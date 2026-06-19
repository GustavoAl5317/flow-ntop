import { useState, useEffect, useCallback } from 'react';
import { Card, Select, Button, Typography, Table, Tag, Spin, Space, Empty, Input } from 'antd';
import { Network, Search, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  getIpBlocks,
  getInterfaces,
  getIpBlockDetail,
  getAsnDetail,
  getInterfaceDetail,
  getIpBlocksRanking,
  type IpBlock,
  type NetInterface,
} from '../services/backendApi';

const { Title, Text } = Typography;

const RANGE_OPTIONS = [
  { label: 'Última 1h',      value: 3600 },
  { label: 'Últimas 6h',     value: 6 * 3600 },
  { label: 'Últimas 24h',    value: 24 * 3600 },
  { label: 'Últimos 7 dias', value: 7 * 24 * 3600 },
];

// Tipo de alvo exigido por cada consulta
type Target = 'bloco' | 'asn' | 'interface' | 'cliente' | 'none';

interface QueryDef {
  key: string;
  label: string;
  target: Target;
  resultLabel: string;
}

const QUERIES: QueryDef[] = [
  { key: 'asn_por_bloco',     label: 'Qual ASN mais consome determinado bloco?',              target: 'bloco',     resultLabel: 'ASNs (maior consumo)' },
  { key: 'iface_por_asn',     label: 'Qual interface transporta mais tráfego de um ASN?',     target: 'asn',       resultLabel: 'Interfaces (maior tráfego)' },
  { key: 'cliente_por_link',  label: 'Qual cliente utiliza determinado link?',                target: 'interface', resultLabel: 'Clientes / blocos no link' },
  { key: 'bloco_mais_cresceu',label: 'Qual bloco mais cresceu no período?',                   target: 'none',      resultLabel: 'Blocos por crescimento' },
  { key: 'proto_por_asn',     label: 'Qual protocolo domina determinado ASN?',                target: 'asn',       resultLabel: 'Protocolos (maior volume)' },
  { key: 'proto_por_iface',   label: 'Qual protocolo domina determinada interface?',          target: 'interface', resultLabel: 'Protocolos (maior volume)' },
  { key: 'clientes_por_asn',  label: 'Quais clientes utilizam determinado ASN?',              target: 'asn',       resultLabel: 'Clientes / blocos do ASN' },
  { key: 'ifaces_por_cliente',label: 'Quais interfaces transportam determinado cliente?',     target: 'cliente',   resultLabel: 'Interfaces do cliente' },
];

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes; let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(2)} ${units[i]}`;
}

interface ResultRow {
  key: string;
  nome: string;
  sub?: string;
  bytes?: number;
  extra?: string;
  link?: string;
}

export function NetworkQueryPage() {
  const navigate = useNavigate();
  const [rangeSeconds, setRangeSeconds] = useState(24 * 3600);
  const [queryKey, setQueryKey] = useState<string>(QUERIES[0].key);
  const [blocks, setBlocks]   = useState<IpBlock[]>([]);
  const [ifaces, setIfaces]   = useState<NetInterface[]>([]);
  const [targetValue, setTargetValue] = useState<string | number | undefined>(undefined);
  const [asnInput, setAsnInput] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [resultTitle, setResultTitle] = useState<string>('');
  const [ran, setRan] = useState(false);

  const query = QUERIES.find(q => q.key === queryKey)!;

  // Catálogos para os seletores
  useEffect(() => {
    getIpBlocks().then(r => setBlocks(r.blocks)).catch(() => {});
    getInterfaces().then(r => setIfaces(r.interfaces)).catch(() => {});
  }, []);

  // Lista de clientes derivada dos blocos cadastrados
  const clientes = [...new Set(blocks.map(b => b.customer).filter((c): c is string => !!c))].sort();

  // Reset do alvo ao trocar de consulta
  useEffect(() => { setTargetValue(undefined); setAsnInput(''); setRows([]); setRan(false); }, [queryKey]);

  const run = useCallback(async () => {
    const now = Math.floor(Date.now() / 1000);
    const epoch_begin = now - rangeSeconds;
    const params = { epoch_begin, epoch_end: now };
    setLoading(true);
    setRan(true);
    let out: ResultRow[] = [];
    let title = '';

    try {
      switch (queryKey) {
        case 'asn_por_bloco': {
          if (!targetValue) break;
          const d = await getIpBlockDetail(Number(targetValue), params);
          title = `ASNs que mais consomem ${d.block.label} (${d.block.cidr})`;
          out = d.top_asns.map(a => ({
            key: `as${a.asn}`, nome: `AS${a.asn}`, bytes: a.bytes,
            extra: `${a.flows} fluxos`, link: `/asn/${a.asn}`,
          }));
          break;
        }
        case 'iface_por_asn': {
          const asn = parseInt(asnInput.replace(/\D/g, ''), 10);
          if (!asn) break;
          const d = await getAsnDetail(asn, params);
          title = `Interfaces que mais transportam tráfego do AS${asn}`;
          out = d.top_interfaces.map(i => ({
            key: `if${i.id}`, nome: i.name, sub: i.link_type ?? undefined,
            bytes: i.bytes, extra: `${i.flows} fluxos`, link: `/interfaces/${i.id}`,
          }));
          break;
        }
        case 'cliente_por_link': {
          if (!targetValue) break;
          const d = await getInterfaceDetail(Number(targetValue), params);
          title = `Clientes / blocos com tráfego em ${d.iface.name}`;
          out = d.active_blocks.map(b => ({
            key: `b${b.id}`, nome: b.label, sub: b.cidr,
            extra: `${b.ip_count} IP${b.ip_count !== 1 ? 's' : ''}`, link: `/ip-blocks/${b.id}`,
          }));
          break;
        }
        case 'bloco_mais_cresceu': {
          const prevEnd = epoch_begin;
          const prevBegin = prevEnd - rangeSeconds;
          const [cur, prev] = await Promise.all([
            getIpBlocksRanking(params),
            getIpBlocksRanking({ epoch_begin: prevBegin, epoch_end: prevEnd }),
          ]);
          const prevMap: Record<number, number> = {};
          prev.ranking.forEach(b => { prevMap[b.id] = b.total_bytes; });
          title = 'Blocos ordenados por crescimento vs. período anterior';
          out = cur.ranking.map(b => {
            const before = prevMap[b.id] ?? 0;
            const growth = before > 0 ? ((b.total_bytes - before) / before * 100) : (b.total_bytes > 0 ? 100 : 0);
            return {
              key: `b${b.id}`, nome: b.label, sub: b.cidr, bytes: b.total_bytes,
              extra: `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`, link: `/ip-blocks/${b.id}`,
              _growth: growth,
            } as ResultRow & { _growth: number };
          }).sort((a, b) => (b as ResultRow & { _growth: number })._growth - (a as ResultRow & { _growth: number })._growth);
          break;
        }
        case 'proto_por_asn': {
          const asn = parseInt(asnInput.replace(/\D/g, ''), 10);
          if (!asn) break;
          const d = await getAsnDetail(asn, params);
          title = `Protocolos dominantes no AS${asn}`;
          const tot = d.top_protocols.reduce((s, p) => s + p.bytes, 0);
          out = d.top_protocols.map(p => ({
            key: `p${p.protocol}`, nome: p.protocol, bytes: p.bytes,
            extra: tot > 0 ? `${(p.bytes / tot * 100).toFixed(1)}%` : '—',
          }));
          break;
        }
        case 'proto_por_iface': {
          if (!targetValue) break;
          const d = await getInterfaceDetail(Number(targetValue), params);
          title = `Protocolos dominantes em ${d.iface.name}`;
          const tot = d.top_protocols.reduce((s, p) => s + p.bytes, 0);
          out = d.top_protocols.map(p => ({
            key: `p${p.protocol}`, nome: p.protocol, bytes: p.bytes,
            extra: tot > 0 ? `${(p.bytes / tot * 100).toFixed(1)}%` : '—',
          }));
          break;
        }
        case 'clientes_por_asn': {
          const asn = parseInt(asnInput.replace(/\D/g, ''), 10);
          if (!asn) break;
          const d = await getAsnDetail(asn, params);
          title = `Clientes / blocos que se comunicam com o AS${asn}`;
          out = d.touched_blocks.map(b => ({
            key: `b${b.id}`, nome: b.label, sub: b.cidr,
            extra: `${b.ip_count} IP${b.ip_count !== 1 ? 's' : ''}`, link: `/ip-blocks/${b.id}`,
          }));
          break;
        }
        case 'ifaces_por_cliente': {
          if (!targetValue) break;
          const customerBlocks = blocks.filter(b => b.customer === targetValue);
          title = `Interfaces transportando tráfego do cliente "${targetValue}"`;
          const details = await Promise.all(
            customerBlocks.map(b => getIpBlockDetail(b.id, params).catch(() => null)),
          );
          const agg: Record<number, { name: string; link_type: string | null; bytes: number }> = {};
          details.forEach(d => {
            if (!d) return;
            d.active_interfaces.forEach(i => {
              if (!agg[i.id]) agg[i.id] = { name: i.name, link_type: i.link_type, bytes: 0 };
              agg[i.id].bytes += (i.in_bytes ?? 0) + (i.out_bytes ?? 0);
            });
          });
          out = Object.entries(agg).map(([id, v]) => ({
            key: `if${id}`, nome: v.name, sub: v.link_type ?? undefined,
            bytes: v.bytes, link: `/interfaces/${id}`,
          })).sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
          break;
        }
      }
    } catch {
      out = [];
      title = 'Erro ao executar a consulta';
    }

    setRows(out);
    setResultTitle(title);
    setLoading(false);
  }, [queryKey, targetValue, asnInput, rangeSeconds, blocks]);

  // Seletor de alvo dinâmico
  const renderTargetSelector = () => {
    if (query.target === 'none') return <Text style={{ color: '#475569', fontSize: 12 }}>Sem alvo — usa o período selecionado</Text>;
    if (query.target === 'asn') {
      return (
        <Input
          placeholder="Número do ASN (ex: 7738)" style={{ width: 260 }}
          value={asnInput}
          onChange={e => setAsnInput(e.target.value)}
          onPressEnter={() => { if (canRun) run(); }}
          prefix={<span style={{ color: '#475569', fontSize: 12 }}>AS</span>}
        />
      );
    }
    if (query.target === 'bloco') {
      return (
        <Select
          showSearch placeholder="Selecione o bloco IP" style={{ width: 320 }}
          value={targetValue} onChange={v => setTargetValue(v)}
          filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
          options={blocks.map(b => ({ value: b.id, label: `${b.label} — ${b.cidr}` }))}
        />
      );
    }
    if (query.target === 'interface') {
      return (
        <Select
          showSearch placeholder="Selecione a interface" style={{ width: 320 }}
          value={targetValue} onChange={v => setTargetValue(v)}
          filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
          options={ifaces.map(i => ({ value: i.id, label: `${i.name}${i.link_type ? ` (${i.link_type})` : ''}` }))}
        />
      );
    }
    // cliente
    return (
      <Select
        showSearch placeholder="Selecione o cliente" style={{ width: 320 }}
        value={targetValue} onChange={v => setTargetValue(v)}
        filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
        options={clientes.map(c => ({ value: c, label: c }))}
        notFoundContent={<Text style={{ color: '#64748b' }}>Nenhum cliente cadastrado nos blocos IP</Text>}
      />
    );
  };

  const canRun = query.target === 'none'
    || (query.target === 'asn' ? !!asnInput : !!targetValue);

  return (
    <main style={{ flex: 1, padding: '16px 20px', background: '#060d1f', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Network size={20} color="#00c8f0" />
        <Title level={4} style={{ color: '#e2e8f0', margin: 0 }}>Consultas Inteligentes</Title>
      </div>
      <Text style={{ color: '#64748b', fontSize: 13, display: 'block', marginBottom: 16 }}>
        Correlação entre Fluxo → Interface → Bloco IP → ASN → Cliente. Selecione uma pergunta e o alvo.
      </Text>

      <Card style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8, marginBottom: 16 }}
        styles={{ body: { padding: 16 } }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Text style={{ color: '#94a3b8', fontSize: 12, width: 70 }}>Pergunta:</Text>
            <Select
              value={queryKey} onChange={v => setQueryKey(v)} style={{ width: 460 }}
              options={QUERIES.map(q => ({ value: q.key, label: q.label }))}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Text style={{ color: '#94a3b8', fontSize: 12, width: 70 }}>Alvo:</Text>
            {renderTargetSelector()}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Text style={{ color: '#94a3b8', fontSize: 12, width: 70 }}>Período:</Text>
            <Select value={rangeSeconds} onChange={v => setRangeSeconds(v)} options={RANGE_OPTIONS} style={{ width: 180 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={run} disabled={!canRun} loading={loading}>
              Consultar
            </Button>
          </div>
        </Space>
      </Card>

      <Card title={<span style={{ color: '#94a3b8' }}>{resultTitle || query.resultLabel}</span>}
        style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
        styles={{ body: { padding: 0 } }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>
        ) : !ran ? (
          <div style={{ padding: 32 }}>
            <Empty description={<Text style={{ color: '#475569' }}>Selecione uma pergunta e clique em Consultar</Text>} />
          </div>
        ) : (
          <Table<ResultRow>
            size="small" rowKey="key" pagination={{ pageSize: 15 }}
            dataSource={rows}
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem resultados para este alvo no período</Text> }}
            onRow={r => ({
              style: { cursor: r.link ? 'pointer' : 'default' },
              onClick: () => { if (r.link) navigate(r.link); },
            })}
            columns={[
              { title: 'Item', key: 'nome', render: (_, r) => (
                <div>
                  <span style={{ color: '#00c8f0', fontWeight: 600 }}>{r.nome}</span>
                  {r.sub && <span style={{ display: 'block', color: '#475569', fontSize: 11, fontFamily: 'monospace' }}>{r.sub}</span>}
                </div>
              ) },
              { title: 'Volume', dataIndex: 'bytes', width: 130, align: 'right',
                render: (v?: number) => v != null ? <strong style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{formatBytes(v)}</strong> : '—' },
              { title: 'Detalhe', dataIndex: 'extra', width: 110, align: 'right',
                render: (v?: string) => v ? <Tag color={v.startsWith('+') ? 'green' : v.startsWith('-') ? 'red' : 'default'}>{v}</Tag> : null },
              { title: '', key: 'go', width: 40, align: 'center',
                render: (_, r) => r.link ? <ArrowRight size={14} color="#475569" /> : null },
            ]}
          />
        )}
      </Card>
    </main>
  );
}

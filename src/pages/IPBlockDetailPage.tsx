import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Tag, Select, Button, Typography, Space, Spin, Switch, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import dayjs from 'dayjs';
import { ArrowLeft, RefreshCw, Shield, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getIpBlockDetail,
  type IpBlockDetail,
  type IpBlockActiveInterface,
  type IpBlockTimeseriesPoint,
} from '../services/backendApi';

const { Title, Text } = Typography;

const RANGE_OPTIONS = [
  { label: 'Última 1h',      value: 3600 },
  { label: 'Últimas 6h',     value: 6 * 3600 },
  { label: 'Últimas 24h',    value: 24 * 3600 },
  { label: 'Últimos 7 dias', value: 7 * 24 * 3600 },
];

const TYPE_COLORS: Record<string, string> = {
  Cliente: 'blue', Transit: 'purple', CDN: 'cyan', IX: 'green',
  Backbone: 'orange', Servidor: 'gold', Infraestrutura: 'volcano', Backup: 'default',
};

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes; let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(2)} ${units[i]}`;
}

function fmtMbps(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(2)} Gbps`;
  return `${v.toFixed(2)} Mbps`;
}

function bucketFor(range: number): number {
  if (range <= 3600)       return 60;
  if (range <= 6 * 3600)  return 300;
  if (range <= 24 * 3600) return 900;
  return 3600 * 2;
}

export function IPBlockDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [rangeSeconds, setRangeSeconds] = useState(6 * 3600);
  const [detail, setDetail] = useState<IpBlockDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [prevTimeseries, setPrevTimeseries] = useState<IpBlockTimeseriesPoint[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      const data = await getIpBlockDetail(Number(id), {
        epoch_begin: now - rangeSeconds,
        epoch_end: now,
        bucket_seconds: bucketFor(rangeSeconds),
      });
      setDetail(data);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao carregar detalhe do bloco');
    } finally {
      setLoading(false);
    }
  }, [id, rangeSeconds]);

  const loadCompare = useCallback(async () => {
    if (!id || !showCompare) { setPrevTimeseries([]); return; }
    try {
      const now  = Math.floor(Date.now() / 1000);
      const prev_end   = now - rangeSeconds;
      const prev_begin = prev_end - rangeSeconds;
      const data = await getIpBlockDetail(Number(id), {
        epoch_begin: prev_begin,
        epoch_end: prev_end,
        bucket_seconds: bucketFor(rangeSeconds),
      });
      setPrevTimeseries(data.timeseries);
    } catch { setPrevTimeseries([]); }
  }, [id, rangeSeconds, showCompare]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCompare(); }, [loadCompare]);

  if (loading && !detail) {
    return (
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#060d1f' }}>
        <Spin size="large" />
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main style={{ flex: 1, padding: '16px 20px', background: '#060d1f' }}>
        <Button icon={<ArrowLeft size={14} />} onClick={() => navigate('/ip-blocks')}
          style={{ background: '#0f1f3d', borderColor: '#1e2d4a', color: '#94a3b8', marginBottom: 16 }}>
          Voltar
        </Button>
        <Text style={{ color: '#ff3b3b' }}>{error ?? 'Bloco não encontrado'}</Text>
      </main>
    );
  }

  const { block, summary, timeseries, top_asns, top_protocols, top_ports, top_src, top_dst, active_interfaces, cdn_distribution } = detail;
  const bucketSecs = bucketFor(rangeSeconds);

  // ── Distribuição IP x CDN ───────────────────────────────────────────────────
  const cdnBytes    = cdn_distribution?.cdn_bytes ?? 0;
  const nonCdnBytes = cdn_distribution?.noncdn_bytes ?? 0;
  const cdnTotal    = cdnBytes + nonCdnBytes;
  const cdnPct      = cdnTotal > 0 ? (cdnBytes / cdnTotal * 100) : 0;

  // ── Crescimento: 1ª metade vs 2ª metade do período ──────────────────────────
  const half       = Math.floor(timeseries.length / 2);
  const firstHalf  = timeseries.slice(0, half).reduce((s, p) => s + p.in_bytes + p.out_bytes, 0);
  const secondHalf = timeseries.slice(half).reduce((s, p) => s + p.in_bytes + p.out_bytes, 0);
  const growthPct  = half > 2 && firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf * 100) : null;

  // ── Chart data ───────────────────────────────────────────────────────────────
  const labels      = timeseries.map(p => dayjs.unix(p.bucket).format('DD/MM HH:mm'));
  const inMbps      = timeseries.map(p => Number(((p.in_bytes  ?? 0) * 8 / bucketSecs / 1_000_000).toFixed(3)));
  const outMbps     = timeseries.map(p => Number(((p.out_bytes ?? 0) * 8 / bucketSecs / 1_000_000).toFixed(3)));
  const prevInMbps  = prevTimeseries.map(p => Number(((p.in_bytes  ?? 0) * 8 / bucketSecs / 1_000_000).toFixed(3)));
  const prevOutMbps = prevTimeseries.map(p => Number(((p.out_bytes ?? 0) * 8 / bucketSecs / 1_000_000).toFixed(3)));

  const hasPrev = showCompare && prevInMbps.length > 0;

  const chartOptions: ApexOptions = {
    chart: {
      background: 'transparent', type: 'area',
      toolbar: { show: true, tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true, download: false } },
      animations: { enabled: false }, stacked: false,
    },
    colors: ['#00c8f0', '#f59e0b', '#00c8f055', '#f59e0b55'],
    stroke: {
      curve: 'smooth',
      width:     [2, 2, 1.5, 1.5],
      dashArray: [0, 0,   6,    6],
    },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0.02 } },
    xaxis: {
      categories: labels,
      labels: { style: { colors: '#475569', fontSize: '10px' }, rotate: 0 },
      tickAmount: Math.min(10, labels.length),
    },
    yaxis: { labels: { style: { colors: '#475569', fontSize: '11px' }, formatter: v => `${v.toFixed(1)} Mbps` } },
    grid: { borderColor: '#1e2d4a', strokeDashArray: 4 },
    tooltip: { theme: 'dark', y: { formatter: v => `${v.toFixed(2)} Mbps` } },
    legend: { labels: { colors: '#94a3b8' }, fontSize: '12px' },
    dataLabels: { enabled: false },
    annotations: {
      yaxis: [
        { y: summary.avg_mbps, borderColor: '#8b5cf6', borderWidth: 1, strokeDashArray: 4,
          label: { text: `Média ${fmtMbps(summary.avg_mbps)}`, style: { color: '#8b5cf6', background: '#0a0f1e', fontSize: '10px' } } },
      ],
    },
  };

  const chartSeries = [
    { name: 'IN (↓)',        data: inMbps },
    { name: 'OUT (↑)',       data: outMbps },
    ...(hasPrev ? [
      { name: 'IN — per. ant.',  data: prevInMbps },
      { name: 'OUT — per. ant.', data: prevOutMbps },
    ] : []),
  ];

  // ── Table columns ────────────────────────────────────────────────────────────
  const asnCols: ColumnsType<{ asn: number; bytes: number; flows: number }> = [
    { title: 'ASN', dataIndex: 'asn', render: (v: number) => (
      <Tag color="purple" style={{ fontFamily: 'monospace', cursor: 'pointer' }}
        onClick={() => navigate(`/asn/${v}`)}>AS{v}</Tag>
    )},
    { title: 'Bytes', dataIndex: 'bytes', align: 'right', sorter: (a, b) => a.bytes - b.bytes, defaultSortOrder: 'descend',
      render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text> },
    { title: 'Fluxos', dataIndex: 'flows', align: 'right',
      render: (v: number) => <Text style={{ color: '#94a3b8' }}>{v.toLocaleString('pt-BR')}</Text> },
  ];

  const protoCols: ColumnsType<{ protocol: string; bytes: number; flows: number }> = [
    { title: 'Protocolo', dataIndex: 'protocol',
      render: (v: string) => <Tag style={{ background: '#0d1b2e', borderColor: '#1e3a5f', color: '#94a3b8' }}>{v}</Tag> },
    { title: 'Bytes', dataIndex: 'bytes', align: 'right', sorter: (a, b) => a.bytes - b.bytes, defaultSortOrder: 'descend',
      render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text> },
    { title: 'Fluxos', dataIndex: 'flows', align: 'right',
      render: (v: number) => <Text style={{ color: '#94a3b8' }}>{v.toLocaleString('pt-BR')}</Text> },
  ];

  const portCols: ColumnsType<{ port: number; protocol: string; bytes: number; flows: number }> = [
    { title: 'Porta',    dataIndex: 'port',     render: (v: number) => <Text style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v}</Text> },
    { title: 'Proto',    dataIndex: 'protocol' },
    { title: 'Bytes',    dataIndex: 'bytes',    align: 'right', sorter: (a, b) => a.bytes - b.bytes, defaultSortOrder: 'descend',
      render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text> },
    { title: 'Fluxos',   dataIndex: 'flows',   align: 'right',
      render: (v: number) => <Text style={{ color: '#94a3b8' }}>{v.toLocaleString('pt-BR')}</Text> },
  ];

  const ifaceCols: ColumnsType<IpBlockActiveInterface> = [
    {
      title: 'Interface', key: 'name',
      render: (_, r) => (
        <div style={{ cursor: 'pointer' }} onClick={() => navigate(`/interfaces/${r.id}`)}>
          <Text style={{ color: '#00c8f0', fontSize: 12 }}>{r.name}</Text>
          {r.link_type && <Tag color="geekblue" style={{ fontSize: 10, marginLeft: 6 }}>{r.link_type}</Tag>}
          <Text style={{ display: 'block', color: '#475569', fontSize: 11, fontFamily: 'monospace' }}>
            ifid {r.ifid} · {r.router_ip}
          </Text>
        </div>
      ),
    },
    { title: 'IN',     dataIndex: 'in_bytes',  align: 'right',
      render: (v: number) => <Text style={{ color: '#00c8f0',  fontFamily: 'monospace' }}>{formatBytes(v)}</Text> },
    { title: 'OUT',    dataIndex: 'out_bytes', align: 'right',
      render: (v: number) => <Text style={{ color: '#f59e0b',  fontFamily: 'monospace' }}>{formatBytes(v)}</Text> },
    { title: 'Fluxos', dataIndex: 'flows',     align: 'right',
      render: (v: number) => <Text style={{ color: '#94a3b8' }}>{v.toLocaleString('pt-BR')}</Text> },
  ];

  const ipCols: ColumnsType<{ ip: string; bytes: number; flows: number }> = [
    { title: 'IP', dataIndex: 'ip', render: (v: string) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontFamily: 'monospace', color: '#e2e8f0', fontSize: 12 }}>{v}</Text>
        <Tooltip title="Ver fluxos deste IP">
          <ExternalLink size={11} color="#475569" style={{ cursor: 'pointer' }}
            onClick={() => navigate('/consulta', { state: { ip: v } })} />
        </Tooltip>
      </div>
    )},
    { title: 'Bytes',  dataIndex: 'bytes', align: 'right', sorter: (a, b) => a.bytes - b.bytes, defaultSortOrder: 'descend',
      render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text> },
    { title: 'Fluxos', dataIndex: 'flows', align: 'right',
      render: (v: number) => <Text style={{ color: '#94a3b8' }}>{v.toLocaleString('pt-BR')}</Text> },
  ];

  const isClientBlock = block.type === 'Cliente';

  return (
    <main style={{ flex: 1, overflow: 'auto', padding: '16px 20px', background: '#060d1f' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button icon={<ArrowLeft size={14} />} onClick={() => navigate('/ip-blocks')}
            style={{ background: '#0f1f3d', borderColor: '#1e2d4a', color: '#94a3b8' }}>
            Voltar
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: '8px', borderRadius: 8, background: '#00c8f015' }}>
              <Shield size={18} style={{ color: '#00c8f0' }} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color="blue" style={{ fontFamily: 'monospace', fontSize: 14, margin: 0 }}>{block.cidr}</Tag>
                {block.type && <Tag color={TYPE_COLORS[block.type] ?? 'default'} style={{ fontSize: 12 }}>{block.type}</Tag>}
                {block.category && <Text style={{ color: '#64748b', fontSize: 12 }}>{block.category}</Text>}
              </div>
              <Title level={5} style={{ color: '#e2e8f0', margin: '2px 0 0' }}>{block.label}</Title>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
                {block.customer && <Text style={{ color: '#64748b', fontSize: 12 }}>Cliente: {block.customer}</Text>}
                {block.description && <Text style={{ color: '#475569', fontSize: 12 }}>{block.description}</Text>}
              </div>
            </div>
          </div>
        </div>
        <Space>
          <Button
            icon={<ExternalLink size={13} />}
            onClick={() => navigate('/consulta', { state: { cidr: block.cidr } })}
            style={{ background: '#0f1f3d', borderColor: '#1e2d4a', color: '#475569', fontSize: 12 }}
            size="small"
          >
            Ver fluxos
          </Button>
          <Select value={rangeSeconds} onChange={setRangeSeconds} options={RANGE_OPTIONS} style={{ width: 150 }} />
          <Button icon={<RefreshCw size={14} />} onClick={load} loading={loading}
            style={{ background: '#0f1f3d', borderColor: '#1e2d4a', color: '#94a3b8' }}>
            Atualizar
          </Button>
        </Space>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Total',    value: formatBytes(summary.total_bytes), color: '#e2e8f0' },
          { label: 'IN (↓)',   value: formatBytes(summary.in_bytes),    color: '#00c8f0' },
          { label: 'OUT (↑)',  value: formatBytes(summary.out_bytes),   color: '#f59e0b' },
          { label: 'Fluxos',   value: summary.total_flows.toLocaleString('pt-BR'), color: '#64748b' },
          { label: 'Pico',     value: fmtMbps(summary.peak_mbps),      color: '#8b5cf6' },
          { label: 'Média',    value: fmtMbps(summary.avg_mbps),       color: '#10b981' },
        ].map(m => (
          <div key={m.label} style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8, padding: '10px 14px' }}>
            <Text style={{ color: '#475569', fontSize: 10, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.label}</Text>
            <Text style={{ color: m.color, fontSize: 15, fontWeight: 700, fontFamily: 'monospace', display: 'block' }}>{m.value}</Text>
          </div>
        ))}
      </div>

      {/* IN/OUT chart */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ color: '#94a3b8' }}>Banda IN/OUT</span>
            <span style={{ color: '#00c8f0', fontSize: 12 }}>■ IN</span>
            <span style={{ color: '#f59e0b', fontSize: 12 }}>■ OUT</span>
            {growthPct !== null && (
              <Tooltip title="Crescimento: comparativo 1ª metade vs 2ª metade do período">
                <Tag color={growthPct > 20 ? 'red' : growthPct > 5 ? 'orange' : growthPct < -5 ? 'green' : 'default'}>
                  {growthPct >= 0 ? <TrendingUp size={11} style={{ marginRight: 3 }} /> : <TrendingDown size={11} style={{ marginRight: 3 }} />}
                  {growthPct >= 0 ? '+' : ''}{growthPct.toFixed(1)}% no período
                </Tag>
              </Tooltip>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: '#475569', fontSize: 12 }}>Comparar c/ período anterior</Text>
              <Switch size="small" checked={showCompare} onChange={setShowCompare} />
            </div>
          </div>
        }
        style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8, marginBottom: 16 }}
        styles={{ body: { padding: 12 } }}
      >
        {timeseries.length > 0 ? (
          <Chart
            key={`block-ts-${id}-${timeseries.length}-${hasPrev}`}
            type="area"
            options={chartOptions}
            series={chartSeries}
            height={250}
          />
        ) : (
          <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#334155' }}>Sem dados de tráfego para este bloco no período.</Text>
          </div>
        )}
      </Card>

      {/* Detail tables 2x2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Card title={<span style={{ color: '#94a3b8' }}>Top ASNs (peers)</span>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table columns={asnCols} dataSource={top_asns} rowKey="asn"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Top Protocolos</span>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table columns={protoCols} dataSource={top_protocols} rowKey="protocol"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>

        <Card
          title={
            <span style={{ color: '#94a3b8' }}>
              {isClientBlock ? 'Top Clientes (IPs enviando para o bloco)' : 'Top Origens'}
            </span>
          }
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table columns={ipCols} dataSource={top_src} rowKey="ip"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>

        <Card
          title={
            <span style={{ color: '#94a3b8' }}>
              {isClientBlock ? 'Top Destinos externos do bloco' : 'Top Destinos (IPs recebendo do bloco)'}
            </span>
          }
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table columns={ipCols} dataSource={top_dst} rowKey="ip"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>
      </div>

      {/* Ports */}
      <Card title={<span style={{ color: '#94a3b8' }}>Top Portas de Destino</span>}
        style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8, marginBottom: 12 }}
        styles={{ body: { padding: 0 } }}>
        <Table columns={portCols} dataSource={top_ports} rowKey={r => `${r.port}-${r.protocol}`}
          pagination={false} size="small"
          locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
          style={{ background: 'transparent' }} />
      </Card>

      {/* Distribuição IP x CDN (peers do bloco que são CDN) ───────────────── */}
      {cdnTotal > 0 && (
        <Card title={<span style={{ color: '#94a3b8' }}>Distribuição IP × CDN</span>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 16 } }}>
          <div style={{ display: 'flex', gap: 24, marginBottom: 14 }}>
            <div>
              <Text style={{ color: '#475569', fontSize: 11, display: 'block' }}>TRÁFEGO CDN</Text>
              <Text style={{ color: '#00c8f0', fontSize: 18, fontFamily: 'monospace', fontWeight: 700 }}>{cdnPct.toFixed(1)}%</Text>
              <Text style={{ color: '#64748b', fontSize: 11, display: 'block' }}>{formatBytes(cdnBytes)}</Text>
            </div>
            <div>
              <Text style={{ color: '#475569', fontSize: 11, display: 'block' }}>IP COMUM</Text>
              <Text style={{ color: '#8b5cf6', fontSize: 18, fontFamily: 'monospace', fontWeight: 700 }}>{(100 - cdnPct).toFixed(1)}%</Text>
              <Text style={{ color: '#64748b', fontSize: 11, display: 'block' }}>{formatBytes(nonCdnBytes)}</Text>
            </div>
          </div>
          <div style={{ background: '#1e2d4a', borderRadius: 4, height: 10, display: 'flex', overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ background: '#00c8f0', width: `${cdnPct}%`, height: 10, transition: 'width .4s' }} />
            <div style={{ background: '#8b5cf6', width: `${100 - cdnPct}%`, height: 10, transition: 'width .4s' }} />
          </div>
          {cdn_distribution.providers.length > 0 && (
            <>
              <Text style={{ color: '#475569', fontSize: 11, display: 'block', marginBottom: 8 }}>TOP PROVEDORES CDN</Text>
              {cdn_distribution.providers.map(p => {
                const pPct = cdnBytes > 0 ? (p.bytes / cdnBytes * 100) : 0;
                return (
                  <div key={p.provider} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ color: '#e2e8f0', fontSize: 12 }}>{p.provider}</span>
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>{formatBytes(p.bytes)} · {pPct.toFixed(1)}%</span>
                    </div>
                    <div style={{ background: '#1e2d4a', borderRadius: 4, height: 5 }}>
                      <div style={{ background: '#00c8f0', width: `${pPct}%`, height: 5, borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </Card>
      )}

      {/* Interfaces */}
      {active_interfaces && active_interfaces.length > 0 && (
        <Card title={<span style={{ color: '#94a3b8' }}>Interfaces com tráfego deste bloco</span>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table columns={ifaceCols} dataSource={active_interfaces} rowKey="id"
            pagination={false} size="small"
            onRow={r => ({ onClick: () => navigate(`/interfaces/${r.id}`), style: { cursor: 'pointer' } })}
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem interfaces registradas</Text> }}
            style={{ background: 'transparent' }} />
        </Card>
      )}
    </main>
  );
}

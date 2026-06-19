import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Input, Form, Select, Typography, Space, Popconfirm, message, Tag, Progress, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { RefreshCw, ExternalLink, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import {
  getIpBlocks,
  createIpBlock,
  deleteIpBlock,
  getIpBlocksStats,
  getIpBlocksRanking,
  type IpBlock,
  type IpBlockStats,
  type IpBlockRankingEntry,
} from '../services/backendApi';

const { Title, Text } = Typography;

const RANGE_OPTIONS = [
  { label: 'Última 1h',      value: 3600 },
  { label: 'Últimas 6h',     value: 6 * 3600 },
  { label: 'Últimas 24h',    value: 24 * 3600 },
  { label: 'Últimos 7 dias', value: 7 * 24 * 3600 },
];

const BLOCK_TYPES = [
  'Cliente', 'Transit', 'CDN', 'IX', 'Backbone', 'Servidor', 'Infraestrutura', 'Backup', 'Outros',
].map(v => ({ label: v, value: v }));

const BLOCK_CATEGORIES = [
  'Residencial', 'Empresarial', 'Data Center', 'Upstream', 'Downstream', 'Interno', 'Externo',
].map(v => ({ label: v, value: v }));

const TYPE_COLORS: Record<string, string> = {
  Cliente: 'blue', Transit: 'purple', CDN: 'cyan', IX: 'green',
  Backbone: 'orange', Servidor: 'gold', Infraestrutura: 'volcano', Backup: 'default',
};

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes; let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(2)} ${units[i]}`;
}

interface BlockRow extends IpBlock {
  total_bytes: number;
  total_packets: number;
  total_flows: number;
}

export function IPBlocksPage() {
  const navigate = useNavigate();
  const [blocks, setBlocks]               = useState<BlockRow[]>([]);
  const [ranking, setRanking]             = useState<IpBlockRankingEntry[]>([]);
  const [prevRankingMap, setPrevRankingMap] = useState<Record<number, IpBlockRankingEntry>>({});
  const [loading, setLoading]             = useState(false);
  const [rangeSeconds, setRangeSeconds]   = useState(3600);
  const [form] = Form.useForm();
  const [adding, setAdding]               = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const now        = Math.floor(Date.now() / 1000);
      const epoch_end  = now;
      const epoch_begin = now - rangeSeconds;
      const prevEnd    = epoch_begin;
      const prevBegin  = prevEnd - rangeSeconds;

      const [{ blocks: bl }, { stats }, { ranking: rk }, prevResult] = await Promise.all([
        getIpBlocks(),
        getIpBlocksStats({ epoch_begin, epoch_end }),
        getIpBlocksRanking({ epoch_begin, epoch_end }),
        getIpBlocksRanking({ epoch_begin: prevBegin, epoch_end: prevEnd }).catch(() => ({ ranking: [] })),
      ]);

      const statsMap = Object.fromEntries(stats.map((s: IpBlockStats) => [s.id, s]));
      setBlocks(bl.map((b: IpBlock) => ({
        ...b,
        total_bytes:   statsMap[b.id]?.total_bytes   ?? 0,
        total_packets: statsMap[b.id]?.total_packets ?? 0,
        total_flows:   statsMap[b.id]?.total_flows   ?? 0,
      })));
      setRanking(rk);
      setPrevRankingMap(
        Object.fromEntries((prevResult.ranking as IpBlockRankingEntry[]).map(r => [r.id, r]))
      );
    } catch (e: unknown) {
      message.error((e as Error).message ?? 'Erro ao carregar blocos');
    } finally {
      setLoading(false);
    }
  }, [rangeSeconds]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (values: {
    cidr: string; label: string; customer?: string;
    description?: string; type?: string; category?: string;
  }) => {
    setAdding(true);
    try {
      await createIpBlock({
        cidr: values.cidr.trim(),
        label: values.label.trim(),
        customer: values.customer?.trim() || null,
        description: values.description?.trim() || null,
        type: values.type || null,
        category: values.category || null,
      });
      message.success('Bloco adicionado');
      form.resetFields();
      load();
    } catch (e: unknown) {
      message.error((e as Error).message ?? 'Erro ao adicionar bloco');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteIpBlock(id);
      message.success('Bloco removido');
      load();
    } catch (e: unknown) {
      message.error((e as Error).message ?? 'Erro ao remover bloco');
    }
  };

  // ── Derived state ────────────────────────────────────────────────────────────

  // Growth per block (current vs previous period)
  const growthMap: Record<number, number> = {};
  for (const r of ranking) {
    const prev = prevRankingMap[r.id];
    if (prev && prev.total_bytes > 0) {
      growthMap[r.id] = (r.total_bytes - prev.total_bytes) / prev.total_bytes * 100;
    }
  }

  // Anomaly threshold: blocks growing > 50% vs previous period
  const anomalies = ranking.filter(r => (growthMap[r.id] ?? 0) > 50);

  // Customer grouping
  const byCustomer = blocks.reduce((acc, b) => {
    if (!b.customer) return acc;
    if (!acc[b.customer]) acc[b.customer] = { blocks: [], total_bytes: 0 };
    acc[b.customer].blocks.push(b);
    acc[b.customer].total_bytes += b.total_bytes;
    return acc;
  }, {} as Record<string, { blocks: BlockRow[]; total_bytes: number }>);
  const customerEntries = Object.entries(byCustomer).sort((a, b) => b[1].total_bytes - a[1].total_bytes);

  const columns: ColumnsType<BlockRow> = [
    {
      title: 'CIDR',
      dataIndex: 'cidr',
      render: (v: string) => <Tag color="blue" style={{ fontFamily: 'monospace', fontSize: 13 }}>{v}</Tag>,
    },
    {
      title: 'Label / Cliente',
      key: 'label',
      render: (_: unknown, r: BlockRow) => (
        <div>
          <Text strong style={{ color: '#e2e8f0', display: 'block' }}>{r.label}</Text>
          {r.customer && <Text style={{ color: '#64748b', fontSize: 11 }}>{r.customer}</Text>}
        </div>
      ),
    },
    {
      title: 'Tipo',
      dataIndex: 'type',
      render: (v: string | null) => v
        ? <Tag color={TYPE_COLORS[v] ?? 'default'} style={{ fontSize: 11 }}>{v}</Tag>
        : <Text style={{ color: '#334155' }}>—</Text>,
    },
    {
      title: 'Categoria',
      dataIndex: 'category',
      render: (v: string | null) => v
        ? <Text style={{ color: '#94a3b8', fontSize: 12 }}>{v}</Text>
        : <Text style={{ color: '#334155' }}>—</Text>,
    },
    {
      title: 'Total Bytes',
      dataIndex: 'total_bytes',
      align: 'right',
      sorter: (a, b) => a.total_bytes - b.total_bytes,
      defaultSortOrder: 'descend',
      render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text>,
    },
    {
      title: 'Fluxos',
      dataIndex: 'total_flows',
      align: 'right',
      sorter: (a, b) => a.total_flows - b.total_flows,
      render: (v: number) => <Text style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{v.toLocaleString('pt-BR')}</Text>,
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      align: 'center',
      render: (_: unknown, row: BlockRow) => (
        <Space size={4}>
          <Button
            type="text" size="small" icon={<ExternalLink size={13} />}
            onClick={e => { e.stopPropagation(); navigate(`/ip-blocks/${row.id}`); }}
            style={{ color: '#00c8f0' }} title="Abrir dashboard"
          />
          <Popconfirm
            title="Remover este bloco?" onConfirm={() => handleDelete(row.id)}
            okText="Remover" cancelText="Cancelar" okButtonProps={{ danger: true }}>
            <Button type="text" icon={<DeleteOutlined />} danger size="small"
              onClick={e => e.stopPropagation()} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <main style={{ flex: 1, overflow: 'auto', padding: '16px 20px', background: '#060d1f' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ color: '#e2e8f0', margin: 0 }}>Blocos IP Monitorados</Title>
        <Space>
          <Select value={rangeSeconds} onChange={setRangeSeconds} options={RANGE_OPTIONS} style={{ width: 150 }} />
          <Button icon={<RefreshCw size={14} />} onClick={load} loading={loading}
            style={{ background: '#0f1f3d', borderColor: '#1e2d4a', color: '#94a3b8' }}>
            Atualizar
          </Button>
        </Space>
      </div>

      {/* ── Anomaly alert ──────────────────────────────────────────────────────── */}
      {anomalies.length > 0 && (
        <div style={{
          background: '#ff3b3b0d', border: '1px solid #ff3b3b33', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <AlertTriangle size={16} style={{ color: '#ff3b3b', flexShrink: 0 }} />
          <Text style={{ color: '#fca5a5', fontSize: 13 }}>
            <strong>{anomalies.length} bloco{anomalies.length > 1 ? 's' : ''} com consumo anormal</strong>
            {' '}(crescimento &gt; 50% vs período anterior):{' '}
            {anomalies.slice(0, 3).map(r => (
              <Tag key={r.id} color="error" style={{ fontFamily: 'monospace', cursor: 'pointer' }}
                onClick={() => navigate(`/ip-blocks/${r.id}`)}>
                {r.cidr} +{growthMap[r.id]?.toFixed(0)}%
              </Tag>
            ))}
            {anomalies.length > 3 && <Text style={{ color: '#64748b', fontSize: 12 }}>e mais {anomalies.length - 3}…</Text>}
          </Text>
        </div>
      )}

      {/* ── Add form ───────────────────────────────────────────────────────────── */}
      <Card style={{ background: '#0a1628', border: '1px solid #1e2d4a', marginBottom: 16, borderRadius: 8 }}
        styles={{ body: { padding: '16px 20px' } }}>
        <Text style={{ color: '#94a3b8', display: 'block', marginBottom: 12 }}>Adicionar bloco IP (CIDR)</Text>
        <Form form={form} layout="inline" onFinish={handleAdd}>
          <Form.Item name="cidr" rules={[
            { required: true, message: 'Informe o CIDR' },
            { pattern: /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, message: 'Formato inválido (ex: 192.168.0.0/24)' },
          ]}>
            <Input placeholder="192.168.0.0/24" style={{ width: 170, fontFamily: 'monospace', background: '#060d1f', borderColor: '#1e2d4a', color: '#e2e8f0' }} />
          </Form.Item>
          <Form.Item name="label" rules={[{ required: true, message: 'Informe o label' }]}>
            <Input placeholder="Label" style={{ width: 150, background: '#060d1f', borderColor: '#1e2d4a', color: '#e2e8f0' }} />
          </Form.Item>
          <Form.Item name="customer">
            <Input placeholder="Cliente" style={{ width: 140, background: '#060d1f', borderColor: '#1e2d4a', color: '#e2e8f0' }} />
          </Form.Item>
          <Form.Item name="type">
            <Select placeholder="Tipo" allowClear options={BLOCK_TYPES} style={{ width: 130 }} />
          </Form.Item>
          <Form.Item name="category">
            <Select placeholder="Categoria" allowClear options={BLOCK_CATEGORIES} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="description">
            <Input placeholder="Descrição (opcional)" style={{ width: 200, background: '#060d1f', borderColor: '#1e2d4a', color: '#e2e8f0' }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={adding} icon={<PlusOutlined />}
              style={{ background: '#00c8f0', borderColor: '#00c8f0', color: '#000' }}>
              Adicionar
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* ── Blocks table ───────────────────────────────────────────────────────── */}
      <Card style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8, marginBottom: 16 }}
        styles={{ body: { padding: 0 } }}>
        <Table
          columns={columns} dataSource={blocks} rowKey="id" loading={loading}
          pagination={false} size="small"
          onRow={row => ({ onClick: () => navigate(`/ip-blocks/${row.id}`), style: { cursor: 'pointer' } })}
          locale={{ emptyText: <Text style={{ color: '#334155' }}>Nenhum bloco cadastrado</Text> }}
          style={{ background: 'transparent' }}
        />
      </Card>

      {/* ── Customer grouping ──────────────────────────────────────────────────── */}
      {customerEntries.length > 0 && (
        <Card
          title={<span style={{ color: '#94a3b8' }}>Agrupamento por Cliente</span>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8, marginBottom: 16 }}
          styles={{ body: { padding: '12px 16px' } }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {customerEntries.map(([customer, { blocks: cBlocks, total_bytes }]) => (
              <div key={customer} style={{ background: '#060d1f', border: '1px solid #1e2d4a', borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Text strong style={{ color: '#e2e8f0', fontSize: 13 }}>{customer}</Text>
                  <Text style={{ color: '#475569', fontSize: 12 }}>{cBlocks.length} bloco{cBlocks.length !== 1 ? 's' : ''}</Text>
                  <Text style={{ color: '#00c8f0', fontFamily: 'monospace', marginLeft: 'auto' }}>
                    {formatBytes(total_bytes)}
                  </Text>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {cBlocks.map(b => (
                    <Tag key={b.id} color="blue"
                      style={{ fontFamily: 'monospace', cursor: 'pointer', marginBottom: 2 }}
                      onClick={() => navigate(`/ip-blocks/${b.id}`)}>
                      {b.cidr}
                      <Text style={{ color: '#64748b', fontSize: 10, marginLeft: 4 }}>
                        {formatBytes(b.total_bytes)}
                      </Text>
                    </Tag>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Comparative chart: IN vs OUT per block ─────────────────────────────── */}
      {ranking.length > 1 && (() => {
        const top = ranking.slice(0, 10);
        const maxVal = Math.max(...top.flatMap(r => [r.in_bytes ?? 0, r.out_bytes ?? 0]), 1);
        const unit = maxVal >= 1e12 ? 'TB' : maxVal >= 1e9 ? 'GB' : maxVal >= 1e6 ? 'MB' : 'KB';
        const div  = unit === 'TB' ? 1e12 : unit === 'GB' ? 1e9 : unit === 'MB' ? 1e6 : 1e3;

        const options: ApexOptions = {
          chart: { background: 'transparent', toolbar: { show: false }, animations: { enabled: false } },
          plotOptions: { bar: { horizontal: true, barHeight: '60%', dataLabels: { position: 'top' } } },
          colors: ['#00c8f0', '#f59e0b'],
          xaxis: {
            categories: top.map(r => r.label ?? r.cidr),
            labels: { style: { colors: '#475569', fontSize: '11px' }, formatter: (v: number) => `${v.toFixed(1)} ${unit}` },
          },
          yaxis: { labels: { style: { colors: '#94a3b8', fontSize: '11px' } } },
          grid: { borderColor: '#1e2d4a', strokeDashArray: 4 },
          tooltip: { theme: 'dark', y: { formatter: (v: number) => `${v.toFixed(2)} ${unit}` } },
          legend: { labels: { colors: '#94a3b8' }, fontSize: '12px', position: 'top' },
          dataLabels: { enabled: false },
        };

        const series = [
          { name: 'IN (↓)',  data: top.map(r => Number(((r.in_bytes  ?? 0) / div).toFixed(3))) },
          { name: 'OUT (↑)', data: top.map(r => Number(((r.out_bytes ?? 0) / div).toFixed(3))) },
        ];

        return (
          <Card
            title={<span style={{ color: '#94a3b8' }}>Comparação de Blocos — IN vs OUT (Top 10)</span>}
            style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8, marginBottom: 16 }}
            styles={{ body: { padding: 12 } }}
          >
            <Chart type="bar" options={options} series={series} height={320} />
          </Card>
        );
      })()}

      {/* ── Ranking section ────────────────────────────────────────────────────── */}
      {ranking.length > 0 && (
        <Card title={<span style={{ color: '#94a3b8' }}>Ranking de participação no tráfego</span>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: '12px 20px' } }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ranking.slice(0, 10).map(r => {
              const g = growthMap[r.id];
              const isAnomaly = g !== undefined && g > 50;
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                  onClick={() => navigate(`/ip-blocks/${r.id}`)}>
                  <Tag color="blue" style={{ fontFamily: 'monospace', width: 145, textAlign: 'center', flexShrink: 0 }}>{r.cidr}</Tag>
                  <Text style={{ color: '#94a3b8', width: 160, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.label}
                  </Text>
                  <div style={{ flex: 1 }}>
                    <Progress
                      percent={Math.min(r.pct, 100)}
                      showInfo={false}
                      strokeColor={isAnomaly ? '#ff3b3b' : '#00c8f0'}
                      trailColor="#1e2d4a"
                      size="small"
                    />
                  </div>
                  <Text style={{ color: '#00c8f0', fontFamily: 'monospace', width: 90, textAlign: 'right', flexShrink: 0 }}>
                    {formatBytes(r.total_bytes)}
                  </Text>
                  <Text style={{ color: '#475569', width: 40, textAlign: 'right', flexShrink: 0, fontSize: 12 }}>
                    {r.pct.toFixed(1)}%
                  </Text>
                  {g !== undefined && (
                    <Tooltip title={`Crescimento vs período anterior`}>
                      <div style={{ width: 70, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
                        {g >= 0
                          ? <TrendingUp size={12} color={g > 50 ? '#ff3b3b' : '#f59e0b'} />
                          : <TrendingDown size={12} color="#10b981" />}
                        <Text style={{ fontSize: 11, color: g > 50 ? '#ff3b3b' : g >= 0 ? '#f59e0b' : '#10b981', fontFamily: 'monospace' }}>
                          {g >= 0 ? '+' : ''}{g.toFixed(0)}%
                        </Text>
                      </div>
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </main>
  );
}

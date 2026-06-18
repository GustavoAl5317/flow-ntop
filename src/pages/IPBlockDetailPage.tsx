import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Tag, Select, Button, Typography, Space, Spin } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import dayjs from 'dayjs';
import { ArrowLeft, RefreshCw, Shield } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getIpBlockDetail,
  type IpBlockDetail,
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

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      const epoch_begin = now - rangeSeconds;
      const data = await getIpBlockDetail(Number(id), {
        epoch_begin,
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

  useEffect(() => { load(); }, [load]);

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

  const { block, summary, timeseries, top_asns, top_protocols, top_ports, top_src, top_dst } = detail;
  const bucketSecs = bucketFor(rangeSeconds);

  // Chart data
  const labels    = timeseries.map(p => dayjs.unix(p.bucket).format('DD/MM HH:mm'));
  const inMbps    = timeseries.map(p => Number(((p.in_bytes ?? 0) * 8 / bucketSecs / 1_000_000).toFixed(3)));
  const outMbps   = timeseries.map(p => Number(((p.out_bytes ?? 0) * 8 / bucketSecs / 1_000_000).toFixed(3)));

  const chartOptions: ApexOptions = {
    chart: {
      background: 'transparent', type: 'area',
      toolbar: { show: true, tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true, download: false } },
      animations: { enabled: false }, stacked: false,
    },
    colors: ['#00c8f0', '#f59e0b'],
    fill: { type: 'gradient', gradient: { opacityFrom: 0.5, opacityTo: 0.05 } },
    stroke: { curve: 'smooth', width: 2 },
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

  // Table columns
  const asnCols: ColumnsType<{ asn: number; bytes: number; flows: number }> = [
    { title: 'ASN', dataIndex: 'asn', render: v => <Tag color="purple" style={{ fontFamily: 'monospace' }}>AS{v}</Tag> },
    { title: 'Bytes', dataIndex: 'bytes', align: 'right', sorter: (a, b) => a.bytes - b.bytes, defaultSortOrder: 'descend',
      render: v => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text> },
    { title: 'Fluxos', dataIndex: 'flows', align: 'right',
      render: v => <Text style={{ color: '#94a3b8' }}>{v.toLocaleString('pt-BR')}</Text> },
  ];

  const protoCols: ColumnsType<{ protocol: string; bytes: number; flows: number }> = [
    { title: 'Protocolo', dataIndex: 'protocol',
      render: v => <Tag style={{ background: '#0d1b2e', borderColor: '#1e3a5f', color: '#94a3b8' }}>{v}</Tag> },
    { title: 'Bytes', dataIndex: 'bytes', align: 'right', sorter: (a, b) => a.bytes - b.bytes, defaultSortOrder: 'descend',
      render: v => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text> },
    { title: 'Fluxos', dataIndex: 'flows', align: 'right',
      render: v => <Text style={{ color: '#94a3b8' }}>{v.toLocaleString('pt-BR')}</Text> },
  ];

  const portCols: ColumnsType<{ port: number; protocol: string; bytes: number; flows: number }> = [
    { title: 'Porta', dataIndex: 'port', render: v => <Text style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v}</Text> },
    { title: 'Proto', dataIndex: 'protocol' },
    { title: 'Bytes', dataIndex: 'bytes', align: 'right', sorter: (a, b) => a.bytes - b.bytes, defaultSortOrder: 'descend',
      render: v => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text> },
    { title: 'Fluxos', dataIndex: 'flows', align: 'right',
      render: v => <Text style={{ color: '#94a3b8' }}>{v.toLocaleString('pt-BR')}</Text> },
  ];

  const ipCols: ColumnsType<{ ip: string; bytes: number; flows: number }> = [
    { title: 'IP', dataIndex: 'ip', render: v => <Text style={{ fontFamily: 'monospace', color: '#e2e8f0', fontSize: 12 }}>{v}</Text> },
    { title: 'Bytes', dataIndex: 'bytes', align: 'right', sorter: (a, b) => a.bytes - b.bytes, defaultSortOrder: 'descend',
      render: v => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text> },
    { title: 'Fluxos', dataIndex: 'flows', align: 'right',
      render: v => <Text style={{ color: '#94a3b8' }}>{v.toLocaleString('pt-BR')}</Text> },
  ];

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
              {block.customer && <Text style={{ color: '#64748b', fontSize: 12 }}>{block.customer}</Text>}
              {block.description && <Text style={{ color: '#475569', fontSize: 12, display: 'block' }}>{block.description}</Text>}
            </div>
          </div>
        </div>
        <Space>
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
          { label: 'Média',    value: fmtMbps(summary.avg_mbps),        color: '#10b981' },
        ].map(m => (
          <div key={m.label} style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8, padding: '10px 14px' }}>
            <Text style={{ color: '#475569', fontSize: 10, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.label}</Text>
            <Text style={{ color: m.color, fontSize: 15, fontWeight: 700, fontFamily: 'monospace', display: 'block' }}>{m.value}</Text>
          </div>
        ))}
      </div>

      {/* IN/OUT chart */}
      <Card title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#94a3b8' }}>Banda IN/OUT</span>
          <span style={{ color: '#00c8f0', fontSize: 12 }}>■ IN (download para o bloco)</span>
          <span style={{ color: '#f59e0b', fontSize: 12 }}>■ OUT (upload do bloco)</span>
        </div>
      }
        style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8, marginBottom: 16 }}
        styles={{ body: { padding: 12 } }}>
        {timeseries.length > 0 ? (
          <Chart
            key={`block-ts-${id}-${timeseries.length}`}
            type="area"
            options={chartOptions}
            series={[
              { name: 'IN (↓)', data: inMbps },
              { name: 'OUT (↑)', data: outMbps },
            ]}
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

        <Card title={<span style={{ color: '#94a3b8' }}>Top Origens (IPs enviando para o bloco)</span>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table columns={ipCols} dataSource={top_src} rowKey="ip"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Top Destinos (IPs recebendo do bloco)</span>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table columns={ipCols} dataSource={top_dst} rowKey="ip"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>
      </div>

      {/* Ports */}
      <Card title={<span style={{ color: '#94a3b8' }}>Top Portas de Destino (tráfego para o bloco)</span>}
        style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
        styles={{ body: { padding: 0 } }}>
        <Table columns={portCols} dataSource={top_ports} rowKey={r => `${r.port}-${r.protocol}`}
          pagination={false} size="small"
          locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
          style={{ background: 'transparent' }} />
      </Card>
    </main>
  );
}

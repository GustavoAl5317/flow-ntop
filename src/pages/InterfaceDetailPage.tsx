import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Tag, Select, Button, Typography, Space, Spin, Progress, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import dayjs from 'dayjs';
import { ArrowLeft, RefreshCw, Network } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getInterfaceDetail,
  type InterfaceDetail,
  type InterfaceActiveBlock,
} from '../services/backendApi';

const { Title, Text } = Typography;

const RANGE_OPTIONS = [
  { label: 'Última 1h',      value: 3600 },
  { label: 'Últimas 6h',     value: 6 * 3600 },
  { label: 'Últimas 24h',    value: 24 * 3600 },
  { label: 'Últimos 7 dias', value: 7 * 24 * 3600 },
];

const LINK_TYPE_COLORS: Record<string, string> = {
  Transit: 'purple', IX: 'green', CDN: 'cyan', Peering: 'blue',
  Backbone: 'orange', Acesso: 'geekblue', MPLS: 'gold', Fibra: 'lime',
  Wireless: 'volcano', Outros: 'default',
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

function DailyHistoryChart({ data }: { data: Array<{ day: number; in_bytes: number; out_bytes: number; flows: number }> }) {
  const labels = data.map(d => dayjs.unix(d.day).format('DD/MM'));
  const inGb   = data.map(d => Number((d.in_bytes / 1e9).toFixed(2)));
  const outGb  = data.map(d => Number((d.out_bytes / 1e9).toFixed(2)));

  const options: ApexOptions = {
    chart: { background: 'transparent', type: 'bar', stacked: false, toolbar: { show: false }, animations: { enabled: false } },
    colors: ['#00c8f0', '#f59e0b'],
    plotOptions: { bar: { columnWidth: '55%', borderRadius: 3 } },
    xaxis: { categories: labels, labels: { style: { colors: '#475569', fontSize: '10px' } } },
    yaxis: { labels: { style: { colors: '#475569', fontSize: '11px' }, formatter: v => `${v.toFixed(0)} GB` } },
    grid: { borderColor: '#1e2d4a', strokeDashArray: 4 },
    tooltip: { theme: 'dark', y: { formatter: v => `${v.toFixed(2)} GB` } },
    legend: { labels: { colors: '#94a3b8' }, fontSize: '12px' },
    dataLabels: { enabled: false },
  };

  return (
    <Card title={<span style={{ color: '#94a3b8' }}>Histórico de Utilização Diária</span>}
      style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
      styles={{ body: { padding: 12 } }}>
      <Chart
        options={options}
        series={[{ name: 'Download (IN)', data: inGb }, { name: 'Upload (OUT)', data: outGb }]}
        type="bar" height={240} />
    </Card>
  );
}

export function InterfaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [rangeSeconds, setRangeSeconds] = useState(6 * 3600);
  const [detail, setDetail] = useState<InterfaceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      const epoch_begin = now - rangeSeconds;
      const data = await getInterfaceDetail(Number(id), {
        epoch_begin,
        epoch_end: now,
        bucket_seconds: bucketFor(rangeSeconds),
      });
      setDetail(data);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao carregar detalhe da interface');
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
        <Button icon={<ArrowLeft size={14} />} onClick={() => navigate('/interfaces')}
          style={{ background: '#0f1f3d', borderColor: '#1e2d4a', color: '#94a3b8', marginBottom: 16 }}>
          Voltar
        </Button>
        <Text style={{ color: '#ff3b3b' }}>{error ?? 'Interface não encontrada'}</Text>
      </main>
    );
  }

  const { iface, summary, timeseries, top_asns, top_protocols, top_ports, top_src, top_dst, active_blocks, cdn_distribution, daily_history } = detail;
  const bucketSecs = bucketFor(rangeSeconds);

  // ── Distribuição IP x CDN ─────────────────────────────────────────────────
  const cdnBytes    = cdn_distribution?.cdn_bytes ?? 0;
  const nonCdnBytes = cdn_distribution?.noncdn_bytes ?? 0;
  const cdnTotal    = cdnBytes + nonCdnBytes;
  const cdnPct      = cdnTotal > 0 ? (cdnBytes / cdnTotal * 100) : 0;

  // ── Concentração de ASNs ──────────────────────────────────────────────────
  const top3Bytes = top_asns.slice(0, 3).reduce((s, a) => s + a.bytes, 0);
  const top3Pct   = summary.total_bytes > 0 ? (top3Bytes / summary.total_bytes * 100) : 0;

  // ── Crescimento: 1ª metade vs 2ª metade do período ────────────────────────
  const half = Math.floor(timeseries.length / 2);
  const firstHalf  = timeseries.slice(0, half).reduce((s, p) => s + p.in_bytes + p.out_bytes, 0);
  const secondHalf = timeseries.slice(half).reduce((s, p) => s + p.in_bytes + p.out_bytes, 0);
  const growthPct  = half > 2 && firstHalf > 0
    ? ((secondHalf - firstHalf) / firstHalf * 100)
    : null;

  const labels  = timeseries.map(p => dayjs.unix(p.bucket).format('DD/MM HH:mm'));
  const inMbps  = timeseries.map(p => Number(((p.in_bytes ?? 0) * 8 / bucketSecs / 1_000_000).toFixed(3)));
  const outMbps = timeseries.map(p => Number(((p.out_bytes ?? 0) * 8 / bucketSecs / 1_000_000).toFixed(3)));

  const capacityMbps = iface.capacity_mbps ?? 0;
  const utilColor = summary.utilization_pct > 80 ? '#ff3b3b' : summary.utilization_pct > 60 ? '#f59e0b' : '#22c55e';

  const chartOptions: ApexOptions = {
    chart: {
      background: 'transparent', type: 'area',
      toolbar: { show: true, tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true, download: false } },
      animations: { enabled: false },
    },
    colors: ['#00c8f0', '#f59e0b'],
    fill: { type: 'gradient', gradient: { opacityFrom: 0.5, opacityTo: 0.05 } },
    stroke: { curve: 'smooth', width: 2 },
    xaxis: {
      categories: labels,
      labels: { style: { colors: '#475569', fontSize: '10px' }, rotate: 0 },
      tickAmount: Math.min(10, labels.length),
    },
    yaxis: {
      labels: { style: { colors: '#475569', fontSize: '11px' }, formatter: v => `${v.toFixed(1)} Mbps` },
      max: capacityMbps > 0 ? capacityMbps * 1.1 : undefined,
    },
    grid: { borderColor: '#1e2d4a', strokeDashArray: 4 },
    tooltip: { theme: 'dark', y: { formatter: v => `${v.toFixed(2)} Mbps` } },
    legend: { labels: { colors: '#94a3b8' }, fontSize: '12px' },
    dataLabels: { enabled: false },
    annotations: {
      yaxis: [
        ...(summary.avg_mbps > 0 ? [{
          y: summary.avg_mbps,
          borderColor: '#8b5cf6', borderWidth: 1, strokeDashArray: 4,
          label: { text: `Média ${fmtMbps(summary.avg_mbps)}`, style: { color: '#8b5cf6', background: '#0a0f1e', fontSize: '10px' } },
        }] : []),
        ...(capacityMbps > 0 ? [{
          y: capacityMbps,
          borderColor: '#ff3b3b', borderWidth: 1, strokeDashArray: 6,
          label: { text: `Capacidade ${fmtMbps(capacityMbps)}`, style: { color: '#ff3b3b', background: '#0a0f1e', fontSize: '10px' } },
        }] : []),
      ],
    },
  };

  const blockCols: ColumnsType<InterfaceActiveBlock> = [
    {
      title: 'Bloco',
      key: 'block',
      render: (_, r) => (
        <div style={{ cursor: 'pointer' }} onClick={() => navigate(`/ip-blocks/${r.id}`)}>
          <Tag color="blue" style={{ fontFamily: 'monospace' }}>{r.cidr}</Tag>
          {r.type && <Tag color="geekblue" style={{ fontSize: 10 }}>{r.type}</Tag>}
          <Text style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{r.label}</Text>
        </div>
      ),
    },
    { title: 'IPs vistos', dataIndex: 'ip_count', align: 'right',
      render: v => <Text style={{ color: '#94a3b8' }}>{v} IP{v !== 1 ? 's' : ''}</Text> },
  ];

  const asnCols: ColumnsType<{ asn: number; bytes: number; flows: number }> = [
    { title: 'ASN', dataIndex: 'asn', render: (v: number) => (
      <Tag color="purple" style={{ fontFamily: 'monospace', cursor: 'pointer' }}
        onClick={() => navigate(`/asn/${v}`)}>AS{v}</Tag>
    )},
    { title: 'Bytes', dataIndex: 'bytes', align: 'right', sorter: (a, b) => a.bytes - b.bytes, defaultSortOrder: 'descend',
      render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text> },
    {
      title: '% Link', dataIndex: 'bytes', key: 'pct', width: 130,
      render: (v: number) => {
        const pct = summary.total_bytes > 0 ? (v / summary.total_bytes * 100) : 0;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Progress percent={parseFloat(pct.toFixed(1))} size="small" showInfo={false}
              strokeColor="#8b5cf6" style={{ flex: 1, marginBottom: 0 }} />
            <Text style={{ color: '#8b5cf6', fontFamily: 'monospace', fontSize: 11, width: 36, textAlign: 'right' }}>
              {pct.toFixed(1)}%
            </Text>
          </div>
        );
      },
    },
    { title: 'Fluxos', dataIndex: 'flows', align: 'right',
      render: (v: number) => <Text style={{ color: '#94a3b8' }}>{v.toLocaleString('pt-BR')}</Text> },
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
          <Button icon={<ArrowLeft size={14} />} onClick={() => navigate('/interfaces')}
            style={{ background: '#0f1f3d', borderColor: '#1e2d4a', color: '#94a3b8' }}>
            Voltar
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: '8px', borderRadius: 8, background: '#00c8f015' }}>
              <Network size={18} style={{ color: '#00c8f0' }} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Tag color="geekblue" style={{ fontFamily: 'monospace', fontSize: 14, margin: 0 }}>
                  ifid {iface.ifid}
                </Tag>
                {iface.link_type && (
                  <Tag color={LINK_TYPE_COLORS[iface.link_type] ?? 'default'} style={{ fontSize: 12 }}>
                    {iface.link_type}
                  </Tag>
                )}
                {iface.equipment && (
                  <Text style={{ color: '#64748b', fontSize: 12 }}>{iface.equipment}</Text>
                )}
              </div>
              <Title level={5} style={{ color: '#e2e8f0', margin: '2px 0 0' }}>{iface.name}</Title>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
                {iface.router_ip && (
                  <Text style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace' }}>{iface.router_ip}</Text>
                )}
                {iface.operator && <Text style={{ color: '#475569', fontSize: 11 }}>Op: {iface.operator}</Text>}
                {iface.partner && <Text style={{ color: '#475569', fontSize: 11 }}>Parceiro: {iface.partner}</Text>}
                {iface.city && <Text style={{ color: '#475569', fontSize: 11 }}>{iface.city}</Text>}
                {iface.pop && <Text style={{ color: '#475569', fontSize: 11 }}>PoP: {iface.pop}</Text>}
                {iface.description && <Text style={{ color: '#475569', fontSize: 11 }}>{iface.description}</Text>}
              </div>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Total',        value: formatBytes(summary.total_bytes), color: '#e2e8f0' },
          { label: 'IN (↓)',       value: formatBytes(summary.in_bytes),    color: '#00c8f0' },
          { label: 'OUT (↑)',      value: formatBytes(summary.out_bytes),   color: '#f59e0b' },
          { label: 'Fluxos',       value: summary.total_flows.toLocaleString('pt-BR'), color: '#64748b' },
          { label: 'Pico',         value: fmtMbps(summary.peak_mbps),      color: '#8b5cf6' },
          { label: 'Média',        value: fmtMbps(summary.avg_mbps),       color: '#10b981' },
          {
            label: 'Saturação',
            value: capacityMbps > 0 ? `${summary.utilization_pct.toFixed(1)}%` : '—',
            color: capacityMbps > 0 ? utilColor : '#334155',
          },
        ].map(m => (
          <div key={m.label} style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8, padding: '10px 14px' }}>
            <Text style={{ color: '#475569', fontSize: 10, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {m.label}
            </Text>
            <Text style={{ color: m.color, fontSize: 14, fontWeight: 700, fontFamily: 'monospace', display: 'block' }}>
              {m.value}
            </Text>
          </div>
        ))}
      </div>

      {/* IN/OUT chart */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ color: '#94a3b8' }}>Banda IN/OUT</span>
            <span style={{ color: '#00c8f0', fontSize: 12 }}>■ IN (entrada)</span>
            <span style={{ color: '#f59e0b', fontSize: 12 }}>■ OUT (saída)</span>
            {capacityMbps > 0 && (
              <span style={{ color: '#ff3b3b', fontSize: 12 }}>— Capacidade ({fmtMbps(capacityMbps)})</span>
            )}
            {growthPct !== null && (
              <Tooltip title={`Comparativo 1ª metade vs 2ª metade do período`}>
                <Tag color={growthPct > 20 ? 'red' : growthPct > 5 ? 'orange' : growthPct < -5 ? 'green' : 'default'}>
                  {growthPct >= 0 ? '↑' : '↓'} {Math.abs(growthPct).toFixed(1)}% no período
                </Tag>
              </Tooltip>
            )}
          </div>
        }
        style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8, marginBottom: 16 }}
        styles={{ body: { padding: 12 } }}
      >
        {timeseries.length > 0 ? (
          <Chart
            key={`iface-ts-${id}-${timeseries.length}`}
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
            <Text style={{ color: '#334155' }}>Sem dados de tráfego para esta interface no período.</Text>
          </div>
        )}
      </Card>

      {/* Detail tables 2x2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#94a3b8' }}>Top ASNs</span>
              <Tooltip title={`Top 3 ASNs respondem por ${top3Pct.toFixed(1)}% do tráfego desta interface`}>
                <Tag color={top3Pct > 80 ? 'red' : top3Pct > 60 ? 'orange' : 'green'}>
                  Conc. top3: {top3Pct.toFixed(1)}%
                </Tag>
              </Tooltip>
            </div>
          }
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

        <Card title={<span style={{ color: '#94a3b8' }}>Top Origens (src IPs via IN)</span>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table columns={ipCols} dataSource={top_src} rowKey="ip"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Top Destinos (dst IPs via OUT)</span>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table columns={ipCols} dataSource={top_dst} rowKey="ip"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>
      </div>

      {/* Ports */}
      <Card title={<span style={{ color: '#94a3b8' }}>Top Portas de Destino (tráfego IN)</span>}
        style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8, marginBottom: 12 }}
        styles={{ body: { padding: 0 } }}>
        <Table columns={portCols} dataSource={top_ports} rowKey={r => `${r.port}-${r.protocol}`}
          pagination={false} size="small"
          locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
          style={{ background: 'transparent' }} />
      </Card>

      {/* Distribuição IP x CDN (tráfego para/de provedores CDN conhecidos) ── */}
      {cdnTotal > 0 && (
        <Card title={<span style={{ color: '#94a3b8' }}>Distribuição IP × CDN</span>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 16 } }}>
          <div style={{ display: 'flex', gap: 24, marginBottom: 14 }}>
            <div>
              <Text style={{ color: '#475569', fontSize: 11, display: 'block' }}>TRÁFEGO CDN</Text>
              <Text style={{ color: '#00c8f0', fontSize: 18, fontFamily: 'monospace', fontWeight: 700 }}>
                {cdnPct.toFixed(1)}%
              </Text>
              <Text style={{ color: '#64748b', fontSize: 11, display: 'block' }}>{formatBytes(cdnBytes)}</Text>
            </div>
            <div>
              <Text style={{ color: '#475569', fontSize: 11, display: 'block' }}>IP COMUM</Text>
              <Text style={{ color: '#8b5cf6', fontSize: 18, fontFamily: 'monospace', fontWeight: 700 }}>
                {(100 - cdnPct).toFixed(1)}%
              </Text>
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

      {/* Histórico de utilização diária ─────────────────────────────────── */}
      {daily_history && daily_history.length > 0 && (
        <DailyHistoryChart data={daily_history} />
      )}

      {/* Blocos IP ativos nesta interface */}
      {active_blocks && active_blocks.length > 0 && (
        <Card title={<span style={{ color: '#94a3b8' }}>Blocos IP ativos nesta interface</span>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table columns={blockCols} dataSource={active_blocks} rowKey="id"
            pagination={false} size="small"
            onRow={r => ({ onClick: () => navigate(`/ip-blocks/${r.id}`), style: { cursor: 'pointer' } })}
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Nenhum bloco cadastrado com IPs nesta interface</Text> }}
            style={{ background: 'transparent' }} />
        </Card>
      )}
    </main>
  );
}

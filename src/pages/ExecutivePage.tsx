import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Tag, Select, Button, Typography, Space, Badge } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import dayjs from 'dayjs';
import { RefreshCw, TrendingUp, AlertTriangle, Activity, Wifi } from 'lucide-react';
import {
  getNetflowSummary,
  getNetflowTimeseries,
  getNetflowProtocols,
  getNetflowTopAsn,
  getNetflowTopTalkers,
  getCorrelatedAttacks,
  type NetflowSummary,
  type NetflowTimeseriesPoint,
  type NetflowProtocol,
  type NetflowTopAsn,
  type NetflowTopTalker,
  type CorrelatedAttack,
} from '../services/backendApi';

const { Title, Text } = Typography;

const PROTO_COLORS: Record<string, string> = {
  TCP: '#3b82f6', UDP: '#8b5cf6', ICMP: '#f59e0b',
  'IPv6-ICMP': '#f97316', GRE: '#ec4899', ESP: '#14b8a6',
};

function formatBytes(bytes: number): string {
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

// ─── KPI card ─────────────────────────────────────────────────────────────────

interface KpiProps {
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon: React.ReactNode;
}
function KpiCard({ label, value, sub, color, icon }: KpiProps) {
  return (
    <Card
      style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
      bodyStyle={{ padding: '18px 20px' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ color, marginTop: 2 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <Text style={{ color: '#64748b', fontSize: 11, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
            {label}
          </Text>
          <Text style={{ color, fontSize: 26, fontWeight: 700, fontFamily: 'monospace', display: 'block', lineHeight: 1.2 }}>
            {value}
          </Text>
          {sub && <Text style={{ color: '#475569', fontSize: 12 }}>{sub}</Text>}
        </div>
      </div>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { label: 'Última 1h',      value: 3600 },
  { label: 'Últimas 6h',     value: 6 * 3600 },
  { label: 'Últimas 24h',    value: 24 * 3600 },
  { label: 'Últimos 7 dias', value: 7 * 24 * 3600 },
];

function bucketFor(range: number): number {
  if (range <= 3600)       return 60;
  if (range <= 6 * 3600)  return 300;
  if (range <= 24 * 3600) return 900;
  return 3600 * 2;
}

export function ExecutivePage() {
  const [rangeSeconds, setRangeSeconds] = useState(6 * 3600);
  const [loading, setLoading] = useState(false);

  const [summary, setSummary]       = useState<NetflowSummary | null>(null);
  const [timeseries, setTimeseries] = useState<NetflowTimeseriesPoint[]>([]);
  const [protocols, setProtocols]   = useState<NetflowProtocol[]>([]);
  const [topAsn, setTopAsn]         = useState<NetflowTopAsn[]>([]);
  const [topTalkers, setTopTalkers] = useState<NetflowTopTalker[]>([]);
  const [attacks, setAttacks]       = useState<CorrelatedAttack[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const now = Math.floor(Date.now() / 1000);
    const epoch_begin = now - rangeSeconds;
    const epoch_end = now;
    const bucket = bucketFor(rangeSeconds);
    try {
      const [sum, ts, prot, asn, talkers, atk] = await Promise.all([
        getNetflowSummary({ epoch_begin, epoch_end, bucket_seconds: bucket }),
        getNetflowTimeseries({ epoch_begin, epoch_end, bucket_seconds: bucket }),
        getNetflowProtocols({ epoch_begin, epoch_end }),
        getNetflowTopAsn({ epoch_begin, epoch_end, asn_type: 'src', limit: 10 }),
        getNetflowTopTalkers({ epoch_begin, epoch_end, direction: 'dst', limit: 10 }),
        getCorrelatedAttacks({ epoch_begin, epoch_end, min_events: 30, limit: 10 }),
      ]);
      setSummary(sum);
      setTimeseries(ts.records);
      setProtocols(prot.records);
      setTopAsn(asn.records);
      setTopTalkers(talkers.records);
      setAttacks(atk.attacks);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [rangeSeconds]);

  useEffect(() => { load(); }, [load]);

  // ── Charts ──
  const bucketSecs = bucketFor(rangeSeconds);
  const tsLabels = timeseries.map(r => dayjs.unix(r.bucket).format('DD/MM HH:mm'));
  const tsMbps   = timeseries.map(r => parseFloat(((r.total_bytes * 8) / 1_000_000 / bucketSecs).toFixed(3)));

  const tsOptions: ApexOptions = {
    chart: { type: 'area', background: 'transparent', toolbar: { show: false }, animations: { enabled: false } },
    theme: { mode: 'dark' },
    stroke: { curve: 'smooth', width: 2 },
    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05 } },
    colors: ['#00c8f0'],
    xaxis: { categories: tsLabels, labels: { rotate: -30, style: { colors: '#475569', fontSize: '10px' }, maxHeight: 40 }, tickAmount: 8 },
    yaxis: { labels: { style: { colors: '#475569' }, formatter: (v) => fmtMbps(v) } },
    grid: { borderColor: '#1e2d4a' },
    dataLabels: { enabled: false },
    tooltip: { theme: 'dark', y: { formatter: (v) => fmtMbps(v) } },
  };

  const totalProtoBytes = protocols.reduce((s, p) => s + p.total_bytes, 0);
  const donutOptions: ApexOptions = {
    chart: { type: 'donut', background: 'transparent' },
    theme: { mode: 'dark' },
    labels: protocols.slice(0, 6).map(p => p.protocol),
    colors: protocols.slice(0, 6).map(p => PROTO_COLORS[p.protocol] ?? '#475569'),
    legend: { position: 'bottom', labels: { colors: '#94a3b8' } },
    dataLabels: { enabled: true, formatter: (val: number) => `${val.toFixed(1)}%` },
    plotOptions: { pie: { donut: { size: '60%' } } },
    tooltip: { theme: 'dark', y: { formatter: (v) => formatBytes(v) } },
  };
  const donutSeries = protocols.slice(0, 6).map(p => p.total_bytes);

  // ── Tables ──
  const asnCols: ColumnsType<NetflowTopAsn> = [
    { title: 'ASN', dataIndex: 'asn', render: (v: number) => <Tag color="blue" style={{ fontFamily: 'monospace' }}>AS{v}</Tag> },
    { title: 'Bytes', dataIndex: 'total_bytes', align: 'right', render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text> },
    { title: 'Fluxos', dataIndex: 'flows', align: 'right', render: (v: number) => <Text style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{v.toLocaleString('pt-BR')}</Text> },
  ];

  const talkerCols: ColumnsType<NetflowTopTalker> = [
    { title: 'IP Destino', dataIndex: 'ip', render: (v: string) => <Text style={{ fontFamily: 'monospace', color: '#e2e8f0', fontSize: 12 }}>{v}</Text> },
    { title: 'Bytes', dataIndex: 'total_bytes', align: 'right', render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text> },
  ];

  const attackCols: ColumnsType<CorrelatedAttack> = [
    {
      title: 'Vítima',
      dataIndex: 'victim_ip',
      render: (v: string, r: CorrelatedAttack) => (
        <Space>
          <Badge status={r.max_severity === 'critical' ? 'error' : 'warning'} />
          <Text style={{ fontFamily: 'monospace', color: '#e2e8f0', fontSize: 12 }}>{v}</Text>
        </Space>
      ),
    },
    {
      title: 'Volume',
      dataIndex: 'total_bytes',
      align: 'right',
      render: (v: number) => <Text style={{ color: '#ff3b3b', fontFamily: 'monospace' }}>{formatBytes(v)}</Text>,
    },
    {
      title: 'Origens',
      dataIndex: 'unique_sources',
      align: 'right',
      render: (v: number) => <Tag color={v > 20 ? 'red' : 'orange'}>{v}</Tag>,
    },
  ];

  const criticalCount = attacks.filter(a => a.max_severity === 'critical').length;

  return (
    <main style={{ flex: 1, overflow: 'auto', padding: '16px 20px', background: '#060d1f' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ color: '#e2e8f0', margin: 0 }}>Dashboard Executivo</Title>
        <Space>
          <Select value={rangeSeconds} onChange={setRangeSeconds} options={RANGE_OPTIONS} style={{ width: 160 }} />
          <Button icon={<RefreshCw size={14} />} onClick={load} loading={loading}
            style={{ background: '#0f1f3d', borderColor: '#1e2d4a', color: '#94a3b8' }}>
            Atualizar
          </Button>
        </Space>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <KpiCard label="Tráfego Atual"     value={fmtMbps(summary?.current_mbps ?? 0)}  sub={`Pico: ${fmtMbps(summary?.peak_mbps ?? 0)}`}  color="#00c8f0" icon={<Activity size={20} />} />
        <KpiCard label="Média do Período"  value={fmtMbps(summary?.avg_mbps ?? 0)}       sub={`${formatBytes(summary?.total_bytes ?? 0)} total`} color="#8b5cf6" icon={<TrendingUp size={20} />} />
        <KpiCard label="Campanhas Ativas"  value={String(attacks.length)}                 sub={`${criticalCount} critical`}                  color={criticalCount > 0 ? '#ff3b3b' : '#f59e0b'} icon={<AlertTriangle size={20} />} />
        <KpiCard label="Total de Fluxos"   value={(summary?.total_flows ?? 0).toLocaleString('pt-BR')} sub={`${(summary?.total_packets ?? 0).toLocaleString('pt-BR')} pacotes`} color="#22c55e" icon={<Wifi size={20} />} />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 16 }}>
        <Card title={<Text style={{ color: '#94a3b8' }}>Banda (Mbps)</Text>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          bodyStyle={{ padding: '8px 12px' }}>
          {timeseries.length > 0 ? (
            <Chart type="area" series={[{ name: 'Mbps', data: tsMbps }]} options={tsOptions} height={200} />
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#334155' }}>Sem dados no período</Text>
            </div>
          )}
        </Card>

        <Card title={<Text style={{ color: '#94a3b8' }}>Distribuição de Protocolos</Text>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          bodyStyle={{ padding: '8px 12px' }}>
          {donutSeries.length > 0 ? (
            <Chart type="donut" series={donutSeries} options={donutOptions} height={200} />
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#334155' }}>Sem dados</Text>
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            {protocols.slice(0, 4).map(p => (
              <div key={p.protocol} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <Tag color={PROTO_COLORS[p.protocol] ?? '#475569'} style={{ marginRight: 0 }}>{p.protocol}</Tag>
                <Text style={{ color: '#64748b', fontSize: 11 }}>
                  {totalProtoBytes > 0 ? ((p.total_bytes / totalProtoBytes) * 100).toFixed(1) : 0}% · {formatBytes(p.total_bytes)}
                </Text>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Tables row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Card title={<Text style={{ color: '#94a3b8' }}>Top ASNs Atacantes</Text>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          bodyStyle={{ padding: 0 }}>
          <Table columns={asnCols} dataSource={topAsn} rowKey="asn"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>

        <Card title={<Text style={{ color: '#94a3b8' }}>Top IPs Destino</Text>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          bodyStyle={{ padding: 0 }}>
          <Table columns={talkerCols} dataSource={topTalkers} rowKey="ip"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>

        <Card title={<Text style={{ color: '#94a3b8' }}>Campanhas de Ataque</Text>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          bodyStyle={{ padding: 0 }}>
          <Table columns={attackCols} dataSource={attacks} rowKey="victim_ip"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem ataques detectados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>
      </div>
    </main>
  );
}

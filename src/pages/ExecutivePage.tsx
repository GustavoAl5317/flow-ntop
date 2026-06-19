import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Tag, Select, Button, Typography, Space, Badge, Progress, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import dayjs from 'dayjs';
import { RefreshCw, TrendingUp, TrendingDown, AlertTriangle, Activity, Network, Layers, Shield } from 'lucide-react';
import {
  getNetflowSummary,
  getNetflowTimeseries,
  getNetflowProtocols,
  getNetflowTopAsn,
  getNetflowTopTalkers,
  getCorrelatedAttacks,
  getInterfacesRanking,
  getIpBlocksRanking,
  type NetflowSummary,
  type NetflowTimeseriesPoint,
  type NetflowProtocol,
  type NetflowTopAsn,
  type NetflowTopTalker,
  type CorrelatedAttack,
  type InterfaceRankingEntry,
  type IpBlockRankingEntry,
} from '../services/backendApi';

const { Title, Text } = Typography;

const PROTO_COLORS: Record<string, string> = {
  TCP: '#3b82f6', UDP: '#8b5cf6', ICMP: '#f59e0b',
  'IPv6-ICMP': '#f97316', GRE: '#ec4899', ESP: '#14b8a6',
};

const LINK_TYPE_COLORS: Record<string, string> = {
  Transit: '#3b82f6', IX: '#22c55e', CDN: '#f59e0b',
  Backbone: '#8b5cf6', Peer: '#14b8a6', Outros: '#475569',
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

// ─── KPI card ──────────────────────────────────────────────────────────────────

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
      styles={{ body: { padding: '16px 18px' } }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ color, marginTop: 2 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: '#64748b', fontSize: 10, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
            {label}
          </Text>
          <Text style={{ color, fontSize: 22, fontWeight: 700, fontFamily: 'monospace', display: 'block', lineHeight: 1.2 }}>
            {value}
          </Text>
          {sub && <Text style={{ color: '#475569', fontSize: 11 }}>{sub}</Text>}
        </div>
      </div>
    </Card>
  );
}

// ─── Constants ─────────────────────────────────────────────────────────────────

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

// ─── Page ──────────────────────────────────────────────────────────────────────

export function ExecutivePage() {
  const navigate = useNavigate();
  const [rangeSeconds, setRangeSeconds] = useState(6 * 3600);
  const [loading, setLoading] = useState(false);

  const [summary, setSummary]           = useState<NetflowSummary | null>(null);
  const [ipv4Summary, setIpv4Summary]   = useState<NetflowSummary | null>(null);
  const [ipv6Summary, setIpv6Summary]   = useState<NetflowSummary | null>(null);
  const [prevSummary, setPrevSummary]   = useState<NetflowSummary | null>(null);
  const [timeseries, setTimeseries]     = useState<NetflowTimeseriesPoint[]>([]);
  const [protocols, setProtocols]       = useState<NetflowProtocol[]>([]);
  const [topAsn, setTopAsn]             = useState<NetflowTopAsn[]>([]);
  const [topTalkers, setTopTalkers]     = useState<NetflowTopTalker[]>([]);
  const [attacks, setAttacks]           = useState<CorrelatedAttack[]>([]);
  const [ifaceRanking, setIfaceRanking] = useState<InterfaceRankingEntry[]>([]);
  const [blockRanking, setBlockRanking] = useState<IpBlockRankingEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const now = Math.floor(Date.now() / 1000);
    const epoch_end   = now;
    const epoch_begin = now - rangeSeconds;
    const prevBegin   = epoch_begin - rangeSeconds;
    const bucket      = bucketFor(rangeSeconds);
    try {
      const [sum, ipv4, ipv6, prev, ts, prot, asn, talkers, atk, ifr, blr] = await Promise.all([
        getNetflowSummary({ epoch_begin, epoch_end, bucket_seconds: bucket }),
        getNetflowSummary({ epoch_begin, epoch_end, ip_version: '4' }),
        getNetflowSummary({ epoch_begin, epoch_end, ip_version: '6' }),
        getNetflowSummary({ epoch_begin: prevBegin, epoch_end: epoch_begin }),
        getNetflowTimeseries({ epoch_begin, epoch_end, bucket_seconds: bucket }),
        getNetflowProtocols({ epoch_begin, epoch_end }),
        getNetflowTopAsn({ epoch_begin, epoch_end, asn_type: 'src', limit: 10 }),
        getNetflowTopTalkers({ epoch_begin, epoch_end, direction: 'dst', limit: 10 }),
        getCorrelatedAttacks({ epoch_begin, epoch_end, min_events: 30, limit: 10 }),
        getInterfacesRanking({ epoch_begin, epoch_end }),
        getIpBlocksRanking({ epoch_begin, epoch_end }),
      ]);
      setSummary(sum);
      setIpv4Summary(ipv4);
      setIpv6Summary(ipv6);
      setPrevSummary(prev);
      setTimeseries(ts.records);
      setProtocols(prot.records);
      setTopAsn(asn.records);
      setTopTalkers(talkers.records);
      setAttacks(atk.attacks);
      setIfaceRanking(ifr.ranking);
      setBlockRanking(blr.ranking);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [rangeSeconds]);

  useEffect(() => { load(); }, [load]);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const growthPct = prevSummary && prevSummary.total_bytes > 0 && summary
    ? ((summary.total_bytes - prevSummary.total_bytes) / prevSummary.total_bytes) * 100
    : null;

  const byLinkType = ifaceRanking.reduce((acc, iface) => {
    const lt = iface.link_type ?? 'Outros';
    if (!acc[lt]) acc[lt] = { in_bytes: 0, out_bytes: 0, count: 0 };
    acc[lt].in_bytes  += iface.in_bytes;
    acc[lt].out_bytes += iface.out_bytes;
    acc[lt].count     += 1;
    return acc;
  }, {} as Record<string, { in_bytes: number; out_bytes: number; count: number }>);
  const linkTypeEntries = Object.entries(byLinkType)
    .sort((a, b) => (b[1].in_bytes + b[1].out_bytes) - (a[1].in_bytes + a[1].out_bytes));
  const totalLinkBytes = linkTypeEntries.reduce((s, [, v]) => s + v.in_bytes + v.out_bytes, 0);

  const saturatedIfaces = ifaceRanking
    .filter(i => i.utilization_pct >= 80)
    .sort((a, b) => b.utilization_pct - a.utilization_pct);

  const ipv4Pct = summary && summary.total_bytes > 0 && ipv4Summary
    ? ((ipv4Summary.total_bytes / summary.total_bytes) * 100).toFixed(1)
    : '—';
  const ipv6Pct = summary && summary.total_bytes > 0 && ipv6Summary
    ? ((ipv6Summary.total_bytes / summary.total_bytes) * 100).toFixed(1)
    : '—';

  const criticalCount = attacks.filter(a => a.max_severity === 'critical').length;

  // ── Charts ───────────────────────────────────────────────────────────────────
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

  // ── Column defs ──────────────────────────────────────────────────────────────
  const asnCols: ColumnsType<NetflowTopAsn> = [
    {
      title: 'ASN', dataIndex: 'asn',
      render: (v: number) => <Tag color="blue" style={{ fontFamily: 'monospace' }}>AS{v}</Tag>,
    },
    {
      title: 'Bytes', dataIndex: 'total_bytes', align: 'right',
      render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text>,
    },
    {
      title: 'Fluxos', dataIndex: 'flows', align: 'right',
      render: (v: number) => <Text style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{v.toLocaleString('pt-BR')}</Text>,
    },
  ];

  const talkerCols: ColumnsType<NetflowTopTalker> = [
    {
      title: 'IP Destino', dataIndex: 'ip',
      render: (v: string) => <Text style={{ fontFamily: 'monospace', color: '#e2e8f0', fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Bytes', dataIndex: 'total_bytes', align: 'right',
      render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text>,
    },
  ];

  const attackCols: ColumnsType<CorrelatedAttack> = [
    {
      title: 'Vítima', dataIndex: 'victim_ip',
      render: (v: string, r: CorrelatedAttack) => (
        <Space>
          <Badge status={r.max_severity === 'critical' ? 'error' : 'warning'} />
          <Text style={{ fontFamily: 'monospace', color: '#e2e8f0', fontSize: 12 }}>{v}</Text>
        </Space>
      ),
    },
    {
      title: 'Volume', dataIndex: 'total_bytes', align: 'right',
      render: (v: number) => <Text style={{ color: '#ff3b3b', fontFamily: 'monospace' }}>{formatBytes(v)}</Text>,
    },
    {
      title: 'Origens', dataIndex: 'unique_sources', align: 'right',
      render: (v: number) => <Tag color={v > 20 ? 'red' : 'orange'}>{v}</Tag>,
    },
  ];

  const ifaceRankingCols: ColumnsType<InterfaceRankingEntry> = [
    {
      title: 'Interface', dataIndex: 'name',
      render: (v: string, r: InterfaceRankingEntry) => (
        <div>
          <Text style={{ color: '#00c8f0', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
            onClick={() => navigate(`/interfaces/${r.id}`)}>{v}</Text>
          {r.link_type && (
            <Tag color={LINK_TYPE_COLORS[r.link_type] ?? '#475569'} style={{ marginLeft: 6, fontSize: 10 }}>
              {r.link_type}
            </Tag>
          )}
          {r.city && <Text style={{ color: '#475569', fontSize: 10, marginLeft: 4 }}>{r.city}</Text>}
        </div>
      ),
    },
    {
      title: 'Utilização', dataIndex: 'utilization_pct', width: 170,
      render: (v: number) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Progress percent={Math.min(v, 100)} size="small" showInfo={false}
            strokeColor={v >= 80 ? '#ff3b3b' : v >= 60 ? '#f59e0b' : '#22c55e'}
            style={{ flex: 1, marginBottom: 0 }} />
          <Text style={{ color: v >= 80 ? '#ff3b3b' : '#94a3b8', fontFamily: 'monospace', fontSize: 11, width: 44, textAlign: 'right' }}>
            {v.toFixed(1)}%
          </Text>
        </div>
      ),
    },
    {
      title: 'Avg', dataIndex: 'avg_mbps', width: 100, align: 'right',
      render: (v: number) => <Text style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 11 }}>{fmtMbps(v)}</Text>,
    },
  ];

  const blockRankingCols: ColumnsType<IpBlockRankingEntry> = [
    {
      title: 'Bloco IP',
      render: (_: unknown, r: IpBlockRankingEntry) => (
        <div>
          <Text style={{ color: '#00c8f0', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
            onClick={() => navigate(`/ip-blocks/${r.id}`)}>{r.label}</Text>
          <Text style={{ color: '#475569', fontSize: 11, marginLeft: 6 }}>{r.cidr}</Text>
          {r.type && <Tag color="geekblue" style={{ marginLeft: 6, fontSize: 10 }}>{r.type}</Tag>}
        </div>
      ),
    },
    {
      title: 'IN', dataIndex: 'in_bytes', align: 'right', width: 90,
      render: (v: number) => <Text style={{ color: '#22c55e', fontFamily: 'monospace', fontSize: 11 }}>{formatBytes(v)}</Text>,
    },
    {
      title: 'OUT', dataIndex: 'out_bytes', align: 'right', width: 90,
      render: (v: number) => <Text style={{ color: '#f59e0b', fontFamily: 'monospace', fontSize: 11 }}>{formatBytes(v)}</Text>,
    },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
        <KpiCard
          label="Tráfego Atual"
          value={fmtMbps(summary?.current_mbps ?? 0)}
          sub={`Pico: ${fmtMbps(summary?.peak_mbps ?? 0)}`}
          color="#00c8f0"
          icon={<Activity size={18} />}
        />
        <KpiCard
          label="Média do Período"
          value={fmtMbps(summary?.avg_mbps ?? 0)}
          sub={`${formatBytes(summary?.total_bytes ?? 0)} total`}
          color="#8b5cf6"
          icon={<TrendingUp size={18} />}
        />
        <KpiCard
          label="IPv4"
          value={fmtMbps(ipv4Summary?.avg_mbps ?? 0)}
          sub={`${ipv4Pct}% do tráfego`}
          color="#3b82f6"
          icon={<Network size={18} />}
        />
        <KpiCard
          label="IPv6"
          value={fmtMbps(ipv6Summary?.avg_mbps ?? 0)}
          sub={`${ipv6Pct}% do tráfego`}
          color="#14b8a6"
          icon={<Layers size={18} />}
        />
        <KpiCard
          label="Crescimento vs período ant."
          value={growthPct !== null ? `${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}%` : '—'}
          sub={prevSummary ? `Ant: ${fmtMbps(prevSummary.avg_mbps)}` : 'sem dados anteriores'}
          color={growthPct !== null && growthPct > 20 ? '#ff3b3b' : growthPct !== null && growthPct > 0 ? '#f59e0b' : '#22c55e'}
          icon={growthPct !== null && growthPct > 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
        />
        <KpiCard
          label="Campanhas Ativas"
          value={String(attacks.length)}
          sub={`${criticalCount} critical · ${(summary?.total_flows ?? 0).toLocaleString('pt-BR')} fluxos`}
          color={criticalCount > 0 ? '#ff3b3b' : '#f59e0b'}
          icon={<AlertTriangle size={18} />}
        />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 16 }}>
        <Card title={<Text style={{ color: '#94a3b8' }}>Banda (Mbps)</Text>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: '8px 12px' } }}>
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
          styles={{ body: { padding: '8px 12px' } }}>
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

      {/* Link types + Network health */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Card title={<Text style={{ color: '#94a3b8' }}>Tráfego por Tipo de Link</Text>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: '12px 16px' } }}>
          {linkTypeEntries.length === 0 ? (
            <Text style={{ color: '#334155' }}>Nenhuma interface cadastrada</Text>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {linkTypeEntries.map(([lt, data]) => {
                const total = data.in_bytes + data.out_bytes;
                const pct   = totalLinkBytes > 0 ? (total / totalLinkBytes) * 100 : 0;
                const color = LINK_TYPE_COLORS[lt] ?? '#475569';
                return (
                  <div key={lt}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Tag color={color} style={{ marginRight: 0 }}>{lt}</Tag>
                        <Text style={{ color: '#64748b', fontSize: 11 }}>{data.count} iface{data.count !== 1 ? 's' : ''}</Text>
                      </div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <Text style={{ color: '#22c55e', fontFamily: 'monospace', fontSize: 11 }}>↓ {formatBytes(data.in_bytes)}</Text>
                        <Text style={{ color: '#f59e0b', fontFamily: 'monospace', fontSize: 11 }}>↑ {formatBytes(data.out_bytes)}</Text>
                        <Text style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 11, width: 42, textAlign: 'right' }}>{pct.toFixed(1)}%</Text>
                      </div>
                    </div>
                    <Progress percent={parseFloat(pct.toFixed(1))} showInfo={false} size="small"
                      strokeColor={color} style={{ marginBottom: 0 }} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: '#94a3b8' }}>Saúde da Rede — Gargalos</Text>
              {saturatedIfaces.length > 0 && (
                <Tag color="red">
                  {saturatedIfaces.length} saturada{saturatedIfaces.length !== 1 ? 's' : ''} ≥80%
                </Tag>
              )}
            </div>
          }
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: '12px 16px' } }}
        >
          {ifaceRanking.length === 0 ? (
            <Text style={{ color: '#334155' }}>Nenhuma interface com dados</Text>
          ) : saturatedIfaces.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0' }}>
              <Shield size={20} color="#22c55e" />
              <Text style={{ color: '#22c55e' }}>Todas as interfaces dentro da capacidade</Text>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {saturatedIfaces.slice(0, 7).map(iface => (
                <div key={iface.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Tooltip title={`${iface.link_type ?? ''} · avg ${fmtMbps(iface.avg_mbps)} · cap ${iface.capacity_mbps ?? '?'} Mbps`}>
                    <Text
                      style={{ color: '#00c8f0', fontSize: 12, cursor: 'pointer', minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      onClick={() => navigate(`/interfaces/${iface.id}`)}
                    >{iface.name}</Text>
                  </Tooltip>
                  <Progress
                    percent={Math.min(iface.utilization_pct, 100)}
                    size="small" showInfo={false}
                    strokeColor={iface.utilization_pct >= 95 ? '#ff3b3b' : '#f59e0b'}
                    style={{ flex: 1, marginBottom: 0 }}
                  />
                  <Text style={{ color: iface.utilization_pct >= 95 ? '#ff3b3b' : '#f59e0b', fontFamily: 'monospace', fontSize: 11, width: 46, textAlign: 'right' }}>
                    {iface.utilization_pct.toFixed(1)}%
                  </Text>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Top 10 interfaces + Top 10 blocks */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Card title={<Text style={{ color: '#94a3b8' }}>Top 10 Interfaces por Utilização</Text>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table
            columns={ifaceRankingCols}
            dataSource={[...ifaceRanking].sort((a, b) => b.utilization_pct - a.utilization_pct).slice(0, 10)}
            rowKey="id"
            pagination={false}
            size="small"
            onRow={r => ({ onClick: () => navigate(`/interfaces/${r.id}`), style: { cursor: 'pointer' } })}
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }}
          />
        </Card>

        <Card title={<Text style={{ color: '#94a3b8' }}>Top 10 Blocos IP</Text>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table
            columns={blockRankingCols}
            dataSource={blockRanking.slice(0, 10)}
            rowKey="id"
            pagination={false}
            size="small"
            onRow={r => ({ onClick: () => navigate(`/ip-blocks/${r.id}`), style: { cursor: 'pointer' } })}
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }}
          />
        </Card>
      </div>

      {/* Bottom tables */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Card title={<Text style={{ color: '#94a3b8' }}>Top ASNs Atacantes</Text>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table columns={asnCols} dataSource={topAsn} rowKey="asn"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>

        <Card title={<Text style={{ color: '#94a3b8' }}>Top IPs Destino</Text>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table columns={talkerCols} dataSource={topTalkers} rowKey="ip"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem dados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>

        <Card title={<Text style={{ color: '#94a3b8' }}>Campanhas de Ataque</Text>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}>
          <Table columns={attackCols} dataSource={attacks} rowKey="victim_ip"
            pagination={false} size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Sem ataques detectados</Text> }}
            style={{ background: 'transparent' }} />
        </Card>
      </div>
    </main>
  );
}

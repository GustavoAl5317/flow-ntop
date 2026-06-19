import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Table, Tag, Select, Button, Input, message, Spin, Space, Progress } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import dayjs from 'dayjs';
import { Network, RefreshCw, Filter, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  getNetflowSummary,
  getNetflowTopTalkers,
  getNetflowTopPorts,
  getNetflowTopAsn,
  getNetflowProtocols,
  getNetflowBandwidthByClient,
  getNetflowIncidents,
  getNetflowTimeseries,
  getNetflowIpTimeseries,
  getNetflowProtocolTimeseries,
  getNetflowAsnTimeseries,
  getNetflowPortTimeseries,
  resolveIpsToBlocks,
  type NetflowSummary,
  type NetflowTopTalker,
  type NetflowTopPort,
  type NetflowTopAsn,
  type NetflowProtocol,
  type NetflowBandwidthClient,
  type NetflowIncident,
  type NetflowTimeseriesPoint,
  type NetflowProtoTimeseriesResult,
  type NetflowAsnTimeseriesResult,
  type NetflowPortTimeseriesResult,
} from '../services/backendApi';

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(2)} ${units[i]}`;
}

function fmtMbps(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(2)} Gbps`;
  return `${v.toFixed(2)} Mbps`;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff3b3b', error: '#ff3b3b', warning: '#f59e0b',
  notice: '#00c8f0', info: '#475569',
};

const RANGE_OPTIONS = [
  { label: 'Última 1h',      value: 3600 },
  { label: 'Últimas 6h',     value: 6 * 3600 },
  { label: 'Últimas 24h',    value: 24 * 3600 },
  { label: 'Últimos 7 dias', value: 7 * 24 * 3600 },
];

const PROTOCOL_OPTIONS = [
  'TCP', 'UDP', 'ICMP', 'ICMPv6', 'GRE', 'ESP', 'SCTP', 'OSPF',
].map(p => ({ label: p, value: p }));

const PROTO_PALETTE = ['#00c8f0', '#8b5cf6', '#f59e0b', '#10b981', '#ff3b3b', '#ec4899', '#3b82f6', '#f97316'];
const ASN_PALETTE   = ['#00c8f0', '#8b5cf6', '#f59e0b', '#10b981', '#ff6b6b', '#06b6d4', '#84cc16'];

function bucketSecondsFor(rangeSeconds: number): number {
  if (rangeSeconds <= 3600)        return 60;
  if (rangeSeconds <= 6 * 3600)   return 300;
  if (rangeSeconds <= 24 * 3600)  return 1800;
  return 3600 * 6;
}

// ─── filter state ─────────────────────────────────────────────────────────────

interface Filters {
  protocol?: string;
  ip_version?: '4' | '6';
  asn?: string;
  src_ip?: string;
  dst_ip?: string;
}

function filtersToParams(f: Filters): Record<string, string | number | undefined> {
  return {
    protocol: f.protocol || undefined,
    ip_version: f.ip_version,
    asn: f.asn ? parseInt(f.asn, 10) : undefined,
    src_ip: f.src_ip || undefined,
    dst_ip: f.dst_ip || undefined,
  };
}

function hasActiveFilters(f: Filters): boolean {
  return !!(f.protocol || f.ip_version || f.asn || f.src_ip || f.dst_ip);
}

// ─── KPI cards ────────────────────────────────────────────────────────────────

function NetflowKpiCards({ summary, loading }: { summary: NetflowSummary | null; loading: boolean }) {
  const metrics = [
    { label: 'Banda Atual',      value: summary ? fmtMbps(summary.current_mbps)   : '—', color: '#00c8f0' },
    { label: 'Pico do Período',  value: summary ? fmtMbps(summary.peak_mbps)       : '—', color: '#8b5cf6' },
    { label: 'Média de Consumo', value: summary ? fmtMbps(summary.avg_mbps)        : '—', color: '#f59e0b' },
    { label: 'Total Processado', value: summary ? formatBytes(summary.total_bytes)  : '—', color: '#10b981' },
    { label: 'Total de Fluxos',  value: summary ? summary.total_flows.toLocaleString('pt-BR') : '—', color: '#64748b' },
    { label: 'Total de Pacotes', value: summary ? summary.total_packets.toLocaleString('pt-BR') : '—', color: '#64748b' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
      {metrics.map(m => (
        <div key={m.label} className="rounded-xl p-3"
          style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {m.label}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: m.color, fontFamily: 'monospace' }}>
            {loading ? '…' : m.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── IP timeseries mini chart (expandable row) ────────────────────────────────

interface IpHistoryChartProps {
  ip: string;
  epochBegin: number;
  epochEnd: number;
  bucketSeconds: number;
}

function IpHistoryChart({ ip, epochBegin, epochEnd, bucketSeconds }: IpHistoryChartProps) {
  const [data, setData] = useState<{ bucket: number; total_bytes: number; flows: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getNetflowIpTimeseries({ ip, epoch_begin: epochBegin, epoch_end: epochEnd, bucket_seconds: bucketSeconds, direction: 'both' })
      .then(r => { if (!cancelled) { setData(r.records); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ip, epochBegin, epochEnd, bucketSeconds]);

  if (loading) return <div style={{ padding: '16px 32px', textAlign: 'center' }}><Spin size="small" /></div>;
  if (!data.length) return <div style={{ padding: '16px 32px', color: '#475569', fontSize: 12, textAlign: 'center' }}>Sem dados para este IP no período.</div>;

  const labels  = data.map(p => dayjs.unix(p.bucket).format('DD/MM HH:mm'));
  const mbps    = data.map(p => Number(((p.total_bytes ?? 0) * 8 / bucketSeconds / 1_000_000).toFixed(3)));
  const peakMbps = Math.max(...mbps, 0);
  const avgMbps  = mbps.reduce((s, v) => s + v, 0) / (mbps.length || 1);

  const opts: ApexOptions = {
    chart: { background: 'transparent', toolbar: { show: false }, animations: { enabled: false }, sparkline: { enabled: false } },
    colors: ['#00c8f0'],
    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0.01, stops: [0, 90, 100] } },
    stroke: { curve: 'smooth', width: 2 },
    xaxis: { categories: labels, labels: { style: { colors: '#475569', fontSize: '10px' } }, tickAmount: 6 },
    yaxis: { labels: { style: { colors: '#475569', fontSize: '10px' }, formatter: v => `${v.toFixed(1)}M` } },
    grid: { borderColor: '#1e2d4a', strokeDashArray: 4 },
    tooltip: { theme: 'dark' },
    dataLabels: { enabled: false },
  };

  return (
    <div style={{ padding: '8px 24px 4px' }}>
      <div style={{ display: 'flex', gap: 20, marginBottom: 6, fontSize: 11 }}>
        <span style={{ color: '#8b5cf6' }}>Pico: <strong style={{ fontFamily: 'monospace' }}>{fmtMbps(peakMbps)}</strong></span>
        <span style={{ color: '#f59e0b' }}>Média: <strong style={{ fontFamily: 'monospace' }}>{fmtMbps(avgMbps)}</strong></span>
        <span style={{ color: '#64748b' }}>Buckets: <strong>{data.length}</strong></span>
      </div>
      <Chart type="area" options={opts} series={[{ name: 'Mbps', data: mbps }]} height={150} />
    </div>
  );
}

// ─── Protocol evolution chart with growth badges ──────────────────────────────

function ProtocolEvolutionChart({ data, bucketSeconds, loading }: { data: NetflowProtoTimeseriesResult; bucketSeconds: number; loading: boolean }) {
  if (loading || !data.series.length) {
    return (
      <Card title={<span style={{ color: '#94a3b8' }}>Evolução por Protocolo</span>}
        style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 12 } }}>
        <p className="text-xs text-center py-8" style={{ color: '#475569' }}>
          {loading ? 'Carregando…' : 'Sem dados.'}
        </p>
      </Card>
    );
  }

  const labels = data.series.map(r => dayjs.unix(r['bucket']).format('DD/MM HH:mm'));
  const half   = Math.floor(data.series.length / 2);

  const series = data.protocols.map((proto, i) => {
    const vals = data.series.map(r => Number(((r[proto] ?? 0) * 8 / bucketSeconds / 1_000_000).toFixed(3)));
    const first  = vals.slice(0, half).reduce((s, v) => s + v, 0);
    const second = vals.slice(half).reduce((s, v) => s + v, 0);
    const growth = half > 1 && first > 0 ? ((second - first) / first * 100) : null;
    return { name: proto, data: vals, color: PROTO_PALETTE[i % PROTO_PALETTE.length], growth };
  });

  const opts: ApexOptions = {
    chart: { background: 'transparent', toolbar: { show: true, tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true, download: false } }, stacked: true, animations: { enabled: false } },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.6, opacityTo: 0.1 } },
    stroke: { curve: 'smooth', width: 1.5 },
    colors: data.protocols.map((_, i) => PROTO_PALETTE[i % PROTO_PALETTE.length]),
    xaxis: { categories: labels, labels: { style: { colors: '#475569', fontSize: '10px' }, rotate: 0 }, tickAmount: Math.min(10, labels.length) },
    yaxis: { labels: { style: { colors: '#475569', fontSize: '11px' }, formatter: v => `${v.toFixed(1)} Mbps` } },
    grid: { borderColor: '#1e2d4a', strokeDashArray: 4 },
    tooltip: { theme: 'dark', y: { formatter: v => `${v.toFixed(2)} Mbps` } },
    legend: { labels: { colors: '#94a3b8' }, fontSize: '12px' },
    dataLabels: { enabled: false },
  };

  return (
    <Card
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ color: '#94a3b8' }}>Evolução por Protocolo (Mbps empilhado)</span>
          {series.map(s => s.growth !== null && (
            <span key={s.name} style={{ fontSize: 11, color: s.color }}>
              {s.name}: <strong style={{ color: s.growth > 20 ? '#ff3b3b' : s.growth < -20 ? '#10b981' : '#f59e0b' }}>
                {s.growth >= 0 ? '+' : ''}{s.growth.toFixed(0)}%
              </strong>
            </span>
          ))}
        </div>
      }
      style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 12 } }}>
      <Chart type="area" options={opts} series={series} height={230} />
    </Card>
  );
}

// ─── Port evolution chart ──────────────────────────────────────────────────────

const PORT_PALETTE = ['#00c8f0', '#8b5cf6', '#f59e0b', '#10b981', '#ff6b6b'];

function PortEvolutionChart({ data, bucketSeconds, loading }: { data: NetflowPortTimeseriesResult; bucketSeconds: number; loading: boolean }) {
  if (loading || !data.series.length) {
    return (
      <Card title={<span style={{ color: '#94a3b8' }}>Evolução por Porta</span>}
        style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 12 } }}>
        <p className="text-xs text-center py-8" style={{ color: '#475569' }}>
          {loading ? 'Carregando…' : 'Sem dados.'}
        </p>
      </Card>
    );
  }

  const labels = data.series.map(r => dayjs.unix(r['bucket']).format('DD/MM HH:mm'));
  const series = data.ports.map((port, i) => ({
    name: port,
    data: data.series.map(r => Number(((r[port] ?? 0) * 8 / bucketSeconds / 1_000_000).toFixed(3))),
    color: PORT_PALETTE[i % PORT_PALETTE.length],
  }));

  const opts: ApexOptions = {
    chart: { background: 'transparent', toolbar: { show: true, tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true, download: false } }, animations: { enabled: false } },
    stroke: { curve: 'smooth', width: 2 },
    colors: data.ports.map((_, i) => PORT_PALETTE[i % PORT_PALETTE.length]),
    xaxis: { categories: labels, labels: { style: { colors: '#475569', fontSize: '10px' }, rotate: 0 }, tickAmount: Math.min(10, labels.length) },
    yaxis: { labels: { style: { colors: '#475569', fontSize: '11px' }, formatter: v => `${v.toFixed(1)} Mbps` } },
    grid: { borderColor: '#1e2d4a', strokeDashArray: 4 },
    tooltip: { theme: 'dark', y: { formatter: v => `${v.toFixed(2)} Mbps` } },
    legend: { labels: { colors: '#94a3b8' }, fontSize: '12px' },
    dataLabels: { enabled: false },
  };

  return (
    <Card title={<span style={{ color: '#94a3b8' }}>Evolução Top 5 Portas DST (Mbps)</span>}
      style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 12 } }}>
      <Chart type="line" options={opts} series={series} height={230} />
    </Card>
  );
}

// ─── ASN evolution chart ───────────────────────────────────────────────────────

function AsnEvolutionChart({
  data, bucketSeconds, loading, onAsnClick,
}: {
  data: NetflowAsnTimeseriesResult;
  bucketSeconds: number;
  loading: boolean;
  onAsnClick?: (asn: number) => void;
}) {
  if (loading || !data.series.length) {
    return (
      <Card title={<span style={{ color: '#94a3b8' }}>Evolução por ASN Origem</span>}
        style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 12 } }}>
        <p className="text-xs text-center py-8" style={{ color: '#475569' }}>
          {loading ? 'Carregando…' : 'Sem dados.'}
        </p>
      </Card>
    );
  }

  const labels = data.series.map(r => dayjs.unix(r['bucket']).format('DD/MM HH:mm'));
  const series = data.asns.map((asn, i) => ({
    name: `AS${asn}`,
    data: data.series.map(r => Number(((r[String(asn)] ?? 0) * 8 / bucketSeconds / 1_000_000).toFixed(3))),
    color: ASN_PALETTE[i % ASN_PALETTE.length],
  }));

  const opts: ApexOptions = {
    chart: {
      background: 'transparent',
      toolbar: { show: true, tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true, download: false } },
      animations: { enabled: false },
      events: {
        dataPointSelection: (_e: unknown, _ctx: unknown, cfg: { seriesIndex: number; w: { globals: { seriesNames: string[] } } } | undefined) => {
          if (!cfg) return;
          const name = cfg.w.globals.seriesNames[cfg.seriesIndex];
          const asnNum = parseInt(name.replace('AS', ''), 10);
          if (!isNaN(asnNum)) onAsnClick?.(asnNum);
        },
      },
    },
    stroke: { curve: 'smooth', width: 2 },
    colors: data.asns.map((_, i) => ASN_PALETTE[i % ASN_PALETTE.length]),
    xaxis: { categories: labels, labels: { style: { colors: '#475569', fontSize: '10px' }, rotate: 0 }, tickAmount: Math.min(10, labels.length) },
    yaxis: { labels: { style: { colors: '#475569', fontSize: '11px' }, formatter: v => `${v.toFixed(1)} Mbps` } },
    grid: { borderColor: '#1e2d4a', strokeDashArray: 4 },
    tooltip: { theme: 'dark', y: { formatter: v => `${v.toFixed(2)} Mbps` } },
    legend: { labels: { colors: '#94a3b8' }, fontSize: '12px', onItemClick: { toggleDataSeries: false } },
    dataLabels: { enabled: false },
    states: { active: { filter: { type: 'darken' } } },
  };

  return (
    <Card
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#94a3b8' }}>Evolução Top 5 ASNs Origem (Mbps)</span>
          <span style={{ color: '#475569', fontSize: 11 }}>clique no ponto → drill-down</span>
        </div>
      }
      style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 12 } }}>
      <Chart type="line" options={opts} series={series} height={230} />
    </Card>
  );
}

// ─── Timeseries chart ─────────────────────────────────────────────────────────

type ChartMetric = 'mbps' | 'flows' | 'packets' | 'split';

interface TimeseriesChartProps {
  data: NetflowTimeseriesPoint[];
  prevData: NetflowTimeseriesPoint[];
  loading: boolean;
  bucketSeconds: number;
  metric: ChartMetric;
  onMetricChange: (m: ChartMetric) => void;
  showPrev: boolean;
  onTogglePrev: () => void;
  onBucketClick?: (bucket: number) => void;
}

function NetflowTimeseriesChart({
  data, prevData, loading, bucketSeconds, metric, onMetricChange, showPrev, onTogglePrev, onBucketClick,
}: TimeseriesChartProps) {
  if (!data.length) {
    return (
      <Card title={<span style={{ color: '#94a3b8' }}>Histórico e Evolução de Tráfego</span>}
        style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 12 } }}>
        <p className="text-xs text-center py-12" style={{ color: '#475569' }}>
          {loading ? 'Carregando série temporal…' : 'Sem dados para o período selecionado.'}
        </p>
      </Card>
    );
  }

  const labels     = data.map(p => dayjs.unix(p.bucket).format('DD/MM HH:mm'));
  const mbpsSeries = data.map(p => Number(((p.total_bytes ?? 0) * 8 / bucketSeconds / 1_000_000).toFixed(3)));
  const inMbps     = data.map(p => Number(((p.in_bytes  ?? 0) * 8 / bucketSeconds / 1_000_000).toFixed(3)));
  const outMbps    = data.map(p => Number(((p.out_bytes ?? 0) * 8 / bucketSeconds / 1_000_000).toFixed(3)));
  const flowSeries = data.map(p => p.flows ?? 0);
  const pktSeries  = data.map(p => p.total_packets ?? 0);
  const warnSeries = data.map(p => p.warning ?? 0);
  const critSeries = data.map(p => p.critical ?? 0);

  const hasInOut   = inMbps.some(v => v > 0);

  const prevMbps   = prevData.map(p => Number(((p.total_bytes ?? 0) * 8 / bucketSeconds / 1_000_000).toFixed(3)));

  const peakMbps = Math.max(...mbpsSeries, 0);
  const avgMbps  = mbpsSeries.reduce((s, v) => s + v, 0) / (mbpsSeries.length || 1);

  const isSplit = metric === 'split' && hasInOut;

  const buildSeries = () => {
    if (isSplit) {
      return [
        { name: 'IN (↓)',    type: 'area',   data: inMbps   },
        { name: 'OUT (↑)',   type: 'area',   data: outMbps  },
        { name: 'Avisos',    type: 'column', data: warnSeries },
        { name: 'Críticos',  type: 'column', data: critSeries },
        ...(showPrev && prevMbps.length ? [{ name: 'Período ant.', type: 'line', data: prevMbps }] : []),
      ];
    }
    const metricSeries = metric === 'flows' ? flowSeries : metric === 'packets' ? pktSeries : mbpsSeries;
    const metricLabel  = metric === 'flows' ? 'Fluxos' : metric === 'packets' ? 'Pacotes' : 'Banda (Mbps)';
    return [
      { name: metricLabel,    type: 'area',   data: metricSeries },
      { name: 'Avisos',       type: 'column', data: warnSeries   },
      { name: 'Críticos',     type: 'column', data: critSeries   },
      ...(showPrev && prevMbps.length ? [{ name: 'Período ant.', type: 'line', data: prevMbps }] : []),
    ];
  };

  const seriesData = buildSeries();

  const metricFmt = (metric === 'flows' || metric === 'packets')
    ? (v: number) => v.toLocaleString('pt-BR')
    : (v: number) => `${v.toFixed(2)} Mbps`;

  const options: ApexOptions = {
    chart: {
      id: `netflow-ts-${metric}`, background: 'transparent',
      toolbar: { show: true, tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true, download: false } },
      animations: { enabled: false }, zoom: { enabled: true },
      events: {
        dataPointSelection: (_e: unknown, _ctx: unknown, cfg: { dataPointIndex: number; w: { globals: { categoryLabels: string[] } } } | undefined) => {
          if (!cfg) return;
          const bucket = data[cfg.dataPointIndex]?.bucket;
          if (bucket) onBucketClick?.(bucket);
        },
      },
    },
    colors: isSplit
      ? ['#00c8f0', '#f59e0b', '#f59e0b55', '#ff3b3b', '#ffffff44']
      : ['#00c8f0', '#f59e0b', '#ff3b3b', '#ffffff44'],
    fill: {
      type: seriesData.map(s => s.type === 'area' ? 'gradient' : 'solid'),
      gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.02, stops: [0, 95, 100] },
    },
    stroke: {
      curve: 'smooth',
      width: seriesData.map(s => s.type === 'column' ? 0 : s.name === 'Período ant.' ? 1.5 : 2),
      dashArray: seriesData.map(s => s.name === 'Período ant.' ? 5 : 0),
    },
    plotOptions: { bar: { columnWidth: '60%' } },
    annotations: (metric === 'mbps' || isSplit) ? {
      yaxis: [
        { y: avgMbps, borderColor: '#f59e0b', borderWidth: 1, strokeDashArray: 4,
          label: { text: `Média ${avgMbps.toFixed(2)} Mbps`, style: { color: '#f59e0b', background: '#0a0f1e', fontSize: '10px' } } },
      ],
    } : {},
    grid: { borderColor: '#1e2d4a', strokeDashArray: 4, xaxis: { lines: { show: false } } },
    xaxis: {
      categories: labels,
      labels: { style: { colors: '#475569', fontSize: '10px', fontFamily: 'monospace' }, rotate: 0 },
      axisBorder: { show: false }, axisTicks: { show: false },
      tickAmount: Math.min(10, labels.length),
    },
    yaxis: { labels: { style: { colors: '#475569', fontSize: '11px', fontFamily: 'monospace' }, formatter: metricFmt } },
    tooltip: { theme: 'dark', x: { show: true }, y: { formatter: metricFmt } },
    legend: { labels: { colors: '#94a3b8' }, fontSize: '12px' },
    dataLabels: { enabled: false },
  };

  const METRIC_BTN: { key: ChartMetric; label: string }[] = [
    { key: 'mbps',    label: 'Total'   },
    { key: 'split',   label: 'IN/OUT'  },
    { key: 'flows',   label: 'Fluxos'  },
    { key: 'packets', label: 'Pacotes' },
  ];

  return (
    <Card
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ color: '#94a3b8' }}>Histórico e Evolução de Tráfego</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {METRIC_BTN.map(({ key, label }) => (
                <button key={key}
                  onClick={() => onMetricChange(key)}
                  disabled={key === 'split' && !hasInOut}
                  title={key === 'split' && !hasInOut ? 'Configure interfaces com tipo Transit/IX para habilitar' : undefined}
                  style={{
                    padding: '2px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: 'none',
                    cursor: key === 'split' && !hasInOut ? 'not-allowed' : 'pointer',
                    background: metric === key ? '#00c8f0' : '#1e2d4a',
                    color: metric === key ? '#000' : key === 'split' && !hasInOut ? '#334155' : '#94a3b8',
                    transition: 'all 0.15s',
                  }}>
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={onTogglePrev}
              style={{
                padding: '2px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4,
                border: '1px solid #1e2d4a', cursor: 'pointer',
                background: showPrev ? '#8b5cf620' : 'transparent',
                color: showPrev ? '#8b5cf6' : '#475569',
              }}>
              ⟳ Período ant.
            </button>
            <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
              <span style={{ color: '#8b5cf6' }}>Pico: <strong>{fmtMbps(peakMbps)}</strong></span>
              <span style={{ color: '#f59e0b' }}>Média: <strong>{fmtMbps(avgMbps)}</strong></span>
            </div>
          </div>
        </div>
      }
      style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 12 } }}>
      <Chart
        key={`ts-${data.length}-${metric}-${showPrev}-${prevData.length}`}
        options={options}
        series={seriesData}
        type="line"
        height={290}
      />
    </Card>
  );
}

// ─── Protocols with percentage bars ───────────────────────────────────────────

function ProtocolsWithBar({ data, loading }: { data: NetflowProtocol[]; loading: boolean }) {
  const total = data.reduce((s, r) => s + (r.total_bytes ?? 0), 0);
  return (
    <Table<NetflowProtocol>
      size="small" rowKey="protocol" loading={loading} pagination={false}
      dataSource={data} locale={{ emptyText: 'Sem dados' }}
      columns={[
        ...protocolColumns,
        {
          title: '%',
          dataIndex: 'total_bytes',
          width: 100,
          render: (v: number) => {
            const pct = total > 0 ? (v / total) * 100 : 0;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 6, background: '#1e2d4a', borderRadius: 3 }}>
                  <div style={{ width: `${pct.toFixed(1)}%`, height: '100%', background: '#00c8f0', borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 10, color: '#64748b', width: 34, textAlign: 'right' }}>
                  {pct.toFixed(1)}%
                </span>
              </div>
            );
          },
        },
      ]}
    />
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export function NetflowPage() {
  const [rangeSeconds, setRangeSeconds]   = useState(24 * 3600);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [chartMetric, setChartMetric]     = useState<ChartMetric>('mbps');

  const [draftFilters, setDraftFilters]   = useState<Filters>({});
  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const appliedRef = useRef(appliedFilters);
  appliedRef.current = appliedFilters;

  const navigate = useNavigate();

  const [summary, setSummary]             = useState<NetflowSummary | null>(null);
  const [topTalkersSrc, setTopTalkersSrc] = useState<NetflowTopTalker[]>([]);
  const [topTalkersDst, setTopTalkersDst] = useState<NetflowTopTalker[]>([]);
  const [ipBlockMap, setIpBlockMap]       = useState<Record<string, { id: number; cidr: string; label: string; type: string | null }>>({});
  const [topPorts, setTopPorts]           = useState<NetflowTopPort[]>([]);
  const [portType, setPortType]           = useState<'src' | 'dst'>('dst');
  const [topAsnSrc, setTopAsnSrc]         = useState<NetflowTopAsn[]>([]);
  const [topAsnDst, setTopAsnDst]         = useState<NetflowTopAsn[]>([]);
  const [protocols, setProtocols]         = useState<NetflowProtocol[]>([]);
  const [bandwidth, setBandwidth]         = useState<NetflowBandwidthClient[]>([]);
  const [incidents, setIncidents]         = useState<NetflowIncident[]>([]);
  const [timeseries, setTimeseries]       = useState<NetflowTimeseriesPoint[]>([]);
  const [protoTs, setProtoTs]             = useState<NetflowProtoTimeseriesResult>({ protocols: [], series: [] });
  const [asnTs, setAsnTs]                 = useState<NetflowAsnTimeseriesResult>({ asns: [], series: [] });
  const [portTs, setPortTs]               = useState<NetflowPortTimeseriesResult>({ ports: [], series: [] });
  const [showPrevTs, setShowPrevTs]       = useState(false);
  const [prevTimeseries, setPrevTimeseries] = useState<NetflowTimeseriesPoint[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);

  // range context for expandable IP charts
  const [epochRange, setEpochRange]       = useState<{ begin: number; end: number }>({ begin: 0, end: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const epoch_end      = Math.floor(Date.now() / 1000);
    const epoch_begin    = epoch_end - rangeSeconds;
    const bucket_seconds = bucketSecondsFor(rangeSeconds);
    setEpochRange({ begin: epoch_begin, end: epoch_end });
    const fp = filtersToParams(appliedRef.current);
    const base = { epoch_begin, epoch_end, ...fp };
    const limited = { ...base, limit: 15 };

    const prevEnd   = epoch_begin;
    const prevBegin = prevEnd - rangeSeconds;

    const results = await Promise.allSettled([
      getNetflowSummary({ ...base, bucket_seconds }),           // 0
      getNetflowTopTalkers({ ...limited, direction: 'src' }),  // 1
      getNetflowTopTalkers({ ...limited, direction: 'dst' }),  // 2
      getNetflowTopPorts({ ...limited, port_type: portType }),  // 3
      getNetflowTopAsn({ ...limited, asn_type: 'src' }),       // 4
      getNetflowTopAsn({ ...limited, asn_type: 'dst' }),       // 5
      getNetflowProtocols(base),                                // 6
      getNetflowBandwidthByClient(limited),                    // 7
      getNetflowIncidents({ ...base, limit: 50 }),             // 8
      getNetflowTimeseries({ ...base, bucket_seconds }),       // 9
      getNetflowProtocolTimeseries({ epoch_begin, epoch_end, bucket_seconds }), // 10
      getNetflowAsnTimeseries({ epoch_begin, epoch_end, bucket_seconds }),      // 11
      getNetflowPortTimeseries({ epoch_begin, epoch_end, bucket_seconds }),     // 12
      getNetflowTimeseries({ epoch_begin: prevBegin, epoch_end: prevEnd, bucket_seconds }), // 13 prev period
    ]);

    const [r0,r1,r2,r3,r4,r5,r6,r7,r8,r9,r10,r11,r12,r13] = results;
    if (r0.status === 'fulfilled')  setSummary(r0.value);                else setSummary(null);
    const srcRecords = r1.status === 'fulfilled' ? r1.value.records : [];
    const dstRecords = r2.status === 'fulfilled' ? r2.value.records : [];
    setTopTalkersSrc(srcRecords);
    setTopTalkersDst(dstRecords);

    // Resolve IPs → blocos IP cadastrados (best-effort, non-blocking)
    const allIps = [...new Set([...srcRecords.map((r: NetflowTopTalker) => r.ip), ...dstRecords.map((r: NetflowTopTalker) => r.ip)])];
    resolveIpsToBlocks(allIps).then(res => setIpBlockMap(res.resolved)).catch(() => {});
    if (r3.status === 'fulfilled')  setTopPorts(r3.value.records);       else setTopPorts([]);
    if (r4.status === 'fulfilled')  setTopAsnSrc(r4.value.records);      else setTopAsnSrc([]);
    if (r5.status === 'fulfilled')  setTopAsnDst(r5.value.records);      else setTopAsnDst([]);
    if (r6.status === 'fulfilled')  setProtocols(r6.value.records);      else setProtocols([]);
    if (r7.status === 'fulfilled')  setBandwidth(r7.value.records);       else setBandwidth([]);
    if (r8.status === 'fulfilled')  setIncidents(r8.value.records);      else setIncidents([]);
    if (r9.status === 'fulfilled')  setTimeseries(r9.value.records);     else setTimeseries([]);
    if (r10.status === 'fulfilled') setProtoTs(r10.value);               else setProtoTs({ protocols: [], series: [] });
    if (r11.status === 'fulfilled') setAsnTs(r11.value);                 else setAsnTs({ asns: [], series: [] });
    if (r12.status === 'fulfilled') setPortTs(r12.value);               else setPortTs({ ports: [], series: [] });
    if (r13.status === 'fulfilled') setPrevTimeseries(r13.value.records); else setPrevTimeseries([]);

    if (results.every(r => r.status === 'rejected')) {
      setError('Não foi possível carregar dados de NetFlow. Verifique a conexão com o backend.');
    }
    setLoading(false);
  }, [rangeSeconds, appliedFilters, portType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const applyFilters = () => setAppliedFilters({ ...draftFilters });
  const clearFilters = () => { setDraftFilters({}); setAppliedFilters({}); };

  const handleSelectFilter = (key: keyof Filters, value: string | undefined) => {
    const next = { ...draftFilters, [key]: value };
    setDraftFilters(next);
    setAppliedFilters(next);
  };

  const refresh = () => { load().then(() => message.success('Dados atualizados')); };

  const hasData = topTalkersSrc.length > 0 || topTalkersDst.length > 0 || protocols.length > 0
    || bandwidth.length > 0 || timeseries.length > 0;
  const activeFilters = hasActiveFilters(appliedFilters);

  const bucketSecs = bucketSecondsFor(rangeSeconds);

  // Column definitions (depend on runtime state/navigate)
  const talkerCols = makeTopTalkerColumns(ipBlockMap, navigate);
  const asnCols    = makeAsnColumns(navigate, summary?.total_bytes ?? 0);

  // CDN distribution: sum bytes from top talkers whose IPs resolve to a CDN block
  const cdnDistribution: Array<{ label: string; bytes: number }> = (() => {
    const providers: Record<string, number> = {};
    for (const talker of [...topTalkersSrc, ...topTalkersDst]) {
      const block = ipBlockMap[talker.ip];
      if (block?.type === 'CDN') {
        providers[block.label] = (providers[block.label] ?? 0) + talker.total_bytes;
      }
    }
    return Object.entries(providers).sort((a, b) => b[1] - a[1]).map(([label, bytes]) => ({ label, bytes }));
  })();
  const totalCdnBytes = cdnDistribution.reduce((s, e) => s + e.bytes, 0);

  // Expandable row for top talker tables
  const expandable = {
    expandedRowRender: (record: NetflowTopTalker) => (
      <IpHistoryChart
        ip={record.ip}
        epochBegin={epochRange.begin}
        epochEnd={epochRange.end}
        bucketSeconds={bucketSecs}
      />
    ),
    rowExpandable: () => epochRange.begin > 0,
  };

  return (
    <main style={{
      flex: 1, overflowY: 'auto', padding: '16px', minWidth: 0,
      display: 'flex', flexDirection: 'column', gap: '14px',
    }}>
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl p-4" style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: '#00c8f018' }}>
              <Network size={18} style={{ color: '#00c8f0' }} />
            </div>
            <div>
              <h2 className="font-bold text-sm" style={{ color: '#e2e8f0' }}>Tráfego NetFlow</h2>
              <p className="text-xs" style={{ color: '#475569' }}>
                Análise do fluxo de rede coletado via GoFlow2 — Top IPs, portas, ASN, protocolos e incidentes.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select size="small" value={rangeSeconds} onChange={setRangeSeconds} options={RANGE_OPTIONS} style={{ width: 150 }} />
            <Button size="small" icon={<RefreshCw size={12} />} onClick={refresh} loading={loading}
              style={{ background: '#0a0f1e', borderColor: '#1e3a5f', color: '#94a3b8' }}>
              Atualizar
            </Button>
          </div>
        </div>

        {/* ─── Filter bar ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Filter size={12} style={{ color: '#475569', flexShrink: 0 }} />
          <Select size="small" allowClear placeholder="Protocolo" style={{ width: 110 }}
            value={draftFilters.protocol} onChange={v => handleSelectFilter('protocol', v)} options={PROTOCOL_OPTIONS} />
          <Select size="small" allowClear placeholder="Versão IP" style={{ width: 95 }}
            value={draftFilters.ip_version}
            onChange={v => handleSelectFilter('ip_version', v as '4' | '6' | undefined)}
            options={[{ label: 'IPv4', value: '4' }, { label: 'IPv6', value: '6' }]} />
          <Input size="small" placeholder="ASN (ex: 1234)" style={{ width: 130, background: '#0a0f1e', borderColor: '#1e3a5f', color: '#e2e8f0' }}
            value={draftFilters.asn ?? ''} onChange={e => setDraftFilters(f => ({ ...f, asn: e.target.value }))} onPressEnter={applyFilters} />
          <Input size="small" placeholder="IP Origem" style={{ width: 140, background: '#0a0f1e', borderColor: '#1e3a5f', color: '#e2e8f0' }}
            value={draftFilters.src_ip ?? ''} onChange={e => setDraftFilters(f => ({ ...f, src_ip: e.target.value }))} onPressEnter={applyFilters} />
          <Input size="small" placeholder="IP Destino" style={{ width: 140, background: '#0a0f1e', borderColor: '#1e3a5f', color: '#e2e8f0' }}
            value={draftFilters.dst_ip ?? ''} onChange={e => setDraftFilters(f => ({ ...f, dst_ip: e.target.value }))} onPressEnter={applyFilters} />
          <Button size="small" onClick={applyFilters}
            style={{ background: '#00c8f0', borderColor: '#00c8f0', color: '#000', fontWeight: 600 }}>
            Aplicar
          </Button>
          {activeFilters && (
            <Button size="small" icon={<X size={11} />} onClick={clearFilters}
              style={{ background: 'transparent', borderColor: '#334155', color: '#94a3b8' }}>
              Limpar
            </Button>
          )}
          {activeFilters && <span style={{ fontSize: 11, color: '#f59e0b' }}>Filtros ativos</span>}
        </div>

        {error && (
          <div className="rounded-lg p-2.5 mt-3"
            style={{ background: '#ff3b3b10', border: '1px solid #ff3b3b33', color: '#ff3b3b', fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && !hasData && (
          <div className="rounded-lg p-2.5 mt-3"
            style={{ background: '#f59e0b10', border: '1px solid #f59e0b33', color: '#f59e0b', fontSize: 12 }}>
            Nenhum dado de NetFlow (GoFlow2) disponível para o período e filtros selecionados.
          </div>
        )}
      </div>

      {/* ─── KPI cards ───────────────────────────────────────────────────── */}
      <NetflowKpiCards summary={summary} loading={loading} />

      {/* ─── Timeseries chart (com toggle de métrica) ────────────────────── */}
      <NetflowTimeseriesChart
        data={timeseries}
        prevData={prevTimeseries}
        loading={loading}
        bucketSeconds={bucketSecs}
        metric={chartMetric}
        onMetricChange={setChartMetric}
        showPrev={showPrevTs}
        onTogglePrev={() => setShowPrevTs(p => !p)}
        onBucketClick={setSelectedBucket}
      />

      {/* ─── Drill-down: Top IPs no bucket selecionado ───────────────────── */}
      {selectedBucket !== null && (() => {
        const bucketTime = new Date(selectedBucket * 1000).toLocaleString('pt-BR');
        const bucketEnd  = selectedBucket + bucketSecs;
        const bucketRows = topTalkersSrc.slice(0, 5);
        return (
          <Card
            title={<span style={{ color: '#94a3b8' }}>Top IPs em {bucketTime}</span>}
            extra={<button onClick={() => setSelectedBucket(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>✕ fechar</button>}
            style={{ background: '#0a0f1e', border: '1px solid #f59e0b' }}
            styles={{ body: { padding: 8 } }}
          >
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
              Intervalo: {bucketTime} – {new Date(bucketEnd * 1000).toLocaleString('pt-BR')} · Mostrando top IPs do período completo (drill-down por bucket requer filtro adicional)
            </div>
            <Table
              size="small" rowKey="ip" pagination={false}
              dataSource={bucketRows}
              columns={[
                { title: 'IP', dataIndex: 'ip', key: 'ip', render: (ip: string) => <span style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{ip}</span> },
                { title: 'Bytes', dataIndex: 'bytes', key: 'bytes', render: (b: number) => `${(b / 1e6).toFixed(1)} MB` },
              ]}
              locale={{ emptyText: 'Sem dados' }}
            />
          </Card>
        );
      })()}

      {/* ─── Evolução por protocolo + porta + ASN ────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <ProtocolEvolutionChart data={protoTs} bucketSeconds={bucketSecs} loading={loading} />
        <PortEvolutionChart data={portTs} bucketSeconds={bucketSecs} loading={loading} />
        <AsnEvolutionChart data={asnTs} bucketSeconds={bucketSecs} loading={loading}
          onAsnClick={asnNum => navigate(`/asn/${asnNum}`)} />
      </div>

      {/* ─── Top Talkers / Portas / Protocolos / ASN ─────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card title={<span style={{ color: '#94a3b8' }}>Top Origens — clique ▶ para histórico</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 8 } }}>
          <Table<NetflowTopTalker>
            size="small" rowKey="ip" loading={loading} pagination={false}
            dataSource={topTalkersSrc} columns={talkerCols}
            expandable={expandable}
            locale={{ emptyText: 'Sem dados' }} />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Top Destinos — clique ▶ para histórico</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 8 } }}>
          <Table<NetflowTopTalker>
            size="small" rowKey="ip" loading={loading} pagination={false}
            dataSource={topTalkersDst} columns={talkerCols}
            expandable={expandable}
            locale={{ emptyText: 'Sem dados' }} />
        </Card>

        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Top Portas {portType === 'dst' ? 'de Destino' : 'de Origem'}</span>
              <Space size={4}>
                <Button
                  size="small"
                  type={portType === 'dst' ? 'primary' : 'default'}
                  onClick={() => setPortType('dst')}
                  style={{ fontSize: 11, padding: '0 8px', height: 22, ...(portType !== 'dst' ? { background: '#0f1f3d', borderColor: '#1e2d4a', color: '#64748b' } : {}) }}
                >DST</Button>
                <Button
                  size="small"
                  type={portType === 'src' ? 'primary' : 'default'}
                  onClick={() => setPortType('src')}
                  style={{ fontSize: 11, padding: '0 8px', height: 22, ...(portType !== 'src' ? { background: '#0f1f3d', borderColor: '#1e2d4a', color: '#64748b' } : {}) }}
                >SRC</Button>
              </Space>
            </div>
          }
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 8 } }}>
          <Table<NetflowTopPort>
            size="small" rowKey={r => `${r.port}-${r.protocol}`} loading={loading} pagination={false}
            dataSource={topPorts} columns={topPortColumns} locale={{ emptyText: 'Sem dados' }} />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Distribuição por Protocolo</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 8 } }}>
          <ProtocolsWithBar data={protocols} loading={loading} />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Top ASN Origem</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 8 } }}>
          <Table<NetflowTopAsn>
            size="small" rowKey="asn" loading={loading} pagination={false}
            dataSource={topAsnSrc} columns={asnCols} locale={{ emptyText: 'Sem dados' }} />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Top ASN Destino</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 8 } }}>
          <Table<NetflowTopAsn>
            size="small" rowKey="asn" loading={loading} pagination={false}
            dataSource={topAsnDst} columns={asnCols} locale={{ emptyText: 'Sem dados' }} />
        </Card>
      </div>

      {/* ─── CDN distribution ───────────────────────────────────────────── */}
      {cdnDistribution.length > 0 && (
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: '#94a3b8' }}>Distribuição de Tráfego CDN</span>
              <span style={{ color: '#475569', fontSize: 12 }}>
                {formatBytes(totalCdnBytes)} identificados nos top talkers
              </span>
            </div>
          }
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }}
          styles={{ body: { padding: '12px 16px' } }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {cdnDistribution.map(({ label, bytes }) => {
              const pct = totalCdnBytes > 0 ? (bytes / totalCdnBytes * 100) : 0;
              const color = label === 'Cloudflare' ? '#f97316'
                : label === 'Google'    ? '#3b82f6'
                : label === 'Fastly'    ? '#ec4899'
                : label === 'Akamai'    ? '#8b5cf6'
                : '#22c55e'; // Amazon + others
              return (
                <div key={label} style={{ background: '#060d1f', border: '1px solid #1e2d4a', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color, fontWeight: 600, fontSize: 13 }}>{label}</span>
                    <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 12 }}>{pct.toFixed(1)}%</span>
                  </div>
                  <Progress percent={parseFloat(pct.toFixed(1))} showInfo={false} size="small"
                    strokeColor={color} trailColor="#1e2d4a" style={{ marginBottom: 4 }} />
                  <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: 11 }}>{formatBytes(bytes)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ─── Bandwidth by client ─────────────────────────────────────────── */}
      <Card title={<span style={{ color: '#94a3b8' }}>Banda por Cliente (Top Talkers)</span>}
        style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 8 } }}>
        <Table<NetflowBandwidthClient>
          size="small" rowKey="ip" loading={loading} pagination={{ pageSize: 10 }}
          dataSource={bandwidth} columns={bandwidthColumns} locale={{ emptyText: 'Sem dados' }} />
      </Card>

      {/* ─── Incidents ───────────────────────────────────────────────────── */}
      <Card title={<span style={{ color: '#94a3b8' }}>Incidentes Recentes (Severidade Elevada)</span>}
        style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 8 } }}>
        <Table<NetflowIncident>
          size="small" rowKey="id" loading={loading} pagination={{ pageSize: 10 }}
          dataSource={incidents} columns={incidentColumns} locale={{ emptyText: 'Nenhum incidente no período' }} />
      </Card>
    </main>
  );
}

// ─── Table column definitions ─────────────────────────────────────────────────

function makeTopTalkerColumns(
  ipBlockMap: Record<string, { id: number; cidr: string; label: string; type: string | null }>,
  navigate: (path: string) => void,
): ColumnsType<NetflowTopTalker> {
  return [
    {
      title: 'IP / Bloco', dataIndex: 'ip',
      render: (v: string) => {
        const block = ipBlockMap[v];
        return (
          <div>
            <span style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v}</span>
            {block && (
              <Tag color="blue"
                style={{ fontSize: 10, marginLeft: 6, cursor: 'pointer' }}
                onClick={e => { e.stopPropagation(); navigate(`/ip-blocks/${block.id}`); }}>
                {block.cidr}
              </Tag>
            )}
          </div>
        );
      },
    },
    { title: 'Volume', dataIndex: 'total_bytes',
      sorter: (a, b) => a.total_bytes - b.total_bytes, defaultSortOrder: 'descend',
      render: v => formatBytes(v) },
    { title: 'Pacotes', dataIndex: 'total_packets',
      render: v => (v ?? 0).toLocaleString('pt-BR') },
    { title: 'Fluxos', dataIndex: 'flows' },
  ];
}

const topPortColumns: ColumnsType<NetflowTopPort> = [
  { title: 'Porta', dataIndex: 'port',
    render: v => <span style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v ?? '-'}</span> },
  { title: 'Protocolo', dataIndex: 'protocol' },
  { title: 'Volume', dataIndex: 'total_bytes',
    sorter: (a, b) => a.total_bytes - b.total_bytes, defaultSortOrder: 'descend',
    render: v => formatBytes(v) },
  { title: 'Pacotes', dataIndex: 'total_packets',
    render: v => (v ?? 0).toLocaleString('pt-BR') },
  { title: 'Fluxos', dataIndex: 'flows' },
];

const protocolColumns: ColumnsType<NetflowProtocol> = [
  { title: 'Protocolo', dataIndex: 'protocol',
    render: v => <Tag style={{ fontSize: 12, background: '#0d1b2e', borderColor: '#1e3a5f', color: '#94a3b8' }}>{v}</Tag> },
  { title: 'Volume', dataIndex: 'total_bytes',
    sorter: (a, b) => a.total_bytes - b.total_bytes, defaultSortOrder: 'descend',
    render: v => formatBytes(v) },
  { title: 'Pacotes', dataIndex: 'total_packets',
    render: v => (v ?? 0).toLocaleString('pt-BR') },
  { title: 'Fluxos', dataIndex: 'flows' },
];

function makeAsnColumns(navigate: (path: string) => void, totalBytes: number): ColumnsType<NetflowTopAsn> {
  return [
    { title: 'ASN', dataIndex: 'asn',
      render: (v: number) => (
        <span style={{ fontFamily: 'monospace', color: '#8b5cf6', cursor: 'pointer' }}
          onClick={() => navigate(`/asn/${v}`)}>AS{v}</span>
      )},
    { title: 'Volume', dataIndex: 'total_bytes',
      sorter: (a, b) => a.total_bytes - b.total_bytes, defaultSortOrder: 'descend',
      render: (v: number) => formatBytes(v) },
    {
      title: '% Total', dataIndex: 'total_bytes', key: 'pct', width: 110,
      render: (v: number) => {
        const pct = totalBytes > 0 ? (v / totalBytes * 100) : 0;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Progress percent={parseFloat(pct.toFixed(1))} size="small" showInfo={false}
              strokeColor="#8b5cf6" style={{ flex: 1, marginBottom: 0 }} />
            <span style={{ color: '#8b5cf6', fontFamily: 'monospace', fontSize: 11, width: 36, textAlign: 'right' }}>
              {pct.toFixed(1)}%
            </span>
          </div>
        );
      },
    },
    { title: 'Fluxos', dataIndex: 'flows' },
  ];
}

const bandwidthColumns: ColumnsType<NetflowBandwidthClient> = [
  { title: 'IP Cliente', dataIndex: 'ip',
    render: v => <span style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v}</span> },
  { title: 'Volume', dataIndex: 'total_bytes',
    sorter: (a, b) => a.total_bytes - b.total_bytes, defaultSortOrder: 'descend',
    render: v => formatBytes(v) },
  { title: 'Pacotes', dataIndex: 'total_packets',
    render: v => (v ?? 0).toLocaleString('pt-BR') },
  { title: 'Fluxos', dataIndex: 'flows' },
  { title: 'Críticos', dataIndex: 'critical',
    render: v => <span style={{ color: v > 0 ? '#ff3b3b' : '#64748b' }}>{v}</span> },
  { title: 'Avisos', dataIndex: 'warning',
    render: v => <span style={{ color: v > 0 ? '#f59e0b' : '#64748b' }}>{v}</span> },
];

const incidentColumns: ColumnsType<NetflowIncident> = [
  { title: 'Horário', dataIndex: 'tstamp', width: 155,
    render: v => dayjs.unix(v).format('DD/MM/YYYY HH:mm:ss') },
  { title: 'Severidade', dataIndex: 'severity', width: 105,
    render: v => <Tag color={SEVERITY_COLORS[v] ?? '#475569'} style={{ fontSize: 11 }}>{v}</Tag> },
  { title: 'Score', dataIndex: 'score', width: 65 },
  { title: 'Origem', dataIndex: 'cli_ip',
    render: v => <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{v}</span> },
  { title: 'Destino', dataIndex: 'ip',
    render: v => <span style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v}</span> },
  { title: 'Porta Dst', dataIndex: 'dst_port', width: 90 },
  { title: 'Proto', dataIndex: 'proto', width: 80 },
  { title: 'Bytes', dataIndex: 'bytes', render: v => formatBytes(v) },
  { title: 'Pacotes', dataIndex: 'packets' },
];

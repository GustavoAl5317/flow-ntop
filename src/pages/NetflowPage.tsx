import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Table, Tag, Select, Button, Input, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import dayjs from 'dayjs';
import { Network, RefreshCw, Filter, X } from 'lucide-react';
import {
  getNetflowSummary,
  getNetflowTopTalkers,
  getNetflowTopPorts,
  getNetflowTopAsn,
  getNetflowProtocols,
  getNetflowBandwidthByClient,
  getNetflowIncidents,
  getNetflowTimeseries,
  type NetflowSummary,
  type NetflowTopTalker,
  type NetflowTopPort,
  type NetflowTopAsn,
  type NetflowProtocol,
  type NetflowBandwidthClient,
  type NetflowIncident,
  type NetflowTimeseriesPoint,
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

interface KpiCardsProps {
  summary: NetflowSummary | null;
  loading: boolean;
}

function NetflowKpiCards({ summary, loading }: KpiCardsProps) {
  const metrics = [
    { label: 'Banda Atual',        value: summary ? fmtMbps(summary.current_mbps) : '—', color: '#00c8f0' },
    { label: 'Pico do Período',    value: summary ? fmtMbps(summary.peak_mbps)    : '—', color: '#8b5cf6' },
    { label: 'Média de Consumo',   value: summary ? fmtMbps(summary.avg_mbps)     : '—', color: '#f59e0b' },
    { label: 'Total Processado',   value: summary ? formatBytes(summary.total_bytes)                      : '—', color: '#10b981' },
    { label: 'Total de Fluxos',    value: summary ? summary.total_flows.toLocaleString('pt-BR')           : '—', color: '#64748b' },
    { label: 'Total de Pacotes',   value: summary ? summary.total_packets.toLocaleString('pt-BR')         : '—', color: '#64748b' },
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

// ─── main page ────────────────────────────────────────────────────────────────

export function NetflowPage() {
  const [rangeSeconds, setRangeSeconds] = useState(24 * 3600);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // draft = what the user is editing; applied = what load() uses
  const [draftFilters, setDraftFilters] = useState<Filters>({});
  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const appliedRef = useRef(appliedFilters);
  appliedRef.current = appliedFilters;

  const [summary, setSummary]           = useState<NetflowSummary | null>(null);
  const [topTalkersSrc, setTopTalkersSrc] = useState<NetflowTopTalker[]>([]);
  const [topTalkersDst, setTopTalkersDst] = useState<NetflowTopTalker[]>([]);
  const [topPorts, setTopPorts]         = useState<NetflowTopPort[]>([]);
  const [topAsnSrc, setTopAsnSrc]       = useState<NetflowTopAsn[]>([]);
  const [topAsnDst, setTopAsnDst]       = useState<NetflowTopAsn[]>([]);
  const [protocols, setProtocols]       = useState<NetflowProtocol[]>([]);
  const [bandwidth, setBandwidth]       = useState<NetflowBandwidthClient[]>([]);
  const [incidents, setIncidents]       = useState<NetflowIncident[]>([]);
  const [timeseries, setTimeseries]     = useState<NetflowTimeseriesPoint[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const epoch_end   = Math.floor(Date.now() / 1000);
    const epoch_begin = epoch_end - rangeSeconds;
    const bucket_seconds = bucketSecondsFor(rangeSeconds);
    const fp = filtersToParams(appliedRef.current);
    const base = { epoch_begin, epoch_end, ...fp };
    const limited = { ...base, limit: 15 };

    const results = await Promise.allSettled([
      getNetflowSummary({ ...base, bucket_seconds }),
      getNetflowTopTalkers({ ...limited, direction: 'src' }),
      getNetflowTopTalkers({ ...limited, direction: 'dst' }),
      getNetflowTopPorts({ ...limited, port_type: 'dst' }),
      getNetflowTopAsn({ ...limited, asn_type: 'src' }),
      getNetflowTopAsn({ ...limited, asn_type: 'dst' }),
      getNetflowProtocols(base),
      getNetflowBandwidthByClient(limited),
      getNetflowIncidents({ ...base, limit: 50 }),
      getNetflowTimeseries({ ...base, bucket_seconds }),
    ]);

    const [r0, r1, r2, r3, r4, r5, r6, r7, r8, r9] = results;
    if (r0.status === 'fulfilled') setSummary(r0.value);           else setSummary(null);
    if (r1.status === 'fulfilled') setTopTalkersSrc(r1.value.records); else setTopTalkersSrc([]);
    if (r2.status === 'fulfilled') setTopTalkersDst(r2.value.records); else setTopTalkersDst([]);
    if (r3.status === 'fulfilled') setTopPorts(r3.value.records);      else setTopPorts([]);
    if (r4.status === 'fulfilled') setTopAsnSrc(r4.value.records);     else setTopAsnSrc([]);
    if (r5.status === 'fulfilled') setTopAsnDst(r5.value.records);     else setTopAsnDst([]);
    if (r6.status === 'fulfilled') setProtocols(r6.value.records);     else setProtocols([]);
    if (r7.status === 'fulfilled') setBandwidth(r7.value.records);      else setBandwidth([]);
    if (r8.status === 'fulfilled') setIncidents(r8.value.records);     else setIncidents([]);
    if (r9.status === 'fulfilled') setTimeseries(r9.value.records);    else setTimeseries([]);

    if (results.every(r => r.status === 'rejected')) {
      setError('Não foi possível carregar dados de NetFlow. Verifique a conexão com o backend.');
    }
    setLoading(false);
  }, [rangeSeconds, appliedFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const applyFilters = () => {
    setAppliedFilters({ ...draftFilters });
  };

  const clearFilters = () => {
    setDraftFilters({});
    setAppliedFilters({});
  };

  const handleSelectFilter = (key: keyof Filters, value: string | undefined) => {
    const next = { ...draftFilters, [key]: value };
    setDraftFilters(next);
    setAppliedFilters(next);
  };

  const refresh = () => { load().then(() => message.success('Dados atualizados')); };

  const hasData = topTalkersSrc.length > 0 || topTalkersDst.length > 0 || protocols.length > 0
    || bandwidth.length > 0 || timeseries.length > 0;

  const activeFilters = hasActiveFilters(appliedFilters);

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
            <Select
              size="small"
              value={rangeSeconds}
              onChange={setRangeSeconds}
              options={RANGE_OPTIONS}
              style={{ width: 150 }}
            />
            <Button
              size="small"
              icon={<RefreshCw size={12} />}
              onClick={refresh}
              loading={loading}
              style={{ background: '#0a0f1e', borderColor: '#1e3a5f', color: '#94a3b8' }}
            >
              Atualizar
            </Button>
          </div>
        </div>

        {/* ─── Filter bar ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Filter size={12} style={{ color: '#475569', flexShrink: 0 }} />

          <Select
            size="small"
            allowClear
            placeholder="Protocolo"
            style={{ width: 110 }}
            value={draftFilters.protocol}
            onChange={v => handleSelectFilter('protocol', v)}
            options={PROTOCOL_OPTIONS}
          />

          <Select
            size="small"
            allowClear
            placeholder="Versão IP"
            style={{ width: 95 }}
            value={draftFilters.ip_version}
            onChange={v => handleSelectFilter('ip_version', v as '4' | '6' | undefined)}
            options={[{ label: 'IPv4', value: '4' }, { label: 'IPv6', value: '6' }]}
          />

          <Input
            size="small"
            placeholder="ASN (ex: 1234)"
            style={{ width: 130, background: '#0a0f1e', borderColor: '#1e3a5f', color: '#e2e8f0' }}
            value={draftFilters.asn ?? ''}
            onChange={e => setDraftFilters(f => ({ ...f, asn: e.target.value }))}
            onPressEnter={applyFilters}
          />

          <Input
            size="small"
            placeholder="IP Origem"
            style={{ width: 140, background: '#0a0f1e', borderColor: '#1e3a5f', color: '#e2e8f0' }}
            value={draftFilters.src_ip ?? ''}
            onChange={e => setDraftFilters(f => ({ ...f, src_ip: e.target.value }))}
            onPressEnter={applyFilters}
          />

          <Input
            size="small"
            placeholder="IP Destino"
            style={{ width: 140, background: '#0a0f1e', borderColor: '#1e3a5f', color: '#e2e8f0' }}
            value={draftFilters.dst_ip ?? ''}
            onChange={e => setDraftFilters(f => ({ ...f, dst_ip: e.target.value }))}
            onPressEnter={applyFilters}
          />

          <Button
            size="small"
            onClick={applyFilters}
            style={{ background: '#00c8f0', borderColor: '#00c8f0', color: '#000', fontWeight: 600 }}
          >
            Aplicar
          </Button>

          {activeFilters && (
            <Button
              size="small"
              icon={<X size={11} />}
              onClick={clearFilters}
              style={{ background: 'transparent', borderColor: '#334155', color: '#94a3b8' }}
            >
              Limpar
            </Button>
          )}

          {activeFilters && (
            <span style={{ fontSize: 11, color: '#f59e0b' }}>
              Filtros ativos
            </span>
          )}
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

      {/* ─── Timeseries chart ────────────────────────────────────────────── */}
      <NetflowTimeseriesChart
        data={timeseries}
        loading={loading}
        bucketSeconds={bucketSecondsFor(rangeSeconds)}
      />

      {/* ─── Top Talkers / Portas / Protocolos / ASN ─────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card title={<span style={{ color: '#94a3b8' }}>Top Origens (Clientes)</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 8 } }}>
          <Table<NetflowTopTalker>
            size="small" rowKey="ip" loading={loading} pagination={false}
            dataSource={topTalkersSrc} columns={topTalkerColumns} locale={{ emptyText: 'Sem dados' }} />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Top Destinos</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 8 } }}>
          <Table<NetflowTopTalker>
            size="small" rowKey="ip" loading={loading} pagination={false}
            dataSource={topTalkersDst} columns={topTalkerColumns} locale={{ emptyText: 'Sem dados' }} />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Top Portas de Destino</span>}
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
            dataSource={topAsnSrc} columns={asnColumns} locale={{ emptyText: 'Sem dados' }} />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Top ASN Destino</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 8 } }}>
          <Table<NetflowTopAsn>
            size="small" rowKey="asn" loading={loading} pagination={false}
            dataSource={topAsnDst} columns={asnColumns} locale={{ emptyText: 'Sem dados' }} />
        </Card>
      </div>

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

// ─── Timeseries chart ─────────────────────────────────────────────────────────

interface TimeseriesChartProps {
  data: NetflowTimeseriesPoint[];
  loading: boolean;
  bucketSeconds: number;
}

function NetflowTimeseriesChart({ data, loading, bucketSeconds }: TimeseriesChartProps) {
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
  const pktSeries  = data.map(p => p.total_packets ?? 0);
  const warnSeries = data.map(p => p.warning ?? 0);
  const critSeries = data.map(p => p.critical ?? 0);

  const peakMbps = Math.max(...mbpsSeries, 0);
  const avgMbps  = mbpsSeries.reduce((s, v) => s + v, 0) / (mbpsSeries.length || 1);

  const options: ApexOptions = {
    chart: {
      id: 'netflow-ts', background: 'transparent',
      toolbar: { show: true, tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true, download: false } },
      animations: { enabled: false }, zoom: { enabled: true },
    },
    colors: ['#00c8f0', '#8b5cf6', '#f59e0b', '#ff3b3b'],
    fill: {
      type: ['gradient', 'solid', 'solid', 'solid'],
      gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.02, stops: [0, 95, 100] },
    },
    stroke: { curve: 'smooth', width: [2, 0, 0, 0] },
    plotOptions: { bar: { columnWidth: '60%' } },
    annotations: {
      yaxis: [
        { y: avgMbps, borderColor: '#f59e0b', borderWidth: 1, strokeDashArray: 4,
          label: { text: `Média ${avgMbps.toFixed(2)} Mbps`, style: { color: '#f59e0b', background: '#0a0f1e', fontSize: '10px' } } },
      ],
    },
    grid: { borderColor: '#1e2d4a', strokeDashArray: 4, xaxis: { lines: { show: false } } },
    xaxis: {
      categories: labels,
      labels: { style: { colors: '#475569', fontSize: '10px', fontFamily: 'monospace' }, rotate: 0 },
      axisBorder: { show: false }, axisTicks: { show: false },
      tickAmount: Math.min(10, labels.length),
    },
    yaxis: [
      { seriesName: 'Banda (Mbps)',
        labels: { style: { colors: '#475569', fontSize: '11px', fontFamily: 'monospace' }, formatter: v => `${v.toFixed(1)} Mbps` } },
      { seriesName: 'Pacotes', opposite: true,
        labels: { style: { colors: '#475569', fontSize: '11px', fontFamily: 'monospace' }, formatter: v => v.toFixed(0) } },
      { seriesName: 'Avisos', show: false },
      { seriesName: 'Críticos', show: false },
    ],
    tooltip: { theme: 'dark', x: { show: true } },
    legend: { labels: { colors: '#94a3b8' }, fontSize: '12px' },
    dataLabels: { enabled: false },
  };

  return (
    <Card
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>Histórico e Evolução de Tráfego</span>
          <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
            <span style={{ color: '#8b5cf6' }}>Pico: <strong>{fmtMbps(peakMbps)}</strong></span>
            <span style={{ color: '#f59e0b' }}>Média: <strong>{fmtMbps(avgMbps)}</strong></span>
          </div>
        </div>
      }
      style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} styles={{ body: { padding: 12 } }}>
      <Chart
        key={`ts-${data.length}`}
        options={options}
        series={[
          { name: 'Banda (Mbps)', type: 'area',   data: mbpsSeries },
          { name: 'Pacotes',      type: 'column', data: pktSeries  },
          { name: 'Avisos',       type: 'column', data: warnSeries },
          { name: 'Críticos',     type: 'column', data: critSeries },
        ]}
        type="line"
        height={290}
      />
    </Card>
  );
}

// ─── Table column definitions ─────────────────────────────────────────────────

const topTalkerColumns: ColumnsType<NetflowTopTalker> = [
  { title: 'IP', dataIndex: 'ip',
    render: v => <span style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v}</span> },
  { title: 'Volume', dataIndex: 'total_bytes',
    sorter: (a, b) => a.total_bytes - b.total_bytes, defaultSortOrder: 'descend',
    render: v => formatBytes(v) },
  { title: 'Pacotes', dataIndex: 'total_packets',
    render: v => (v ?? 0).toLocaleString('pt-BR') },
  { title: 'Fluxos', dataIndex: 'flows' },
];

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

const asnColumns: ColumnsType<NetflowTopAsn> = [
  { title: 'ASN', dataIndex: 'asn',
    render: v => <span style={{ fontFamily: 'monospace', color: '#8b5cf6' }}>AS{v}</span> },
  { title: 'Volume', dataIndex: 'total_bytes',
    sorter: (a, b) => a.total_bytes - b.total_bytes, defaultSortOrder: 'descend',
    render: v => formatBytes(v) },
  { title: 'Pacotes', dataIndex: 'total_packets',
    render: v => (v ?? 0).toLocaleString('pt-BR') },
  { title: 'Fluxos', dataIndex: 'flows' },
];

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

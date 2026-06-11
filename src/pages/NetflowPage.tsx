import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Tag, Select, Button, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import dayjs from 'dayjs';
import { Network, RefreshCw } from 'lucide-react';
import {
  getNetflowTopTalkers,
  getNetflowTopPorts,
  getNetflowTopAsn,
  getNetflowProtocols,
  getNetflowBandwidthByClient,
  getNetflowIncidents,
  getNetflowTimeseries,
  type NetflowTopTalker,
  type NetflowTopPort,
  type NetflowTopAsn,
  type NetflowProtocol,
  type NetflowBandwidthClient,
  type NetflowIncident,
  type NetflowTimeseriesPoint,
} from '../services/backendApi';

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(2)} ${units[i]}`;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff3b3b',
  error: '#ff3b3b',
  warning: '#f59e0b',
  notice: '#00c8f0',
  info: '#475569',
};

const RANGE_OPTIONS = [
  { label: 'Última 1h',  value: 3600 },
  { label: 'Últimas 6h', value: 6 * 3600 },
  { label: 'Últimas 24h', value: 24 * 3600 },
  { label: 'Últimos 7 dias', value: 7 * 24 * 3600 },
];

// Bucket size scales with the selected range so the chart stays readable.
function bucketSecondsFor(rangeSeconds: number): number {
  if (rangeSeconds <= 3600) return 60;          // 1h  -> 1min buckets
  if (rangeSeconds <= 6 * 3600) return 300;     // 6h  -> 5min buckets
  if (rangeSeconds <= 24 * 3600) return 1800;   // 24h -> 30min buckets
  return 3600 * 6;                              // 7d  -> 6h buckets
}

export function NetflowPage() {
  const [rangeSeconds, setRangeSeconds] = useState(24 * 3600);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [topTalkersSrc, setTopTalkersSrc] = useState<NetflowTopTalker[]>([]);
  const [topTalkersDst, setTopTalkersDst] = useState<NetflowTopTalker[]>([]);
  const [topPorts, setTopPorts] = useState<NetflowTopPort[]>([]);
  const [topAsnSrc, setTopAsnSrc] = useState<NetflowTopAsn[]>([]);
  const [topAsnDst, setTopAsnDst] = useState<NetflowTopAsn[]>([]);
  const [protocols, setProtocols] = useState<NetflowProtocol[]>([]);
  const [bandwidth, setBandwidth] = useState<NetflowBandwidthClient[]>([]);
  const [incidents, setIncidents] = useState<NetflowIncident[]>([]);
  const [timeseries, setTimeseries] = useState<NetflowTimeseriesPoint[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const epoch_end = Math.floor(Date.now() / 1000);
    const epoch_begin = epoch_end - rangeSeconds;
    const params = { epoch_begin, epoch_end, limit: 15 };

    const results = await Promise.allSettled([
      getNetflowTopTalkers({ ...params, direction: 'src' }),
      getNetflowTopTalkers({ ...params, direction: 'dst' }),
      getNetflowTopPorts({ ...params, port_type: 'dst' }),
      getNetflowTopAsn({ ...params, asn_type: 'src' }),
      getNetflowTopAsn({ ...params, asn_type: 'dst' }),
      getNetflowProtocols({ epoch_begin, epoch_end }),
      getNetflowBandwidthByClient(params),
      getNetflowIncidents({ epoch_begin, epoch_end, limit: 50 }),
      getNetflowTimeseries({ epoch_begin, epoch_end, bucket_seconds: bucketSecondsFor(rangeSeconds) }),
    ]);

    const [r1, r2, r3, r4, r5, r6, r7, r8, r9] = results;
    if (r1.status === 'fulfilled') setTopTalkersSrc(r1.value.records); else setTopTalkersSrc([]);
    if (r2.status === 'fulfilled') setTopTalkersDst(r2.value.records); else setTopTalkersDst([]);
    if (r3.status === 'fulfilled') setTopPorts(r3.value.records); else setTopPorts([]);
    if (r4.status === 'fulfilled') setTopAsnSrc(r4.value.records); else setTopAsnSrc([]);
    if (r5.status === 'fulfilled') setTopAsnDst(r5.value.records); else setTopAsnDst([]);
    if (r6.status === 'fulfilled') setProtocols(r6.value.records); else setProtocols([]);
    if (r7.status === 'fulfilled') setBandwidth(r7.value.records); else setBandwidth([]);
    if (r8.status === 'fulfilled') setIncidents(r8.value.records); else setIncidents([]);
    if (r9.status === 'fulfilled') setTimeseries(r9.value.records); else setTimeseries([]);

    if (results.every(r => r.status === 'rejected')) {
      setError('Não foi possível carregar dados de NetFlow. Verifique a conexão com o backend.');
    }

    setLoading(false);
  }, [rangeSeconds]);

  useEffect(() => { load(); }, [load]);

  const refresh = () => {
    load().then(() => message.success('Dados atualizados'));
  };

  const hasData = topTalkersSrc.length > 0 || topTalkersDst.length > 0 || topPorts.length > 0
    || topAsnSrc.length > 0 || topAsnDst.length > 0 || protocols.length > 0
    || bandwidth.length > 0 || incidents.length > 0 || timeseries.length > 0;

  return (
    <main style={{
      flex: 1, overflowY: 'auto', padding: '16px', minWidth: 0,
      display: 'flex', flexDirection: 'column', gap: '14px',
    }}>
      <div className="rounded-xl p-4" style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: '#00c8f018' }}>
              <Network size={18} style={{ color: '#00c8f0' }} />
            </div>
            <div>
              <h2 className="font-bold text-sm" style={{ color: '#e2e8f0' }}>Tráfego NetFlow</h2>
              <p className="text-xs" style={{ color: '#475569' }}>
                Análise do fluxo de rede coletado via GoFlow2 (Top IPs, portas, ASN, protocolos e incidentes).
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

        {error && (
          <div className="rounded-lg p-2.5 mt-3" style={{ background: '#ff3b3b10', border: '1px solid #ff3b3b33', color: '#ff3b3b', fontSize: 12 }}>
            {error}
          </div>
        )}

        {!loading && !error && !hasData && (
          <div className="rounded-lg p-2.5 mt-3" style={{ background: '#f59e0b10', border: '1px solid #f59e0b33', color: '#f59e0b', fontSize: 12 }}>
            Nenhum dado de NetFlow (GoFlow2) disponível para o período selecionado. O pipeline pode ainda
            estar acumulando o primeiro lote de fluxos.
          </div>
        )}
      </div>

      <NetflowTimeseriesChart data={timeseries} loading={loading} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card title={<span style={{ color: '#94a3b8' }}>Top Origens (Clientes)</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} bodyStyle={{ padding: 8 }}>
          <Table<NetflowTopTalker>
            size="small" rowKey="ip" loading={loading} pagination={false}
            dataSource={topTalkersSrc} columns={topTalkerColumns} locale={{ emptyText: 'Sem dados' }}
          />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Top Destinos</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} bodyStyle={{ padding: 8 }}>
          <Table<NetflowTopTalker>
            size="small" rowKey="ip" loading={loading} pagination={false}
            dataSource={topTalkersDst} columns={topTalkerColumns} locale={{ emptyText: 'Sem dados' }}
          />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Top Portas de Destino</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} bodyStyle={{ padding: 8 }}>
          <Table<NetflowTopPort>
            size="small" rowKey={r => `${r.port}-${r.protocol}`} loading={loading} pagination={false}
            dataSource={topPorts} columns={topPortColumns} locale={{ emptyText: 'Sem dados' }}
          />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Distribuição por Protocolo</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} bodyStyle={{ padding: 8 }}>
          <Table<NetflowProtocol>
            size="small" rowKey="protocol" loading={loading} pagination={false}
            dataSource={protocols} columns={protocolColumns} locale={{ emptyText: 'Sem dados' }}
          />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Top ASN Origem</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} bodyStyle={{ padding: 8 }}>
          <Table<NetflowTopAsn>
            size="small" rowKey="asn" loading={loading} pagination={false}
            dataSource={topAsnSrc} columns={asnColumns} locale={{ emptyText: 'Sem dados' }}
          />
        </Card>

        <Card title={<span style={{ color: '#94a3b8' }}>Top ASN Destino</span>}
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} bodyStyle={{ padding: 8 }}>
          <Table<NetflowTopAsn>
            size="small" rowKey="asn" loading={loading} pagination={false}
            dataSource={topAsnDst} columns={asnColumns} locale={{ emptyText: 'Sem dados' }}
          />
        </Card>
      </div>

      <Card title={<span style={{ color: '#94a3b8' }}>Banda por Cliente (Top Talkers)</span>}
        style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} bodyStyle={{ padding: 8 }}>
        <Table<NetflowBandwidthClient>
          size="small" rowKey="ip" loading={loading} pagination={{ pageSize: 10 }}
          dataSource={bandwidth} columns={bandwidthColumns} locale={{ emptyText: 'Sem dados' }}
        />
      </Card>

      <Card title={<span style={{ color: '#94a3b8' }}>Incidentes Recentes (Severidade Elevada)</span>}
        style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} bodyStyle={{ padding: 8 }}>
        <Table<NetflowIncident>
          size="small" rowKey="id" loading={loading} pagination={{ pageSize: 10 }}
          dataSource={incidents} columns={incidentColumns} locale={{ emptyText: 'Nenhum incidente no período' }}
        />
      </Card>
    </main>
  );
}

const topTalkerColumns: ColumnsType<NetflowTopTalker> = [
  { title: 'IP', dataIndex: 'ip', render: v => <span style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v}</span> },
  { title: 'Volume', dataIndex: 'total_bytes', sorter: (a, b) => a.total_bytes - b.total_bytes, defaultSortOrder: 'descend', render: v => formatBytes(v) },
  { title: 'Pacotes', dataIndex: 'total_packets', render: v => (v ?? 0).toLocaleString('pt-BR') },
  { title: 'Fluxos', dataIndex: 'flows' },
];

const topPortColumns: ColumnsType<NetflowTopPort> = [
  { title: 'Porta', dataIndex: 'port', render: v => <span style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v ?? '-'}</span> },
  { title: 'Protocolo', dataIndex: 'protocol' },
  { title: 'Volume', dataIndex: 'total_bytes', sorter: (a, b) => a.total_bytes - b.total_bytes, defaultSortOrder: 'descend', render: v => formatBytes(v) },
  { title: 'Pacotes', dataIndex: 'total_packets', render: v => (v ?? 0).toLocaleString('pt-BR') },
  { title: 'Fluxos', dataIndex: 'flows' },
];

const protocolColumns: ColumnsType<NetflowProtocol> = [
  { title: 'Protocolo', dataIndex: 'protocol', render: v => <Tag style={{ fontSize: 12, background: '#0d1b2e', borderColor: '#1e3a5f', color: '#94a3b8' }}>{v}</Tag> },
  { title: 'Volume', dataIndex: 'total_bytes', sorter: (a, b) => a.total_bytes - b.total_bytes, defaultSortOrder: 'descend', render: v => formatBytes(v) },
  { title: 'Pacotes', dataIndex: 'total_packets', render: v => (v ?? 0).toLocaleString('pt-BR') },
  { title: 'Fluxos', dataIndex: 'flows' },
];

const asnColumns: ColumnsType<NetflowTopAsn> = [
  { title: 'ASN', dataIndex: 'asn', render: v => <span style={{ fontFamily: 'monospace', color: '#8b5cf6' }}>AS{v}</span> },
  { title: 'Volume', dataIndex: 'total_bytes', sorter: (a, b) => a.total_bytes - b.total_bytes, defaultSortOrder: 'descend', render: v => formatBytes(v) },
  { title: 'Pacotes', dataIndex: 'total_packets', render: v => (v ?? 0).toLocaleString('pt-BR') },
  { title: 'Fluxos', dataIndex: 'flows' },
];

const bandwidthColumns: ColumnsType<NetflowBandwidthClient> = [
  { title: 'IP Cliente', dataIndex: 'ip', render: v => <span style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v}</span> },
  { title: 'Volume', dataIndex: 'total_bytes', sorter: (a, b) => a.total_bytes - b.total_bytes, defaultSortOrder: 'descend', render: v => formatBytes(v) },
  { title: 'Pacotes', dataIndex: 'total_packets', render: v => (v ?? 0).toLocaleString('pt-BR') },
  { title: 'Fluxos', dataIndex: 'flows' },
  { title: 'Críticos', dataIndex: 'critical', render: v => <span style={{ color: v > 0 ? '#ff3b3b' : '#64748b' }}>{v}</span> },
  { title: 'Avisos', dataIndex: 'warning', render: v => <span style={{ color: v > 0 ? '#f59e0b' : '#64748b' }}>{v}</span> },
];

const incidentColumns: ColumnsType<NetflowIncident> = [
  { title: 'Horário', dataIndex: 'tstamp', width: 160, render: v => dayjs.unix(v).format('DD/MM/YYYY HH:mm:ss') },
  { title: 'Severidade', dataIndex: 'severity', width: 110, render: v => (
    <Tag color={SEVERITY_COLORS[v] ?? '#475569'} style={{ fontSize: 11 }}>{v}</Tag>
  ) },
  { title: 'Score', dataIndex: 'score', width: 70 },
  { title: 'Origem', dataIndex: 'cli_ip', render: v => <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{v}</span> },
  { title: 'Destino', dataIndex: 'ip', render: v => <span style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v}</span> },
  { title: 'Porta Origem', dataIndex: 'src_port', width: 110 },
  { title: 'Porta Destino', dataIndex: 'dst_port', width: 110 },
  { title: 'Protocolo', dataIndex: 'proto', width: 100 },
  { title: 'Bytes', dataIndex: 'bytes', render: v => formatBytes(v) },
  { title: 'Pacotes', dataIndex: 'packets' },
];

interface TimeseriesChartProps {
  data: NetflowTimeseriesPoint[];
  loading: boolean;
}

function NetflowTimeseriesChart({ data, loading }: TimeseriesChartProps) {
  const hasPoints = data.length > 0;

  if (!hasPoints) {
    return (
      <Card title={<span style={{ color: '#94a3b8' }}>Histórico e Evolução de Tráfego/Incidentes</span>}
        style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} bodyStyle={{ padding: 12 }}>
        <p className="text-xs text-center py-12" style={{ color: '#475569' }}>
          {loading ? 'Carregando série temporal…' : 'Sem dados de NetFlow para o período selecionado.'}
        </p>
      </Card>
    );
  }

  const labels = data.map(p => dayjs.unix(p.bucket).format('DD/MM HH:mm'));
  const bandwidthSeries = data.map(p => Number(((p.total_bytes ?? 0) * 8 / 1_000_000).toFixed(2))); // Mbps-equivalent volume per bucket
  const packetsSeries = data.map(p => p.total_packets ?? 0);
  const criticalSeries = data.map(p => p.critical ?? 0);
  const warningSeries = data.map(p => p.warning ?? 0);

  const options: ApexOptions = {
    chart: {
      id: 'netflow-timeseries',
      background: 'transparent',
      toolbar: { show: false },
      animations: { enabled: false },
      zoom: { enabled: false },
      stacked: false,
    },
    colors: ['#00c8f0', '#8b5cf6', '#f59e0b', '#ff3b3b'],
    fill: {
      type: ['gradient', 'solid', 'solid', 'solid'],
      gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0.02, stops: [0, 95, 100] },
    },
    stroke: { curve: 'smooth', width: [2, 0, 0, 0] },
    plotOptions: { bar: { columnWidth: '60%' } },
    grid: {
      borderColor: '#1e2d4a',
      strokeDashArray: 4,
      xaxis: { lines: { show: false } },
    },
    xaxis: {
      categories: labels,
      labels: { style: { colors: '#475569', fontSize: '10px', fontFamily: 'monospace' }, rotate: 0 },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tickAmount: Math.min(10, labels.length),
    },
    yaxis: [
      {
        seriesName: 'Volume (Mb)',
        labels: { style: { colors: '#475569', fontSize: '11px', fontFamily: 'monospace' }, formatter: v => `${v.toFixed(0)} Mb` },
      },
      {
        seriesName: 'Pacotes',
        opposite: true,
        labels: { style: { colors: '#475569', fontSize: '11px', fontFamily: 'monospace' }, formatter: v => v.toFixed(0) },
      },
      { seriesName: 'Críticos', show: false },
      { seriesName: 'Avisos', show: false },
    ],
    tooltip: { theme: 'dark', x: { show: true } },
    legend: { labels: { colors: '#94a3b8' }, fontSize: '12px' },
    dataLabels: { enabled: false },
  };

  const chartSeries = [
    { name: 'Volume (Mb)', type: 'area', data: bandwidthSeries },
    { name: 'Pacotes',     type: 'column', data: packetsSeries },
    { name: 'Avisos',      type: 'column', data: warningSeries },
    { name: 'Críticos',    type: 'column', data: criticalSeries },
  ];

  return (
    <Card title={<span style={{ color: '#94a3b8' }}>Histórico e Evolução de Tráfego/Incidentes</span>}
      style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} bodyStyle={{ padding: 12 }}>
      <Chart
        key="netflow-timeseries"
        options={options}
        series={chartSeries}
        type="line"
        height={280}
      />
    </Card>
  );
}

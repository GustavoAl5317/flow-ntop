import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { TrafficChartData } from '../hooks/useDashboardData';

interface Props {
  data: TrafficChartData;
  isLive: boolean;
}

export function TrafficChart({ data, isLive }: Props) {
  const hasPoints = data.labels.length > 0;

  if (!hasPoints) {
    return (
      <div className="rounded-xl p-4" style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
        <h2 className="text-sm font-semibold mb-1" style={{ color: '#e2e8f0' }}>Tráfego em Tempo Real</h2>
        <p className="text-xs text-center py-12" style={{ color: '#475569' }}>
          {isLive
            ? 'Coletando amostras de throughput… aguarde a próxima atualização (30s).'
            : 'Sem conexão com o ntopng. Configure a conexão para ver o tráfego real.'}
        </p>
      </div>
    );
  }

  const { series, labels, peakGbps } = data;

  const options: ApexOptions = {
    chart: {
      id: 'traffic-chart',
      type: 'area',
      background: 'transparent',
      toolbar: { show: false },
      animations: { enabled: false },
      zoom: { enabled: false },
    },
    colors: ['#00c8f0', '#ff3b3b', '#10b981'],
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.3,
        opacityTo: 0.02,
        stops: [0, 95, 100],
      },
    },
    stroke: { curve: 'smooth', width: 2 },
    grid: {
      borderColor: '#1e2d4a',
      strokeDashArray: 4,
      xaxis: { lines: { show: false } },
    },
    xaxis: {
      categories: labels,
      labels: {
        style: { colors: '#475569', fontSize: '10px', fontFamily: 'monospace' },
        rotate: 0,
      },
      axisBorder: { show: false },
      axisTicks:  { show: false },
      tickAmount: 6,
    },
    yaxis: {
      labels: {
        style: { colors: '#475569', fontSize: '11px', fontFamily: 'monospace' },
        formatter: (v) => `${v.toFixed(0)} Gbps`,
      },
    },
    tooltip: {
      theme: 'dark',
      x: { show: true },
      y: { formatter: (v) => `${v.toFixed(1)} Gbps` },
    },
    legend: {
      labels: { colors: '#94a3b8' },
      fontSize: '12px',
    },
    dataLabels: { enabled: false },
  };

  const chartSeries = [
    { name: 'Total',   data: series.total  },
    { name: 'Entrada', data: series.attack },
    { name: 'Saída',   data: series.clean  },
  ];

  return (
    <div className="rounded-xl p-4" style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Volume de Tráfego</h2>
          <p className="text-xs" style={{ color: '#475569' }}>
            Últimos {labels.length} min · Dados ao vivo (delta bytes)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full font-mono"
            style={{ background: '#ff3b3b22', color: '#ff3b3b' }}>
            PICO: {peakGbps.toFixed(1)} Gbps
          </span>
        </div>
      </div>
      <Chart
        key="traffic-live"
        options={options}
        series={chartSeries}
        type="area"
        height={220}
      />
    </div>
  );
}

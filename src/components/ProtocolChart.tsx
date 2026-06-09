import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { ProtocolEntry } from '../hooks/useDashboardData';

interface Props {
  data: ProtocolEntry[];
  isLive: boolean;
}

const COLORS = ['#00c8f0', '#ff3b3b', '#f59e0b', '#8b5cf6', '#10b981', '#64748b'];

export function ProtocolChart({ data, isLive }: Props) {
  const total = data.reduce((s, d) => s + d.value, 0);

  if (data.length === 0) {
    return (
      <div className="rounded-xl p-4" style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
        <h2 className="text-sm font-semibold mb-1" style={{ color: '#e2e8f0' }}>Distribuição por Protocolo</h2>
        <p className="text-xs text-center py-10" style={{ color: '#475569' }}>
          {isLive
            ? 'Sem flows ativos para classificar'
            : 'Sem conexão com o ntopng. Configure a conexão para ver protocolos reais.'}
        </p>
      </div>
    );
  }

  const options: ApexOptions = {
    chart:  { id: 'protocol-chart', type: 'donut', background: 'transparent', toolbar: { show: false } },
    colors: COLORS,
    labels: data.map(d => d.name),
    legend: {
      position: 'bottom',
      labels:   { colors: '#94a3b8' },
      fontSize: '11px',
      itemMargin: { horizontal: 8, vertical: 4 },
    },
    dataLabels: {
      enabled:   true,
      formatter: (val: number) => `${val.toFixed(0)}%`,
      style:     { fontSize: '11px', colors: ['#e2e8f0'] },
      dropShadow: { enabled: false },
    },
    plotOptions: {
      pie: {
        donut: {
          size: '60%',
          labels: {
            show:  true,
            total: {
              show:      true,
              label:     'Eventos',
              color:     '#475569',
              fontSize:  '11px',
              formatter: () => String(total),
            },
            value: { color: '#e2e8f0', fontSize: '20px', fontWeight: 700, fontFamily: 'monospace' },
          },
        },
      },
    },
    stroke:  { width: 2, colors: ['#0f1629'] },
    tooltip: { theme: 'dark', y: { formatter: (v) => `${v} eventos` } },
  };

  return (
    <div className="rounded-xl p-4" style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
      <div className="mb-2">
        <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Protocolos</h2>
        <p className="text-xs" style={{ color: '#475569' }}>Distribuição por tipo de ataque</p>
      </div>
      <Chart
        key="protocol-live"
        options={options}
        series={data.map(d => d.value)}
        type="donut"
        height={260}
      />
    </div>
  );
}

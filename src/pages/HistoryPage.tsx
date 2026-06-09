import { useState, useEffect, useCallback } from 'react';
import {
  Timeline, Tag, DatePicker, Button, Select, Empty,
  Spin, Badge, Card,
} from 'antd';
import { ReloadOutlined, HistoryOutlined } from '@ant-design/icons';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import dayjs from 'dayjs';
import { getAllAlerts, getHostAlerts, getConfig } from '../services/ntopngApi';
import type { NtopAlert } from '../types/ntopng';
import { useInterval } from '../hooks/useInterval';

const { RangePicker } = DatePicker;

const DDOS_LABELS: Record<number, { label: string; color: string }> = {
  4:    { label: 'Flow Flood',     color: '#ff3b3b' },
  18:   { label: 'ICMP Flood',     color: '#ff3b3b' },
  22:   { label: 'DNS Flood',      color: '#ff3b3b' },
  23:   { label: 'SNMP Flood',     color: '#ff3b3b' },
  26:   { label: 'Volume Anômalo', color: '#f59e0b' },
  31:   { label: 'Port Scan',      color: '#f59e0b' },
  8:    { label: 'Elephant Flow',  color: '#f59e0b' },
  4153: { label: 'Flood Victim',   color: '#ff3b3b' },
  4157: { label: 'SYN Flood',      color: '#ff3b3b' },
  4142: { label: 'Mitigação SNMP', color: '#10b981' },
};

function alertLabel(id: number) {
  return DDOS_LABELS[id] ?? { label: `Alerta #${id}`, color: '#64748b' };
}

function severityDot(severity: string): string {
  if (severity === 'critical' || severity === 'error') return '#ff3b3b';
  if (severity === 'warning') return '#f59e0b';
  return '#3b82f6';
}

interface GroupedEvent {
  date: string;
  alerts: NtopAlert[];
}

function groupByDate(alerts: NtopAlert[]): GroupedEvent[] {
  const map = new Map<string, NtopAlert[]>();
  for (const a of alerts) {
    const d = a.tstamp ? new Date(a.tstamp * 1000).toLocaleDateString('pt-BR') : 'Data desconhecida';
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(a);
  }
  return Array.from(map.entries()).map(([date, events]) => ({ date, alerts: events }));
}

function countByDayOffset(alerts: NtopAlert[], periodStart: number, days: number): number[] {
  const counts = new Array(days).fill(0);
  for (const a of alerts) {
    if (!a.tstamp) continue;
    const offset = Math.floor((a.tstamp - periodStart) / 86400);
    if (offset >= 0 && offset < days) counts[offset]++;
  }
  return counts;
}

export function HistoryPage() {
  const ifid = getConfig().ifid;
  const [alerts, setAlerts]       = useState<NtopAlert[]>([]);
  const [prevAlerts, setPrevAlerts] = useState<NtopAlert[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(7, 'day'), dayjs(),
  ]);
  const [filterSev, setFilterSev] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const durationSec = dateRange[1].unix() - dateRange[0].unix();
      const prevEnd   = dateRange[0].unix() - 1;
      const prevBegin = prevEnd - durationSec;

      const [flowAlerts, hostAlerts, prevFlowAlerts, prevHostAlerts] = await Promise.allSettled([
        getAllAlerts({
          ifid, currentPage: 0, perPage: 100,
          epochBegin: dateRange[0].unix(),
          epochEnd:   dateRange[1].unix(),
        }),
        getHostAlerts({
          ifid, currentPage: 0, perPage: 100,
          epochBegin: dateRange[0].unix(),
          epochEnd:   dateRange[1].unix(),
        }),
        getAllAlerts({
          ifid, currentPage: 0, perPage: 100,
          epochBegin: prevBegin,
          epochEnd:   prevEnd,
        }),
        getHostAlerts({
          ifid, currentPage: 0, perPage: 100,
          epochBegin: prevBegin,
          epochEnd:   prevEnd,
        }),
      ]);

      let combined: NtopAlert[] = [];
      if (flowAlerts.status === 'fulfilled')  combined.push(...(flowAlerts.value.records ?? []));
      if (hostAlerts.status === 'fulfilled')  combined.push(...(hostAlerts.value.records ?? []));

      let prevCombined: NtopAlert[] = [];
      if (prevFlowAlerts.status === 'fulfilled') prevCombined.push(...(prevFlowAlerts.value.records ?? []));
      if (prevHostAlerts.status === 'fulfilled') prevCombined.push(...(prevHostAlerts.value.records ?? []));

      combined.sort((a, b) => (b.tstamp ?? 0) - (a.tstamp ?? 0));

      if (filterSev) {
        combined = combined.filter(a => a.severity === filterSev);
        prevCombined = prevCombined.filter(a => a.severity === filterSev);
      }

      setAlerts(combined);
      setPrevAlerts(prevCombined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar histórico');
    } finally {
      setLoading(false);
    }
  }, [dateRange, filterSev, ifid]);

  useEffect(() => { load(); }, [load]);
  useInterval(load, 60_000);

  const grouped = groupByDate(alerts);

  const numDays = Math.max(1, dateRange[1].startOf('day').diff(dateRange[0].startOf('day'), 'day') + 1);
  const periodStart = dateRange[0].unix();
  const prevPeriodStart = periodStart - numDays * 86400;
  const currentCounts = countByDayOffset(alerts, periodStart, numDays);
  const previousCounts = countByDayOffset(prevAlerts, prevPeriodStart, numDays);
  const dayLabels = Array.from({ length: numDays }, (_, i) =>
    dateRange[0].add(i, 'day').format('DD/MM')
  );

  const trendOptions: ApexOptions = {
    chart: {
      id: 'trend-comparison',
      type: 'bar',
      background: 'transparent',
      toolbar: { show: false },
      animations: { enabled: false },
    },
    colors: ['#00c8f0', '#475569'],
    plotOptions: {
      bar: { columnWidth: '55%', borderRadius: 3 },
    },
    grid: {
      borderColor: '#1e2d4a',
      strokeDashArray: 4,
      xaxis: { lines: { show: false } },
    },
    xaxis: {
      categories: dayLabels,
      labels: { style: { colors: '#475569', fontSize: '10px', fontFamily: 'monospace' } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { style: { colors: '#475569', fontSize: '11px', fontFamily: 'monospace' } },
    },
    tooltip: { theme: 'dark' },
    legend: { labels: { colors: '#94a3b8' }, fontSize: '12px' },
    dataLabels: { enabled: false },
  };

  const trendSeries = [
    { name: 'Período atual',    data: currentCounts },
    { name: 'Período anterior', data: previousCounts },
  ];

  return (
      <div style={{ padding: 20, height: '100%', overflowY: 'auto', flex: 1 }}>

        {/* Header */}
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <HistoryOutlined style={{ color: '#00c8f0', fontSize: 20 }} />
            <h2 style={{ color: '#e2e8f0', margin: 0, fontSize: 18, fontWeight: 700 }}>
              Histórico de Eventos
            </h2>
            <Badge count={alerts.length} style={{ backgroundColor: '#0077aa' }} />
          </div>
          <Button
            icon={<ReloadOutlined />}
            onClick={load}
            loading={loading}
            style={{ background: '#0a0f1e', borderColor: '#1e3a5f', color: '#94a3b8' }}
          >
            Atualizar
          </Button>
        </div>

        {/* Filters */}
        <div style={{
          background: '#0a0f1e', border: '1px solid #1e3a5f', borderRadius: 8,
          padding: '12px 16px', marginBottom: 20,
          display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <RangePicker
            value={dateRange}
            format="DD/MM/YYYY"
            onChange={v => v && setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs])}
            presets={[
              { label: 'Hoje',         value: [dayjs().startOf('day'), dayjs()] },
              { label: 'Ontem',        value: [dayjs().subtract(1,'day').startOf('day'), dayjs().subtract(1,'day').endOf('day')] },
              { label: 'Últimos 7d',   value: [dayjs().subtract(7,'day'), dayjs()] },
              { label: 'Últimos 30d',  value: [dayjs().subtract(30,'day'), dayjs()] },
            ]}
            style={{ borderColor: '#1e3a5f' }}
          />
          <Select
            placeholder="Severidade"
            allowClear
            value={filterSev}
            onChange={setFilterSev}
            style={{ width: 140 }}
            options={[
              { label: 'Crítico', value: 'critical' },
              { label: 'Erro',    value: 'error'    },
              { label: 'Aviso',   value: 'warning'  },
              { label: 'Info',    value: 'info'      },
            ]}
          />
          <Button
            onClick={load}
            type="primary"
            style={{ background: '#0077aa', borderColor: '#0099bb' }}
          >
            Aplicar
          </Button>
        </div>

        {error && (
          <div style={{
            background: '#1a0a0a', border: '1px solid #ff3b3b', borderRadius: 8,
            padding: '10px 16px', marginBottom: 16, color: '#ff3b3b', fontSize: 13,
          }}>
            {error} — aguarde chegada de dados NetFlow.
          </div>
        )}

        {!loading && (alerts.length > 0 || prevAlerts.length > 0) && (
          <Card
            style={{ background: '#0a0f1e', border: '1px solid #1e3a5f', marginBottom: 16 }}
            bodyStyle={{ padding: '16px 20px' }}
          >
            <h3 style={{ color: '#94a3b8', fontSize: 13, fontWeight: 600, marginBottom: 12, marginTop: 0 }}>
              Comparação de Eventos: período atual vs. período anterior
            </h3>
            <Chart options={trendOptions} series={trendSeries} type="bar" height={200} />
          </Card>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <Spin size="large" />
          </div>
        ) : grouped.length === 0 ? (
          <Empty
            description={<span style={{ color: '#475569' }}>Nenhum evento no período. Aguarde dados de NetFlow.</span>}
            style={{ padding: 60 }}
          />
        ) : (
          grouped.map(group => (
            <Card
              key={group.date}
              style={{ background: '#0a0f1e', border: '1px solid #1e3a5f', marginBottom: 16 }}
              bodyStyle={{ padding: '16px 20px' }}
            >
              <h3 style={{ color: '#94a3b8', fontSize: 13, fontWeight: 600, marginBottom: 16, marginTop: 0 }}>
                {group.date} — {group.alerts.length} evento{group.alerts.length !== 1 ? 's' : ''}
              </h3>
              <Timeline
                items={group.alerts.map((a, i) => {
                  const { label, color } = alertLabel(a.alert_id);
                  const time = a.tstamp
                    ? new Date(a.tstamp * 1000).toLocaleTimeString('pt-BR')
                    : '—';
                  return {
                    key: i,
                    dot: <span style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: severityDot(a.severity ?? 'info'),
                      display: 'inline-block',
                    }} />,
                    children: (
                      <div style={{ paddingBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace' }}>{time}</span>
                          <Tag style={{ background: '#0d1b2e', borderColor: color, color, fontSize: 11 }}>
                            {label}
                          </Tag>
                          {a.ip && (
                            <span style={{ fontFamily: 'monospace', color: '#00c8f0', fontSize: 12 }}>
                              → {a.ip}
                            </span>
                          )}
                          {a.cli_ip && (
                            <span style={{ fontFamily: 'monospace', color: '#64748b', fontSize: 12 }}>
                              de {a.cli_ip}
                            </span>
                          )}
                        </div>
                        {a.score != null && (
                          <span style={{ color: '#64748b', fontSize: 11 }}>Score: {a.score}</span>
                        )}
                      </div>
                    ),
                  };
                })}
              />
            </Card>
          ))
        )}
      </div>
  );
}

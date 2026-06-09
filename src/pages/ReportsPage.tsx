import { useState, useCallback } from 'react';
import {
  Card, DatePicker, Button, Select, Table, Statistic,
  Divider, Space, Tag, message,
} from 'antd';
import { BarChartOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { getAllAlerts, getHostAlerts, getConfig } from '../services/ntopngApi';
import { saveEventsBulk, saveReport } from '../services/backendApi';
import { useAuth } from '../context/AuthContext';
import type { NtopAlert } from '../types/ntopng';

const { RangePicker } = DatePicker;

const DDOS_LABELS: Record<number, string> = {
  4:    'Flow Flood',
  18:   'ICMP Flood',
  22:   'DNS Flood',
  23:   'SNMP Flood',
  26:   'Volume Anômalo',
  31:   'Port Scan',
  8:    'Elephant Flow',
  4153: 'Flood Victim',
  4157: 'SYN Flood',
  4142: 'Mitigação SNMP',
};

interface TypeStat {
  alert_id: number;
  label: string;
  count: number;
  critical: number;
  warning: number;
}

interface TopIP {
  ip: string;
  count: number;
  as_target: number;
  as_source: number;
}

function buildTypeStats(alerts: NtopAlert[]): TypeStat[] {
  const map = new Map<number, TypeStat>();
  for (const a of alerts) {
    const id = a.alert_id;
    if (!map.has(id)) {
      map.set(id, { alert_id: id, label: DDOS_LABELS[id] ?? `#${id}`, count: 0, critical: 0, warning: 0 });
    }
    const s = map.get(id)!;
    s.count++;
    if (a.severity === 'critical' || a.severity === 'error') s.critical++;
    else if (a.severity === 'warning') s.warning++;
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function buildTopIPs(alerts: NtopAlert[]): TopIP[] {
  const map = new Map<string, TopIP>();
  for (const a of alerts) {
    if (a.ip) {
      if (!map.has(a.ip)) map.set(a.ip, { ip: a.ip, count: 0, as_target: 0, as_source: 0 });
      map.get(a.ip)!.count++;
      map.get(a.ip)!.as_target++;
    }
    if (a.cli_ip) {
      if (!map.has(a.cli_ip)) map.set(a.cli_ip, { ip: a.cli_ip, count: 0, as_target: 0, as_source: 0 });
      map.get(a.cli_ip)!.count++;
      map.get(a.cli_ip)!.as_source++;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 20);
}

function exportCSV(alerts: NtopAlert[], filename: string) {
  const header = 'Horário,Tipo,Severidade,IP Alvo,IP Origem,Score,Duração\n';
  const rows = alerts.map(a => [
    a.tstamp ? new Date(a.tstamp * 1000).toLocaleString('pt-BR') : '',
    DDOS_LABELS[a.alert_id] ?? a.alert_id,
    a.severity ?? '',
    a.ip ?? '',
    a.cli_ip ?? '',
    a.score ?? '',
    a.duration ?? '',
  ].join(',')).join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const typeColumns: ColumnsType<TypeStat> = [
  { title: 'Tipo de Ataque', dataIndex: 'label', render: v => <Tag style={{ fontSize: 12, background: '#0d1b2e', borderColor: '#1e3a5f', color: '#94a3b8' }}>{v}</Tag> },
  { title: 'Total', dataIndex: 'count', sorter: (a, b) => b.count - a.count, render: v => <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{v}</span>, defaultSortOrder: 'ascend' },
  { title: 'Críticos', dataIndex: 'critical', render: v => <span style={{ color: v > 0 ? '#ff3b3b' : '#64748b' }}>{v}</span> },
  { title: 'Avisos', dataIndex: 'warning', render: v => <span style={{ color: v > 0 ? '#f59e0b' : '#64748b' }}>{v}</span> },
];

const ipColumns: ColumnsType<TopIP> = [
  { title: 'IP', dataIndex: 'ip', render: v => <span style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v}</span> },
  { title: 'Total', dataIndex: 'count', sorter: (a, b) => b.count - a.count, defaultSortOrder: 'ascend', render: v => <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{v}</span> },
  { title: 'Como Alvo', dataIndex: 'as_target', render: v => <span style={{ color: '#ff3b3b' }}>{v}</span> },
  { title: 'Como Origem', dataIndex: 'as_source', render: v => <span style={{ color: '#f59e0b' }}>{v}</span> },
];

export function ReportsPage() {
  const { backendOnline, user } = useAuth();
  const ifid = getConfig().ifid;
  const [alerts, setAlerts]   = useState<NtopAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(7, 'day'), dayjs(),
  ]);
  const [reportType, setReportType] = useState('ddos');

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r1, r2] = await Promise.allSettled([
        getAllAlerts({ ifid, currentPage: 0, perPage: 500, epochBegin: dateRange[0].unix(), epochEnd: dateRange[1].unix() }),
        getHostAlerts({ ifid, currentPage: 0, perPage: 500, epochBegin: dateRange[0].unix(), epochEnd: dateRange[1].unix() }),
      ]);
      const combined: NtopAlert[] = [];
      if (r1.status === 'fulfilled') combined.push(...(r1.value.records ?? []));
      if (r2.status === 'fulfilled') combined.push(...(r2.value.records ?? []));
      combined.sort((a, b) => (b.tstamp ?? 0) - (a.tstamp ?? 0));
      setAlerts(combined);
      setGenerated(true);

      if (backendOnline && user && combined.length > 0) {
        const epochBegin = dateRange[0].unix();
        const epochEnd   = dateRange[1].unix();
        saveEventsBulk(combined).catch(() => {});
        saveReport({
          name: `Relatório DDoS ${dateRange[0].format('DD/MM/YYYY')}`,
          report_type: reportType,
          epoch_begin: epochBegin,
          epoch_end: epochEnd,
          summary: { total: combined.length, by_type: buildTypeStats(combined), top_ips: buildTopIPs(combined) },
        }).then(() => message.success('Relatório salvo no backend'))
          .catch(() => message.warning('Relatório gerado localmente — backend indisponível'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar relatório');
    } finally {
      setLoading(false);
    }
  }, [dateRange, ifid, backendOnline, user, reportType]);

  const typeStats = buildTypeStats(alerts);
  const topIPs    = buildTopIPs(alerts);

  const critical = alerts.filter(a => a.severity === 'critical' || a.severity === 'error').length;
  const warning  = alerts.filter(a => a.severity === 'warning').length;

  const startStr = dateRange[0].format('DD/MM/YYYY');
  const endStr   = dateRange[1].format('DD/MM/YYYY');

  return (
      <div style={{ padding: 20, height: '100%', overflowY: 'auto', flex: 1 }}>

        {/* Header */}
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BarChartOutlined style={{ color: '#00c8f0', fontSize: 20 }} />
            <h2 style={{ color: '#e2e8f0', margin: 0, fontSize: 18, fontWeight: 700 }}>Relatórios</h2>
          </div>
          {generated && (
            <Button
              icon={<DownloadOutlined />}
              onClick={() => exportCSV(alerts, `relatorio-ddos-${startStr}-${endStr}.csv`)}
              style={{ background: '#0a0f1e', borderColor: '#1e3a5f', color: '#94a3b8' }}
            >
              Exportar CSV
            </Button>
          )}
        </div>

        {/* Config */}
        <Card style={{ background: '#0a0f1e', border: '1px solid #1e3a5f', marginBottom: 16 }} bodyStyle={{ padding: 16 }}>
          <Space wrap>
            <Select
              value={reportType}
              onChange={setReportType}
              style={{ width: 180 }}
              options={[
                { label: 'Relatório DDoS',    value: 'ddos'    },
                { label: 'Top Atacantes',     value: 'origins' },
                { label: 'Alvos Afetados',    value: 'targets' },
              ]}
            />
            <RangePicker
              value={dateRange}
              format="DD/MM/YYYY"
              onChange={v => v && setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs])}
              presets={[
                { label: 'Hoje',        value: [dayjs().startOf('day'), dayjs()] },
                { label: 'Últimos 7d',  value: [dayjs().subtract(7,'day'), dayjs()] },
                { label: 'Últimos 30d', value: [dayjs().subtract(30,'day'), dayjs()] },
              ]}
              style={{ borderColor: '#1e3a5f' }}
            />
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={generate}
              loading={loading}
              style={{ background: '#0077aa', borderColor: '#0099bb' }}
            >
              Gerar Relatório
            </Button>
          </Space>
        </Card>

        {error && (
          <div style={{
            background: '#1a0a0a', border: '1px solid #ff3b3b', borderRadius: 8,
            padding: '10px 16px', marginBottom: 16, color: '#ff3b3b', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {generated && (
          <>
            {/* Summary KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
              {[
                { title: 'Total de Alertas', value: alerts.length, color: '#00c8f0' },
                { title: 'Críticos',          value: critical,      color: '#ff3b3b' },
                { title: 'Avisos',            value: warning,       color: '#f59e0b' },
                { title: 'IPs Únicos',        value: topIPs.length, color: '#8b5cf6' },
              ].map(kpi => (
                <Card key={kpi.title} style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }} bodyStyle={{ padding: 16 }}>
                  <Statistic
                    title={<span style={{ color: '#64748b', fontSize: 12 }}>{kpi.title}</span>}
                    value={kpi.value}
                    valueStyle={{ color: kpi.color, fontSize: 28, fontWeight: 700 }}
                  />
                  <div style={{ color: '#475569', fontSize: 11, marginTop: 4 }}>
                    {startStr} – {endStr}
                  </div>
                </Card>
              ))}
            </div>

            <Divider style={{ borderColor: '#1e3a5f' }} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Card title={<span style={{ color: '#94a3b8' }}>Distribuição por Tipo</span>}
                style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }}
                bodyStyle={{ padding: 12 }}>
                <Table<TypeStat>
                  columns={typeColumns}
                  dataSource={typeStats}
                  rowKey="alert_id"
                  pagination={false}
                  size="small"
                  locale={{ emptyText: 'Sem dados' }}
                />
              </Card>

              <Card title={<span style={{ color: '#94a3b8' }}>Top IPs Envolvidos</span>}
                style={{ background: '#0a0f1e', border: '1px solid #1e3a5f' }}
                bodyStyle={{ padding: 12 }}>
                <Table<TopIP>
                  columns={ipColumns}
                  dataSource={topIPs}
                  rowKey="ip"
                  pagination={{ pageSize: 10 }}
                  size="small"
                  locale={{ emptyText: 'Sem dados' }}
                />
              </Card>
            </div>
          </>
        )}
      </div>
  );
}

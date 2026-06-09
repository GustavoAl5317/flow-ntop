import { useState, useEffect, useCallback } from 'react';
import { Table, Tag, Select, DatePicker, Input, Button, Space, Badge, Tooltip, Alert, message } from 'antd';
import { SearchOutlined, ReloadOutlined, FilterOutlined, WarningOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { getHostAlerts, getAllAlerts, getFlowAlertsPage, getInterfaceData, getConfig } from '../services/ntopngApi';
import { saveEventsBulk, getAlertStatuses, saveAlertStatus, type AlertStatus } from '../services/backendApi';
import { useAuth } from '../context/AuthContext';
import type { NtopAlert } from '../types/ntopng';
import { useInterval } from '../hooks/useInterval';

const MANAGEMENT_STATUS_LABEL: Record<string, string> = {
  open: 'Aberto',
  acknowledged: 'Reconhecido',
  resolved: 'Resolvido',
};

const MANAGEMENT_STATUS_COLOR: Record<string, string> = {
  open: '#ff3b3b',
  acknowledged: '#f59e0b',
  resolved: '#10b981',
};

function alertKey(a: NtopAlert): string {
  return `${a.tstamp}-${a.alert_id}-${a.ip}-${a.cli_ip}`;
}

const { RangePicker } = DatePicker;

const DDOS_ALERT_IDS: Record<number, string> = {
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

const SEVERITY_COLOR: Record<string, string> = {
  critical:  '#ff3b3b',
  error:     '#ff3b3b',
  warning:   '#f59e0b',
  notice:    '#3b82f6',
  info:      '#64748b',
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Crítico',
  error:    'Erro',
  warning:  'Aviso',
  notice:   'Notícia',
  info:     'Info',
};

function alertTypeName(id: number, name?: string): string {
  return name || DDOS_ALERT_IDS[id] || `Alerta #${id}`;
}

function severityTag(severity: string) {
  const color = SEVERITY_COLOR[severity] ?? '#64748b';
  const label = SEVERITY_LABEL[severity] ?? severity;
  return <Tag color={color} style={{ fontSize: 11 }}>{label}</Tag>;
}

export function AlertsPage() {
  const { backendOnline, user } = useAuth();
  const ifid = getConfig().ifid;
  const [alerts, setAlerts]       = useState<NtopAlert[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [filterType, setFilterType] = useState<number | undefined>(undefined);
  const [search, setSearch]       = useState('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [page, setPage]           = useState(1);
  const [alertScope, setAlertScope] = useState<'all' | 'engaged'>('all');
  const [engagedCount, setEngagedCount] = useState(0);
  const [statuses, setStatuses] = useState<Record<string, AlertStatus>>({});
  const perPage = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const epochBegin = dateRange ? dateRange[0].unix() : undefined;
      const epochEnd   = dateRange ? dateRange[1].unix() : undefined;

      const query = { ifid, currentPage: page - 1, perPage, alert_id: filterType, epochBegin, epochEnd, status: alertScope };

      const [allRes, hostRes, flowRes, ifaceRes] = await Promise.allSettled([
        getAllAlerts(query),
        getHostAlerts(query),
        getFlowAlertsPage(query),
        getInterfaceData(ifid),
      ]);

      if (ifaceRes.status === 'fulfilled')
        setEngagedCount(ifaceRes.value.engaged_alerts ?? 0);

      const combined: NtopAlert[] = [];
      let totalRows = 0;

      for (const res of [allRes, hostRes, flowRes]) {
        if (res.status === 'fulfilled') {
          combined.push(...(res.value.records ?? []));
          totalRows += res.value.recordsTotal ?? 0;
        }
      }

      setTotal(totalRows);

      const filtered = search
        ? combined.filter(a =>
            (a.ip ?? '').includes(search) ||
            (a.cli_ip ?? '').includes(search) ||
            (a.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
            alertTypeName(a.alert_id, a.name).toLowerCase().includes(search.toLowerCase())
          )
        : combined;

      // Deduplicate by timestamp + type + IPs
      const seen = new Set<string>();
      const unique = filtered.filter(a => {
        const key = `${a.tstamp}-${a.alert_id}-${a.ip}-${a.cli_ip}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => (b.tstamp ?? 0) - (a.tstamp ?? 0));

      setAlerts(unique);

      if (backendOnline && user && combined.length > 0) {
        saveEventsBulk(combined).catch(() => { /* silent — persistence is best-effort */ });
      }

      if (backendOnline && user && unique.length > 0) {
        getAlertStatuses(unique.map(alertKey))
          .then(res => setStatuses(prev => ({ ...prev, ...res.statuses })))
          .catch(() => { /* silent — status fetch is best-effort */ });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar alertas');
    } finally {
      setLoading(false);
    }
  }, [page, filterType, search, dateRange, ifid, backendOnline, user, alertScope]);

  useEffect(() => { load(); }, [load]);
  useInterval(load, 30_000);

  async function handleStatusChange(record: NtopAlert, status: string) {
    const key = alertKey(record);
    const current = statuses[key];
    try {
      const saved = await saveAlertStatus({
        alert_key: key,
        status,
        assigned_to: current?.assigned_to ?? null,
        note: current?.note ?? null,
      });
      setStatuses(prev => ({ ...prev, [key]: saved }));
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Erro ao salvar status do alerta');
    }
  }

  async function handleAssigneeChange(record: NtopAlert, assigned_to: string) {
    const key = alertKey(record);
    const current = statuses[key];
    try {
      const saved = await saveAlertStatus({
        alert_key: key,
        status: current?.status ?? 'open',
        assigned_to: assigned_to || null,
        note: current?.note ?? null,
      });
      setStatuses(prev => ({ ...prev, [key]: saved }));
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Erro ao salvar responsável');
    }
  }

  const columns: ColumnsType<NtopAlert> = [
    {
      title: 'Horário',
      dataIndex: 'tstamp',
      width: 160,
      render: (v: number) => v
        ? new Date(v * 1000).toLocaleString('pt-BR')
        : '—',
      sorter: (a, b) => (a.tstamp ?? 0) - (b.tstamp ?? 0),
      defaultSortOrder: 'descend',
    },
    {
      title: 'Severidade',
      dataIndex: 'severity',
      width: 100,
      render: (v: string) => severityTag(v ?? 'info'),
      filters: [
        { text: 'Crítico', value: 'critical' },
        { text: 'Aviso',   value: 'warning'  },
        { text: 'Info',    value: 'info'      },
      ],
      onFilter: (value, record) => record.severity === value,
    },
    {
      title: 'Tipo',
      dataIndex: 'alert_id',
      width: 150,
      render: (v: number, record) => (
        <Tag style={{ background: '#0d1b2e', border: '1px solid #1e3a5f', color: '#94a3b8', fontSize: 11 }}>
          {alertTypeName(v, record.name)}
        </Tag>
      ),
    },
    {
      title: 'IP Alvo',
      dataIndex: 'ip',
      width: 150,
      render: (v: string, record) => (
        <Tooltip title={record.name}>
          <span style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v ?? '—'}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Origem',
      dataIndex: 'cli_ip',
      width: 150,
      render: (v: string) => (
        <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{v ?? '—'}</span>
      ),
    },
    {
      title: 'Protocolo',
      dataIndex: 'proto',
      width: 90,
      render: (v: string) => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : '—',
    },
    {
      title: 'Score',
      dataIndex: 'score',
      width: 80,
      render: (v: number) => (
        <span style={{ color: v > 100 ? '#ff3b3b' : v > 50 ? '#f59e0b' : '#64748b', fontWeight: 600 }}>
          {v ?? 0}
        </span>
      ),
      sorter: (a, b) => (a.score ?? 0) - (b.score ?? 0),
    },
    {
      title: 'Duração',
      dataIndex: 'duration',
      width: 100,
      render: (v: number) => {
        if (!v) return '—';
        const m = Math.floor(v / 60);
        const s = v % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
      },
    },
    {
      title: 'Status ntopng',
      dataIndex: 'alert_status',
      width: 120,
      render: (v: number) => {
        const label = v === 0 ? 'Ativo' : v === 1 ? 'Reconhecido' : 'Resolvido';
        const color = v === 0 ? '#ff3b3b' : v === 1 ? '#f59e0b' : '#10b981';
        return <Badge color={color} text={<span style={{ color, fontSize: 12 }}>{label}</span>} />;
      },
    },
    {
      title: 'Gestão',
      key: 'management_status',
      width: 150,
      render: (_, record) => {
        const status = statuses[alertKey(record)]?.status ?? 'open';
        return (
          <Select
            size="small"
            value={status}
            disabled={!backendOnline || !user}
            onChange={v => handleStatusChange(record, v)}
            style={{ width: '100%' }}
            options={Object.entries(MANAGEMENT_STATUS_LABEL).map(([value, label]) => ({
              value,
              label: <span style={{ color: MANAGEMENT_STATUS_COLOR[value], fontSize: 12 }}>{label}</span>,
            }))}
          />
        );
      },
    },
    {
      title: 'Responsável',
      key: 'assigned_to',
      width: 140,
      render: (_, record) => {
        const key = alertKey(record);
        const assigned = statuses[key]?.assigned_to ?? '';
        return (
          <Input
            size="small"
            placeholder="—"
            defaultValue={assigned}
            disabled={!backendOnline || !user}
            onBlur={e => {
              if (e.target.value !== (statuses[key]?.assigned_to ?? '')) {
                handleAssigneeChange(record, e.target.value);
              }
            }}
          />
        );
      },
    },
  ];

  return (
      <div style={{ padding: 20, height: '100%', overflowY: 'auto', flex: 1 }}>

        {/* Header */}
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <WarningOutlined style={{ color: '#f59e0b', fontSize: 20 }} />
            <h2 style={{ color: '#e2e8f0', margin: 0, fontSize: 18, fontWeight: 700 }}>
              Gestão de Alertas
            </h2>
            <Badge count={total} style={{ backgroundColor: '#ff3b3b' }} />
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

        {/* Info: engaged counter vs list mismatch */}
        {engagedCount > 0 && alertScope === 'engaged' && alerts.length === 0 && !loading && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={`Interface reporta ${engagedCount} alerta(s) engajado(s), mas a API REST não retorna detalhes`}
            description="Isso é comum no ntopng: o contador vem de interface/data.lua, enquanto a listagem filtra alertas de flow/host no banco. Troque o filtro para 'Todos os alertas' para ver o histórico disponível."
          />
        )}

        {/* Filters */}
        <div style={{
          background: '#0a0f1e', border: '1px solid #1e3a5f', borderRadius: 8,
          padding: '12px 16px', marginBottom: 16,
          display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <FilterOutlined style={{ color: '#64748b' }} />

          <Input
            placeholder="Buscar IP, nome ou tipo..."
            prefix={<SearchOutlined style={{ color: '#64748b' }} />}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 240, background: '#0d1b2e', borderColor: '#1e3a5f', color: '#e2e8f0' }}
            allowClear
          />

          <Select
            value={alertScope}
            onChange={setAlertScope}
            style={{ width: 180 }}
            options={[
              { label: 'Todos os alertas',    value: 'all'     },
              { label: 'Somente engajados',   value: 'engaged' },
            ]}
          />

          <Select
            placeholder="Tipo de alerta"
            allowClear
            value={filterType}
            onChange={setFilterType}
            style={{ width: 180 }}
            options={Object.entries(DDOS_ALERT_IDS).map(([k, v]) => ({
              label: v, value: Number(k),
            }))}
          />

          <RangePicker
            showTime
            format="DD/MM HH:mm"
            onChange={v => setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)}
            style={{ borderColor: '#1e3a5f' }}
          />

          <Space>
            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={load}
              style={{ background: '#0077aa', borderColor: '#0099bb' }}
            >
              Filtrar
            </Button>
            <Button
              onClick={() => { setFilterType(undefined); setSearch(''); setDateRange(null); }}
              style={{ background: '#0a0f1e', borderColor: '#1e3a5f', color: '#94a3b8' }}
            >
              Limpar
            </Button>
          </Space>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: '#1a0a0a', border: '1px solid #ff3b3b', borderRadius: 8,
            padding: '10px 16px', marginBottom: 16, color: '#ff3b3b', fontSize: 13,
          }}>
            {error} — verifique a conexão com o ntopng ou aguarde dados de NetFlow chegarem.
          </div>
        )}

        {/* Table */}
        <Table<NtopAlert>
          columns={columns}
          dataSource={alerts}
          rowKey={(r, i) => `${r.tstamp}-${r.alert_id}-${i}`}
          loading={loading}
          pagination={{
            current: page,
            pageSize: perPage,
            total,
            onChange: setPage,
            showTotal: t => `${t} alertas`,
            style: { color: '#94a3b8' },
          }}
          scroll={{ x: 1200 }}
          style={{ background: '#0d1b2e' }}
          size="small"
          locale={{ emptyText: 'Nenhum alerta encontrado. NetFlow ainda não chegou ou não há eventos no período.' }}
        />
      </div>
  );
}

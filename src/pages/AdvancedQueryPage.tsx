import { useState, useCallback } from 'react';
import {
  Form, Input, Select, DatePicker, Button, Table,
  Card, Space, Tag, Tabs, Divider,
} from 'antd';
import { SearchOutlined, ClearOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { getHostAlerts, getAllAlerts, getActiveFlows, getConfig } from '../services/ntopngApi';
import type { NtopAlert } from '../types/ntopng';

const { RangePicker } = DatePicker;

const PROTOCOLS = ['TCP', 'UDP', 'ICMP', 'GRE', 'SCTP'];
const ALERT_TYPES = [
  { label: 'Flow Flood',      value: 4    },
  { label: 'ICMP Flood',      value: 18   },
  { label: 'DNS Flood',       value: 22   },
  { label: 'SNMP Flood',      value: 23   },
  { label: 'Volume Anômalo',  value: 26   },
  { label: 'Port Scan',       value: 31   },
  { label: 'Elephant Flow',   value: 8    },
  { label: 'Flood Victim',    value: 4153 },
  { label: 'SYN Flood',       value: 4157 },
];

interface QueryFilters {
  ip?:        string;
  asn?:       string;
  protocol?:  string;
  alert_id?:  number;
  dateRange?: [dayjs.Dayjs, dayjs.Dayjs] | null;
}

const alertColumns: ColumnsType<NtopAlert> = [
  {
    title: 'Horário',
    dataIndex: 'tstamp',
    width: 160,
    render: (v: number) => v ? new Date(v * 1000).toLocaleString('pt-BR') : '—',
    sorter: (a, b) => (a.tstamp ?? 0) - (b.tstamp ?? 0),
    defaultSortOrder: 'descend',
  },
  {
    title: 'Tipo',
    dataIndex: 'alert_id',
    width: 130,
    render: (v: number) => {
      const t = ALERT_TYPES.find(a => a.value === v);
      return <Tag style={{ fontSize: 11, background: '#0d1b2e', borderColor: '#1e3a5f', color: '#94a3b8' }}>
        {t?.label ?? `#${v}`}
      </Tag>;
    },
  },
  {
    title: 'IP Alvo',
    dataIndex: 'ip',
    width: 150,
    render: (v: string) => <span style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{v ?? '—'}</span>,
  },
  {
    title: 'Origem',
    dataIndex: 'cli_ip',
    width: 150,
    render: (v: string) => <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{v ?? '—'}</span>,
  },
  {
    title: 'ASN',
    dataIndex: 'cli_asn',
    width: 120,
    render: (v: string | number) => v ? <span style={{ color: '#64748b' }}>AS{v}</span> : '—',
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
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const flowColumns: ColumnsType<any> = [
  {
    title: 'Origem',
    dataIndex: 'cli.ip',
    width: 150,
    render: (_: unknown, r) => <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{r['cli.ip'] ?? '—'}</span>,
  },
  {
    title: 'Destino',
    dataIndex: 'srv.ip',
    width: 150,
    render: (_: unknown, r) => <span style={{ fontFamily: 'monospace', color: '#00c8f0' }}>{r['srv.ip'] ?? '—'}</span>,
  },
  {
    title: 'Protocolo',
    dataIndex: 'proto.l4',
    width: 90,
    render: (_: unknown, r) => <Tag style={{ fontSize: 11 }}>{r['proto.l4'] ?? '—'}</Tag>,
  },
  {
    title: 'nDPI',
    dataIndex: 'proto.ndpi',
    width: 120,
    render: (_: unknown, r) => <span style={{ color: '#64748b', fontSize: 12 }}>{r['proto.ndpi'] ?? '—'}</span>,
  },
  {
    title: 'Bytes',
    width: 120,
    render: (_: unknown, r) => {
      const b = (r['cli2srv.bytes'] ?? 0) + (r['srv2cli.bytes'] ?? 0);
      return <span style={{ color: '#94a3b8' }}>{(b / 1024 / 1024).toFixed(2)} MB</span>;
    },
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
  },
];

export function AdvancedQueryPage() {
  const ifid = getConfig().ifid;
  const [form]                = Form.useForm<QueryFilters>();
  const [alerts, setAlerts]   = useState<NtopAlert[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [flows, setFlows]     = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [alertTotal, setAlertTotal] = useState(0);

  const search = useCallback(async () => {
    const values = form.getFieldsValue();
    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const epochBegin = values.dateRange ? values.dateRange[0].unix() : undefined;
      const epochEnd   = values.dateRange ? values.dateRange[1].unix() : undefined;

      const [alertsRes, hostAlertsRes, flowsRes] = await Promise.allSettled([
        getAllAlerts({
          ifid, currentPage: 0, perPage: 50,
          alert_id: values.alert_id,
          epochBegin, epochEnd,
        }),
        getHostAlerts({
          ifid, currentPage: 0, perPage: 50,
          alert_id: values.alert_id,
          epochBegin, epochEnd,
        }),
        getActiveFlows(ifid, 50),
      ]);

      let combined: NtopAlert[] = [];
      if (alertsRes.status === 'fulfilled') {
        combined.push(...(alertsRes.value.records ?? []));
        setAlertTotal(alertsRes.value.recordsTotal ?? 0);
      }
      if (hostAlertsRes.status === 'fulfilled') {
        combined.push(...(hostAlertsRes.value.records ?? []));
      }

      // Client-side filter by IP and ASN
      if (values.ip) {
        combined = combined.filter(a =>
          (a.ip ?? '').includes(values.ip!) ||
          (a.cli_ip ?? '').includes(values.ip!)
        );
      }
      if (values.asn) {
        combined = combined.filter(a =>
          String(a.cli_asn ?? '').includes(values.asn!)
        );
      }
      if (values.protocol) {
        combined = combined.filter(a =>
          (a.proto ?? '').toUpperCase() === values.protocol!.toUpperCase()
        );
      }

      setAlerts(combined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let flowList: any[] = [];
      if (flowsRes.status === 'fulfilled') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = flowsRes.value as any;
        flowList = raw?.data ?? raw?.records ?? (Array.isArray(raw) ? raw : []);
      }
      if (values.ip) {
        flowList = flowList.filter((f: Record<string, unknown>) =>
          (String(f['cli.ip'] ?? '')).includes(values.ip!) ||
          (String(f['srv.ip'] ?? '')).includes(values.ip!)
        );
      }
      if (values.protocol) {
        flowList = flowList.filter((f: Record<string, unknown>) =>
          String(f['proto.l4'] ?? '').toUpperCase() === values.protocol!.toUpperCase()
        );
      }
      setFlows(flowList);

    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na consulta');
    } finally {
      setLoading(false);
    }
  }, [form, ifid]);

  const clear = () => {
    form.resetFields();
    setAlerts([]);
    setFlows([]);
    setSearched(false);
    setError(null);
  };

  return (
      <div style={{ padding: 20, height: '100%', overflowY: 'auto', flex: 1 }}>

        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <SearchOutlined style={{ color: '#00c8f0', fontSize: 20 }} />
          <h2 style={{ color: '#e2e8f0', margin: 0, fontSize: 18, fontWeight: 700 }}>
            Consulta Avançada
          </h2>
        </div>

        {/* Query Form */}
        <Card
          style={{ background: '#0a0f1e', border: '1px solid #1e3a5f', marginBottom: 16 }}
          bodyStyle={{ padding: 20 }}
        >
          <Form form={form} layout="vertical" onFinish={search}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <Form.Item name="ip" label={<span style={{ color: '#94a3b8' }}>IP Alvo / Origem</span>}>
                <Input
                  placeholder="ex: 192.168.1.1"
                  style={{ background: '#0d1b2e', borderColor: '#1e3a5f', color: '#e2e8f0', fontFamily: 'monospace' }}
                />
              </Form.Item>

              <Form.Item name="asn" label={<span style={{ color: '#94a3b8' }}>ASN de Origem</span>}>
                <Input
                  placeholder="ex: 7738"
                  style={{ background: '#0d1b2e', borderColor: '#1e3a5f', color: '#e2e8f0', fontFamily: 'monospace' }}
                />
              </Form.Item>

              <Form.Item name="protocol" label={<span style={{ color: '#94a3b8' }}>Protocolo</span>}>
                <Select
                  placeholder="Todos"
                  allowClear
                  options={PROTOCOLS.map(p => ({ label: p, value: p }))}
                />
              </Form.Item>

              <Form.Item name="alert_id" label={<span style={{ color: '#94a3b8' }}>Tipo de Ataque</span>}>
                <Select placeholder="Todos" allowClear options={ALERT_TYPES} />
              </Form.Item>
            </div>

            <Form.Item name="dateRange" label={<span style={{ color: '#94a3b8' }}>Período</span>}>
              <RangePicker
                showTime
                format="DD/MM/YYYY HH:mm"
                style={{ width: '100%', borderColor: '#1e3a5f' }}
                presets={[
                  { label: 'Última hora',   value: [dayjs().subtract(1, 'hour'), dayjs()] },
                  { label: 'Últimas 6h',    value: [dayjs().subtract(6, 'hour'), dayjs()] },
                  { label: 'Últimas 24h',   value: [dayjs().subtract(1, 'day'), dayjs()] },
                  { label: 'Última semana', value: [dayjs().subtract(7, 'day'), dayjs()] },
                ]}
              />
            </Form.Item>

            <Divider style={{ borderColor: '#1e3a5f', margin: '12px 0' }} />

            <Space>
              <Button
                type="primary"
                htmlType="submit"
                icon={<SearchOutlined />}
                loading={loading}
                style={{ background: '#0077aa', borderColor: '#0099bb' }}
              >
                Consultar
              </Button>
              <Button
                icon={<ClearOutlined />}
                onClick={clear}
                style={{ background: '#0a0f1e', borderColor: '#1e3a5f', color: '#94a3b8' }}
              >
                Limpar
              </Button>
            </Space>
          </Form>
        </Card>

        {/* Error */}
        {error && (
          <div style={{
            background: '#1a0a0a', border: '1px solid #ff3b3b', borderRadius: 8,
            padding: '10px 16px', marginBottom: 16, color: '#ff3b3b', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Results */}
        {searched && (
          <Tabs
            defaultActiveKey="alerts"
            style={{ color: '#94a3b8' }}
            items={[
              {
                key: 'alerts',
                label: `Alertas (${alerts.length} de ${alertTotal})`,
                children: (
                  <Table<NtopAlert>
                    columns={alertColumns}
                    dataSource={alerts}
                    rowKey={(r, i) => `${r.tstamp}-${r.alert_id}-${i}`}
                    loading={loading}
                    pagination={{ pageSize: 20, showTotal: t => `${t} alertas` }}
                    scroll={{ x: 900 }}
                    size="small"
                    locale={{ emptyText: 'Nenhum alerta encontrado para os filtros aplicados.' }}
                  />
                ),
              },
              {
                key: 'flows',
                label: `Flows Ativos (${flows.length})`,
                children: (
                  <Table
                    columns={flowColumns}
                    dataSource={flows}
                    rowKey={(_r, i) => String(i)}
                    loading={loading}
                    pagination={{ pageSize: 20 }}
                    scroll={{ x: 800 }}
                    size="small"
                    locale={{ emptyText: 'Nenhum flow ativo. Aguarde dados de NetFlow.' }}
                  />
                ),
              },
            ]}
          />
        )}
      </div>
  );
}

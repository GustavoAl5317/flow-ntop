import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Tag, Select, Button, Typography, Space, Badge, Tooltip, InputNumber } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RefreshCw, AlertTriangle, Shield, Zap } from 'lucide-react';
import dayjs from 'dayjs';
import {
  getCorrelatedAttacks,
  type CorrelatedAttack,
  type AttackProtocol,
  type AttackSource,
  type AttackAsn,
} from '../services/backendApi';

const { Title, Text } = Typography;

const RANGE_OPTIONS = [
  { label: 'Última 1h',      value: 3600 },
  { label: 'Últimas 6h',     value: 6 * 3600 },
  { label: 'Últimas 24h',    value: 24 * 3600 },
  { label: 'Últimos 7 dias', value: 7 * 24 * 3600 },
];

const PROTO_COLORS: Record<string, string> = {
  TCP: '#3b82f6', UDP: '#8b5cf6', ICMP: '#f59e0b',
  'IPv6-ICMP': '#f97316', GRE: '#ec4899', ESP: '#14b8a6',
};

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes; let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(2)} ${units[i]}`;
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function fmtMbps(bytes: number, durationS: number): string {
  const s = Math.max(durationS, 1);
  const mbps = (bytes * 8) / 1_000_000 / s;
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
  return `${mbps.toFixed(2)} Mbps`;
}

// ─── Expanded row ─────────────────────────────────────────────────────────────

function AttackDetail({ attack }: { attack: CorrelatedAttack }) {
  const srcCols: ColumnsType<AttackSource> = [
    {
      title: 'IP Origem',
      dataIndex: 'ip',
      render: (v: string) => <Text style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{v}</Text>,
    },
    {
      title: 'Bytes',
      dataIndex: 'bytes',
      align: 'right',
      render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text>,
    },
  ];

  const asnCols: ColumnsType<AttackAsn> = [
    {
      title: 'ASN',
      dataIndex: 'asn',
      render: (v: number) => <Tag color="blue" style={{ fontFamily: 'monospace' }}>AS{v}</Tag>,
    },
    {
      title: 'Bytes',
      dataIndex: 'bytes',
      align: 'right',
      render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text>,
    },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '8px 16px' }}>
      <div>
        <Text style={{ color: '#64748b', fontSize: 11, display: 'block', marginBottom: 6 }}>TOP ORIGENS</Text>
        <Table
          columns={srcCols}
          dataSource={attack.top_sources}
          rowKey="ip"
          pagination={false}
          size="small"
          style={{ background: 'transparent' }}
        />
      </div>
      <div>
        <Text style={{ color: '#64748b', fontSize: 11, display: 'block', marginBottom: 6 }}>TOP ASNs</Text>
        {attack.top_asns.length > 0 ? (
          <Table
            columns={asnCols}
            dataSource={attack.top_asns}
            rowKey="asn"
            pagination={false}
            size="small"
            style={{ background: 'transparent' }}
          />
        ) : (
          <Text style={{ color: '#334155' }}>Sem dados de ASN</Text>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function CorrelationPage() {
  const [attacks, setAttacks] = useState<CorrelatedAttack[]>([]);
  const [loading, setLoading] = useState(false);
  const [rangeSeconds, setRangeSeconds] = useState(3600);
  const [minEvents, setMinEvents] = useState(50);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const { attacks: data } = await getCorrelatedAttacks({
        epoch_begin: now - rangeSeconds,
        epoch_end: now,
        min_events: minEvents,
      });
      setAttacks(data);
    } catch {
      // silently ignore — table stays empty
    } finally {
      setLoading(false);
    }
  }, [rangeSeconds, minEvents]);

  useEffect(() => { load(); }, [load]);

  const columns: ColumnsType<CorrelatedAttack> = [
    {
      title: 'Severidade',
      dataIndex: 'max_severity',
      key: 'severity',
      width: 110,
      filters: [
        { text: 'Critical', value: 'critical' },
        { text: 'Warning', value: 'warning' },
      ],
      onFilter: (v, r) => r.max_severity === v,
      render: (v: string) =>
        v === 'critical' ? (
          <Badge status="error" text={<Text style={{ color: '#ff3b3b' }}>Critical</Text>} />
        ) : (
          <Badge status="warning" text={<Text style={{ color: '#f59e0b' }}>Warning</Text>} />
        ),
    },
    {
      title: 'IP Vítima',
      dataIndex: 'victim_ip',
      key: 'victim_ip',
      render: (v: string) => (
        <Text copyable style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{v}</Text>
      ),
    },
    {
      title: 'Vetores',
      dataIndex: 'protocols',
      key: 'protocols',
      render: (protos: AttackProtocol[]) => (
        <Space size={4} wrap>
          {protos.map(p => (
            <Tooltip key={p.proto} title={formatBytes(p.bytes)}>
              <Tag color={PROTO_COLORS[p.proto] ?? '#475569'} style={{ marginRight: 0 }}>
                {p.proto}
              </Tag>
            </Tooltip>
          ))}
        </Space>
      ),
    },
    {
      title: 'Volume Total',
      dataIndex: 'total_bytes',
      key: 'total_bytes',
      align: 'right',
      sorter: (a, b) => a.total_bytes - b.total_bytes,
      defaultSortOrder: 'descend',
      render: (v: number, row: CorrelatedAttack) => (
        <div style={{ textAlign: 'right' }}>
          <Text style={{ color: '#00c8f0', fontFamily: 'monospace', display: 'block' }}>
            {fmtMbps(v, row.duration_s)}
          </Text>
          <Text style={{ color: '#475569', fontSize: 11 }}>{formatBytes(v)}</Text>
        </div>
      ),
    },
    {
      title: 'Eventos',
      dataIndex: 'event_count',
      key: 'event_count',
      align: 'right',
      sorter: (a, b) => a.event_count - b.event_count,
      render: (v: number) => <Text style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{v.toLocaleString('pt-BR')}</Text>,
    },
    {
      title: 'Origens únicas',
      dataIndex: 'unique_sources',
      key: 'unique_sources',
      align: 'right',
      render: (v: number) => (
        <Tag color={v > 50 ? 'red' : v > 10 ? 'orange' : 'default'}>{v}</Tag>
      ),
    },
    {
      title: 'Duração',
      dataIndex: 'duration_s',
      key: 'duration_s',
      align: 'right',
      sorter: (a, b) => a.duration_s - b.duration_s,
      render: (v: number) => <Text style={{ color: '#94a3b8' }}>{fmtDuration(v)}</Text>,
    },
    {
      title: 'Início',
      dataIndex: 'first_seen',
      key: 'first_seen',
      render: (v: number) => (
        <Text style={{ color: '#64748b', fontSize: 12 }}>
          {dayjs.unix(v).format('DD/MM HH:mm:ss')}
        </Text>
      ),
    },
  ];

  const expandable = {
    expandedRowRender: (record: CorrelatedAttack) => <AttackDetail attack={record} />,
    rowExpandable: () => true,
  };

  const criticalCount = attacks.filter(a => a.max_severity === 'critical').length;
  const warningCount  = attacks.filter(a => a.max_severity === 'warning').length;

  return (
    <main style={{ flex: 1, overflow: 'auto', padding: '16px 20px', background: '#060d1f' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ color: '#e2e8f0', margin: 0 }}>Correlação de Ataques</Title>
        <Space>
          <Select value={rangeSeconds} onChange={v => setRangeSeconds(v)} options={RANGE_OPTIONS} style={{ width: 150 }} />
          <Space size={4}>
            <Text style={{ color: '#64748b', fontSize: 12 }}>Min. eventos:</Text>
            <InputNumber
              min={1} max={100} value={minEvents}
              onChange={v => setMinEvents(v ?? 3)}
              style={{ width: 70, background: '#0f1f3d', borderColor: '#1e2d4a', color: '#e2e8f0' }}
              size="small"
            />
          </Space>
          <Button
            icon={<RefreshCw size={14} />}
            onClick={load}
            loading={loading}
            style={{ background: '#0f1f3d', borderColor: '#1e2d4a', color: '#94a3b8' }}
          >
            Atualizar
          </Button>
        </Space>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Campanhas ativas',    value: attacks.length, icon: <Zap size={18} />, color: '#00c8f0' },
          { label: 'Critical',            value: criticalCount,  icon: <AlertTriangle size={18} />, color: '#ff3b3b' },
          { label: 'Warning',             value: warningCount,   icon: <Shield size={18} />, color: '#f59e0b' },
          {
            label: 'IPs sob ataque',
            value: new Set(attacks.map(a => a.victim_ip)).size,
            icon: <Shield size={18} />,
            color: '#8b5cf6',
          },
        ].map(({ label, value, icon, color }) => (
          <Card
            key={label}
            style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
            bodyStyle={{ padding: '14px 18px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color }}>{icon}</span>
              <div>
                <Text style={{ color: '#64748b', fontSize: 11, display: 'block' }}>{label}</Text>
                <Text style={{ color, fontSize: 24, fontWeight: 700, fontFamily: 'monospace' }}>{value}</Text>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Attacks table */}
      <Card
        style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          columns={columns}
          dataSource={attacks}
          rowKey="victim_ip"
          expandable={expandable}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          size="small"
          rowClassName={(r) => r.max_severity === 'critical' ? 'row-critical' : ''}
          locale={{ emptyText: <Text style={{ color: '#334155' }}>Nenhum ataque detectado no período</Text> }}
          style={{ background: 'transparent' }}
        />
      </Card>
    </main>
  );
}

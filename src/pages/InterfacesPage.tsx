import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Input, InputNumber, Form, Select, Typography, Space, Popconfirm, message, Tag, Tooltip, Progress } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { RefreshCw, Zap, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  getInterfaces,
  createInterface,
  deleteInterface,
  getInterfacesStats,
  getDiscoveredInterfaces,
  getInterfacesRanking,
  type NetInterface,
  type InterfaceStats,
  type DiscoveredInterface,
  type InterfaceRankingEntry,
} from '../services/backendApi';

const { Title, Text } = Typography;

const RANGE_OPTIONS = [
  { label: 'Última 1h',      value: 3600 },
  { label: 'Últimas 6h',     value: 6 * 3600 },
  { label: 'Últimas 24h',    value: 24 * 3600 },
  { label: 'Últimos 7 dias', value: 7 * 24 * 3600 },
];

const LINK_TYPES = [
  'Transit', 'IX', 'CDN', 'Peering', 'Backbone', 'Acesso', 'MPLS', 'Fibra', 'Wireless', 'Outros',
].map(v => ({ label: v, value: v }));

const LINK_TYPE_COLORS: Record<string, string> = {
  Transit: 'purple', IX: 'green', CDN: 'cyan', Peering: 'blue',
  Backbone: 'orange', Acesso: 'geekblue', MPLS: 'gold', Fibra: 'lime',
  Wireless: 'volcano', Outros: 'default',
};

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes; let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(2)} ${units[i]}`;
}

function toMbps(bytes: number, seconds: number): string {
  const mbps = (bytes * 8) / 1_000_000 / Math.max(seconds, 1);
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
  return `${mbps.toFixed(2)} Mbps`;
}

interface IfaceRow extends NetInterface {
  bytes_in: number;
  bytes_out: number;
  packets_in: number;
  packets_out: number;
  flows_in: number;
  flows_out: number;
}

export function InterfacesPage() {
  const navigate = useNavigate();
  const [ifaces, setIfaces] = useState<IfaceRow[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredInterface[]>([]);
  const [ranking, setRanking] = useState<InterfaceRankingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [rangeSeconds, setRangeSeconds] = useState(3600);
  const [form] = Form.useForm();
  const [adding, setAdding] = useState(false);
  const [showExtra, setShowExtra] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const epoch_begin = now - rangeSeconds;
      const [{ interfaces: ifl }, { stats }, { interfaces: disc }, { ranking: rk }] = await Promise.all([
        getInterfaces(),
        getInterfacesStats({ epoch_begin, epoch_end: now }),
        getDiscoveredInterfaces({ epoch_begin }),
        getInterfacesRanking({ epoch_begin, epoch_end: now }),
      ]);
      const statsMap = Object.fromEntries(stats.map((s: InterfaceStats) => [s.id, s]));
      setIfaces(ifl.map((i: NetInterface) => ({
        ...i,
        bytes_in:    statsMap[i.id]?.bytes_in    ?? 0,
        bytes_out:   statsMap[i.id]?.bytes_out   ?? 0,
        packets_in:  statsMap[i.id]?.packets_in  ?? 0,
        packets_out: statsMap[i.id]?.packets_out ?? 0,
        flows_in:    statsMap[i.id]?.flows_in    ?? 0,
        flows_out:   statsMap[i.id]?.flows_out   ?? 0,
      })));
      setDiscovered(disc);
      setRanking(rk);
    } catch (e: unknown) {
      message.error((e as Error).message ?? 'Erro ao carregar interfaces');
    } finally {
      setLoading(false);
    }
  }, [rangeSeconds]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (values: {
    ifid: number; router_ip?: string; name: string; description?: string; capacity_mbps?: number;
    equipment?: string; link_type?: string; operator?: string; partner?: string; city?: string; pop?: string;
  }) => {
    setAdding(true);
    try {
      await createInterface({
        ifid: values.ifid,
        router_ip: values.router_ip?.trim() || '',
        name: values.name.trim(),
        description: values.description?.trim() || null,
        capacity_mbps: values.capacity_mbps ?? null,
        equipment: values.equipment?.trim() || null,
        link_type: values.link_type || null,
        operator: values.operator?.trim() || null,
        partner: values.partner?.trim() || null,
        city: values.city?.trim() || null,
        pop: values.pop?.trim() || null,
      });
      message.success('Interface adicionada');
      form.resetFields();
      load();
    } catch (e: unknown) {
      message.error((e as Error).message ?? 'Erro ao adicionar interface');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteInterface(id);
      message.success('Interface removida');
      load();
    } catch (e: unknown) {
      message.error((e as Error).message ?? 'Erro ao remover interface');
    }
  };

  const fillFromDiscovered = (d: DiscoveredInterface) => {
    form.setFieldsValue({ ifid: d.ifid, router_ip: d.sampler ?? '' });
  };

  const columns: ColumnsType<IfaceRow> = [
    {
      title: 'ifid',
      dataIndex: 'ifid',
      width: 65,
      render: (v: number) => <Tag color="geekblue" style={{ fontFamily: 'monospace' }}>{v}</Tag>,
    },
    {
      title: 'Nome / Tipo',
      key: 'name',
      render: (_: unknown, row: IfaceRow) => (
        <div>
          <Text strong style={{ color: '#e2e8f0' }}>{row.name}</Text>
          {row.link_type && (
            <Tag color={LINK_TYPE_COLORS[row.link_type] ?? 'default'} style={{ fontSize: 10, marginLeft: 6 }}>
              {row.link_type}
            </Tag>
          )}
          {row.description && <Text style={{ display: 'block', color: '#64748b', fontSize: 11 }}>{row.description}</Text>}
          {(row.operator || row.city) && (
            <Text style={{ display: 'block', color: '#475569', fontSize: 11 }}>
              {[row.operator, row.city].filter(Boolean).join(' · ')}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: 'Roteador',
      dataIndex: 'router_ip',
      render: (v: string) => v
        ? <Text style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 12 }}>{v}</Text>
        : <Text style={{ color: '#334155' }}>—</Text>,
    },
    {
      title: 'Capacidade',
      dataIndex: 'capacity_mbps',
      align: 'right',
      render: (v: number | null) => v
        ? <Text style={{ color: '#94a3b8' }}>{v >= 1000 ? `${(v / 1000).toFixed(0)} Gbps` : `${v} Mbps`}</Text>
        : <Text style={{ color: '#334155' }}>—</Text>,
    },
    {
      title: 'Tráfego IN',
      key: 'traffic_in',
      align: 'right',
      sorter: (a, b) => a.bytes_in - b.bytes_in,
      render: (_: unknown, row: IfaceRow) => (
        <div style={{ textAlign: 'right' }}>
          <Text style={{ color: '#00c8f0', fontFamily: 'monospace', display: 'block' }}>{toMbps(row.bytes_in, rangeSeconds)}</Text>
          <Text style={{ color: '#475569', fontSize: 11 }}>{formatBytes(row.bytes_in)}</Text>
        </div>
      ),
    },
    {
      title: 'Tráfego OUT',
      key: 'traffic_out',
      align: 'right',
      sorter: (a, b) => a.bytes_out - b.bytes_out,
      defaultSortOrder: 'descend',
      render: (_: unknown, row: IfaceRow) => (
        <div style={{ textAlign: 'right' }}>
          <Text style={{ color: '#f59e0b', fontFamily: 'monospace', display: 'block' }}>{toMbps(row.bytes_out, rangeSeconds)}</Text>
          <Text style={{ color: '#475569', fontSize: 11 }}>{formatBytes(row.bytes_out)}</Text>
        </div>
      ),
    },
    {
      title: 'Utilização',
      key: 'utilization',
      align: 'right',
      render: (_: unknown, row: IfaceRow) => {
        if (!row.capacity_mbps) return <Text style={{ color: '#334155' }}>—</Text>;
        const totalMbps = (row.bytes_in + row.bytes_out) * 8 / 1_000_000 / rangeSeconds;
        const pct = Math.min(100, (totalMbps / row.capacity_mbps) * 100);
        const color = pct > 80 ? '#ff3b3b' : pct > 60 ? '#f59e0b' : '#22c55e';
        return (
          <div style={{ textAlign: 'right' }}>
            <Text style={{ color, fontFamily: 'monospace' }}>{pct.toFixed(1)}%</Text>
            <div style={{ height: 4, background: '#1e2d4a', borderRadius: 2, marginTop: 2, width: 60, marginLeft: 'auto' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
            </div>
          </div>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      align: 'center',
      render: (_: unknown, row: IfaceRow) => (
        <Space size={4}>
          <Button
            type="text" size="small"
            icon={<ExternalLink size={13} />}
            onClick={e => { e.stopPropagation(); navigate(`/interfaces/${row.id}`); }}
            style={{ color: '#00c8f0' }}
            title="Abrir dashboard"
          />
          <Popconfirm
            title="Remover esta interface?"
            onConfirm={() => handleDelete(row.id)}
            okText="Remover" cancelText="Cancelar"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" icon={<DeleteOutlined />} danger size="small"
              onClick={e => e.stopPropagation()} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const discoveredColumns: ColumnsType<DiscoveredInterface> = [
    {
      title: 'ifid',
      dataIndex: 'ifid',
      width: 70,
      render: (v: number) => <Tag color="geekblue" style={{ fontFamily: 'monospace' }}>{v}</Tag>,
    },
    {
      title: 'Sampler',
      dataIndex: 'sampler',
      render: (v: string | null) => v
        ? <Text style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{v}</Text>
        : <Text style={{ color: '#334155' }}>—</Text>,
    },
    {
      title: 'Fluxos',
      dataIndex: 'flows',
      align: 'right',
      render: (v: number) => <Text style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{v.toLocaleString('pt-BR')}</Text>,
    },
    {
      title: 'Total Bytes',
      dataIndex: 'total_bytes',
      align: 'right',
      sorter: (a, b) => a.total_bytes - b.total_bytes,
      defaultSortOrder: 'descend',
      render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text>,
    },
    {
      title: '',
      key: 'add',
      width: 80,
      align: 'center',
      render: (_: unknown, row: DiscoveredInterface) => (
        <Tooltip title="Preencher formulário">
          <Button size="small" icon={<Zap size={12} />} onClick={() => fillFromDiscovered(row)}
            style={{ background: '#0f1f3d', borderColor: '#1e2d4a', color: '#00c8f0' }}>
            Usar
          </Button>
        </Tooltip>
      ),
    },
  ];

  const inputStyle = { background: '#060d1f', borderColor: '#1e2d4a', color: '#e2e8f0' };

  return (
    <main style={{ flex: 1, overflow: 'auto', padding: '16px 20px', background: '#060d1f' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ color: '#e2e8f0', margin: 0 }}>Interfaces de Rede</Title>
        <Space>
          <Select value={rangeSeconds} onChange={setRangeSeconds} options={RANGE_OPTIONS} style={{ width: 150 }} />
          <Button icon={<RefreshCw size={14} />} onClick={load} loading={loading}
            style={{ background: '#0f1f3d', borderColor: '#1e2d4a', color: '#94a3b8' }}>
            Atualizar
          </Button>
        </Space>
      </div>

      {/* Add form */}
      <Card style={{ background: '#0a1628', border: '1px solid #1e2d4a', marginBottom: 16, borderRadius: 8 }}
        styles={{ body: { padding: '16px 20px' } }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: '#94a3b8' }}>Registrar interface</Text>
          <Button type="text" size="small" style={{ color: '#475569', fontSize: 12 }}
            onClick={() => setShowExtra(v => !v)}>
            {showExtra ? 'Ocultar campos extras ▲' : 'Campos extras ▼'}
          </Button>
        </div>
        <Form form={form} layout="inline" onFinish={handleAdd}>
          <Form.Item name="ifid" rules={[{ required: true, message: 'ifid obrigatório' }]}>
            <InputNumber placeholder="ifid" min={0} style={{ width: 90, ...inputStyle }} />
          </Form.Item>
          <Form.Item name="router_ip">
            <Input placeholder="IP do roteador" style={{ width: 155, fontFamily: 'monospace', ...inputStyle }} />
          </Form.Item>
          <Form.Item name="name" rules={[{ required: true, message: 'Nome obrigatório' }]}>
            <Input placeholder="Nome (ex: Ge0/0/0)" style={{ width: 155, ...inputStyle }} />
          </Form.Item>
          <Form.Item name="description">
            <Input placeholder="Descrição" style={{ width: 170, ...inputStyle }} />
          </Form.Item>
          <Form.Item name="capacity_mbps">
            <InputNumber placeholder="Capacidade Mbps" min={0} style={{ width: 145, ...inputStyle }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={adding} icon={<PlusOutlined />}
              style={{ background: '#00c8f0', borderColor: '#00c8f0', color: '#000' }}>
              Adicionar
            </Button>
          </Form.Item>

          {showExtra && (
            <>
              <div style={{ width: '100%', height: 8 }} />
              <Form.Item name="link_type">
                <Select placeholder="Tipo de link" allowClear options={LINK_TYPES} style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name="equipment">
                <Input placeholder="Equipamento" style={{ width: 145, ...inputStyle }} />
              </Form.Item>
              <Form.Item name="operator">
                <Input placeholder="Operadora" style={{ width: 145, ...inputStyle }} />
              </Form.Item>
              <Form.Item name="partner">
                <Input placeholder="Parceiro" style={{ width: 145, ...inputStyle }} />
              </Form.Item>
              <Form.Item name="city">
                <Input placeholder="Cidade" style={{ width: 130, ...inputStyle }} />
              </Form.Item>
              <Form.Item name="pop">
                <Input placeholder="PoP" style={{ width: 100, ...inputStyle }} />
              </Form.Item>
            </>
          )}
        </Form>
      </Card>

      {/* Interfaces table */}
      <Card
        title={<Text style={{ color: '#94a3b8' }}>Interfaces Registradas</Text>}
        style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8, marginBottom: 16 }}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          columns={columns}
          dataSource={ifaces}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
          onRow={row => ({ onClick: () => navigate(`/interfaces/${row.id}`), style: { cursor: 'pointer' } })}
          locale={{ emptyText: <Text style={{ color: '#334155' }}>Nenhuma interface cadastrada</Text> }}
          style={{ background: 'transparent' }}
        />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Discovered interfaces */}
        <Card
          title={<Text style={{ color: '#94a3b8' }}>Interfaces Descobertas (via GoFlow2)</Text>}
          style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
          styles={{ body: { padding: 0 } }}
        >
          <Table
            columns={discoveredColumns}
            dataSource={discovered}
            rowKey={(r) => `${r.ifid}-${r.sampler}`}
            loading={loading}
            pagination={false}
            size="small"
            locale={{ emptyText: <Text style={{ color: '#334155' }}>Nenhuma interface detectada</Text> }}
            style={{ background: 'transparent' }}
          />
        </Card>

        {/* Ranking */}
        {ranking.length > 0 && (
          <Card
            title={<Text style={{ color: '#94a3b8' }}>Ranking por Saturação</Text>}
            style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
            styles={{ body: { padding: '12px 20px' } }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ranking.slice(0, 10).map(r => {
                const pct = r.utilization_pct;
                const color = pct > 80 ? '#ff3b3b' : pct > 60 ? '#f59e0b' : '#22c55e';
                const imbalanced = r.imbalance_ratio > 3;
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                    onClick={() => navigate(`/interfaces/${r.id}`)}>
                    <div style={{ width: 130, flexShrink: 0 }}>
                      <Text style={{ color: '#e2e8f0', fontSize: 12 }}>{r.name}</Text>
                      {r.link_type && (
                        <Tag color={LINK_TYPE_COLORS[r.link_type] ?? 'default'} style={{ fontSize: 10, marginLeft: 4 }}>
                          {r.link_type}
                        </Tag>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <Progress
                        percent={Math.min(pct, 100)}
                        showInfo={false}
                        strokeColor={color}
                        trailColor="#1e2d4a"
                        size="small"
                      />
                    </div>
                    <Text style={{ color, fontFamily: 'monospace', width: 52, textAlign: 'right', flexShrink: 0, fontSize: 12 }}>
                      {pct.toFixed(1)}%
                    </Text>
                    {imbalanced && (
                      <Tooltip title={`Desbalanço IN/OUT: ${r.imbalance_ratio.toFixed(1)}x`}>
                        <Tag color="volcano" style={{ fontSize: 10, flexShrink: 0 }}>⚠ imbal</Tag>
                      </Tooltip>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}

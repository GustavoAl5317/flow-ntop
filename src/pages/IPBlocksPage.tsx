import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Input, Form, Select, Typography, Space, Popconfirm, message, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, DeleteOutlined, RefreshCw } from 'lucide-react';
import {
  getIpBlocks,
  createIpBlock,
  deleteIpBlock,
  getIpBlocksStats,
  type IpBlock,
  type IpBlockStats,
} from '../services/backendApi';

const { Title, Text } = Typography;

const RANGE_OPTIONS = [
  { label: 'Última 1h',      value: 3600 },
  { label: 'Últimas 6h',     value: 6 * 3600 },
  { label: 'Últimas 24h',    value: 24 * 3600 },
  { label: 'Últimos 7 dias', value: 7 * 24 * 3600 },
];

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(2)} ${units[i]}`;
}

interface BlockRow extends IpBlock {
  total_bytes: number;
  total_packets: number;
  total_flows: number;
}

export function IPBlocksPage() {
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [rangeSeconds, setRangeSeconds] = useState(3600);
  const [form] = Form.useForm();
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const epoch_begin = now - rangeSeconds;
      const [{ blocks: bl }, { stats }] = await Promise.all([
        getIpBlocks(),
        getIpBlocksStats({ epoch_begin, epoch_end: now }),
      ]);
      const statsMap = Object.fromEntries(stats.map((s: IpBlockStats) => [s.id, s]));
      setBlocks(bl.map((b: IpBlock) => ({
        ...b,
        total_bytes:   statsMap[b.id]?.total_bytes   ?? 0,
        total_packets: statsMap[b.id]?.total_packets ?? 0,
        total_flows:   statsMap[b.id]?.total_flows   ?? 0,
      })));
    } catch (e: unknown) {
      message.error((e as Error).message ?? 'Erro ao carregar blocos');
    } finally {
      setLoading(false);
    }
  }, [rangeSeconds]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (values: { cidr: string; label: string; customer?: string }) => {
    setAdding(true);
    try {
      await createIpBlock({ cidr: values.cidr.trim(), label: values.label.trim(), customer: values.customer?.trim() || null });
      message.success('Bloco adicionado');
      form.resetFields();
      load();
    } catch (e: unknown) {
      message.error((e as Error).message ?? 'Erro ao adicionar bloco');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteIpBlock(id);
      message.success('Bloco removido');
      load();
    } catch (e: unknown) {
      message.error((e as Error).message ?? 'Erro ao remover bloco');
    }
  };

  const columns: ColumnsType<BlockRow> = [
    {
      title: 'CIDR',
      dataIndex: 'cidr',
      key: 'cidr',
      render: (v: string) => <Tag color="blue" style={{ fontFamily: 'monospace', fontSize: 13 }}>{v}</Tag>,
    },
    {
      title: 'Label',
      dataIndex: 'label',
      key: 'label',
      render: (v: string) => <Text strong style={{ color: '#e2e8f0' }}>{v}</Text>,
    },
    {
      title: 'Cliente',
      dataIndex: 'customer',
      key: 'customer',
      render: (v: string | null) => v ? <Text style={{ color: '#94a3b8' }}>{v}</Text> : <Text style={{ color: '#334155' }}>—</Text>,
    },
    {
      title: 'Total Bytes',
      dataIndex: 'total_bytes',
      key: 'total_bytes',
      align: 'right',
      sorter: (a, b) => a.total_bytes - b.total_bytes,
      defaultSortOrder: 'descend',
      render: (v: number) => <Text style={{ color: '#00c8f0', fontFamily: 'monospace' }}>{formatBytes(v)}</Text>,
    },
    {
      title: 'Fluxos',
      dataIndex: 'total_flows',
      key: 'total_flows',
      align: 'right',
      sorter: (a, b) => a.total_flows - b.total_flows,
      render: (v: number) => <Text style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{v.toLocaleString('pt-BR')}</Text>,
    },
    {
      title: 'Pacotes',
      dataIndex: 'total_packets',
      key: 'total_packets',
      align: 'right',
      sorter: (a, b) => a.total_packets - b.total_packets,
      render: (v: number) => <Text style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{v.toLocaleString('pt-BR')}</Text>,
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      align: 'center',
      render: (_: unknown, row: BlockRow) => (
        <Popconfirm
          title="Remover este bloco?"
          onConfirm={() => handleDelete(row.id)}
          okText="Remover"
          cancelText="Cancelar"
          okButtonProps={{ danger: true }}
        >
          <Button
            type="text"
            icon={<DeleteOutlined size={14} />}
            danger
            size="small"
          />
        </Popconfirm>
      ),
    },
  ];

  return (
    <main style={{ flex: 1, overflow: 'auto', padding: '16px 20px', background: '#060d1f' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ color: '#e2e8f0', margin: 0 }}>Blocos IP Monitorados</Title>
        <Space>
          <Select
            value={rangeSeconds}
            onChange={setRangeSeconds}
            options={RANGE_OPTIONS}
            style={{ width: 150 }}
          />
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

      {/* Add form */}
      <Card
        style={{ background: '#0a1628', border: '1px solid #1e2d4a', marginBottom: 16, borderRadius: 8 }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <Text style={{ color: '#94a3b8', display: 'block', marginBottom: 12 }}>
          Adicionar bloco IP (CIDR)
        </Text>
        <Form form={form} layout="inline" onFinish={handleAdd}>
          <Form.Item
            name="cidr"
            rules={[
              { required: true, message: 'Informe o CIDR' },
              { pattern: /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, message: 'Formato inválido (ex: 192.168.0.0/24)' },
            ]}
          >
            <Input
              placeholder="192.168.0.0/24"
              style={{ width: 180, fontFamily: 'monospace', background: '#060d1f', borderColor: '#1e2d4a', color: '#e2e8f0' }}
            />
          </Form.Item>
          <Form.Item name="label" rules={[{ required: true, message: 'Informe o label' }]}>
            <Input
              placeholder="Label"
              style={{ width: 180, background: '#060d1f', borderColor: '#1e2d4a', color: '#e2e8f0' }}
            />
          </Form.Item>
          <Form.Item name="customer">
            <Input
              placeholder="Cliente (opcional)"
              style={{ width: 180, background: '#060d1f', borderColor: '#1e2d4a', color: '#e2e8f0' }}
            />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={adding}
              icon={<PlusOutlined />}
              style={{ background: '#00c8f0', borderColor: '#00c8f0', color: '#000' }}
            >
              Adicionar
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* Blocks table */}
      <Card
        style={{ background: '#0a1628', border: '1px solid #1e2d4a', borderRadius: 8 }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          columns={columns}
          dataSource={blocks}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
          locale={{ emptyText: <Text style={{ color: '#334155' }}>Nenhum bloco cadastrado</Text> }}
          style={{ background: 'transparent' }}
        />
      </Card>
    </main>
  );
}

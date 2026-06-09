import { useState, useEffect, useCallback } from 'react';
import { Switch, InputNumber, Button, message, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { Gauge, Save, AlertTriangle, History } from 'lucide-react';
import { getThresholds, saveThreshold, getStoredEvents, type Threshold } from '../services/backendApi';
import { getConfig } from '../services/ntopngApi';
import { useDashboardData } from '../hooks/useDashboardData';
import { THRESHOLD_METRICS } from '../hooks/useThresholdDetection';

interface DetectionEvent {
  id: number;
  tstamp: number;
  alert_id: number;
  severity: string;
  score: number;
  proto: string | null;
}

interface RowState {
  metric: string;
  label: string;
  unit: string;
  enabled: boolean;
  warning_value: number | null;
  critical_value: number | null;
  saving: boolean;
}

export function DetectionPage() {
  const ifid = getConfig().ifid;
  const { data, isLive, sources } = useDashboardData();

  const [rows, setRows]   = useState<RowState[]>(
    THRESHOLD_METRICS.map(m => ({
      metric: m.metric, label: m.label, unit: m.unit,
      enabled: false, warning_value: null, critical_value: null, saving: false,
    }))
  );
  const [loading, setLoading] = useState(true);

  const [events, setEvents]   = useState<DetectionEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const results = await Promise.all(
        THRESHOLD_METRICS.map(m => getStoredEvents({ alert_id: m.alertId, limit: 10 }))
      );
      const all = results.flatMap(r => r.records as DetectionEvent[]);
      all.sort((a, b) => b.tstamp - a.tstamp);
      setEvents(all.slice(0, 20));
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getThresholds(ifid);
      const byMetric = new Map<string, Threshold>(res.thresholds.map(t => [t.metric, t]));
      setRows(THRESHOLD_METRICS.map(m => {
        const t = byMetric.get(m.metric);
        return {
          metric: m.metric, label: m.label, unit: m.unit,
          enabled: t ? !!t.enabled : false,
          warning_value: t?.warning_value ?? null,
          critical_value: t?.critical_value ?? null,
          saving: false,
        };
      }));
    } catch {
      message.error('Não foi possível carregar os thresholds salvos.');
    } finally {
      setLoading(false);
    }
  }, [ifid]);

  useEffect(() => { load(); }, [load]);

  function update(metric: string, patch: Partial<RowState>) {
    setRows(prev => prev.map(r => r.metric === metric ? { ...r, ...patch } : r));
  }

  async function save(row: RowState) {
    update(row.metric, { saving: true });
    try {
      await saveThreshold({
        ifid,
        metric: row.metric,
        label: row.label,
        warning_value: row.warning_value,
        critical_value: row.critical_value,
        enabled: row.enabled,
      });
      message.success(`Threshold "${row.label}" salvo.`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Erro ao salvar threshold');
    } finally {
      update(row.metric, { saving: false });
    }
  }

  const currentValues: Record<string, number> = {};
  for (const m of THRESHOLD_METRICS) currentValues[m.metric] = m.getValue(data.summary);

  return (
    <main style={{
      flex: 1, overflowY: 'auto', padding: '16px', minWidth: 0,
      display: 'flex', flexDirection: 'column', gap: '14px',
    }}>
      <div className="rounded-xl p-4" style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg" style={{ background: '#00c8f018' }}>
            <Gauge size={18} style={{ color: '#00c8f0' }} />
          </div>
          <div>
            <h2 className="font-bold text-sm" style={{ color: '#e2e8f0' }}>Módulo de Detecção</h2>
            <p className="text-xs" style={{ color: '#475569' }}>
              Defina limiares (thresholds) para as métricas em tempo real. Quando um valor
              ultrapassar o limiar configurado, um evento de detecção interna é gravado
              automaticamente (fonte: <code className="font-mono" style={{ color: '#00c8f0' }}>internal_threshold</code>).
            </p>
          </div>
        </div>

        {!isLive && (
          <div className="rounded-lg p-2.5 mt-3 flex items-center gap-2"
            style={{ background: '#f59e0b10', border: '1px solid #f59e0b33' }}>
            <AlertTriangle size={13} style={{ color: '#f59e0b' }} />
            <span className="text-xs" style={{ color: '#f59e0b' }}>
              Sem conexão com o ntopng — a avaliação dos thresholds fica pausada até a conexão
              voltar (interface ifid={sources.ifid}).
            </span>
          </div>
        )}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
        <div className="grid" style={{
          display: 'grid',
          gridTemplateColumns: '1.6fr 1fr 1fr 1fr 0.8fr 0.8fr',
          gap: '8px',
          padding: '10px 16px',
          borderBottom: '1px solid #1e2d4a',
          background: '#0a0f1e',
        }}>
          {['Métrica', 'Valor Atual', 'Aviso (≥)', 'Crítico (≥)', 'Ativo', ''].map(h => (
            <span key={h} className="text-xs font-semibold font-mono" style={{ color: '#475569' }}>{h}</span>
          ))}
        </div>

        {rows.map(row => (
          <div key={row.metric} className="grid items-center" style={{
            display: 'grid',
            gridTemplateColumns: '1.6fr 1fr 1fr 1fr 0.8fr 0.8fr',
            gap: '8px',
            padding: '12px 16px',
            borderBottom: '1px solid #1e2d4a55',
          }}>
            <div>
              <p className="text-xs font-semibold" style={{ color: '#e2e8f0' }}>{row.label}</p>
              <p className="text-xs font-mono" style={{ color: '#334155' }}>{row.metric}</p>
            </div>

            <span className="text-xs font-mono" style={{ color: '#00c8f0' }}>
              {loading ? '…' : `${currentValues[row.metric]}${row.unit ? ` ${row.unit}` : ''}`}
            </span>

            <InputNumber
              size="small"
              min={0}
              value={row.warning_value ?? undefined}
              placeholder="—"
              onChange={v => update(row.metric, { warning_value: v ?? null })}
              style={{ width: '100%' }}
            />

            <InputNumber
              size="small"
              min={0}
              value={row.critical_value ?? undefined}
              placeholder="—"
              onChange={v => update(row.metric, { critical_value: v ?? null })}
              style={{ width: '100%' }}
            />

            <Switch
              size="small"
              checked={row.enabled}
              onChange={v => update(row.metric, { enabled: v })}
            />

            <Button
              size="small"
              icon={<Save size={12} />}
              loading={row.saving}
              onClick={() => save(row)}
            >
              Salvar
            </Button>
          </div>
        ))}
      </div>

      <div className="rounded-xl p-4" style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
        <div className="flex items-center gap-2 mb-3">
          <History size={14} style={{ color: '#475569' }} />
          <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Eventos de Detecção</h2>
        </div>
        <Table<DetectionEvent>
          size="small"
          rowKey="id"
          loading={eventsLoading}
          dataSource={events}
          pagination={false}
          locale={{ emptyText: 'Nenhuma detecção registrada ainda' }}
          columns={detectionColumns}
        />
      </div>
    </main>
  );
}

const detectionColumns: ColumnsType<DetectionEvent> = [
  {
    title: 'Horário',
    dataIndex: 'tstamp',
    width: 160,
    render: (v: number) => dayjs.unix(v).format('DD/MM/YYYY HH:mm:ss'),
  },
  {
    title: 'Métrica',
    dataIndex: 'alert_id',
    render: (v: number) => THRESHOLD_METRICS.find(m => m.alertId === v)?.label ?? `#${v}`,
  },
  {
    title: 'Severidade',
    dataIndex: 'severity',
    width: 110,
    render: (v: string) => (
      <Tag color={v === 'critical' ? '#ff3b3b' : '#f59e0b'} style={{ fontSize: 11 }}>
        {v === 'critical' ? 'Crítico' : 'Aviso'}
      </Tag>
    ),
  },
  {
    title: 'Valor',
    dataIndex: 'score',
    width: 100,
  },
];

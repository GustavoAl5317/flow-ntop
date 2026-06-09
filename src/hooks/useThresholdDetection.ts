import { useEffect, useRef } from 'react';
import { getThresholds, saveEventsBulk, type Threshold } from '../services/backendApi';
import type { SummaryStats } from './useDashboardData';

// ─── Metric catalog ───────────────────────────────────────────────────────────
// Synthetic alert_id range reserved for internally-detected events (does not
// collide with ntopng's own alert_id space, which is small integers).
export interface MetricDef {
  metric: string;
  label: string;
  unit: string;
  alertId: number;
  getValue: (s: SummaryStats) => number;
}

export const THRESHOLD_METRICS: MetricDef[] = [
  { metric: 'total_gbps',    label: 'Tráfego Total',        unit: 'Gbps', alertId: 90001, getValue: s => s.totalGbps },
  { metric: 'attack_gbps',   label: 'Volume de Entrada',    unit: 'Gbps', alertId: 90002, getValue: s => s.attackGbps },
  { metric: 'active_events', label: 'Alertas Engajados',    unit: '',     alertId: 90003, getValue: s => s.activeEvents },
];

type Level = 'none' | 'warning' | 'critical';

function levelFor(value: number, t: Threshold): Level {
  if (t.critical_value != null && value >= t.critical_value) return 'critical';
  if (t.warning_value  != null && value >= t.warning_value)  return 'warning';
  return 'none';
}

/**
 * Evaluates configured thresholds against live dashboard metrics and persists
 * a detection event (source: 'internal_threshold') whenever a metric crosses
 * into a worse severity level. De-escalations are tracked silently so the
 * next breach can fire again.
 */
export function useThresholdDetection(summary: SummaryStats, ifid: number, isLive: boolean): void {
  const thresholdsRef = useRef<Threshold[]>([]);
  const ifidRef       = useRef<number | null>(null);
  const levelsRef     = useRef<Map<string, Level>>(new Map());

  // (Re)load thresholds whenever the active interface changes
  useEffect(() => {
    if (!isLive) return;
    if (ifidRef.current === ifid) return;
    ifidRef.current = ifid;
    levelsRef.current = new Map();
    getThresholds(ifid)
      .then(res => { thresholdsRef.current = res.thresholds.filter(t => t.enabled); })
      .catch(() => { thresholdsRef.current = []; });
  }, [ifid, isLive]);

  useEffect(() => {
    if (!isLive || thresholdsRef.current.length === 0) return;

    const tstamp = Math.floor(Date.now() / 1000);
    const breaches: Record<string, unknown>[] = [];

    for (const t of thresholdsRef.current) {
      const def = THRESHOLD_METRICS.find(m => m.metric === t.metric);
      if (!def) continue;

      const value = def.getValue(summary);
      const level = levelFor(value, t);
      const prevLevel = levelsRef.current.get(t.metric) ?? 'none';

      const escalated =
        (prevLevel === 'none' && level !== 'none') ||
        (prevLevel === 'warning' && level === 'critical');

      if (escalated) {
        breaches.push({
          tstamp,
          alert_id: def.alertId,
          severity: level,
          score: Math.round(value),
          duration: 0,
          ip: null,
          cli_ip: null,
          proto: t.label,
          alert_status: 1,
        });
      }

      levelsRef.current.set(t.metric, level);
    }

    if (breaches.length > 0) {
      saveEventsBulk(breaches, 'internal_threshold')
        .catch(() => { /* não crítico: tentaremos novamente na próxima leitura */ });
    }
  }, [summary, isLive]);
}

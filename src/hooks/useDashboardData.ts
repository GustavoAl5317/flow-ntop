import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getInterfaces,
  getInterfaceData,
  getFlowL7Counters,
  getInterfaceL7Stats,
  getActiveHosts,
  getActiveFlows,
} from '../services/ntopngApi';
import type { NtopInterface } from '../types/ntopng';
import type { AttackEvent, TopIP, LinkStatus, OriginCountry } from '../types/dashboard';
import { useInterval } from './useInterval';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TrafficChartData {
  series: { total: number[]; attack: number[]; clean: number[] };
  labels: string[];
  peakGbps: number;
}
export interface ProtocolEntry { name: string; value: number }
export interface SummaryStats {
  totalGbps: number; attackGbps: number; activeEvents: number;
  mitigatedToday: number; topAttackGbps: number; blockedIPs: number;
  affectedClients: number; mitigationRate: number;
}
export interface DashboardData {
  summary: SummaryStats; traffic: TrafficChartData;
  events: AttackEvent[]; protocols: ProtocolEntry[];
  topIPs: TopIP[]; links: LinkStatus[]; origins: OriginCountry[];
  activeAlerts: number; mitigatingAlerts: number;
}

export interface DataSources {
  interfaces: 'live' | 'error';
  timeseries:  'computed' | 'pending' | 'error';
  alerts:      'disabled';
  l4counters:  'disabled';
  topTalkers:  'disabled';
  protocols:   'live' | 'empty';
  topIPs:      'live' | 'empty';
  events:      'live' | 'empty';
  ifid: number;
  ifname: string;
  pointsCollected: number;
}

export interface DashboardState {
  data: DashboardData; loading: boolean;
  error: string | null; isLive: boolean; lastUpdated: Date | null;
  sources: DataSources;
  rawIface: object | null;
  rawTs:    object | null;
}

// ─── History point ────────────────────────────────────────────────────────────

interface TrafficPoint {
  totalGbps: number;
  rcvdGbps:  number;
  sentGbps:  number;
  label:     string;
  epochMs:   number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const r1   = (n: number) => Math.round(n * 10) / 10;
const bpsG = (bps: number) => r1(bps / 1e9);

function nowLabel() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ─── Data mapping: L7 → ProtocolEntry[] ──────────────────────────────────────

function mapL7ToProtocols(raw: unknown): ProtocolEntry[] | null {
  try {
    if (!raw) return null;
    let entries: ProtocolEntry[];

    if (Array.isArray(raw)) {
      if (raw.length === 0) return [];
      entries = (raw as Array<Record<string, unknown>>)
        .filter(item => item.name)
        .map(item => ({
          name:  String(item.name),
          value: Number(item.bytes ?? item.value ?? item.num_flows ?? 0),
        }));
    } else if (typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      // Chart format from /interface/l7/stats.lua
      if (Array.isArray(obj.labels) && Array.isArray(obj.series)) {
        const labels = obj.labels as string[];
        const series = obj.series as number[];
        if (labels[0] === 'No Flows') return [];
        entries = labels.map((name, i) => ({ name, value: Number(series[i] ?? 0) }));
      } else {
        entries = Object.entries(obj).map(([name, v]) => ({
          name,
          value: Number(
            typeof v === 'number'
              ? v
              : ((v as Record<string, unknown>)?.bytes ?? (v as Record<string, unknown>)?.num_flows ?? 0)
          ),
        }));
      }
    } else {
      return null;
    }

    return entries
      .filter(e => e.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  } catch {
    return null;
  }
}

// ─── Data mapping: active hosts → TopIP[] ─────────────────────────────────────

function mapHostsToTopIPs(raw: unknown): TopIP[] | null {
  try {
    if (!raw) return null;

    // ntopng may return { data: [...], totalRows: N } or a flat array
    const list: Array<Record<string, unknown>> = Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
      : ((raw as Record<string, unknown>)?.data as Array<Record<string, unknown>> ?? []);

    if (!list.length) return [];

    return list.slice(0, 8).map(h => {
      // IP: string or nested { ip: string, name: string }
      const rawIp = h.ip;
      const ip = typeof rawIp === 'string'
        ? rawIp
        : (typeof rawIp === 'object' && rawIp !== null)
          ? (String((rawIp as Record<string, unknown>).ip ?? (rawIp as Record<string, unknown>).name ?? 'N/A'))
          : String(h.name ?? 'N/A');

      // ntopng REST v2 uses dot-notation keys: "bytes.sent", "bytes.rcvd"
      const bytesSent = Number(h['bytes.sent'] ?? h.bytes_sent ?? 0);
      const bytesRcvd = Number(h['bytes.rcvd'] ?? h.bytes_rcvd ?? 0);
      const pktsSent  = Number(h['pkts.sent']  ?? h.pkts_sent  ?? 0);
      const pktsRcvd  = Number(h['pkts.rcvd']  ?? h.pkts_rcvd  ?? 0);

      return {
        ip,
        country:     String(h.country ?? 'N/A'),
        countryCode: String(h.country_code ?? h.countryCode ?? '??'),
        gbps:     r1((bytesSent + bytesRcvd) * 8 / 1e9),
        packets:  pktsSent + pktsRcvd,
        protocol: String(h['ndpi.proto'] ?? h.proto ?? h.l7_proto ?? 'TCP'),
      } satisfies TopIP;
    });
  } catch {
    return null;
  }
}

// ─── Data mapping: active flows → AttackEvent[] ───────────────────────────────

function fmtDuration(firstSeen: number, lastSeen: number): string {
  const secs = Math.max(0, lastSeen - firstSeen);
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`;
  if (secs >= 60)   return `${Math.floor(secs / 60)}m${secs % 60}s`;
  return `${secs}s`;
}

function mapFlowsToEvents(raw: unknown): AttackEvent[] | null {
  try {
    if (!raw) return null;

    const list: Array<Record<string, unknown>> = Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
      : ((raw as Record<string, unknown>)?.data as Array<Record<string, unknown>> ?? []);

    if (!list.length) return [];

    return list.slice(0, 15).map((f, i) => {
      // ntopng active flows use dot-notation: "cli.ip", "srv.ip", "proto.l4", "proto.ndpi"
      const srvIP = String(f['srv.ip'] ?? (f.srv as Record<string,unknown>)?.ip ?? 'N/A');
      const l4    = String(f['proto.l4'] ?? (f.proto as Record<string,unknown>)?.l4 ?? 'TCP');
      const ndpi  = String(f['proto.ndpi'] ?? (f.proto as Record<string,unknown>)?.ndpi ?? '');

      const c2sBytes = Number(f['cli2srv.bytes'] ?? f.cli2srv_bytes ?? 0);
      const s2cBytes = Number(f['srv2cli.bytes'] ?? f.srv2cli_bytes ?? 0);
      const bytes    = c2sBytes + s2cBytes || Number(f.bytes ?? 0);
      const score    = Number(f.score ?? 0);

      const firstSeen = Number(f.first_seen ?? f['seen.first'] ?? 0);
      const lastSeen  = Number(f.last_seen  ?? f['seen.last']  ?? firstSeen);

      let startedAt = '--:--';
      if (firstSeen > 0) {
        const d = new Date(firstSeen * 1000);
        startedAt = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }

      const asnRaw  = f['cli.asn_name'] ?? f['cli.asname'] ?? f['cli.asn'] ?? '';
      const asnName = String(asnRaw || 'N/A');

      return {
        id:       `FLOW-${f.key ?? i}`,
        target:   srvIP,
        type:     ndpi ? `${ndpi}/${l4}` : `${l4} Flow`,
        protocol: l4,
        gbps:     r1(bytes * 8 / 1e9),
        mpps:     0,
        status:   score > 100 ? 'active' : score > 30 ? 'mitigating' : 'mitigated',
        startedAt,
        duration: firstSeen > 0 ? fmtDuration(firstSeen, lastSeen) : '0s',
        asn:      asnName,
      } satisfies AttackEvent;
    });
  } catch {
    return null;
  }
}

// ─── Transform interface list → link statuses ─────────────────────────────────

function xInterfaces(ifaces: NtopInterface[], sentGbps: number, rcvdGbps: number): LinkStatus[] {
  return ifaces.filter(i => !i.is_loopback).slice(0, 6).map(i => {
    const cap    = Math.max(1, Math.round((i.speed ?? 1000) / 1000));
    const usage  = Math.min(cap, r1(sentGbps + rcvdGbps));
    const attack = Math.min(usage, r1(rcvdGbps));
    return { name: i.ifname, capacity: cap, usage, attackLoad: attack };
  });
}

// ─── Build chart data from rolling history ─────────────────────────────────────

function buildTrafficChart(history: TrafficPoint[]): TrafficChartData {
  if (history.length === 0) {
    return { series: { total: [], attack: [], clean: [] }, labels: [], peakGbps: 0 };
  }
  const total  = history.map(p => p.totalGbps);
  const attack = history.map(p => p.rcvdGbps);
  const clean  = history.map(p => p.sentGbps);
  const labels = history.map(p => p.label);
  return { series: { total, attack, clean }, labels, peakGbps: Math.max(...total, 0) };
}

// ─── Statics ─────────────────────────────────────────────────────────────────

const EMPTY_CHART: TrafficChartData = {
  series: { total: [], attack: [], clean: [] }, labels: [], peakGbps: 0,
};

const EMPTY_DATA: DashboardData = {
  summary: {
    totalGbps: 0, attackGbps: 0, activeEvents: 0,
    mitigatedToday: 0, topAttackGbps: 0, blockedIPs: 0,
    affectedClients: 0, mitigationRate: 0,
  },
  traffic:  EMPTY_CHART,
  events:   [],
  protocols: [],
  topIPs:   [],
  links:    [],
  origins:  [],
  activeAlerts: 0, mitigatingAlerts: 0,
};

const INITIAL_SOURCES: DataSources = {
  interfaces: 'error', timeseries: 'pending', alerts: 'disabled',
  l4counters: 'disabled', topTalkers: 'disabled',
  protocols: 'empty', topIPs: 'empty', events: 'empty',
  ifid: 0, ifname: '-', pointsCollected: 0,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDashboardData(): DashboardState & { refresh: () => void } {
  const pollMs = Number(import.meta.env.VITE_POLL_INTERVAL_MS ?? 30_000);

  const [state, setState] = useState<DashboardState>({
    data: EMPTY_DATA, loading: true, error: null, isLive: false, lastUpdated: null,
    sources: INITIAL_SOURCES, rawIface: null, rawTs: null,
  });

  const historyRef   = useRef<TrafficPoint[]>([]);
  const prevBytesRef = useRef<{ sent: number; rcvd: number; epochMs: number } | null>(null);

  const fetchAll = useCallback(async () => {
    setState(prev => ({ ...prev, loading: !prev.isLive }));

    try {
      // ── 1. Interfaces (required — provides ifid + byte counters) ──────────
      const allIfaces = await getInterfaces();
      console.debug('[FLOW] interfaces:', allIfaces);

      const usable     = allIfaces.filter(i => !i.is_loopback);
      const fallbackId = Number(localStorage.getItem('ntopng_ifid') ?? import.meta.env.VITE_NTOPNG_IFID ?? 0);
      const ifaceList: NtopInterface | null = usable[0] ?? null;
      const primaryId  = ifaceList?.id ?? fallbackId;

      // ── 2. Full interface stats (bytes, throughput, alerts) ─────────────
      let iface: NtopInterface | null = ifaceList;
      try {
        iface = await getInterfaceData(primaryId);
      } catch {
        console.warn('[FLOW] getInterfaceData failed, using interfaces list');
      }

      const bytesSent = iface?.bytes?.sent ?? 0;
      const bytesRcvd = iface?.bytes?.rcvd ?? 0;
      const nowMs     = Date.now();

      let sentGbps = bpsG(iface?.throughput_bps ?? 0) / 2;
      let rcvdGbps = bpsG(iface?.throughput_bps ?? 0) / 2;

      // Use throughput breakdown when available
      const tp = (iface as unknown as Record<string, unknown> | null)?.throughput as
        { upload?: { bps?: number }; download?: { bps?: number } } | undefined;
      if (tp?.upload?.bps || tp?.download?.bps) {
        sentGbps = bpsG(tp.upload?.bps ?? 0);
        rcvdGbps = bpsG(tp.download?.bps ?? 0);
      }

      const prev = prevBytesRef.current;
      if (prev && (bytesSent > 0 || bytesRcvd > 0)) {
        const dtSec = (nowMs - prev.epochMs) / 1000;
        if (dtSec > 1) {
          const dSent = Math.max(0, bytesSent - prev.sent);
          const dRcvd = Math.max(0, bytesRcvd - prev.rcvd);
          if (dSent < 1e12 && dRcvd < 1e12) {
            sentGbps = r1(dSent * 8 / dtSec / 1e9);
            rcvdGbps = r1(dRcvd * 8 / dtSec / 1e9);
          }
        }
      }
      if (bytesSent > 0 || bytesRcvd > 0) {
        prevBytesRef.current = { sent: bytesSent, rcvd: bytesRcvd, epochMs: nowMs };
      }

      const totalGbps = r1(sentGbps + rcvdGbps);

      const point: TrafficPoint = { totalGbps, sentGbps, rcvdGbps, label: nowLabel(), epochMs: nowMs };
      const history = historyRef.current;
      if (history.length === 0 || history[history.length - 1].label !== point.label) {
        history.push(point);
        if (history.length > 60) history.shift();
      }
      console.debug(`[FLOW] throughput: total=${totalGbps} Gbps sent=${sentGbps} rcvd=${rcvdGbps} pts=${history.length}`);

      const chart      = buildTrafficChart(history);
      const hasHistory = history.length > 0;

      // ── 3. Secondary endpoints — all in parallel, failures are silent ─────
      const [l7Res, hostsRes, flowsRes] = await Promise.allSettled([
        // Try flow-level L7 counters; if disabled, fallback to interface L7 stats
        getFlowL7Counters(primaryId).catch(() => getInterfaceL7Stats(primaryId)),
        getActiveHosts(primaryId, 8),
        getActiveFlows(primaryId, 20),
      ]);

      // Log raw responses for debugging
      if (l7Res.status === 'fulfilled')    console.debug('[FLOW] l7:', l7Res.value);
      else                                  console.warn('[FLOW] l7 failed:', l7Res.reason);
      if (hostsRes.status === 'fulfilled') console.debug('[FLOW] hosts:', hostsRes.value);
      else                                  console.warn('[FLOW] hosts failed:', hostsRes.reason);
      if (flowsRes.status === 'fulfilled') console.debug('[FLOW] flows:', flowsRes.value);
      else                                  console.warn('[FLOW] flows failed:', flowsRes.reason);

      // Map to typed domain objects (null = no data available)
      const liveProtocols = l7Res.status === 'fulfilled'
        ? mapL7ToProtocols(l7Res.value) : null;

      const liveTopIPs = hostsRes.status === 'fulfilled'
        ? mapHostsToTopIPs(hostsRes.value) : null;

      const liveEvents = flowsRes.status === 'fulfilled'
        ? mapFlowsToEvents(flowsRes.value) : null;

      const connected = iface !== null;

      const protocols  = liveProtocols ?? [];
      const topIPs     = liveTopIPs    ?? [];
      const events     = liveEvents    ?? [];

      // ── 4. Summary ────────────────────────────────────────────────────────
      const summary: SummaryStats = {
        totalGbps,
        attackGbps:     rcvdGbps,
        topAttackGbps:  chart.peakGbps,
        activeEvents:   iface?.engaged_alerts ?? 0,
        mitigatedToday: iface?.alerts_stored  ?? 0,
        blockedIPs:     iface?.num_hosts      ?? 0,
        affectedClients: iface?.num_local_hosts ?? 0,
        mitigationRate: (iface?.engaged_alerts ?? 0) > 0 ? 0 : 100,
      };

      const sources: DataSources = {
        interfaces:      connected ? 'live'     : 'error',
        timeseries:      hasHistory ? 'computed' : 'pending',
        alerts:          'disabled',
        l4counters:      'disabled',
        topTalkers:      'disabled',
        protocols:       liveProtocols !== null ? 'live' : 'empty',
        topIPs:          liveTopIPs    !== null ? 'live' : 'empty',
        events:          liveEvents    !== null ? 'live' : 'empty',
        ifid:    primaryId,
        ifname:  iface?.ifname ?? '-',
        pointsCollected: history.length,
      };

      setState({
        data: {
          summary,
          traffic:   hasHistory ? chart : EMPTY_CHART,
          events,
          protocols,
          topIPs,
          links:  connected && usable.length > 0
            ? xInterfaces(usable, sentGbps, rcvdGbps)
            : [],
          origins: [],
          activeAlerts:     iface?.engaged_alerts ?? 0,
          mitigatingAlerts: 0,
        },
        loading: false, error: null,
        isLive:  connected,
        lastUpdated: new Date(),
        sources,
        rawIface: iface as object | null,
        rawTs: {
          note: 'throughput calculado via delta bytes.sent/rcvd',
          history: history.slice(-5),
          l7raw:    l7Res.status    === 'fulfilled' ? l7Res.value    : String((l7Res as PromiseRejectedResult).reason),
          hostsRaw: hostsRes.status === 'fulfilled' ? hostsRes.value : String((hostsRes as PromiseRejectedResult).reason),
          flowsRaw: flowsRes.status === 'fulfilled' ? flowsRes.value : String((flowsRes as PromiseRejectedResult).reason),
        },
      });

    } catch (err) {
      console.error('[FLOW] fetchAll error:', err);
      setState(prev => ({
        ...prev, loading: false, isLive: false,
        error: err instanceof Error ? err.message : 'Erro de conexão',
      }));
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useInterval(fetchAll, pollMs);

  return { ...state, refresh: fetchAll };
}

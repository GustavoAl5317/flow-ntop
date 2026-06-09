import { useState } from 'react';
import { Bug, ChevronDown, ChevronUp, Wifi, WifiOff, AlertCircle, MinusCircle } from 'lucide-react';
import type { DataSources } from '../hooks/useDashboardData';

interface Props {
  sources: DataSources;
  rawIface: object | null;
  rawTs:    object | null;
}

type Status = 'live' | 'empty' | 'error' | 'disabled' | 'computed' | 'pending';

const STATUS_STYLE: Record<Status, { color: string; bg: string; label: string }> = {
  live:     { color: '#10b981', bg: '#10b98115', label: 'AO VIVO' },
  computed: { color: '#8b5cf6', bg: '#8b5cf615', label: 'CALCULADO' },
  empty:    { color: '#f59e0b', bg: '#f59e0b15', label: 'SEM DADOS' },
  pending:  { color: '#f59e0b', bg: '#f59e0b15', label: 'AGUARDANDO' },
  error:    { color: '#ff3b3b', bg: '#ff3b3b15', label: 'ERRO' },
  disabled: { color: '#475569', bg: '#47556915', label: 'DESABILITADO' },
};

function StatusBadge({ status }: { status: Status }) {
  const s = STATUS_STYLE[status];
  const Icon = status === 'live' ? Wifi
             : status === 'error' ? AlertCircle
             : status === 'disabled' ? MinusCircle
             : WifiOff;
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold font-mono"
      style={{ background: s.bg, color: s.color }}>
      <Icon size={10} />
      {s.label}
    </span>
  );
}

function Row({ label, status, detail }: { label: string; status: Status; detail?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5"
      style={{ borderBottom: '1px solid #1e2d4a1a' }}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono" style={{ color: '#94a3b8', minWidth: 160 }}>{label}</span>
        {detail && <span className="text-xs font-mono" style={{ color: '#475569' }}>{detail}</span>}
      </div>
      <StatusBadge status={status} />
    </div>
  );
}

export function DebugPanel({ sources, rawIface, rawTs }: Props) {
  const [open,    setOpen]    = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: '#0a0f1e', border: '1px solid #1e2d4a' }}>

      {/* Toggle header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 cursor-pointer border-0"
        style={{ background: open ? '#0d1526' : 'transparent' }}
      >
        <div className="flex items-center gap-2">
          <Bug size={13} style={{ color: '#00c8f066' }} />
          <span className="text-xs font-semibold font-mono" style={{ color: '#334155' }}>
            🔍 DIAGNÓSTICO · iface:{' '}
            <span style={{ color: sources.interfaces === 'live' ? '#10b981' : '#f59e0b' }}>
              {sources.ifname || '...'}
            </span>
            {' '}ifid=<span style={{ color: '#00c8f0' }}>{sources.ifid || '?'}</span>
            {' '}· ts:{' '}
            <span style={{ color: sources.timeseries === 'computed' ? '#8b5cf6' : sources.timeseries === 'error' ? '#ff3b3b' : '#f59e0b' }}>
              {STATUS_STYLE[sources.timeseries].label}
            </span>
          </span>
        </div>
        {open ? <ChevronUp size={13} style={{ color: '#475569' }} />
               : <ChevronDown size={13} style={{ color: '#475569' }} />}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {/* Data source table */}
          <div className="mb-3">
            <Row label="/get/ntopng/interfaces.lua"      status={sources.interfaces} detail={sources.interfaces === 'live' ? `ifid=${sources.ifid} · ${sources.ifname}` : undefined} />
            <Row label="Tráfego (delta bytes.sent/rcvd)" status={sources.timeseries} detail={sources.timeseries === 'computed' ? `${sources.pointsCollected} amostras acumuladas` : 'aguardando 2ª leitura'} />
            <Row label="/get/flow/l7/counters.lua"       status={sources.protocols}  detail={sources.protocols  === 'live' ? 'Protocolos ao vivo' : 'sem dados'} />
            <Row label="/get/host/active.lua"            status={sources.topIPs}     detail={sources.topIPs     === 'live' ? 'Hosts ao vivo'     : 'sem dados'} />
            <Row label="/get/flow/active.lua"            status={sources.events}     detail={sources.events     === 'live' ? 'Fluxos ao vivo'    : 'sem dados'} />
            <Row label="/get/flow/alert/list.lua"        status={sources.alerts}     detail="Feature is disabled nesta instância" />
            <Row label="/get/flow/l4/counters.lua"       status={sources.l4counters} detail="Feature is disabled nesta instância" />
            <Row label="/get/interface/top/talkers"      status={sources.topTalkers} detail="not_found nesta instância" />
          </div>

          {/* Legend */}
          <div className="flex gap-3 mb-3 flex-wrap">
            {(Object.entries(STATUS_STYLE) as [Status, typeof STATUS_STYLE[Status]][]).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1 text-xs" style={{ color: v.color }}>
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: v.color }} />
                {v.label} — {k === 'live' ? 'dado real da API' : k === 'computed' ? 'calculado a partir da API' : k === 'error' ? 'falha na chamada' : k === 'pending' ? 'aguardando amostras' : k === 'empty' ? 'sem dados retornados' : 'endpoint indisponível'}
              </span>
            ))}
          </div>

          {/* Raw JSON toggle */}
          <button
            onClick={() => setShowRaw(v => !v)}
            className="text-xs font-mono cursor-pointer border-0 bg-transparent mb-2"
            style={{ color: '#334155' }}
          >
            {showRaw ? '▲ ocultar JSON bruto' : '▼ ver JSON bruto da API'}
          </button>

          {showRaw && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <p className="text-xs mb-1 font-mono" style={{ color: '#475569' }}>getInterfaces() rsp[0]:</p>
                <pre className="text-xs rounded p-2 overflow-auto"
                  style={{ background: '#060b14', color: '#64748b', maxHeight: 180, fontFamily: 'monospace', fontSize: 10 }}>
                  {rawIface ? JSON.stringify(rawIface, null, 2) : 'null'}
                </pre>
              </div>
              <div>
                <p className="text-xs mb-1 font-mono" style={{ color: '#475569' }}>l7/counters (proto):</p>
                <pre className="text-xs rounded p-2 overflow-auto"
                  style={{ background: '#060b14', color: '#64748b', maxHeight: 180, fontFamily: 'monospace', fontSize: 10 }}>
                  {rawTs ? JSON.stringify((rawTs as Record<string, unknown>).l7raw ?? 'sem dado', null, 2) : 'null'}
                </pre>
              </div>
              <div>
                <p className="text-xs mb-1 font-mono" style={{ color: '#475569' }}>host/active (top IPs):</p>
                <pre className="text-xs rounded p-2 overflow-auto"
                  style={{ background: '#060b14', color: '#64748b', maxHeight: 180, fontFamily: 'monospace', fontSize: 10 }}>
                  {rawTs ? JSON.stringify((rawTs as Record<string, unknown>).hostsRaw ?? 'sem dado', null, 2) : 'null'}
                </pre>
              </div>
              <div>
                <p className="text-xs mb-1 font-mono" style={{ color: '#475569' }}>flow/active (eventos):</p>
                <pre className="text-xs rounded p-2 overflow-auto"
                  style={{ background: '#060b14', color: '#64748b', maxHeight: 180, fontFamily: 'monospace', fontSize: 10 }}>
                  {rawTs ? JSON.stringify((rawTs as Record<string, unknown>).flowsRaw ?? 'sem dado', null, 2) : 'null'}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

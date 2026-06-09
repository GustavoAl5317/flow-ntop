import type { AttackEvent } from '../types/dashboard';
import { Zap, Shield, CheckCircle } from 'lucide-react';

interface Props {
  events: AttackEvent[];
  isLive: boolean;
}

const statusConfig = {
  active:     { label: 'ATIVO',      color: '#ff3b3b', bg: '#ff3b3b18', Icon: Zap          },
  mitigating: { label: 'MITIGANDO',  color: '#f59e0b', bg: '#f59e0b18', Icon: Shield        },
  mitigated:  { label: 'MITIGADO',   color: '#10b981', bg: '#10b98118', Icon: CheckCircle   },
};

export function AttackEvents({ events, isLive }: Props) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Eventos de Ataque</h2>
          <p className="text-xs" style={{ color: '#475569' }}>Últimas ocorrências detectadas</p>
        </div>
        <span className="text-xs font-mono px-2 py-0.5 rounded-full"
          style={{ background: '#1e2d4a', color: '#94a3b8' }}>
          {events.length} eventos
        </span>
      </div>

      {events.length === 0 ? (
        <p className="text-xs text-center py-6" style={{ color: '#475569' }}>
          {isLive
            ? 'Nenhum flow ativo no momento. Aguardando dados NetFlow do coletor ZMQ.'
            : 'Sem conexão com o ntopng. Configure a conexão para ver eventos reais.'}
        </p>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid #1e2d4a' }}>
              {['ID', 'Alvo', 'Tipo', 'Protocolo', 'Volume', 'Mpps', 'Status', 'Início', 'Duração'].map(h => (
                <th key={h} className="text-left pb-2 pr-4 font-medium uppercase tracking-wider"
                  style={{ color: '#475569' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((ev, i) => {
              const { label, color, bg, Icon } = statusConfig[ev.status];
              return (
                <tr
                  key={ev.id}
                  className="transition-colors cursor-default"
                  style={{ borderBottom: i < events.length - 1 ? '1px solid #1e2d4a55' : 'none' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#131c33')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td className="py-2.5 pr-4 font-mono" style={{ color: '#00c8f0' }}>{ev.id}</td>
                  <td className="py-2.5 pr-4 font-mono" style={{ color: '#e2e8f0' }}>{ev.target}</td>
                  <td className="py-2.5 pr-4"           style={{ color: '#94a3b8' }}>{ev.type}</td>
                  <td className="py-2.5 pr-4">
                    <span className="font-mono px-1.5 py-0.5 rounded text-xs"
                      style={{ background: '#1e2d4a', color: '#94a3b8' }}>{ev.protocol}</span>
                  </td>
                  <td className="py-2.5 pr-4 font-mono font-bold"
                    style={{ color: ev.gbps > 30 ? '#ff3b3b' : ev.gbps > 10 ? '#f59e0b' : '#10b981' }}>
                    {ev.gbps.toFixed(1)} Gbps
                  </td>
                  <td className="py-2.5 pr-4 font-mono" style={{ color: '#94a3b8' }}>{ev.mpps.toFixed(1)}</td>
                  <td className="py-2.5 pr-4">
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full w-fit"
                      style={{ background: bg, color }}>
                      <Icon size={10} />
                      <span className="font-semibold">{label}</span>
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 font-mono" style={{ color: '#64748b' }}>{ev.startedAt}</td>
                  <td className="py-2.5     font-mono"  style={{ color: '#64748b' }}>{ev.duration}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

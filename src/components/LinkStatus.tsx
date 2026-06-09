import type { LinkStatus as LinkStatusType } from '../types/dashboard';

interface Props {
  data: LinkStatusType[];
  isLive: boolean;
}

function getLinkColor(pct: number): string {
  if (pct >= 85) return '#ff3b3b';
  if (pct >= 70) return '#f59e0b';
  return '#10b981';
}

export function LinkStatus({ data, isLive }: Props) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Status dos Enlaces</h2>
        <p className="text-xs" style={{ color: '#475569' }}>Consumo atual · Capacidade total</p>
      </div>

      {data.length === 0 ? (
        <p className="text-xs text-center py-6" style={{ color: '#475569' }}>
          {isLive
            ? 'Nenhuma interface monitorada'
            : 'Sem conexão com o ntopng. Configure a conexão para ver enlaces reais.'}
        </p>
      ) : (
      <div className="flex flex-col gap-3">
        {data.map(link => {
          const pct    = link.capacity > 0 ? (link.usage / link.capacity) * 100 : 0;
          const color  = getLinkColor(pct);
          const atkPct = link.capacity > 0 ? (link.attackLoad / link.capacity) * 100 : 0;
          return (
            <div key={link.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono" style={{ color: '#94a3b8' }}>{link.name}</span>
                <div className="flex items-center gap-3">
                  {link.attackLoad > 0 && (
                    <span className="text-xs font-mono" style={{ color: '#ff3b3b' }}>
                      ↑ {link.attackLoad}G ataque
                    </span>
                  )}
                  <span className="text-xs font-mono font-bold" style={{ color }}>
                    {link.usage}G <span style={{ color: '#334155' }}>/ {link.capacity}G</span>
                  </span>
                </div>
              </div>
              <div className="relative h-2 rounded-full overflow-hidden" style={{ background: '#1e2d4a' }}>
                {/* total usage dim bar */}
                <div className="absolute left-0 top-0 h-full rounded-full"
                  style={{ width: `${pct}%`, background: color, opacity: 0.3 }} />
                {/* attack segment */}
                {link.attackLoad > 0 && (
                  <div className="absolute top-0 h-full"
                    style={{
                      left:       `${Math.max(0, pct - atkPct)}%`,
                      width:      `${atkPct}%`,
                      background: '#ff3b3b',
                    }} />
                )}
                {/* clean traffic */}
                <div className="absolute left-0 top-0 h-full rounded-full"
                  style={{
                    width:      `${Math.max(0, pct - atkPct)}%`,
                    background: color,
                  }} />
              </div>
            </div>
          );
        })}
      </div>
      )}

      <div className="flex items-center gap-4 mt-3 pt-3" style={{ borderTop: '1px solid #1e2d4a' }}>
        <LegendItem color="#10b981" label="Limpo"    />
        <LegendItem color="#ff3b3b" label="Ataque"   />
        <LegendItem color="#f59e0b" label="Saturação"/>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      <span className="text-xs" style={{ color: '#475569' }}>{label}</span>
    </div>
  );
}

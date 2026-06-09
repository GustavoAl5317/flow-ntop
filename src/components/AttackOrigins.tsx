import type { OriginCountry } from '../types/dashboard';

interface Props {
  data: OriginCountry[];
  isLive: boolean;
}

function getFlagEmoji(code: string): string {
  if (code === '--') return '🌐';
  const codePoints = code.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export function AttackOrigins({ data, isLive }: Props) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Origens dos Ataques</h2>
        <p className="text-xs" style={{ color: '#475569' }}>Por país de origem · Hoje</p>
      </div>

      {data.length === 0 ? (
        <p className="text-xs text-center py-6" style={{ color: '#475569' }}>
          {isLive
            ? 'Sem origens de ataque identificadas'
            : 'Sem conexão com o ntopng. Configure a conexão para ver origens reais.'}
        </p>
      ) : (
      <div className="flex flex-col gap-2.5">
        {data.map(c => (
          <div key={c.country} className="flex items-center gap-3">
            <span className="text-sm w-6" title={c.country}>{getFlagEmoji(c.countryCode)}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs" style={{ color: '#94a3b8' }}>{c.country}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono" style={{ color: '#475569' }}>{c.attacks} eventos</span>
                  <span className="text-xs font-mono font-bold" style={{ color: '#e2e8f0' }}>{c.gbps} Gbps</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1e2d4a' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${c.percentage}%`,
                    background: c.percentage > 25
                      ? 'linear-gradient(90deg, #ff3b3b, #ff6b6b)'
                      : c.percentage > 15
                      ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                      : 'linear-gradient(90deg, #00c8f0, #00d4ff)',
                  }}
                />
              </div>
            </div>
            <span className="text-xs font-mono w-8 text-right" style={{ color: '#334155' }}>
              {c.percentage}%
            </span>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

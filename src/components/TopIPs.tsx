import type { TopIP } from '../types/dashboard';

interface Props {
  data: TopIP[];
  isLive: boolean;
}

export function TopIPs({ data, isLive }: Props) {
  const maxGbps = Math.max(...data.map(ip => ip.gbps), 1);

  return (
    <div className="rounded-xl p-4" style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>Top IPs Atacantes</h2>
        <p className="text-xs" style={{ color: '#475569' }}>Maiores volumes de tráfego malicioso</p>
      </div>

      {data.length === 0 ? (
        <p className="text-xs text-center py-6" style={{ color: '#475569' }}>
          {isLive
            ? 'Nenhum host ativo detectado'
            : 'Sem conexão com o ntopng. Configure a conexão para ver hosts reais.'}
        </p>
      ) : (
      <div className="flex flex-col gap-2">
        {data.map((ip, i) => (
          <div key={ip.ip} className="flex items-center gap-3">
            <span className="text-xs w-4 text-right font-mono" style={{ color: '#334155' }}>{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs" style={{ color: '#00c8f0' }}>{ip.ip}</span>
                  <span className="text-xs px-1 rounded" style={{ background: '#1e2d4a', color: '#64748b' }}>
                    {ip.countryCode}
                  </span>
                  <span className="text-xs px-1 rounded" style={{ background: '#1e2d4a55', color: '#475569' }}>
                    {ip.protocol}
                  </span>
                </div>
                <span className="font-mono text-xs font-bold" style={{ color: '#ff3b3b' }}>
                  {ip.gbps.toFixed(1)} Gbps
                </span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: '#1e2d4a' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(ip.gbps / maxGbps) * 100}%`,
                    background: i === 0
                      ? 'linear-gradient(90deg, #ff3b3b, #ff6b6b)'
                      : i <= 2
                      ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                      : 'linear-gradient(90deg, #00c8f0, #00d4ff55)',
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

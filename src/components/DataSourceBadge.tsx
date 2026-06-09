import { Database, Wifi, WifiOff, RefreshCw } from 'lucide-react';

interface Props {
  isLive:      boolean;
  loading:     boolean;
  error:       string | null;
  lastUpdated: Date | null;
  onRefresh?:  () => void;
}

export function DataSourceBadge({ isLive, loading, error, lastUpdated, onRefresh }: Props) {
  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md"
        style={{ background: '#00c8f018', border: '1px solid #00c8f033' }}>
        <RefreshCw size={10} style={{ color: '#00c8f0' }} className="animate-spin" />
        <span className="text-xs font-mono" style={{ color: '#00c8f0' }}>CONECTANDO…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer"
        style={{ background: '#ff3b3b18', border: '1px solid #ff3b3b33' }}
        title={error}
        onClick={onRefresh}
      >
        <WifiOff size={10} style={{ color: '#ff3b3b' }} />
        <span className="text-xs font-mono" style={{ color: '#ff3b3b' }}>ERRO API</span>
        <span className="text-xs font-mono" style={{ color: '#ff3b3b88' }}>↺</span>
      </div>
    );
  }

  if (isLive && lastUpdated) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer"
        style={{ background: '#10b98118', border: '1px solid #10b98133' }}
        onClick={onRefresh}
        title="Dados ao vivo · Clique para atualizar"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
            style={{ background: '#10b981' }} />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: '#10b981' }} />
        </span>
        <Wifi size={10} style={{ color: '#10b981' }} />
        <span className="text-xs font-mono" style={{ color: '#10b981' }}>LIVE</span>
        <span className="text-xs font-mono" style={{ color: '#47556988' }}>
          {lastUpdated.toLocaleTimeString('pt-BR', {
            hour:   '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
      </div>
    );
  }

  // Not connected to ntopng
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md"
      style={{ background: '#47556918', border: '1px solid #47556933' }}>
      <Database size={10} style={{ color: '#94a3b8' }} />
      <span className="text-xs font-mono" style={{ color: '#94a3b8' }}>OFFLINE</span>
    </div>
  );
}

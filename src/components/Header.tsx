import { useState, useEffect } from 'react';
import { Shield, AlertTriangle, Clock, LogOut, User } from 'lucide-react';
import { DataSourceBadge } from './DataSourceBadge';
import { useAuth } from '../context/AuthContext';

interface Props {
  activeAlerts?:     number;
  mitigatingAlerts?: number;
  isLive?:           boolean;
  loading?:          boolean;
  error?:            string | null;
  lastUpdated?:      Date | null;
  onRefresh?:        () => void;
}

export function Header({
  activeAlerts     = 3,
  mitigatingAlerts = 2,
  isLive           = false,
  loading          = false,
  error            = null,
  lastUpdated      = null,
  onRefresh,
}: Props) {
  const { user, logout, backendOnline } = useAuth();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeStr = time.toLocaleTimeString('pt-BR',  { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = time.toLocaleDateString('pt-BR',  { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

  const alertLevel =
    activeAlerts > 5 ? { label: 'CRÍTICO', color: '#ff3b3b' } :
    activeAlerts > 2 ? { label: 'ALTO',    color: '#ff3b3b' } :
    activeAlerts > 0 ? { label: 'MÉDIO',   color: '#f59e0b' } :
                       { label: 'BAIXO',   color: '#10b981' };

  return (
    <header style={{ background: '#0a0f1e', borderBottom: '1px solid #1e2d4a' }}
      className="px-6 py-3 flex items-center justify-between">

      {/* Brand */}
      <div className="flex items-center gap-3">
        <div style={{ background: 'linear-gradient(135deg, #0099bb 0%, #00d4ff 100%)' }}
          className="p-2 rounded-lg">
          <Shield size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold tracking-wide" style={{ color: '#e2e8f0', margin: 0 }}>
            FLOW <span style={{ color: '#00c8f0' }}>GUARD</span>
          </h1>
          <p className="text-xs" style={{ color: '#475569', margin: 0 }}>Painel de Monitoramento DDoS</p>
        </div>
      </div>

      {/* Status + controls */}
      <div className="flex items-center gap-6">

        {/* Data-source badge */}
        <DataSourceBadge
          isLive={isLive}
          loading={loading}
          error={error}
          lastUpdated={lastUpdated}
          onRefresh={onRefresh}
        />

        {/* Attack status badges */}
        <div className="flex items-center gap-4">
          <StatusBadge
            color="#ff3b3b"
            label={`${activeAlerts} Ataque${activeAlerts !== 1 ? 's' : ''} Ativo${activeAlerts !== 1 ? 's' : ''}`}
            pulse={activeAlerts > 0}
          />
          <StatusBadge
            color="#f59e0b"
            label={`${mitigatingAlerts} Em Mitigação`}
          />
          <StatusBadge color="#10b981" label="Infraestrutura OK" />
        </div>

        {/* Alert level */}
        <div className="flex items-center gap-2" style={{ color: '#475569' }}>
          <AlertTriangle size={14} />
          <span className="text-xs font-mono">
            Nível: <span style={{ color: alertLevel.color }} className="font-bold">{alertLevel.label}</span>
          </span>
        </div>

        {/* Clock */}
        <div className="flex items-center gap-2" style={{ color: '#475569' }}>
          <Clock size={14} />
          <div className="text-right">
            <div className="text-xs font-mono" style={{ color: '#94a3b8' }}>{timeStr}</div>
            <div className="text-xs capitalize"   style={{ color: '#475569'  }}>{dateStr}</div>
          </div>
        </div>

        {backendOnline && user && (
          <div className="flex items-center gap-2" style={{ borderLeft: '1px solid #1e2d4a', paddingLeft: 16 }}>
            <User size={14} style={{ color: '#64748b' }} />
            <span className="text-xs" style={{ color: '#94a3b8' }}>{user.username}</span>
            <button
              onClick={logout}
              title="Sair"
              className="p-1.5 rounded-lg border-0 cursor-pointer"
              style={{ background: 'transparent', color: '#475569' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#ff3b3b')}
              onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function StatusBadge({ color, label, pulse }: { color: string; label: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        {pulse && (
          <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
            style={{ background: color }} />
        )}
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
      </span>
      <span className="text-xs" style={{ color: '#94a3b8' }}>{label}</span>
    </div>
  );
}

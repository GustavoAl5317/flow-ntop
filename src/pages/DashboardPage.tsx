import { useState } from 'react';
import { StatCard }      from '../components/StatCard';
import { TrafficChart }  from '../components/TrafficChart';
import { AttackEvents }  from '../components/AttackEvents';
import { ProtocolChart } from '../components/ProtocolChart';
import { TopIPs }        from '../components/TopIPs';
import { LinkStatus }    from '../components/LinkStatus';
import { AttackOrigins } from '../components/AttackOrigins';
import { ConfigPanel }   from '../components/ConfigPanel';
import { DebugPanel }    from '../components/DebugPanel';
import { useDashboardData } from '../hooks/useDashboardData';
import {
  Activity, AlertTriangle, ShieldCheck, Zap,
  Users, WifiOff, TrendingUp, Shield,
} from 'lucide-react';

export function DashboardPage() {
  const [showConfig, setShowConfig] = useState(false);

  const {
    data, isLive,
    refresh, sources, rawIface, rawTs,
  } = useDashboardData();

  const s = data.summary;

  const offline = !isLive ? 'Sem conexão com o ntopng' : undefined;

  return (
    <main style={{
      flex: 1, overflowY: 'auto', padding: '16px', minWidth: 0,
      display: 'flex', flexDirection: 'column', gap: '14px',
    }}>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <StatCard
          label="Tráfego Total"
          value={`${s.totalGbps} Gbps`}
          sub={offline ?? (s.totalGbps > 0 ? 'Dados ao vivo' : 'Aguardando NetFlow')}
          icon={Activity} color="#00c8f0" trend="up"
        />
        <StatCard
          label="Volume de Ataque"
          value={`${s.attackGbps} Gbps`}
          sub={offline ?? (s.totalGbps > 0
            ? `${Math.round((s.attackGbps / s.totalGbps) * 100)}% do tráfego total`
            : 'sem ataque ativo')}
          icon={Zap} color="#ff3b3b" trend="up"
        />
        <StatCard
          label="Eventos Ativos"
          value={s.activeEvents.toString()}
          sub={offline ?? `${s.activeEvents} alerta(s) engajado(s)`}
          icon={AlertTriangle} color="#f59e0b" trend="up"
        />
        <StatCard
          label="Mitigados Hoje"
          value={s.mitigatedToday.toString()}
          sub={offline ?? 'Alertas armazenados'}
          icon={ShieldCheck} color="#10b981" trend="down"
        />
        <StatCard
          label="Pico do Ataque"
          value={`${s.topAttackGbps} Gbps`}
          sub={offline ?? 'Pico acumulado na sessão'}
          icon={TrendingUp} color="#ff3b3b"
        />
        <StatCard
          label="Hosts Monitorados"
          value={s.blockedIPs.toLocaleString('pt-BR')}
          sub={offline ?? 'Hosts na interface'}
          icon={Shield} color="#8b5cf6" trend="up"
        />
        <StatCard
          label="Hosts Locais"
          value={s.affectedClients.toString()}
          sub={offline ?? 'Detectados na rede'}
          icon={Users} color="#f59e0b" trend="down"
        />
        <StatCard
          label="Flows Ativos"
          value={String(data.events.length)}
          sub={offline ?? `ifid ${sources.ifid} · ${sources.ifname}`}
          icon={WifiOff} color="#10b981" trend="down"
        />
      </div>

      <DebugPanel sources={sources} rawIface={rawIface} rawTs={rawTs} />

      <TrafficChart data={data.traffic} isLive={isLive} />

      <AttackEvents events={data.events} isLive={isLive} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
        <ProtocolChart  data={data.protocols} isLive={isLive} />
        <TopIPs         data={data.topIPs}    isLive={isLive} />
        <LinkStatus     data={data.links}     isLive={isLive} />
        <AttackOrigins  data={data.origins}   isLive={isLive} />
      </div>


      {showConfig && (
        <ConfigPanel onClose={() => setShowConfig(false)} onSave={refresh} />
      )}
    </main>
  );
}

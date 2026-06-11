import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Zap, Bell, BarChart2, Search, Settings, Gauge, Network } from 'lucide-react';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard',  to: '/'          },
  { icon: Zap,             label: 'Alertas',    to: '/alertas'   },
  { icon: Bell,            label: 'Histórico',  to: '/historico' },
  { icon: Search,          label: 'Consulta',   to: '/consulta'  },
  { icon: BarChart2,       label: 'Relatórios', to: '/relatorios'},
  { icon: Gauge,           label: 'Detecção',   to: '/deteccao'  },
  { icon: Network,         label: 'NetFlow',    to: '/netflow'   },
];

interface Props {
  onSettings?: () => void;
}

export function Sidebar({ onSettings }: Props) {
  return (
    <aside
      className="flex flex-col py-4 gap-1"
      style={{ width: 56, background: '#0a0f1e', borderRight: '1px solid #1e2d4a', flexShrink: 0 }}
    >
      {navItems.map(({ icon: Icon, label, to }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          title={label}
          style={({ isActive }) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '2px 8px',
            padding: 8,
            borderRadius: 8,
            textDecoration: 'none',
            background: isActive ? '#00c8f015' : 'transparent',
            color: isActive ? '#00c8f0' : '#334155',
            transition: 'color 0.15s, background 0.15s',
            border: 'none',
          })}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement;
            if (!el.dataset.active) el.style.color = '#94a3b8';
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement;
            if (!el.dataset.active) el.style.color = '#334155';
          }}
        >
          <Icon size={18} />
        </NavLink>
      ))}

      <div className="flex-1" />

      <button
        title="Configurações da API"
        onClick={onSettings}
        className="mx-2 p-2 rounded-lg flex items-center justify-center transition-all cursor-pointer border-0"
        style={{ background: 'transparent', color: '#334155' }}
        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#00c8f0')}
        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#334155')}
      >
        <Settings size={18} />
      </button>
    </aside>
  );
}

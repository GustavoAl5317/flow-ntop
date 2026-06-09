import type { LucideIcon } from 'lucide-react';

type Props = {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  color: string;
  trend?: 'up' | 'down' | 'neutral';
};

export function StatCard({ label, value, sub, icon: Icon, color, trend }: Props) {
  const trendColor = trend === 'up' ? '#ff3b3b' : trend === 'down' ? '#10b981' : '#94a3b8';

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2 transition-all"
      style={{ background: '#0f1629', border: '1px solid #1e2d4a' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#475569' }}>{label}</span>
        <div className="p-1.5 rounded-lg" style={{ background: `${color}18` }}>
          <Icon size={14} style={{ color }} />
        </div>
      </div>
      <div>
        <span className="text-2xl font-bold font-mono" style={{ color: '#e2e8f0' }}>{value}</span>
        {sub && (
          <p className="text-xs mt-0.5" style={{ color: trendColor }}>{sub}</p>
        )}
      </div>
    </div>
  );
}

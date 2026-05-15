import { MailOpen, MousePointerClick, MailCheck, TrendingUp, ArrowUpRight, Send, Mail } from 'lucide-react';

interface SoloSidebarProps {
  stats: {
    totalCampaigns: number;
    emailsSent: number;
    emailsOpened: number;
    emailsClicked: number;
    openRate: number;
    clickRate: number;
    deliveryRate: number;
    emailsDelivered: number;
  };
  onNavigate: (view: string) => void;
}

function MetricRow({
  label,
  value,
  icon: Icon,
  pct,
  teal,
  onClick,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  pct?: number;
  teal?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-3 px-3 py-1 rounded-xl transition-colors ${
        onClick ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900' : ''
      }`}
      onClick={onClick}
    >
      <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-zinc-400 dark:text-zinc-500 group-hover:text-[#1ED4A7] transition-colors" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
            {label}
          </span>
          <span
            className={`text-sm font-bold tabular-nums ${
              teal ? 'text-[#1ED4A7]' : 'text-zinc-900 dark:text-white'
            }`}
          >
            {value}
          </span>
        </div>
        {pct !== undefined && (
          <div className="h-1.5 bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 rounded-full overflow-hidden mt-0.5">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r from-[#1ED4A7]/60 to-[#1ED4A7]"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function DashboardSoloSidebar({ stats, onNavigate }: SoloSidebarProps) {
  return (
    <div className="glass-card h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-1 flex-shrink-0 flex items-center justify-between">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
          Campaign Pulse
        </h3>
        <button
          onClick={() => onNavigate('campaigns')}
          className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 hover:text-[#1ED4A7] transition-colors"
        >
          View All <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>

      {/* Metrics — fill the card evenly */}
      <div className="flex-1 flex flex-col justify-evenly px-2 pb-3">
        <MetricRow
          label="Campaigns"
          value={stats.totalCampaigns.toLocaleString()}
          icon={TrendingUp}
          onClick={() => onNavigate('campaigns')}
        />
        <MetricRow
          label="Emails Sent"
          value={stats.emailsSent.toLocaleString()}
          icon={Send}
        />
        <MetricRow
          label="Open Rate"
          value={`${stats.openRate.toFixed(1)}%`}
          icon={MailOpen}
          pct={stats.openRate}
          teal={stats.openRate > 25}
        />
        <MetricRow
          label="Click Rate"
          value={`${stats.clickRate.toFixed(1)}%`}
          icon={MousePointerClick}
          pct={stats.clickRate * 3}
          teal={stats.clickRate > 5}
        />
        <MetricRow
          label="Delivered"
          value={stats.emailsDelivered.toLocaleString()}
          icon={Mail}
        />
        <MetricRow
          label="Delivery Rate"
          value={`${stats.deliveryRate.toFixed(1)}%`}
          icon={MailCheck}
          pct={stats.deliveryRate}
          teal={stats.deliveryRate > 90}
        />
      </div>
    </div>
  );
}

import { Mail, MailOpen, MousePointerClick, MailCheck, TrendingUp, ArrowUpRight, Send, Reply } from 'lucide-react';

interface CampaignMetricsProps {
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
      className={`group flex items-center gap-3 py-3 px-3 rounded-xl transition-colors ${
        onClick ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900' : ''
      }`}
      onClick={onClick}
    >
      <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center flex-shrink-0">
        <Icon className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 group-hover:text-[#1ED4A7] transition-colors" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
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
          <div className="h-1 bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 rounded-full overflow-hidden">
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

export function DashboardCampaignMetrics({ stats, onNavigate }: CampaignMetricsProps) {
  return (
    <div className="glass-card p-5 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
          Campaign Performance
        </h3>
        <button
          onClick={() => onNavigate('campaigns')}
          className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 hover:text-[#1ED4A7] transition-colors"
        >
          View All <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>

      {/* Metrics */}
      <div className="flex-1 flex flex-col justify-center -mx-1">
        <MetricRow
          label="Active Campaigns"
          value={stats.totalCampaigns.toLocaleString()}
          icon={TrendingUp}
          onClick={() => onNavigate('campaigns')}
        />
        <MetricRow
          label="Emails Sent"
          value={stats.emailsSent.toLocaleString()}
          icon={Send}
          onClick={() => onNavigate('emails')}
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
          pct={stats.clickRate * 3} /* Scale up for visual weight */
          teal={stats.clickRate > 5}
        />
        <MetricRow
          label="Delivery Rate"
          value={`${stats.deliveryRate.toFixed(1)}%`}
          icon={MailCheck}
          pct={stats.deliveryRate}
          teal={stats.deliveryRate > 90}
        />
      </div>

      {/* Footer links */}
      <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-200 dark:border-zinc-800 flex gap-2">
        <button
          onClick={() => onNavigate('campaigns')}
          className="flex-1 text-[11px] font-medium text-center py-2 rounded-lg bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-100 dark:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-200 dark:hover:border-zinc-200 dark:border-zinc-800"
        >
          Campaigns
        </button>
        <button
          onClick={() => onNavigate('emails')}
          className="flex-1 text-[11px] font-medium text-center py-2 rounded-lg bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-100 dark:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-200 dark:hover:border-zinc-200 dark:border-zinc-800"
        >
          Emails
        </button>
      </div>
    </div>
  );
}

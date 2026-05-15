import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { Activity, Shield, Bot, User, Wifi, AlertTriangle, RefreshCw, ChevronDown, Users, Mail, MailOpen, MousePointerClick, TrendingUp } from 'lucide-react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

interface ProviderData {
  sent: number;
  opened: number;
  clicked: number;
  delivered: number;
  bounced: number;
  openRate: number;
  clickRate: number;
  deliveryRate: number;
  bounceRate: number;
}

interface UserBreakdownEntry {
  userId: string;
  email: string;
  sent: number;
  opened: number;
  clicked: number;
  delivered: number;
  bounced: number;
  openRate: number;
  clickRate: number;
  deliveryRate: number;
}

interface TrackingData {
  providers: Record<string, ProviderData>;
  totals: {
    sent: number;
    opened: number;
    clicked: number;
    delivered: number;
    bounced: number;
    openRate: number;
    clickRate: number;
  };
  botBreakdown: {
    human: number;
    bot: number;
    proxy: number;
  };
  userBreakdown?: UserBreakdownEntry[];
  days: number;
  emailCount: number;
  uniqueUsers?: number;
}

interface TrackingAnalyticsProps {
  adminMode?: boolean;
}

const PROVIDER_COLORS: Record<string, string> = {
  Gmail: '#EA4335',
  Outlook: '#0078D4',
  Resend: '#1ED4A7',
  SMTP: '#F59E0B',
};

const BOT_COLORS = {
  human: '#1ED4A7',
  proxy: '#3B82F6',
  bot: '#EF4444',
};

export function TrackingAnalytics({ adminMode = false }: TrackingAnalyticsProps) {
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [showDaysDropdown, setShowDaysDropdown] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const endpoint = adminMode
    ? `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/tracking-analytics`
    : `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/analytics/tracking-by-provider`;

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authenticatedFetch(`${endpoint}?days=${days}`);
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(errBody || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error('[TrackingAnalytics] Error:', err);
      setError(err.message || 'Failed to load tracking analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [days]);

  // Build chart data
  const providerChartData = data
    ? Object.entries(data.providers)
        .filter(([name]) => name) // filter out null/empty provider names
        .map(([name, stats]) => ({
        name,
        'Open Rate': parseFloat(stats.openRate.toFixed(1)),
        'Click Rate': parseFloat(stats.clickRate.toFixed(1)),
        sent: stats.sent,
        opened: stats.opened,
        clicked: stats.clicked,
        fill: PROVIDER_COLORS[name] || '#8B8B8B',
      }))
    : [];

  const botPieData = data
    ? [
        { name: 'Human', value: data.botBreakdown.human, color: BOT_COLORS.human },
        { name: 'Proxy', value: data.botBreakdown.proxy, color: BOT_COLORS.proxy },
        { name: 'Bot', value: data.botBreakdown.bot, color: BOT_COLORS.bot },
      ].filter(d => d.value > 0)
    : [];

  const totalBotEvents = data
    ? data.botBreakdown.human + data.botBreakdown.proxy + data.botBreakdown.bot
    : 0;

  const hasData = data && data.totals.sent > 0;
  const hasProviders = providerChartData.length > 0;

  // Filter users for admin mode
  const filteredUsers = data?.userBreakdown?.filter(u =>
    u.email.toLowerCase().includes(userSearch.toLowerCase())
  ) || [];

  return (
    <div className={adminMode ? "flex flex-col gap-4" : "glass-card p-6 h-full flex flex-col"}>
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className={`text-sm font-medium ${adminMode ? 'text-zinc-900 dark:text-white' : 'text-zinc-900 dark:text-white'}`}>
            {adminMode ? 'Platform email tracking' : 'Tracking parity'}
          </h3>
          {data && hasData && (
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 rounded-full">
              {data.emailCount.toLocaleString()} emails
            </span>
          )}
          {adminMode && data && data.uniqueUsers && data.uniqueUsers > 0 && (
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 rounded-full">
              {data.uniqueUsers} sender{data.uniqueUsers !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Days selector */}
          <div className="relative">
            <button
              onClick={() => setShowDaysDropdown(!showDaysDropdown)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-800"
            >
              {days}d
              <ChevronDown className="w-3 h-3" />
            </button>
            {showDaysDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowDaysDropdown(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl overflow-hidden min-w-[90px]">
                  {[7, 14, 30, 60, 90].map(d => (
                    <button
                      key={d}
                      onClick={() => { setDays(d); setShowDaysDropdown(false); }}
                      className={`block w-full px-4 py-2 text-xs font-medium text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${
                        days === d ? 'text-[#1ED4A7] bg-[#1ED4A7]/5' : 'text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      {d} days
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            onClick={fetchData}
            disabled={loading}
            className="p-1.5 text-zinc-400 hover:text-[#1ED4A7] transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && !data && (
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw className="w-5 h-5 text-zinc-400 animate-spin" />
            <span className="text-xs text-zinc-500">Loading tracking data...</span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <span className="text-xs text-zinc-500 max-w-[240px]">{error}</span>
            <button onClick={fetchData} className="text-xs text-[#1ED4A7] hover:underline">Retry</button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !hasData && (
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <div className="flex flex-col items-center gap-3 text-center">
            <Activity className="w-6 h-6 text-zinc-400" />
            <div>
              <p className="text-sm font-medium text-zinc-500">No tracking data yet</p>
              <p className="text-xs text-zinc-400 mt-1">
                {adminMode ? 'No emails have been sent by any user in this period' : 'Send emails to see per-provider analytics'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && hasData && (
        <div className="flex flex-col gap-6">
          {/* Admin Summary Stats */}
          {adminMode && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 flex-shrink-0">
              {[
                { label: 'Total Sent', value: data!.totals.sent.toLocaleString(), icon: Mail, color: '' },
                { label: 'Delivered', value: data!.totals.delivered.toLocaleString(), icon: TrendingUp, color: 'text-emerald-600 dark:text-emerald-400' },
                { label: 'Opened', value: data!.totals.opened.toLocaleString(), icon: MailOpen, color: '' },
                { label: 'Clicked', value: data!.totals.clicked.toLocaleString(), icon: MousePointerClick, color: '' },
                { label: 'Open Rate', value: `${data!.totals.openRate.toFixed(1)}%`, icon: Activity, color: data!.totals.openRate >= 20 ? 'text-emerald-600 dark:text-emerald-400' : '' },
                { label: 'Click Rate', value: `${data!.totals.clickRate.toFixed(1)}%`, icon: Activity, color: data!.totals.clickRate >= 3 ? 'text-emerald-600 dark:text-emerald-400' : '' },
              ].map(s => (
                <div key={s.label} className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5 shadow-sm dark:shadow-none">
                  <div className="flex items-center gap-2 mb-2">
                    <s.icon className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-500" />
                    <span className="text-[10px] text-gray-500 dark:text-zinc-500 font-medium uppercase tracking-wider">{s.label}</span>
                  </div>
                  <p className={`text-lg font-bold ${s.color || 'text-gray-900 dark:text-white'}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-shrink-0">
            {/* Left: Bar chart */}
            <div className="lg:col-span-2 flex flex-col">
              {hasProviders && (
                <>
                  <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-3">
                    Open & Click Rate by Provider
                  </p>
                  <div className="min-h-[220px] h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={providerChartData} barGap={6} barSize={28}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 12, fill: '#71717a' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#71717a' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `${v}%`}
                          width={44}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'rgba(0,0,0,0.92)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '12px',
                            fontSize: '12px',
                            padding: '12px 16px',
                          }}
                          itemStyle={{ color: '#e5e5e5' }}
                          labelStyle={{ color: '#fff', fontWeight: 700, marginBottom: 6 }}
                          formatter={(value: number, name: string) => [`${value}%`, name]}
                          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                        />
                        <Bar dataKey="Open Rate" radius={[6, 6, 0, 0]} name="Open Rate">
                          {providerChartData.map((entry, i) => (
                            <Cell key={`open-${i}`} fill={entry.fill} fillOpacity={0.85} />
                          ))}
                        </Bar>
                        <Bar dataKey="Click Rate" radius={[6, 6, 0, 0]} name="Click Rate">
                          {providerChartData.map((entry, i) => (
                            <Cell key={`click-${i}`} fill={entry.fill} fillOpacity={0.35} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Chart legend */}
                  <div className="flex items-center justify-center gap-6 mt-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-2 rounded-sm bg-zinc-400" style={{ opacity: 0.85 }} />
                      <span className="text-[10px] text-zinc-500 font-medium">Open Rate</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-2 rounded-sm bg-zinc-400" style={{ opacity: 0.35 }} />
                      <span className="text-[10px] text-zinc-500 font-medium">Click Rate</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Right: Provider table + Bot breakdown */}
            <div className="lg:col-span-1 flex flex-col gap-5">
              {/* Provider stats */}
              <div>
                <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-3">
                  Provider Breakdown
                </p>
                <div className="space-y-2">
                  {Object.entries(data!.providers).filter(([name]) => name).map(([name, stats]) => (
                    <div
                      key={name}
                      className={`px-3 py-3 rounded-xl border ${adminMode ? 'bg-white dark:bg-black border-zinc-200 dark:border-zinc-800' : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-100 dark:border-zinc-800'}`}
                    >
                      <div className="flex items-center gap-2.5 mb-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: PROVIDER_COLORS[name] || '#8B8B8B' }}
                        />
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 flex-1">
                          {name}
                        </span>
                        <span className="text-[10px] text-zinc-400 tabular-nums font-medium">
                          {stats.sent.toLocaleString()} sent
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <MiniMetric label="Open" value={stats.openRate} count={stats.opened} good={stats.openRate >= 20} />
                        <MiniMetric label="Click" value={stats.clickRate} count={stats.clicked} good={stats.clickRate >= 3} />
                        <MiniMetric label="Dlvr" value={stats.deliveryRate} count={stats.delivered} good={stats.deliveryRate >= 90} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bot / Human breakdown */}
              {totalBotEvents > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="w-3.5 h-3.5 text-zinc-500" />
                    <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
                      Open Quality
                    </p>
                  </div>

                  <div className={`flex items-center gap-4 px-3 py-3 rounded-xl border ${adminMode ? 'bg-white dark:bg-black border-zinc-200 dark:border-zinc-800' : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-100 dark:border-zinc-800'}`}>
                    {/* Mini pie chart */}
                    <div className="w-[72px] h-[72px] flex-shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={botPieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={18}
                            outerRadius={32}
                            paddingAngle={2}
                            dataKey="value"
                            strokeWidth={0}
                          >
                            {botPieData.map((entry, i) => (
                              <Cell key={`bot-${i}`} fill={entry.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Legend */}
                    <div className="flex-1 space-y-1.5">
                      <BotRow
                        icon={<User className="w-3 h-3" />}
                        label="Human"
                        count={data!.botBreakdown.human}
                        total={totalBotEvents}
                        color={BOT_COLORS.human}
                      />
                      <BotRow
                        icon={<Wifi className="w-3 h-3" />}
                        label="Proxy"
                        count={data!.botBreakdown.proxy}
                        total={totalBotEvents}
                        color={BOT_COLORS.proxy}
                      />
                      <BotRow
                        icon={<Bot className="w-3 h-3" />}
                        label="Bot"
                        count={data!.botBreakdown.bot}
                        total={totalBotEvents}
                        color={BOT_COLORS.bot}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 mt-auto">
                <p className="text-[10px] text-zinc-400 text-center">
                  {Object.keys(data!.providers).length} provider{Object.keys(data!.providers).length !== 1 ? 's' : ''} &middot; {data!.days}d window
                </p>
              </div>
            </div>
          </div>

          {/* Admin-only: Per-User Breakdown Table */}
          {adminMode && data!.userBreakdown && data!.userBreakdown.length > 0 && (
            <div className="flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-2">
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-zinc-500" />
                  <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
                    Per-User Breakdown
                  </p>
                  <span className="text-[10px] text-zinc-400 font-medium bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                    {data!.userBreakdown!.length} user{data!.userBreakdown!.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <input
                  type="text"
                  placeholder="Filter by email..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="w-full sm:w-48 px-3 py-1.5 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors"
                />
              </div>

              <div className="overflow-x-auto bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase tracking-wider">User</th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase tracking-wider text-center">Sent</th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase tracking-wider text-center">Delivered</th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase tracking-wider text-center">Opened</th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase tracking-wider text-center">Clicked</th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase tracking-wider text-center">Bounced</th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase tracking-wider text-right">Open Rate</th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase tracking-wider text-right">Click Rate</th>
                      <th className="px-5 py-3.5 text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase tracking-wider text-right">Delivery</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                    {filteredUsers.map((u) => (
                      <tr key={u.userId} className="hover:bg-gray-50 dark:hover:bg-zinc-50 dark:bg-zinc-950 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-500/20 flex items-center justify-center text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase flex-shrink-0">
                              {u.email?.[0] || '?'}
                            </div>
                            <span className="text-xs font-medium text-gray-900 dark:text-zinc-200 truncate max-w-[200px]" title={u.email}>
                              {u.email}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className="text-sm font-semibold text-gray-900 dark:text-zinc-200 tabular-nums">{u.sent.toLocaleString()}</span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className="text-sm font-medium text-gray-700 dark:text-zinc-300 tabular-nums">{u.delivered.toLocaleString()}</span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className="text-sm font-medium text-gray-700 dark:text-zinc-300 tabular-nums">{u.opened.toLocaleString()}</span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className="text-sm font-medium text-gray-700 dark:text-zinc-300 tabular-nums">{u.clicked.toLocaleString()}</span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className={`text-sm font-medium tabular-nums ${u.bounced > 0 ? 'text-red-500' : 'text-gray-500 dark:text-zinc-500'}`}>
                            {u.bounced.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`text-sm font-bold tabular-nums ${u.openRate >= 20 ? 'text-emerald-600 dark:text-emerald-400' : u.openRate > 0 ? 'text-gray-700 dark:text-zinc-300' : 'text-gray-400'}`}>
                            {u.openRate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`text-sm font-bold tabular-nums ${u.clickRate >= 3 ? 'text-emerald-600 dark:text-emerald-400' : u.clickRate > 0 ? 'text-gray-700 dark:text-zinc-300' : 'text-gray-400'}`}>
                            {u.clickRate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`text-sm font-bold tabular-nums ${u.deliveryRate >= 90 ? 'text-emerald-600 dark:text-emerald-400' : u.deliveryRate > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>
                            {u.deliveryRate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-gray-500 dark:text-zinc-600 text-sm">
                          {userSearch ? 'No users matching your filter.' : 'No user data available.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-2 text-[10px] text-gray-400 dark:text-zinc-600 text-right uppercase tracking-wider flex-shrink-0">
                {filteredUsers.length} of {data!.userBreakdown!.length} user{data!.userBreakdown!.length !== 1 ? 's' : ''} &middot; {data!.totals.sent.toLocaleString()} total emails &middot; {data!.days}d window
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --- Sub-components --- */

function MiniMetric({ label, value, count, good }: { label: string; value: number; count: number; good: boolean }) {
  return (
    <div className="text-center">
      <span
        className={`text-sm font-bold tabular-nums block ${
          good ? 'text-[#1ED4A7]' : value > 0 ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400'
        }`}
      >
        {value.toFixed(1)}%
      </span>
      <span className="text-[9px] text-zinc-400 block mt-0.5">
        {label} ({count})
      </span>
    </div>
  );
}

function BotRow({ icon, label, count, total, color }: {
  icon: React.ReactNode;
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? ((count / total) * 100).toFixed(0) : '0';
  return (
    <div className="flex items-center gap-2">
      <div style={{ color }} className="flex-shrink-0">{icon}</div>
      <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 flex-1">{label}</span>
      <span className="text-[11px] font-bold tabular-nums" style={{ color }}>{pct}%</span>
      <span className="text-[9px] text-zinc-400 tabular-nums w-8 text-right">({count})</span>
    </div>
  );
}
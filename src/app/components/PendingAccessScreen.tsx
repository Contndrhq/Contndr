import { motion } from 'motion/react';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Lock, CalendarDays, Search, Users, Mail, BarChart3, Zap,
  TrendingUp, DollarSign, Inbox, Send, Settings, Plus,
  ArrowUpRight, ChevronRight, Trophy, Target, Sparkles,
  Eye, Globe, MapPin, Clock, LayoutDashboard, GitBranch,
  Share2, X
} from 'lucide-react';

interface PendingAccessScreenProps {
  onLogout: () => void;
}

/* --- sidebar items matching the real app --- */
const SIDEBAR_PLATFORM = [
  { icon: LayoutDashboard, label: 'Dashboard', active: true },
  { icon: Search, label: 'Lead Finder' },
  { icon: Sparkles, label: 'Creator Finder', badge: 'BETA' },
  { icon: Inbox, label: 'Inbox' },
  { icon: Users, label: 'Leads' },
];
const SIDEBAR_OUTREACH = [
  { icon: Send, label: 'Campaigns' },
  { icon: Zap, label: 'Automations' },
  { icon: Share2, label: 'Social Tracker', badge: 'BETA' },
];
const SIDEBAR_INSIGHTS = [
  { icon: GitBranch, label: 'Pipeline' },
  { icon: Target, label: 'Intent' },
  { icon: Users, label: 'Team' },
  { icon: DollarSign, label: 'Revenue' },
  { icon: BarChart3, label: 'Analytics' },
];

/* --- pipeline stages --- */
const PIPELINE = [
  { stage: 'Discovery', value: '$48.2K', count: 12, pct: 85 },
  { stage: 'Demo', value: '$36.4K', count: 8, pct: 65 },
  { stage: 'Proposal', value: '$22.8K', count: 4, pct: 40 },
  { stage: 'Negotiation', value: '$18.5K', count: 3, pct: 33 },
  { stage: 'Closing', value: '$14.6K', count: 2, pct: 26 },
];

/* --- team leaderboard --- */
const TEAM = [
  { rank: 1, initials: 'OB', name: 'Or Briga', color: 'bg-[#1ED4A7]', you: true, meetings: 48, replies: 312, revenue: '$84.2K' },
  { rank: 2, initials: 'SC', name: 'Sarah Chen', color: 'bg-emerald-600', you: false, meetings: 37, replies: 248, revenue: '$62.4K' },
  { rank: 3, initials: 'JM', name: 'Jake Morrison', color: 'bg-red-500', you: false, meetings: 29, replies: 196, revenue: '$41.8K' },
  { rank: 4, initials: 'MP', name: 'Maya Patel', color: 'bg-purple-500', you: false, meetings: 22, replies: 158, revenue: '$29.5K' },
];

/* --- buying signals --- */
const SIGNALS = [
  { initials: 'SC', name: 'Sarah Chen', company: 'Shopify Inc', action: 'Visited pricing page', score: 88, time: '12m ago' },
  { initials: 'MD', name: 'Mark Davis', company: 'Tesla Energy', action: 'Opened email 3x', score: 75, time: '34m ago' },
];

/* --- engagement heatmap (simplified) --- */
const HOURS = ['12am','2am','4am','6am','8am','10am','12pm','2pm','4pm','6pm','8pm','10pm'];
const DAYS = ['Mon','Tue','Wed','Thu','Fri'];
const heatData = () => {
  const rows: number[][] = [];
  for (let d = 0; d < 5; d++) {
    const row: number[] = [];
    for (let h = 0; h < 12; h++) {
      // Peak around 8am-4pm
      if (h >= 4 && h <= 8) row.push(Math.random() > 0.3 ? 2 + Math.floor(Math.random() * 2) : 1);
      else row.push(Math.random() > 0.5 ? 1 : 0);
    }
    rows.push(row);
  }
  return rows;
};
const HEAT = heatData();
const heatColor = (v: number) => {
  if (v === 0) return 'bg-[#1ED4A7]/5';
  if (v === 1) return 'bg-[#1ED4A7]/20';
  if (v === 2) return 'bg-[#1ED4A7]/45';
  return 'bg-[#1ED4A7]/70';
};

export function PendingAccessScreen({ onLogout }: PendingAccessScreenProps) {
  const { t } = useTranslation();
  const [showOverlay, setShowOverlay] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowOverlay(true), 2800);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="h-screen bg-[#050505] text-white font-sans overflow-hidden relative">

      {/* =========== FULL APP REPLICA (decorative preview) =========== */}
      <div className="flex h-full">

        {/* -- SIDEBAR -- */}
        <div className="hidden md:flex w-[200px] shrink-0 flex-col bg-[#0a0a0a] border-r border-white/[0.06] py-5 px-3">
          {/* Logo */}
          <div className="px-2 mb-5">
            <span className="text-[15px] font-bold tracking-wider text-white uppercase">Contndr</span>
          </div>

          {/* Quick search */}
          <div className="mb-5 px-1">
            <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-lg text-xs text-zinc-500">
              <Zap className="w-3 h-3 text-[#1ED4A7]" />
              <span>Find leads in <span className="text-[#1ED4A7]">fintech...</span></span>
            </div>
          </div>

          {/* Platform */}
          <div className="px-2 mb-1">
            <span className="text-[9px] text-zinc-600 font-semibold uppercase tracking-widest">Platform</span>
          </div>
          <div className="space-y-0.5 mb-5">
            {SIDEBAR_PLATFORM.map(item => (
              <div
                key={item.label}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] ${
                  item.active
                    ? 'bg-white/[0.06] text-white font-semibold'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
                {item.badge && <span className="text-[8px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-400 ml-auto">{item.badge}</span>}
              </div>
            ))}
          </div>

          {/* Outreach */}
          <div className="px-2 mb-1">
            <span className="text-[9px] text-zinc-600 font-semibold uppercase tracking-widest">Outreach</span>
          </div>
          <div className="space-y-0.5 mb-5">
            {SIDEBAR_OUTREACH.map(item => (
              <div key={item.label} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-zinc-500">
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
                {item.badge && <span className="text-[8px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-400 ml-auto">{item.badge}</span>}
              </div>
            ))}
          </div>

          {/* Insights */}
          <div className="px-2 mb-1">
            <span className="text-[9px] text-zinc-600 font-semibold uppercase tracking-widest">Insights</span>
          </div>
          <div className="space-y-0.5 mb-5">
            {SIDEBAR_INSIGHTS.map(item => (
              <div key={item.label} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-zinc-500">
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          <div className="mt-auto space-y-3 px-1">
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-zinc-500">
              <Settings className="w-4 h-4" /> Settings
            </div>
            {/* New Campaign */}
            <button className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-white/[0.04] border border-white/[0.06] rounded-xl text-sm text-zinc-300 font-medium">
              <Plus className="w-4 h-4" /> New Campaign
            </button>
            {/* User */}
            <div className="flex items-center gap-2.5 px-2 py-2">
              <div className="w-8 h-8 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center text-[10px] font-bold text-zinc-400">AD</div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">Alex Demo</div>
                <div className="text-[10px] text-zinc-600 truncate">demo@contndr.com</div>
              </div>
              <ChevronRight className="w-3 h-3 text-zinc-600 ml-auto" />
            </div>
          </div>
        </div>

        {/* -- MAIN CONTENT -- */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto overflow-x-hidden">

          {/* Header */}
          <div className="px-6 pt-6 pb-4 shrink-0">
            <h1 className="text-2xl font-bold text-white tracking-tight">Overview</h1>
          </div>

          {/* -- Stats Row -- */}
          <div className="px-6 pb-4 shrink-0">
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: 'LEADS', icon: Users, value: '1,847', sub: '/ 100', accent: false, bar: true },
                { label: 'SENT', icon: Mail, value: '4,832', sub: '312 replies', accent: false },
                { label: 'OPEN RATE', icon: Eye, value: '45.0%', sub: '> industry avg', accent: true },
                { label: 'CLOSE RATE', icon: Target, value: '58.5%', sub: '↑ strong', accent: true },
                { label: t('dashboard.pipelineValue').toUpperCase(), icon: TrendingUp, value: '$489.0K', sub: `41 ${t('dashboard.activeDeals').toLowerCase()}`, accent: false },
                { label: t('dashboard.mrr').toUpperCase(), icon: DollarSign, value: '$34.2K', sub: `24 ${t('dashboard.wonDeals')}`, accent: true },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.06 }}
                  className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-4"
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">{stat.label}</span>
                    <stat.icon className="w-3.5 h-3.5 text-zinc-600" />
                  </div>
                  <div className="text-xl font-bold text-white tracking-tight">
                    {stat.accent ? <span className="text-[#1ED4A7]">{stat.value}</span> : stat.value}
                    {stat.sub && !stat.accent && <span className="text-xs text-zinc-500 font-normal ml-1">{stat.sub}</span>}
                  </div>
                  {stat.accent && stat.sub && <div className="text-[11px] text-zinc-500 mt-0.5">{stat.sub}</div>}
                  {stat.bar && (
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full mt-2 overflow-hidden">
                      <div className="h-full bg-[#1ED4A7] rounded-full" style={{ width: '72%' }} />
                    </div>
                  )}
                  {!stat.accent && stat.sub && !stat.bar && <div className="text-[11px] text-[#1ED4A7] mt-0.5">{stat.sub}</div>}
                </motion.div>
              ))}
            </div>
          </div>

          {/* -- AI Insights Bar -- */}
          <div className="px-6 pb-4 shrink-0">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="flex items-center gap-4 px-4 py-2.5 bg-[#0a0a0a] border border-white/[0.06] rounded-xl overflow-x-auto text-xs text-zinc-400"
            >
              <span className="flex items-center gap-1.5 shrink-0"><Sparkles className="w-3.5 h-3.5 text-[#1ED4A7]" /> AI</span>
              <span className="text-zinc-600">|</span>
              <span className="shrink-0 flex items-center gap-1.5"><Clock className="w-3 h-3" /> BEST TIME TO SEND <span className="text-white font-semibold">Tue & Thu, 4 PM</span></span>
              <span className="text-zinc-600">|</span>
              <span className="shrink-0 flex items-center gap-1.5"><TrendingUp className="w-3 h-3" /> TOP PERFORMING <span className="text-white font-semibold">Real Estate</span></span>
              <span className="text-zinc-600">|</span>
              <span className="shrink-0 flex items-center gap-1.5"><Zap className="w-3 h-3" /> MOST RESPONSIVE <span className="text-white font-semibold">Construction CEOs</span></span>
            </motion.div>
          </div>

          {/* -- Pipeline + Team Row -- */}
          <div className="px-6 pb-4 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 shrink-0">

            {/* Pipeline Card */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-white uppercase tracking-wider">Pipeline</span>
                <span className="text-xs text-zinc-500 flex items-center gap-1">View All <ArrowUpRight className="w-3 h-3" /></span>
              </div>
              <div className="mb-1">
                <span className="text-3xl font-bold text-white">$140.5K</span>
                <span className="text-sm text-zinc-500 ml-2">open deals</span>
              </div>
              <div className="text-[11px] text-zinc-600 mb-4">29 active deals across 5 stages</div>

              <div className="space-y-3">
                {PIPELINE.map((p, i) => (
                  <motion.div
                    key={p.stage}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.7 + i * 0.08 }}
                    className="flex items-center gap-3"
                  >
                    <span className="text-xs text-zinc-400 w-24 shrink-0">{p.stage}</span>
                    <div className="flex-1 h-4 bg-zinc-900/50 rounded overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${p.pct}%` }}
                        transition={{ delay: 0.8 + i * 0.1, duration: 0.6, ease: 'easeOut' }}
                        className="h-full bg-[#1ED4A7]/40 rounded"
                      />
                    </div>
                    <span className="text-xs text-zinc-500 w-14 text-right shrink-0">{p.value}</span>
                    <span className="text-xs font-bold text-white w-6 text-right shrink-0">{p.count}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Team Card */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white uppercase tracking-wider">Team</span>
                  <span className="text-[11px] text-zinc-500">5 members</span>
                </div>
                <span className="text-xs text-zinc-500">Full Board</span>
              </div>

              <div className="space-y-3">
                {TEAM.map((m, i) => (
                  <motion.div
                    key={m.name}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.8 + i * 0.08 }}
                    className="flex items-center gap-3"
                  >
                    <span className="text-xs text-zinc-500 w-3 shrink-0">{m.rank}</span>
                    <div className={`w-8 h-8 rounded-full ${m.color} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                      {m.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-white truncate">{m.name}</span>
                        {m.you && <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#1ED4A7]/15 text-[#1ED4A7] font-bold">YOU</span>}
                      </div>
                      <div className="text-[11px] text-zinc-500">{m.meetings} meetings · {m.replies} replies</div>
                    </div>
                    <span className="text-sm font-bold text-white shrink-0">{m.revenue}</span>
                  </motion.div>
                ))}
              </div>

              <button className="w-full mt-4 py-2.5 border border-white/[0.06] rounded-xl text-xs text-zinc-400 flex items-center justify-center gap-2 hover:bg-white/[0.03]">
                <Trophy className="w-3.5 h-3.5" /> View Leaderboard
              </button>
            </motion.div>
          </div>

          {/* -- Buying Signals + Engagement Row -- */}
          <div className="px-6 pb-6 grid grid-cols-1 lg:grid-cols-2 gap-4 shrink-0">

            {/* Buying Signals */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9 }}
              className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#1ED4A7]" />
                  <span className="text-sm font-bold text-white uppercase tracking-wider">Buying Signals</span>
                </div>
                <span className="text-xs text-zinc-500 flex items-center gap-1">View All <ArrowUpRight className="w-3 h-3" /></span>
              </div>

              <div className="space-y-3">
                {SIGNALS.map((s, i) => (
                  <motion.div
                    key={s.name}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1 + i * 0.1 }}
                    className="flex items-center gap-3"
                  >
                    <div className="w-9 h-9 rounded-full bg-zinc-800 border border-white/[0.08] flex items-center justify-center text-[10px] font-bold text-zinc-400 shrink-0">
                      {s.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{s.name}</div>
                      <div className="text-[11px] text-zinc-500 truncate">{s.company} · {s.action}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-white">{s.score}</div>
                      <div className="text-[10px] text-zinc-600">{s.time}</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Engagement Heatmap */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1 }}
              className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-1">
                <div>
                  <span className="text-sm font-bold text-white uppercase tracking-wider">Engagement</span>
                  <div className="text-[11px] text-zinc-500 mt-0.5">When & where your leads are active</div>
                </div>
                <div className="flex items-center gap-1">
                  {['Time','Location','Map','Live'].map((tab, i) => (
                    <span key={tab} className={`text-[10px] px-2.5 py-1 rounded-full ${i === 0 ? 'bg-white/10 text-white' : 'text-zinc-500'}`}>{tab}</span>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                {/* Hour labels */}
                <div className="flex items-center mb-1">
                  <div className="w-8" />
                  {HOURS.map(h => (
                    <span key={h} className="flex-1 text-[8px] text-zinc-600 text-center">{h}</span>
                  ))}
                </div>
                {/* Grid */}
                {DAYS.map((day, di) => (
                  <div key={day} className="flex items-center gap-0 mb-[2px]">
                    <span className="w-8 text-[10px] text-zinc-500 shrink-0">{day}</span>
                    {HEAT[di].map((v, hi) => (
                      <div key={hi} className="flex-1 px-[1px]">
                        <div className={`h-5 rounded-sm ${heatColor(v)}`} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* -- Bottom CTA bar -- */}
          <div className="px-6 pb-6 shrink-0">
            <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl px-6 py-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-white">Ready to supercharge your outreach?</div>
                <div className="text-xs text-zinc-500">Set up your workspace in under 2 minutes</div>
              </div>
              <button className="px-5 py-2.5 bg-white text-black rounded-xl text-sm font-bold flex items-center gap-2">
                Get Started <ArrowUpRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* =========== WAITLIST OVERLAY (user-facing, i18n) =========== */}
      {showOverlay && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 z-10"
            style={{ background: 'radial-gradient(ellipse 100% 90% at 50% 50%, rgba(5,5,5,0.72) 0%, rgba(5,5,5,0.94) 100%)' }}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut', delay: 0.1 }}
            className="absolute inset-0 z-20 flex items-center justify-center p-4"
          >
            <div className="w-full max-w-md">
              <div className="bg-[#0A0A0A]/95 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

                <div className="flex flex-col items-center text-center">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 ring-1 ring-white/5">
                    <Lock className="w-7 h-7 text-gray-200" />
                  </div>

                  <h2 className="text-2xl font-bold text-white mb-3 tracking-tight">{t('pendingAccess.youreOnTheList')}</h2>
                  <p className="text-gray-400 text-sm leading-relaxed mb-6">
                    {t('pendingAccess.unlockDescription')}
                  </p>

                  {/* Status */}
                  <div className="w-full bg-white/[0.03] rounded-xl p-4 mb-6 border border-white/5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-medium text-gray-400">{t('pendingAccess.status')}</span>
                      <div className="flex items-center gap-2">
                        <div className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </div>
                        <span className="text-xs font-medium text-emerald-500">{t('pendingAccess.pendingApproval')}</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-gray-800/50 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: '5%' }}
                        animate={{ width: '65%' }}
                        transition={{ duration: 1.5, delay: 0.3, ease: 'circOut' }}
                        className="h-full bg-emerald-500 rounded-full"
                      />
                    </div>
                    <div className="mt-2 text-right">
                      <span className="text-[10px] text-gray-500 uppercase tracking-widest">{t('pendingAccess.estWaitDays')}</span>
                    </div>
                  </div>

                  <div className="space-y-3 w-full">
                    <button
                      onClick={() => window.open('https://calendly.com/ax-contndr/30min?month=2026-02', '_blank')}
                      className="w-full py-3.5 bg-white hover:bg-gray-100 text-black font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_-5px_rgba(255,255,255,0.3)] hover:shadow-[0_0_25px_-5px_rgba(255,255,255,0.4)] hover:-translate-y-0.5"
                    >
                      <CalendarDays className="w-4 h-4" />
                      {t('pendingAccess.skipTheLineBookDemo')}
                    </button>
                    <button
                      onClick={onLogout}
                      className="w-full py-2.5 bg-transparent hover:bg-white/5 text-gray-500 hover:text-white text-xs font-medium rounded-xl transition-colors"
                    >
                      {t('pendingAccess.signOut')}
                    </button>
                  </div>
                </div>
              </div>
              <div className="text-center mt-6">
                <p className="text-[10px] text-gray-600 uppercase tracking-widest">{t('pendingAccess.accessControlSystem')}</p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}

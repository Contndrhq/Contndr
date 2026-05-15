import { useState, useEffect } from 'react';
import {
  DollarSign, Users, Calendar, Plus, Trash2, Edit3, Save, X,
  Loader2, RefreshCw, TrendingUp, ArrowUpDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface SalesDeal {
  id: string;
  sales_rep_email: string;
  sales_rep_name: string;
  customer_name: string;
  customer_email?: string;
  amount: number;
  plan_interval: 'monthly' | 'yearly' | 'one_time';
  status: 'active' | 'trialing' | 'canceled' | 'past_due';
  notes?: string;
  created_at: string;
  updated_at: string;
}

interface RepSummary {
  rank: number;
  name: string;
  email: string;
  conversions: number;
  revenue: number;
  deals: SalesDeal[];
}

function fmtCurrency(v: number) {
  return `$${v.toLocaleString()}`;
}

export function SalesAdminPanel({ searchTerm }: { searchTerm: string }) {
  const [loading, setLoading] = useState(true);
  const [reps, setReps] = useState<RepSummary[]>([]);
  const [meetings, setMeetings] = useState<Record<string, number>>({});
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalDeals, setTotalDeals] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Add deal form
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [newDeal, setNewDeal] = useState({
    sales_rep_email: '',
    sales_rep_name: '',
    customer_name: '',
    customer_email: '',
    amount: '',
    plan_interval: 'monthly' as 'monthly' | 'yearly' | 'one_time',
    status: 'active' as 'active' | 'trialing' | 'canceled',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  // Edit meetings
  const [editingMeetings, setEditingMeetings] = useState<string | null>(null);
  const [meetingInput, setMeetingInput] = useState('');

  // Edit deal inline
  const [editingDeal, setEditingDeal] = useState<string | null>(null);
  const [editDealAmount, setEditDealAmount] = useState('');
  const [editDealStatus, setEditDealStatus] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const [lbRes, mtRes] = await Promise.all([
        fetch(`${API_BASE}/sales-leaderboard`, { headers }),
        fetch(`${API_BASE}/sales-leaderboard/meetings`, { headers }),
      ]);

      if (lbRes.ok) {
        const data = await lbRes.json();
        setReps(data.leaderboard || []);
        setTotalRevenue(data.summary?.total_revenue || 0);
        setTotalDeals(data.summary?.total_deals || 0);
      }

      if (mtRes.ok) {
        const data = await mtRes.json();
        setMeetings(data.meetings || {});
      }
    } catch (err) {
      console.error('[SALES ADMIN] Load error:', err);
      toast.error('Failed to load sales data');
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
    toast.success('Sales data refreshed');
  }

  async function addDeal() {
    if (!newDeal.sales_rep_email || !newDeal.customer_name) {
      toast.error('Rep email and customer name are required');
      return;
    }
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/sales-leaderboard/deal`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newDeal,
          amount: Number(newDeal.amount) || 0,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast.success('Deal added');
      setShowAddDeal(false);
      setNewDeal({ sales_rep_email: '', sales_rep_name: '', customer_name: '', customer_email: '', amount: '', plan_interval: 'monthly', status: 'active', notes: '' });
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add deal');
    } finally {
      setSaving(false);
    }
  }

  async function deleteDeal(dealId: string) {
    if (!confirm('Delete this deal?')) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/sales-leaderboard/deal/${dealId}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast.success('Deal deleted');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete deal');
    }
  }

  async function updateDeal(dealId: string) {
    try {
      const headers = await getAuthHeaders();
      const body: any = { deal_id: dealId, amount: Number(editDealAmount) };
      const res = await fetch(`${API_BASE}/sales-leaderboard/update-deal-amount`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast.success('Deal updated');
      setEditingDeal(null);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update deal');
    }
  }

  async function updateMeetings(email: string) {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/sales-leaderboard/meetings`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, meetings: Number(meetingInput) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast.success('Meetings updated');
      setEditingMeetings(null);
      const data = await res.json();
      setMeetings(data.meetings || {});
    } catch (err: any) {
      toast.error(err.message || 'Failed to update meetings');
    }
  }

  const filteredReps = reps.filter(r =>
    !searchTerm ||
    r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.deals.some(d => d.customer_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  const statusColor = (s: string) => {
    if (s === 'active') return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
    if (s === 'canceled') return 'text-red-400 bg-red-500/10 border-red-500/20';
    if (s === 'trialing') return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-shrink-0">
        {[
          { label: 'Total Revenue', value: fmtCurrency(totalRevenue), icon: DollarSign, teal: true },
          { label: 'Active Deals', value: String(totalDeals), icon: TrendingUp },
          { label: 'Sales Reps', value: String(reps.length), icon: Users },
          { label: 'Total Meetings', value: String(Object.values(meetings).reduce((s, v) => s + v, 0)), icon: Calendar },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5 shadow-sm dark:shadow-none">
            <div className="flex items-center gap-2 mb-2">
              <s.icon className={`w-3.5 h-3.5 ${s.teal ? 'text-[#1ED4A7]' : 'text-zinc-400 dark:text-zinc-500'}`} />
              <span className="text-[10px] text-zinc-500 dark:text-zinc-500 font-medium uppercase tracking-wider">{s.label}</span>
            </div>
            <p className={`text-lg font-bold ${s.teal ? 'text-[#1ED4A7]' : 'text-zinc-900 dark:text-white'}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Actions Bar */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => setShowAddDeal(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1ED4A7]/10 text-[#1ED4A7] text-xs font-semibold hover:bg-[#1ED4A7]/20 transition-colors border border-[#1ED4A7]/20"
        >
          <Plus className="w-3.5 h-3.5" /> Add Deal
        </button>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 text-xs font-medium hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Add Deal Modal */}
      {showAddDeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddDeal(false)} />
          <div className="relative w-full max-w-lg bg-white dark:bg-black rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">New Sales Deal</h3>
              <button onClick={() => setShowAddDeal(false)} className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1 block">Rep Email *</label>
                  <input
                    value={newDeal.sales_rep_email}
                    onChange={e => setNewDeal(p => ({ ...p, sales_rep_email: e.target.value }))}
                    placeholder="ax@contndr.com"
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-[#1ED4A7]/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1 block">Rep Name</label>
                  <input
                    value={newDeal.sales_rep_name}
                    onChange={e => setNewDeal(p => ({ ...p, sales_rep_name: e.target.value }))}
                    placeholder="AXE"
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-[#1ED4A7]/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1 block">Customer Name *</label>
                  <input
                    value={newDeal.customer_name}
                    onChange={e => setNewDeal(p => ({ ...p, customer_name: e.target.value }))}
                    placeholder="John Smith"
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-[#1ED4A7]/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1 block">Customer Email</label>
                  <input
                    value={newDeal.customer_email}
                    onChange={e => setNewDeal(p => ({ ...p, customer_email: e.target.value }))}
                    placeholder="john@company.com"
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-[#1ED4A7]/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1 block">Amount ($)</label>
                  <input
                    type="number"
                    value={newDeal.amount}
                    onChange={e => setNewDeal(p => ({ ...p, amount: e.target.value }))}
                    placeholder="199"
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-[#1ED4A7]/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1 block">Interval</label>
                  <select
                    value={newDeal.plan_interval}
                    onChange={e => setNewDeal(p => ({ ...p, plan_interval: e.target.value as any }))}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-[#1ED4A7]/50"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="one_time">One-time</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1 block">Status</label>
                  <select
                    value={newDeal.status}
                    onChange={e => setNewDeal(p => ({ ...p, status: e.target.value as any }))}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-[#1ED4A7]/50"
                  >
                    <option value="active">Active</option>
                    <option value="trialing">Trialing</option>
                    <option value="canceled">Canceled</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1 block">Notes</label>
                <input
                  value={newDeal.notes}
                  onChange={e => setNewDeal(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Pro plan — $199/mo"
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-[#1ED4A7]/50"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowAddDeal(false)}
                className="px-4 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addDeal}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 text-xs font-bold dark:hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Add Deal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reps & Deals List */}
      <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-1">
        {filteredReps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
            <DollarSign className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm">No sales reps found</p>
          </div>
        ) : (
          filteredReps.map(rep => (
            <div key={rep.email} className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm dark:shadow-none">
              {/* Rep Header */}
              <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-zinc-700/40 to-zinc-800/30 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-300 font-bold text-sm">
                      {rep.name.charAt(0)}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-zinc-900 dark:text-white">{rep.name}</h4>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-600">{rep.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {/* Meetings */}
                    <div className="text-right">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3 h-3 text-zinc-400" />
                        {editingMeetings === rep.email ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={meetingInput}
                              onChange={e => setMeetingInput(e.target.value)}
                              className="w-12 px-1.5 py-0.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded text-xs text-zinc-900 dark:text-white text-center focus:outline-none focus:border-[#1ED4A7]/50"
                              autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') updateMeetings(rep.email); if (e.key === 'Escape') setEditingMeetings(null); }}
                            />
                            <button onClick={() => updateMeetings(rep.email)} className="p-0.5 text-[#1ED4A7] hover:text-[#1ED4A7]/80"><Save className="w-3 h-3" /></button>
                            <button onClick={() => setEditingMeetings(null)} className="p-0.5 text-zinc-400 hover:text-zinc-600"><X className="w-3 h-3" /></button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingMeetings(rep.email); setMeetingInput(String(meetings[rep.email] || 0)); }}
                            className="text-[11px] text-zinc-500 hover:text-[#1ED4A7] transition-colors tabular-nums"
                          >
                            {meetings[rep.email] || 0} meetings
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Revenue */}
                    <div className="text-right">
                      <p className="text-sm font-bold text-[#1ED4A7] tabular-nums">{fmtCurrency(rep.revenue)}</p>
                      <p className="text-[10px] text-zinc-400 tabular-nums">{rep.conversions} deal{rep.conversions !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Deals Table */}
              <div className="divide-y divide-zinc-50 dark:divide-zinc-900">
                {rep.deals.map(deal => (
                  <div key={deal.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium text-zinc-900 dark:text-white truncate">{deal.customer_name}</span>
                        <span className={`text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full border ${statusColor(deal.status)}`}>
                          {deal.status}
                        </span>
                      </div>
                      {deal.notes && (
                        <p className="text-[10px] text-zinc-400 dark:text-zinc-600 truncate mt-0.5">{deal.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {editingDeal === deal.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-zinc-400">$</span>
                          <input
                            type="number"
                            value={editDealAmount}
                            onChange={e => setEditDealAmount(e.target.value)}
                            className="w-16 px-1.5 py-0.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 rounded text-xs text-zinc-900 dark:text-white text-right focus:outline-none focus:border-[#1ED4A7]/50"
                            autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') updateDeal(deal.id); if (e.key === 'Escape') setEditingDeal(null); }}
                          />
                          <button onClick={() => updateDeal(deal.id)} className="p-1 text-[#1ED4A7] hover:text-[#1ED4A7]/80"><Save className="w-3 h-3" /></button>
                          <button onClick={() => setEditingDeal(null)} className="p-1 text-zinc-400 hover:text-zinc-600"><X className="w-3 h-3" /></button>
                        </div>
                      ) : (
                        <>
                          <span className="text-[12px] font-bold text-zinc-900 dark:text-white tabular-nums">{fmtCurrency(deal.amount)}</span>
                          <span className="text-[10px] text-zinc-400">/{deal.plan_interval === 'yearly' ? 'yr' : deal.plan_interval === 'monthly' ? 'mo' : '1x'}</span>
                          <button
                            onClick={() => { setEditingDeal(deal.id); setEditDealAmount(String(deal.amount)); }}
                            className="p-1 text-zinc-300 dark:text-zinc-700 hover:text-zinc-500 dark:hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => deleteDeal(deal.id)}
                            className="p-1 text-zinc-300 dark:text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default SalesAdminPanel;
/**
 * Conversation Intelligence (Gong-style) — aggregates the classification
 * data we already produce per call into cross-call coaching insights.
 *
 * Per-call data we already have (see telnyx.tsx classifyCallOutcome):
 *   outcome, score, reason, summary, next_action, objections[],
 *   quality_score, budget, timeline, decision_maker, callback_request
 *
 * What this module adds:
 *   - cross-call aggregation (top objections, win/loss patterns)
 *   - coaching insights (what's working, what's not)
 *   - drill-down lists (show me the calls that mentioned "price")
 *
 * Zero new data captured — purely a read-model over existing KV entries.
 */

import * as kv from "./kv-retry.tsx";

export interface CallRecord {
  id: string;
  user_id?: string;
  status?: string;
  outcome?: string;
  outcome_score?: number;
  outcome_reason?: string;
  outcome_summary?: string;
  outcome_next_action?: string;
  outcome_objections?: string[];
  outcome_quality_score?: number;
  outcome_budget?: string;
  outcome_timeline?: string;
  outcome_decision_maker?: string;
  duration_seconds?: number;
  created_at?: string;
  ended_at?: string;
  to_number?: string;
  lead_name?: string;
  business_name?: string;
}

export interface CoachingInsights {
  window_days: number;
  total_calls: number;
  connected_calls: number;
  classified_calls: number;
  outcomes: Record<string, number>;
  connect_rate: number;        // 0-1
  win_rate: number;            // 0-1, positive/booked of classified
  avg_quality_score: number;   // 0-100
  avg_duration_seconds: number;
  top_objections: Array<{ label: string; count: number; pct_of_calls: number; sample_call_ids: string[] }>;
  next_actions: Array<{ action: string; count: number; sample_call_ids: string[] }>;
  high_intent_unbooked: Array<{
    id: string;
    name: string;
    business: string;
    outcome: string;
    score: number;
    summary: string;
    next_action: string;
    ended_at?: string;
  }>;
  highest_quality_calls: Array<{
    id: string;
    name: string;
    business: string;
    quality_score: number;
    summary: string;
    ended_at?: string;
  }>;
  lowest_quality_calls: Array<{
    id: string;
    name: string;
    business: string;
    quality_score: number;
    summary: string;
    ended_at?: string;
  }>;
  // Plain-English headline takeaways for the dashboard
  takeaways: string[];
}

const HIGH_INTENT_OUTCOMES = new Set(['positive', 'engaged']);
const BOOKED_OUTCOMES = new Set(['booked', 'positive']);
const QUALITY_HIGH = 80;
const QUALITY_LOW = 50;

export async function loadCallsForUser(userId: string, sinceMs: number): Promise<CallRecord[]> {
  // Calls are stored at `call:<id>` per call. We scan by prefix because we
  // don't keep a per-user index of call IDs. Capped at 2000 most-recent;
  // beyond that the coaching view paginates by re-running with a narrower
  // window.
  const entries = await kv.getByPrefixLimited('call:', 2000, 0).catch(() => []);
  const out: CallRecord[] = [];
  for (const raw of entries as any[]) {
    const c = typeof raw === 'string' ? safeParse(raw) : raw;
    if (!c || c.user_id !== userId) continue;
    const created = c.created_at ? Date.parse(c.created_at) : 0;
    if (created < sinceMs) continue;
    out.push(c as CallRecord);
  }
  return out;
}

function safeParse(raw: string): any {
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Normalize an objection string so "price too high", "Too expensive",
 * "PRICING" all bucket together. Keeps top-objection counts honest.
 */
function normalizeObjection(s: string): string {
  const lower = String(s).toLowerCase().trim();
  if (!lower) return 'unknown';
  if (/(price|cost|budget|expensive|afford|too\s+much)/i.test(lower)) return 'price';
  if (/(time|busy|right\s+now|not\s+now|later|q1|q2|q3|q4)/i.test(lower)) return 'timing';
  if (/(authority|decision|owner|boss|manager|cfo|ceo|approval)/i.test(lower)) return 'authority';
  if (/(competitor|already|using|current|incumbent|happy)/i.test(lower)) return 'incumbent';
  if (/(trust|scam|spam|robot|bot|ai|fake)/i.test(lower)) return 'trust';
  if (/(feature|integration|api|salesforce|hubspot|crm)/i.test(lower)) return 'feature_gap';
  if (/(size|small|too\s+big)/i.test(lower)) return 'fit';
  // Fallback: first 3 meaningful words, capitalized
  return lower.split(/\s+/).slice(0, 3).join(' ').slice(0, 40);
}

export function computeCoachingInsights(calls: CallRecord[], windowDays: number): CoachingInsights {
  const totalCalls = calls.length;
  const connected = calls.filter(c => c.status === 'completed' && c.outcome && !['no_answer', 'voicemail'].includes(c.outcome));
  const classified = calls.filter(c => c.outcome);
  const outcomes: Record<string, number> = {};
  for (const c of classified) outcomes[c.outcome!] = (outcomes[c.outcome!] || 0) + 1;

  const booked = classified.filter(c => BOOKED_OUTCOMES.has(String(c.outcome)));
  const winRate = classified.length ? booked.length / classified.length : 0;
  const connectRate = totalCalls ? connected.length / totalCalls : 0;

  // Quality scores
  const withQuality = classified.filter(c => typeof c.outcome_quality_score === 'number');
  const avgQuality = withQuality.length
    ? withQuality.reduce((acc, c) => acc + (c.outcome_quality_score || 0), 0) / withQuality.length
    : 0;

  // Avg duration (only completed/connected — voicemails skew low)
  const withDuration = connected.filter(c => typeof c.duration_seconds === 'number' && c.duration_seconds! > 0);
  const avgDuration = withDuration.length
    ? withDuration.reduce((acc, c) => acc + (c.duration_seconds || 0), 0) / withDuration.length
    : 0;

  // Top objections (normalized bucketing)
  const objectionMap = new Map<string, { count: number; sample: string[] }>();
  for (const c of classified) {
    for (const raw of c.outcome_objections || []) {
      const key = normalizeObjection(raw);
      const existing = objectionMap.get(key) || { count: 0, sample: [] };
      existing.count++;
      if (existing.sample.length < 5) existing.sample.push(c.id);
      objectionMap.set(key, existing);
    }
  }
  const topObjections = [...objectionMap.entries()]
    .map(([label, v]) => ({
      label,
      count: v.count,
      pct_of_calls: classified.length ? v.count / classified.length : 0,
      sample_call_ids: v.sample,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Next-action patterns
  const actionMap = new Map<string, { count: number; sample: string[] }>();
  for (const c of classified) {
    const action = (c.outcome_next_action || '').trim().toLowerCase();
    if (!action) continue;
    const key = action.split(/[.\n]/)[0].slice(0, 80);
    const existing = actionMap.get(key) || { count: 0, sample: [] };
    existing.count++;
    if (existing.sample.length < 3) existing.sample.push(c.id);
    actionMap.set(key, existing);
  }
  const nextActions = [...actionMap.entries()]
    .map(([action, v]) => ({ action, count: v.count, sample_call_ids: v.sample }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // High-intent unbooked — positive sentiment but no meeting booked.
  // These are the "you should follow up THIS WEEK" calls.
  const highIntentUnbooked = classified
    .filter(c => HIGH_INTENT_OUTCOMES.has(String(c.outcome)) && c.outcome !== 'booked')
    .sort((a, b) => (b.outcome_score || 0) - (a.outcome_score || 0))
    .slice(0, 10)
    .map(c => ({
      id: c.id,
      name: c.lead_name || 'Unknown',
      business: c.business_name || '',
      outcome: c.outcome || '',
      score: c.outcome_score || 0,
      summary: c.outcome_summary || '',
      next_action: c.outcome_next_action || '',
      ended_at: c.ended_at,
    }));

  // Quality leaderboard — show the AI's best and worst performances
  const sortedByQuality = withQuality.slice().sort((a, b) => (b.outcome_quality_score || 0) - (a.outcome_quality_score || 0));
  const highestQuality = sortedByQuality.slice(0, 5).map(c => ({
    id: c.id,
    name: c.lead_name || 'Unknown',
    business: c.business_name || '',
    quality_score: c.outcome_quality_score || 0,
    summary: c.outcome_summary || '',
    ended_at: c.ended_at,
  }));
  const lowestQuality = sortedByQuality.slice(-5).reverse().map(c => ({
    id: c.id,
    name: c.lead_name || 'Unknown',
    business: c.business_name || '',
    quality_score: c.outcome_quality_score || 0,
    summary: c.outcome_summary || '',
    ended_at: c.ended_at,
  }));

  // Plain-English headline takeaways — these go above the fold on the
  // coaching tab so the user gets actionable insights in 1 second.
  const takeaways: string[] = [];
  if (topObjections.length && topObjections[0].count >= 3) {
    const top = topObjections[0];
    takeaways.push(`Top objection this period: "${top.label}" — came up in ${top.count} calls (${Math.round(top.pct_of_calls * 100)}% of classified). Consider updating the playbook response.`);
  }
  if (connectRate > 0 && connectRate < 0.2 && totalCalls >= 20) {
    takeaways.push(`Connect rate is ${Math.round(connectRate * 100)}% — below the 20% benchmark. Try different time windows or smaller batches.`);
  }
  if (winRate > 0.15 && classified.length >= 10) {
    takeaways.push(`Win rate of ${Math.round(winRate * 100)}% on classified calls. Strong signal — consider raising daily call volume.`);
  }
  if (avgQuality > 0 && avgQuality < QUALITY_LOW && withQuality.length >= 5) {
    takeaways.push(`Average AI call quality is ${Math.round(avgQuality)}/100 — below 50. Review your lowest-quality calls below and update the agent instructions.`);
  }
  if (highIntentUnbooked.length >= 3) {
    takeaways.push(`${highIntentUnbooked.length} high-intent prospects engaged but didn't book. Follow up manually this week — full list below.`);
  }
  if (takeaways.length === 0 && totalCalls > 0) {
    takeaways.push(`No urgent coaching signals this period. ${totalCalls} call${totalCalls === 1 ? '' : 's'} processed, ${booked.length} booked.`);
  }
  if (totalCalls === 0) {
    takeaways.push(`No calls in the last ${windowDays} days. Pick a campaign and start an AI calling batch to populate this view.`);
  }

  return {
    window_days: windowDays,
    total_calls: totalCalls,
    connected_calls: connected.length,
    classified_calls: classified.length,
    outcomes,
    connect_rate: connectRate,
    win_rate: winRate,
    avg_quality_score: avgQuality,
    avg_duration_seconds: avgDuration,
    top_objections: topObjections,
    next_actions: nextActions,
    high_intent_unbooked: highIntentUnbooked,
    highest_quality_calls: highestQuality,
    lowest_quality_calls: lowestQuality,
    takeaways,
  };
}

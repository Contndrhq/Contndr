/**
 * BUYING INTENT ENGINE — Contndr V1
 *
 * Scores companies/leads based on 4 signal types:
 *   1. Website Behavior (page visits, session frequency, time on site)
 *   2. Email Engagement (opens, clicks, replies)
 *   3. Keyword / Topic Intent (ICP keywords, tech stack changes, job postings)
 *   4. Activity-Based Signals (funding, hiring, expansion)
 *
 * Intent Score = weighted combination → 0-100 scale
 *   0-30   Cold
 *   31-60  Warm
 *   61-80  Hot
 *   81-100 Buying Now
 *
 * KV Schema:
 *   intent:signal:{userId}:{signalId}        → individual signal record
 *   intent:score:{userId}:{companyId}         → computed company score
 *   intent:config:{userId}                    → user's keyword/page config
 *   intent:rules:{userId}:{ruleId}            → automation rule
 *   intent:activity:{userId}:{timestamp}      → activity log entry
 */

import { Hono } from "npm:hono";
import * as kv from "./kv-retry.tsx";
import { sendSlackMessage } from "./slack.tsx";

const intentApp = new Hono();

// ─── Types ───────────────────────────────────────────────────────────

interface IntentSignal {
  id: string;
  user_id: string;
  company_id?: string;
  company_name?: string;
  person_id?: string;
  person_name?: string;
  person_email?: string;
  signal_type: 'website' | 'email' | 'keyword' | 'activity';
  signal_detail: string;
  score: number;
  metadata?: Record<string, any>;
  created_at: string;
}

interface CompanyIntentScore {
  company_id: string;
  company_name: string;
  website_points: number;
  email_points: number;
  keyword_points: number;
  activity_points: number;
  total_score: number;
  status: 'cold' | 'warm' | 'hot' | 'buying_now';
  signal_count: number;
  last_signal_at: string;
  last_updated: string;
  top_signals: string[];
}

interface IntentConfig {
  keywords: string[];
  high_intent_pages: string[];
  tracked_tech: string[];
  activity_keywords: string[];
}

interface IntentRule {
  id: string;
  user_id: string;
  name: string;
  condition_type: 'score_above' | 'status_is' | 'signal_type' | 'new_signal';
  condition_value: string;
  actions: IntentAction[];
  enabled: boolean;
  created_at: string;
  last_triggered?: string;
  trigger_count: number;
}

interface IntentAction {
  type: 'add_to_list' | 'assign_owner' | 'start_sequence' | 'slack_alert' | 'update_status';
  value: string;
}

// ─── Scoring Constants ───────────────────────────────────────────────

const SIGNAL_SCORES: Record<string, number> = {
  // Website signals
  'page_visit_general': 3,
  'page_visit_homepage': 5,
  'page_visit_pricing': 20,
  'page_visit_demo': 30,
  'page_visit_contact': 25,
  'page_visit_case_study': 15,
  'page_visit_compare': 20,
  'page_visit_features': 10,
  'page_visit_book_call': 30,
  'repeat_visit_7d': 15,
  'time_on_site_3min': 10,
  'multiple_pages': 12,
  'email_click_visit': 12,

  // Email engagement signals
  'email_opened': 5,
  'email_clicked': 15,
  'email_replied': 40,
  'email_multiple_replies': 60,
  'email_forwarded': 20,
  'email_opened_multiple': 10,

  // Keyword/topic signals
  'keyword_match_industry': 10,
  'keyword_match_title': 12,
  'keyword_match_description': 8,
  'keyword_match_blog': 15,
  'keyword_match_job_posting': 20,
  'tech_stack_installed': 25,
  'tech_stack_removed': 20,
  'competitor_mention': 15,

  // Activity signals
  'lead_status_interested': 25,
  'lead_status_meeting_scheduled': 35,
  'lead_status_replied': 20,
  'lead_status_engaged': 10,
  'lead_status_converted': 40,
  'funding_raised': 30,
  'new_hire_vp_sales': 25,
  'hiring_bdrs': 20,
  'expansion_new_location': 15,
  'leadership_change': 20,
  'product_launch': 15,
  'partnership_announcement': 10,
};

const WEIGHT_MULTIPLIERS = {
  website: 1.2,
  email: 1.5,
  keyword: 1.1,
  activity: 1.3,
};

// ─── Helpers ─────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function classifyScore(score: number): 'cold' | 'warm' | 'hot' | 'buying_now' {
  if (score >= 81) return 'buying_now';
  if (score >= 61) return 'hot';
  if (score >= 31) return 'warm';
  return 'cold';
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Decay older signals — signals older than 30 days get halved, older than 60 get quartered */
function decaySignalScore(signal: IntentSignal): number {
  const ageMs = Date.now() - new Date(signal.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > 60) return signal.score * 0.25;
  if (ageDays > 30) return signal.score * 0.5;
  if (ageDays > 14) return signal.score * 0.75;
  return signal.score;
}

// Auth helper — extracts user from auth header with retry for transient errors
async function getIntentUser(c: any): Promise<{ id: string; email: string }> {
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const authHeader = c.req.header('Authorization');
  
  console.log('[INTENT] getIntentUser called, Authorization header present:', !!authHeader);
  
  if (!authHeader) {
    console.error('[INTENT] No Authorization header found');
    throw new Error('No Authorization header');
  }
  
  const token = authHeader.replace('Bearer ', '');
  console.log('[INTENT] Token length:', token.length, 'First 20 chars:', token.substring(0, 20));
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  console.log('[INTENT] Environment check - SUPABASE_URL present:', !!supabaseUrl, 'SERVICE_ROLE_KEY present:', !!serviceRoleKey);
  
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[INTENT] Missing environment variables! URL:', !!supabaseUrl, 'Key:', !!serviceRoleKey);
    throw new Error('Server configuration error');
  }
  
  const supabase = createClient(
    supabaseUrl,
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`[INTENT] Calling auth.getUser (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      const { data, error } = await supabase.auth.getUser(token);
      
      if (error) {
        console.error('[INTENT] Supabase auth.getUser error:', error.message, error);
        throw error;
      }
      
      if (!data?.user?.id) {
        console.error('[INTENT] No user returned from auth.getUser, data:', JSON.stringify(data));
        throw new Error('No user returned');
      }
      
      console.log('[INTENT] User authenticated successfully:', data.user.id, data.user.email);
      return { id: data.user.id, email: data.user.email || '' };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[INTENT] Auth attempt ${attempt + 1}/${MAX_RETRIES} failed:`, msg, err);
      
      const isTransient = msg.includes('connection reset') || msg.includes('error sending request')
        || msg.includes('ECONNRESET') || msg.includes('broken pipe')
        || msg.includes('network error') || msg.includes('client error')
        || msg.includes('SendRequest') || msg.includes('ConnectionAborted')
        || msg.includes('connection closed before message completed')
        || msg.includes('schema cache') || msg.includes('PGRST002')
        || msg.includes('Database error') || msg.includes('Unexpected failure')
        || msg.includes('fetch failed') || msg.includes('Failed to fetch')
        || msg.includes('timeout') || msg.includes('connection unexpectedly');
      
      if (isTransient && attempt < MAX_RETRIES - 1) {
        const delay = 300 * Math.pow(2, attempt);
        console.log(`[INTENT] Auth retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms: ${msg}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      console.error('[INTENT] Auth failed permanently after retries, original error:', msg);
      throw new Error('Unauthorized');
    }
  }
  
  console.error('[INTENT] Auth failed: max retries exceeded');
  throw new Error('Unauthorized');
}

// ─── Score Computation ──────────────────────────────────────────────

async function computeCompanyScore(
  userId: string,
  companyId: string,
  companyName: string,
  signals: IntentSignal[]
): Promise<CompanyIntentScore> {
  const companySignals = signals.filter(s => s.company_id === companyId);

  let website_points = 0;
  let email_points = 0;
  let keyword_points = 0;
  let activity_points = 0;
  const topSignals: string[] = [];

  for (const signal of companySignals) {
    const decayed = decaySignalScore(signal);
    switch (signal.signal_type) {
      case 'website':
        website_points += decayed;
        break;
      case 'email':
        email_points += decayed;
        break;
      case 'keyword':
        keyword_points += decayed;
        break;
      case 'activity':
        activity_points += decayed;
        break;
    }
    if (decayed >= 10 && topSignals.length < 5) {
      topSignals.push(signal.signal_detail);
    }
  }

  const rawScore =
    (website_points * WEIGHT_MULTIPLIERS.website) +
    (email_points * WEIGHT_MULTIPLIERS.email) +
    (keyword_points * WEIGHT_MULTIPLIERS.keyword) +
    (activity_points * WEIGHT_MULTIPLIERS.activity);

  const total_score = clampScore(rawScore);
  const lastSignal = companySignals.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0];

  const score: CompanyIntentScore = {
    company_id: companyId,
    company_name: companyName,
    website_points: Math.round(website_points),
    email_points: Math.round(email_points),
    keyword_points: Math.round(keyword_points),
    activity_points: Math.round(activity_points),
    total_score,
    status: classifyScore(total_score),
    signal_count: companySignals.length,
    last_signal_at: lastSignal?.created_at || new Date().toISOString(),
    last_updated: new Date().toISOString(),
    top_signals: topSignals,
  };

  // Persist to KV
  await kv.set(`intent:score:${userId}:${companyId}`, score);
  return score;
}

/** Recompute all company scores for a user */
async function recomputeAllScores(userId: string): Promise<CompanyIntentScore[]> {
  const signals = await kv.getByPrefix(`intent:signal:${userId}:`) as IntentSignal[];

  // Group by company
  const companyMap = new Map<string, { name: string; signals: IntentSignal[] }>();
  for (const s of signals) {
    if (!s.company_id) continue;
    if (!companyMap.has(s.company_id)) {
      companyMap.set(s.company_id, { name: s.company_name || 'Unknown', signals: [] });
    }
    companyMap.get(s.company_id)!.signals.push(s);
  }

  const scores: CompanyIntentScore[] = [];
  for (const [companyId, { name, signals: companySignals }] of companyMap) {
    const score = await computeCompanyScore(userId, companyId, name, companySignals);
    scores.push(score);
  }

  return scores.sort((a, b) => b.total_score - a.total_score);
}

// ─── Public API: Record Intent Signal ────────────────────────────────
// This is exported so other server modules (email-tracking, etc.) can
// fire intent signals directly.

export async function recordIntentSignal(params: {
  userId: string;
  companyId?: string;
  companyName?: string;
  personId?: string;
  personName?: string;
  personEmail?: string;
  signalType: IntentSignal['signal_type'];
  signalDetail: string;
  score?: number;
  metadata?: Record<string, any>;
}): Promise<IntentSignal> {
  const signalId = generateId();
  const score = params.score ?? (SIGNAL_SCORES[params.signalDetail] || 5);

  const signal: IntentSignal = {
    id: signalId,
    user_id: params.userId,
    company_id: params.companyId,
    company_name: params.companyName,
    person_id: params.personId,
    person_name: params.personName,
    person_email: params.personEmail,
    signal_type: params.signalType,
    signal_detail: params.signalDetail,
    score,
    metadata: params.metadata,
    created_at: new Date().toISOString(),
  };

  await kv.set(`intent:signal:${params.userId}:${signalId}`, signal);

  // Log activity
  await kv.set(`intent:activity:${params.userId}:${Date.now()}`, {
    type: 'signal_recorded',
    signal_type: params.signalType,
    signal_detail: params.signalDetail,
    company_name: params.companyName || 'Unknown',
    score,
    created_at: signal.created_at,
  });

  // Recompute company score if we have a company_id
  if (params.companyId) {
    const allSignals = await kv.getByPrefix(`intent:signal:${params.userId}:`) as IntentSignal[];
    await computeCompanyScore(params.userId, params.companyId, params.companyName || 'Unknown', allSignals);
  }

  // Check rules
  await checkIntentRules(params.userId, signal).catch(e =>
    console.error('[INTENT] Rule check failed:', e)
  );

  return signal;
}

// ─── Action Execution ────────────────────────────────────────────────

const SIGNAL_DETAIL_LABELS: Record<string, string> = {
  page_visit_general: 'Visited general page', page_visit_homepage: 'Visited homepage', page_visit_pricing: 'Visited pricing page',
  page_visit_demo: 'Visited demo page', page_visit_contact: 'Visited contact page',
  page_visit_case_study: 'Viewed case study', page_visit_compare: 'Visited comparison page',
  page_visit_book_call: 'Visited book-a-call page', repeat_visit_7d: '2+ sessions in 7 days',
  time_on_site_3min: 'Spent 3+ min on site', multiple_pages: 'Viewed multiple pages',
  email_click_visit: 'Clicked email link to visit',
  email_opened: 'Opened email', email_clicked: 'Clicked email link',
  email_replied: 'Replied to email', email_multiple_replies: 'Multiple replies',
  email_forwarded: 'Forwarded email', email_opened_multiple: 'Re-opened email',
  keyword_match_industry: 'Industry keyword match', keyword_match_title: 'Title keyword match',
  keyword_match_description: 'Description keyword match', keyword_match_blog: 'Blog matches ICP keyword',
  keyword_match_job_posting: 'Job posting matches ICP',
  tech_stack_installed: 'New tech stack detected', tech_stack_removed: 'Tech stack removed',
  competitor_mention: 'Competitor mentioned', funding_raised: 'Recently raised funding',
  new_hire_vp_sales: 'Hired VP of Sales', hiring_bdrs: 'Hiring BDRs/SDRs',
  expansion_new_location: 'Expanding to new location', leadership_change: 'Leadership change',
  product_launch: 'Product launch', partnership_announcement: 'Partnership announced',
  lead_status_interested: 'Lead status: Interested', lead_status_meeting_scheduled: 'Lead status: Meeting Scheduled',
  lead_status_replied: 'Lead status: Replied', lead_status_engaged: 'Lead status: Engaged',
  lead_status_converted: 'Lead status: Converted',
};

async function executeIntentAction(
  userId: string,
  action: IntentAction,
  signal: IntentSignal,
  rule: IntentRule
): Promise<void> {
  switch (action.type) {
    case 'slack_alert': {
      // Build a rich Slack message with intent signal context
      const scoreData = signal.company_id
        ? await kv.get(`intent:score:${userId}:${signal.company_id}`) as CompanyIntentScore | null
        : null;

      const statusEmoji: Record<string, string> = {
        buying_now: '🔥', hot: '🟠', warm: '🟡', cold: '⚪',
      };

      const signalLabel = SIGNAL_DETAIL_LABELS[signal.signal_detail] || signal.signal_detail;
      const companyName = signal.company_name || 'Unknown Company';
      const emoji = scoreData ? (statusEmoji[scoreData.status] || '📊') : '📊';
      const scoreText = scoreData ? `${scoreData.total_score}/100 (${scoreData.status.replace('_', ' ').toUpperCase()})` : 'N/A';

      const text = `${emoji} *Intent Alert — ${companyName}*\n` +
        `Signal: ${signalLabel} (${signal.signal_type}, +${signal.score} pts)\n` +
        `Intent Score: ${scoreText}\n` +
        `Rule: ${rule.name}`;

      const blocks = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `${emoji} *Intent Alert*` },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Company:*\n${companyName}` },
            { type: 'mrkdwn', text: `*Intent Score:*\n${scoreText}` },
            { type: 'mrkdwn', text: `*Signal:*\n${signalLabel}` },
            { type: 'mrkdwn', text: `*Type:*\n${signal.signal_type.charAt(0).toUpperCase() + signal.signal_type.slice(1)} (+${signal.score} pts)` },
          ],
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `Triggered by rule: *${rule.name}* | ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}` },
          ],
        },
        { type: 'divider' },
      ];

      // action.value can optionally specify a channel ID; otherwise uses default
      const channelId = action.value && action.value.startsWith('C') ? action.value : undefined;
      const result = await sendSlackMessage(userId, { channel_id: channelId, text, blocks });

      if (result.success) {
        console.log(`[INTENT] Slack alert sent for ${companyName} (rule: ${rule.name})`);
      } else {
        console.warn(`[INTENT] Slack alert failed: ${result.error}`);
      }

      // Log the action
      await kv.set(`intent:activity:${userId}:${Date.now()}_slack`, {
        type: 'action_executed',
        action_type: 'slack_alert',
        rule_name: rule.name,
        company_name: companyName,
        success: result.success,
        error: result.error,
        created_at: new Date().toISOString(),
      });
      break;
    }

    case 'add_to_list': {
      // Store the company in a named intent list
      const listName = action.value || 'High Intent Leads';
      const listKey = `intent:list:${userId}:${listName.toLowerCase().replace(/\s+/g, '_')}`;
      const list = (await kv.get(listKey) as any) || { name: listName, companies: [], updated_at: '' };

      // Avoid duplicates
      if (signal.company_id && !list.companies.find((c: any) => c.company_id === signal.company_id)) {
        list.companies.push({
          company_id: signal.company_id,
          company_name: signal.company_name || 'Unknown',
          added_at: new Date().toISOString(),
          triggered_by: signal.signal_detail,
        });
        list.updated_at = new Date().toISOString();
        await kv.set(listKey, list);
        console.log(`[INTENT] Added ${signal.company_name} to list "${listName}"`);
      }
      break;
    }

    case 'update_status': {
      // Update the company's pipeline status via KV
      if (signal.company_id) {
        const statusKey = `intent:company_status:${userId}:${signal.company_id}`;
        await kv.set(statusKey, {
          company_id: signal.company_id,
          company_name: signal.company_name,
          status: action.value,
          updated_at: new Date().toISOString(),
          triggered_by: rule.name,
        });
        console.log(`[INTENT] Updated ${signal.company_name} status to "${action.value}"`);
      }
      break;
    }

    case 'assign_owner':
    case 'start_sequence': {
      // Log as pending action for manual pickup — these require CRM integration
      await kv.set(`intent:pending_action:${userId}:${Date.now()}`, {
        action_type: action.type,
        action_value: action.value,
        company_id: signal.company_id,
        company_name: signal.company_name,
        rule_name: rule.name,
        signal_id: signal.id,
        created_at: new Date().toISOString(),
        status: 'pending',
      });
      console.log(`[INTENT] Queued ${action.type} action for ${signal.company_name}: ${action.value}`);
      break;
    }

    default:
      console.warn(`[INTENT] Unknown action type: ${action.type}`);
  }
}

// ─── Rules Engine ────────────────────────────────────────────────────

async function checkIntentRules(userId: string, signal: IntentSignal) {
  const rules = await kv.getByPrefix(`intent:rules:${userId}:`) as IntentRule[];
  if (!rules || rules.length === 0) return;

  for (const rule of rules) {
    if (!rule.enabled) continue;

    let triggered = false;

    switch (rule.condition_type) {
      case 'score_above': {
        if (signal.company_id) {
          const scoreData = await kv.get(`intent:score:${userId}:${signal.company_id}`) as CompanyIntentScore | null;
          if (scoreData && scoreData.total_score >= parseInt(rule.condition_value)) {
            triggered = true;
          }
        }
        break;
      }
      case 'status_is': {
        if (signal.company_id) {
          const scoreData = await kv.get(`intent:score:${userId}:${signal.company_id}`) as CompanyIntentScore | null;
          if (scoreData && scoreData.status === rule.condition_value) {
            triggered = true;
          }
        }
        break;
      }
      case 'signal_type': {
        if (signal.signal_type === rule.condition_value) {
          triggered = true;
        }
        break;
      }
      case 'new_signal': {
        triggered = true; // Fires on every new signal
        break;
      }
    }

    if (triggered) {
      console.log(`[INTENT] Rule "${rule.name}" triggered for signal ${signal.id}`);
      rule.last_triggered = new Date().toISOString();
      rule.trigger_count = (rule.trigger_count || 0) + 1;
      await kv.set(`intent:rules:${userId}:${rule.id}`, rule);

      // Log the trigger
      await kv.set(`intent:activity:${userId}:${Date.now()}`, {
        type: 'rule_triggered',
        rule_name: rule.name,
        rule_id: rule.id,
        signal_type: signal.signal_type,
        company_name: signal.company_name || 'Unknown',
        created_at: new Date().toISOString(),
      });

      // ─── Execute Rule Actions ───────────────────────────────────
      for (const action of rule.actions) {
        try {
          await executeIntentAction(userId, action, signal, rule);
        } catch (actionErr) {
          console.error(`[INTENT] Action ${action.type} execution failed:`, actionErr);
        }
      }
    }
  }
}

// ─── API Routes ──────────────────────────────────────────────────────

// Health check endpoint
intentApp.get("/health", async (c) => {
  console.log('[INTENT ENGINE] /health endpoint hit');
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Dashboard endpoint
intentApp.get("/dashboard", async (c) => {
  console.log('[INTENT ENGINE] /dashboard endpoint hit');
  try {
    const user = await getIntentUser(c);
    console.log(`[INTENT ENGINE] User authenticated: ${user.id}`);

    // PARALLEL LOAD with Promise.allSettled for resilience
    // Run all KV queries in parallel with individual timeouts & fallbacks
    const timeout = (ms: number) => new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms)
    );

    const [scoresRes, signalsRes, activityRes, configRes, rulesRes] = await Promise.allSettled([
      Promise.race([
        kv.getByPrefix(`intent:score:${user.id}:`),
        timeout(6000)
      ]).catch(() => []),
      
      Promise.race([
        kv.getByPrefix(`intent:signal:${user.id}:`),
        timeout(6000)
      ]).catch(() => []),
      
      Promise.race([
        kv.getByPrefix(`intent:activity:${user.id}:`),
        timeout(6000)
      ]).catch(() => []),
      
      Promise.race([
        kv.get(`intent:config:${user.id}`),
        timeout(3000)
      ]).catch(() => null),
      
      Promise.race([
        kv.getByPrefix(`intent:rules:${user.id}:`),
        timeout(6000)
      ]).catch(() => []),
    ]);

    // Extract values with fallbacks
    const scores = (scoresRes.status === 'fulfilled' ? scoresRes.value : []) as CompanyIntentScore[];
    const allSignals = (signalsRes.status === 'fulfilled' ? signalsRes.value : []) as IntentSignal[];
    const activity = (activityRes.status === 'fulfilled' ? activityRes.value : []) as any[];
    const config = (configRes.status === 'fulfilled' ? configRes.value : null) as IntentConfig | null;
    const rules = (rulesRes.status === 'fulfilled' ? rulesRes.value : []) as IntentRule[];

    // Log any failures for debugging
    if (scoresRes.status === 'rejected') console.error('[INTENT] Scores load failed:', scoresRes.reason);
    if (signalsRes.status === 'rejected') console.error('[INTENT] Signals load failed:', signalsRes.reason);
    if (activityRes.status === 'rejected') console.error('[INTENT] Activity load failed:', activityRes.reason);
    if (rulesRes.status === 'rejected') console.error('[INTENT] Rules load failed:', rulesRes.reason);

    const recentSignals = allSignals
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 50);

    const recentActivity = (activity || [])
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 30);

    // Compute summary stats
    const sortedScores = (scores || []).sort((a, b) => b.total_score - a.total_score);
    const buyingNow = sortedScores.filter(s => s.status === 'buying_now').length;
    const hot = sortedScores.filter(s => s.status === 'hot').length;
    const warm = sortedScores.filter(s => s.status === 'warm').length;
    const cold = sortedScores.filter(s => s.status === 'cold').length;

    // Signal type distribution
    const signalDistribution = {
      website: allSignals.filter(s => s.signal_type === 'website').length,
      email: allSignals.filter(s => s.signal_type === 'email').length,
      keyword: allSignals.filter(s => s.signal_type === 'keyword').length,
      activity: allSignals.filter(s => s.signal_type === 'activity').length,
    };

    // Trend: signals in last 7 days vs previous 7 days
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
    const thisWeek = allSignals.filter(s => new Date(s.created_at).getTime() >= weekAgo).length;
    const lastWeek = allSignals.filter(s => {
      const t = new Date(s.created_at).getTime();
      return t >= twoWeeksAgo && t < weekAgo;
    }).length;
    const trendPct = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : thisWeek > 0 ? 100 : 0;

    return c.json({
      summary: {
        total_companies: sortedScores.length,
        buying_now: buyingNow,
        hot,
        warm,
        cold,
        total_signals: allSignals.length,
        signals_this_week: thisWeek,
        trend_pct: trendPct,
      },
      companies: sortedScores.slice(0, 100),
      recent_signals: recentSignals,
      recent_activity: recentActivity,
      signal_distribution: signalDistribution,
      config: config || { keywords: [], high_intent_pages: ['/pricing', '/demo', '/book-call', '/contact', '/case-study', '/compare'], tracked_tech: [], activity_keywords: [] },
      rules: rules || [],
    });
  } catch (error: any) {
    console.error('[INTENT] Dashboard error:', error);
    return c.json({ error: error.message }, error.message === 'Unauthorized' ? 401 : 500);
  }
});

// POST /signal - Record a new intent signal
intentApp.post("/signal", async (c) => {
  try {
    const user = await getIntentUser(c);
    const body = await c.req.json();

    const signal = await recordIntentSignal({
      userId: user.id,
      companyId: body.company_id,
      companyName: body.company_name,
      personId: body.person_id,
      personName: body.person_name,
      personEmail: body.person_email,
      signalType: body.signal_type,
      signalDetail: body.signal_detail,
      score: body.score,
      metadata: body.metadata,
    });

    return c.json({ signal });
  } catch (error: any) {
    console.error('[INTENT] Record signal error:', error);
    return c.json({ error: error.message }, error.message === 'Unauthorized' ? 401 : 500);
  }
});

// POST /signal/batch - Record multiple signals at once
intentApp.post("/signal/batch", async (c) => {
  try {
    const user = await getIntentUser(c);
    const { signals: signalInputs } = await c.req.json();

    if (!Array.isArray(signalInputs) || signalInputs.length === 0) {
      return c.json({ error: 'signals array required' }, 400);
    }

    const results: IntentSignal[] = [];
    for (const input of signalInputs.slice(0, 50)) { // Cap at 50 per batch
      const signal = await recordIntentSignal({
        userId: user.id,
        companyId: input.company_id,
        companyName: input.company_name,
        personId: input.person_id,
        personName: input.person_name,
        personEmail: input.person_email,
        signalType: input.signal_type,
        signalDetail: input.signal_detail,
        score: input.score,
        metadata: input.metadata,
      });
      results.push(signal);
    }

    return c.json({ signals: results, count: results.length });
  } catch (error: any) {
    console.error('[INTENT] Batch signal error:', error);
    return c.json({ error: error.message }, error.message === 'Unauthorized' ? 401 : 500);
  }
});

// GET /company/:id - Get detailed intent data for a specific company
intentApp.get("/company/:id", async (c) => {
  try {
    const user = await getIntentUser(c);
    const companyId = c.req.param('id');

    const score = await kv.get(`intent:score:${user.id}:${companyId}`) as CompanyIntentScore | null;
    const allSignals = await kv.getByPrefix(`intent:signal:${user.id}:`) as IntentSignal[];
    const companySignals = allSignals
      .filter(s => s.company_id === companyId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Group signals by type for breakdown
    const signalsByType = {
      website: companySignals.filter(s => s.signal_type === 'website'),
      email: companySignals.filter(s => s.signal_type === 'email'),
      keyword: companySignals.filter(s => s.signal_type === 'keyword'),
      activity: companySignals.filter(s => s.signal_type === 'activity'),
    };

    // People associated with this company
    const people = new Map<string, { name: string; email: string; signal_count: number }>();
    for (const s of companySignals) {
      if (s.person_id) {
        if (!people.has(s.person_id)) {
          people.set(s.person_id, { name: s.person_name || '', email: s.person_email || '', signal_count: 0 });
        }
        people.get(s.person_id)!.signal_count++;
      }
    }

    return c.json({
      score: score || { company_id: companyId, company_name: 'Unknown', total_score: 0, status: 'cold', signal_count: 0 },
      signals: companySignals.slice(0, 100),
      signals_by_type: signalsByType,
      people: Array.from(people.values()),
    });
  } catch (error: any) {
    console.error('[INTENT] Company detail error:', error);
    return c.json({ error: error.message }, error.message === 'Unauthorized' ? 401 : 500);
  }
});

// POST /recompute - Force recompute all intent scores
intentApp.post("/recompute", async (c) => {
  try {
    const user = await getIntentUser(c);
    const scores = await recomputeAllScores(user.id);
    return c.json({ scores, count: scores.length });
  } catch (error: any) {
    console.error('[INTENT] Recompute error:', error);
    return c.json({ error: error.message }, error.message === 'Unauthorized' ? 401 : 500);
  }
});

// PUT /config - Update intent configuration (keywords, pages, etc.)
intentApp.put("/config", async (c) => {
  try {
    const user = await getIntentUser(c);
    const body = await c.req.json();

    const config: IntentConfig = {
      keywords: body.keywords || [],
      high_intent_pages: body.high_intent_pages || ['/pricing', '/demo', '/book-call', '/contact'],
      tracked_tech: body.tracked_tech || [],
      activity_keywords: body.activity_keywords || [],
    };

    await kv.set(`intent:config:${user.id}`, config);
    return c.json({ config });
  } catch (error: any) {
    console.error('[INTENT] Config update error:', error);
    return c.json({ error: error.message }, error.message === 'Unauthorized' ? 401 : 500);
  }
});

// POST /rules - Create or update an intent rule
intentApp.post("/rules", async (c) => {
  try {
    const user = await getIntentUser(c);
    const body = await c.req.json();

    const ruleId = body.id || generateId();
    const rule: IntentRule = {
      id: ruleId,
      user_id: user.id,
      name: body.name || 'Untitled Rule',
      condition_type: body.condition_type || 'score_above',
      condition_value: body.condition_value || '60',
      actions: body.actions || [],
      enabled: body.enabled !== false,
      created_at: body.created_at || new Date().toISOString(),
      last_triggered: body.last_triggered,
      trigger_count: body.trigger_count || 0,
    };

    await kv.set(`intent:rules:${user.id}:${ruleId}`, rule);
    return c.json({ rule });
  } catch (error: any) {
    console.error('[INTENT] Rule create error:', error);
    return c.json({ error: error.message }, error.message === 'Unauthorized' ? 401 : 500);
  }
});

// DELETE /rules/:id - Delete an intent rule
intentApp.delete("/rules/:id", async (c) => {
  try {
    const user = await getIntentUser(c);
    const ruleId = c.req.param('id');
    await kv.del(`intent:rules:${user.id}:${ruleId}`);
    return c.json({ ok: true });
  } catch (error: any) {
    console.error('[INTENT] Rule delete error:', error);
    return c.json({ error: error.message }, error.message === 'Unauthorized' ? 401 : 500);
  }
});

// DELETE /signal/:id - Delete a specific signal
intentApp.delete("/signal/:id", async (c) => {
  try {
    const user = await getIntentUser(c);
    const signalId = c.req.param('id');
    await kv.del(`intent:signal:${user.id}:${signalId}`);
    return c.json({ ok: true });
  } catch (error: any) {
    console.error('[INTENT] Signal delete error:', error);
    return c.json({ error: error.message }, error.message === 'Unauthorized' ? 401 : 500);
  }
});

// POST /seed-demo - Seed demo intent data for testing
intentApp.post("/seed-demo", async (c) => {
  try {
    const user = await getIntentUser(c);

    // Only allow demo account to seed demo data
    if (user.email.toLowerCase().trim() !== 'demo@contndr.com') {
      return c.json({ error: 'Demo seeding is only available for the demo account' }, 403);
    }

    const demoCompanies = [
      { id: 'demo_acme', name: 'Acme Corp', industry: 'SaaS' },
      { id: 'demo_globex', name: 'Globex Industries', industry: 'Manufacturing' },
      { id: 'demo_initech', name: 'Initech Solutions', industry: 'Technology' },
      { id: 'demo_umbrella', name: 'Umbrella Consulting', industry: 'Consulting' },
      { id: 'demo_wayne', name: 'Wayne Enterprises', industry: 'Finance' },
      { id: 'demo_stark', name: 'Stark Industries', industry: 'Technology' },
      { id: 'demo_oscorp', name: 'OsCorp Biotech', industry: 'Healthcare' },
      { id: 'demo_cyberdyne', name: 'Cyberdyne Systems', industry: 'Technology' },
    ];

    const signalTemplates = [
      { type: 'website' as const, detail: 'page_visit_pricing', score: 20 },
      { type: 'website' as const, detail: 'page_visit_demo', score: 30 },
      { type: 'website' as const, detail: 'page_visit_homepage', score: 5 },
      { type: 'website' as const, detail: 'repeat_visit_7d', score: 15 },
      { type: 'website' as const, detail: 'time_on_site_3min', score: 10 },
      { type: 'email' as const, detail: 'email_opened', score: 5 },
      { type: 'email' as const, detail: 'email_clicked', score: 15 },
      { type: 'email' as const, detail: 'email_replied', score: 40 },
      { type: 'email' as const, detail: 'email_multiple_replies', score: 60 },
      { type: 'keyword' as const, detail: 'keyword_match_job_posting', score: 20 },
      { type: 'keyword' as const, detail: 'tech_stack_installed', score: 25 },
      { type: 'keyword' as const, detail: 'competitor_mention', score: 15 },
      { type: 'activity' as const, detail: 'funding_raised', score: 30 },
      { type: 'activity' as const, detail: 'new_hire_vp_sales', score: 25 },
      { type: 'activity' as const, detail: 'hiring_bdrs', score: 20 },
      { type: 'activity' as const, detail: 'expansion_new_location', score: 15 },
    ];

    let count = 0;
    for (const company of demoCompanies) {
      // Each company gets a random subset of signals
      const numSignals = 3 + Math.floor(Math.random() * 8);
      const shuffled = [...signalTemplates].sort(() => Math.random() - 0.5);

      for (let i = 0; i < Math.min(numSignals, shuffled.length); i++) {
        const template = shuffled[i];
        const daysAgo = Math.floor(Math.random() * 21);
        const signalDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

        await recordIntentSignal({
          userId: user.id,
          companyId: company.id,
          companyName: company.name,
          signalType: template.type,
          signalDetail: template.detail,
          score: template.score,
          metadata: { industry: company.industry, demo: true },
        });
        count++;
      }
    }

    // Set default config
    await kv.set(`intent:config:${user.id}`, {
      keywords: ['sales automation', 'CRM software', 'cold outreach', 'lead generation'],
      high_intent_pages: ['/pricing', '/demo', '/book-call', '/contact', '/case-study', '/compare'],
      tracked_tech: ['HubSpot', 'Salesforce', 'Apollo', 'Outreach', 'SalesLoft'],
      activity_keywords: ['funding', 'hiring', 'expansion', 'VP Sales', 'BDR'],
    });

    return c.json({ ok: true, signals_created: count, companies: demoCompanies.length });
  } catch (error: any) {
    console.error('[INTENT] Seed demo error:', error);
    return c.json({ error: error.message }, error.message === 'Unauthorized' ? 401 : 500);
  }
});

// POST /clear - Clear all intent data for the user
intentApp.post("/clear", async (c) => {
  try {
    const user = await getIntentUser(c);

    // Delete all signals, scores, activity, rules
    const prefixes = [
      `intent:signal:${user.id}:`,
      `intent:score:${user.id}:`,
      `intent:activity:${user.id}:`,
      `intent:rules:${user.id}:`,
    ];

    for (const prefix of prefixes) {
      // getByPrefix returns values but we need keys — use a workaround
      const { createClient } = await import("npm:@supabase/supabase-js@2");
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );
      const { data } = await supabase
        .from('kv_store_a8b2511f')
        .select('key')
        .like('key', `${prefix}%`);
      if (data && data.length > 0) {
        const keys = data.map((d: any) => d.key);
        await kv.mdel(keys);
      }
    }

    // Also delete config
    await kv.del(`intent:config:${user.id}`);

    return c.json({ ok: true });
  } catch (error: any) {
    console.error('[INTENT] Clear error:', error);
    return c.json({ error: error.message }, error.message === 'Unauthorized' ? 401 : 500);
  }
});

// GET /lead-score/:leadId - Get intent score for a specific lead (used by lead-scoring bridge)
intentApp.get("/lead-score/:leadId", async (c) => {
  try {
    const user = await getIntentUser(c);
    const leadId = c.req.param('leadId');
    const businessName = c.req.query('business_name');

    // Try direct lead lookup
    let score = await kv.get(`intent:score:${user.id}:lead_${leadId}`) as CompanyIntentScore | null;

    // Fallback: org-based lookup
    if (!score && businessName) {
      const orgKey = `org_${businessName.toLowerCase().replace(/\s+/g, '_')}`;
      score = await kv.get(`intent:score:${user.id}:${orgKey}`) as CompanyIntentScore | null;
    }

    // Last resort: name match across all scores
    if (!score && businessName) {
      const allScores = await kv.getByPrefix(`intent:score:${user.id}:`) as CompanyIntentScore[];
      const nameLower = businessName.toLowerCase();
      score = allScores?.find(s => s.company_name?.toLowerCase() === nameLower) || null;
    }

    return c.json({
      has_intent: !!score,
      intent_score: score?.total_score ?? null,
      intent_status: score?.status ?? null,
      signal_count: score?.signal_count ?? 0,
      top_signals: score?.top_signals ?? [],
      score_breakdown: score ? {
        website: score.website_points,
        email: score.email_points,
        keyword: score.keyword_points,
        activity: score.activity_points,
      } : null,
    });
  } catch (error: any) {
    console.error('[INTENT] Lead score lookup error:', error);
    return c.json({ error: error.message }, error.message === 'Unauthorized' ? 401 : 500);
  }
});

// POST /scan-leads — Scan leads for keyword & activity signals (deduped, idempotent)
// This auto-generates keyword signals from lead industry/title/description matching
// config keywords, and activity signals from lead status changes.
intentApp.post("/scan-leads", async (c) => {
  try {
    const user = await getIntentUser(c);
    const config = await kv.get(`intent:config:${user.id}`) as IntentConfig | null;
    const keywords = config?.keywords || [];
    const activityKeywords = config?.activity_keywords || [];

    if (keywords.length === 0 && activityKeywords.length === 0) {
      return c.json({ ok: true, scanned: 0, signals_created: 0, message: 'No keywords configured' });
    }

    // Load leads from Supabase
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, business_name, contact_name, email, status, industry, job_title, notes, website, city, state, country')
      .eq('user_id', user.id)
      .limit(500);

    if (error || !leads) {
      console.error('[INTENT SCAN] Failed to load leads:', error);
      return c.json({ ok: false, error: 'Failed to load leads' }, 500);
    }

    const today = new Date().toISOString().split('T')[0];
    let signalsCreated = 0;
    const MAX_SIGNALS = 200; // Safety cap

    for (const lead of leads) {
      if (signalsCreated >= MAX_SIGNALS) break;

      const companyName = lead.business_name || lead.contact_name || 'Unknown';
      const companyId = `lead_${lead.id}`;
      const searchableText = [
        lead.industry, lead.title, lead.notes, lead.business_name, lead.website
      ].filter(Boolean).join(' ').toLowerCase();

      // ── Keyword matching ──────────────────────────────
      for (const kw of keywords) {
        if (signalsCreated >= MAX_SIGNALS) break;
        const kwLower = kw.toLowerCase().trim();
        if (!kwLower) continue;

        if (searchableText.includes(kwLower)) {
          // Determine which field matched
          let matchDetail = 'keyword_match_description';
          if (lead.industry?.toLowerCase().includes(kwLower)) matchDetail = 'keyword_match_industry';
          else if (lead.title?.toLowerCase().includes(kwLower)) matchDetail = 'keyword_match_title';

          const dedupKey = `intent:kw_dedup:${user.id}:${companyId}:${kwLower}:${today}`;
          const alreadyFired = await kv.get(dedupKey);
          if (!alreadyFired) {
            await kv.set(dedupKey, { fired: true });
            await recordIntentSignal({
              userId: user.id, companyId, companyName,
              personId: lead.id, personName: lead.contact_name || undefined, personEmail: lead.email || undefined,
              signalType: 'keyword', signalDetail: matchDetail,
              metadata: { matched_keyword: kw, matched_field: matchDetail.replace('keyword_match_', ''), lead_id: lead.id },
            });
            signalsCreated++;
            console.log(`[INTENT SCAN] Keyword signal: "${kw}" matched for ${companyName} (${matchDetail})`);
          }
        }
      }

      // ── Activity keyword matching ──────────────────────────────
      for (const akw of activityKeywords) {
        if (signalsCreated >= MAX_SIGNALS) break;
        const akwLower = akw.toLowerCase().trim();
        if (!akwLower) continue;

        if (searchableText.includes(akwLower)) {
          const dedupKey = `intent:act_kw_dedup:${user.id}:${companyId}:${akwLower}:${today}`;
          const alreadyFired = await kv.get(dedupKey);
          if (!alreadyFired) {
            await kv.set(dedupKey, { fired: true });

            // Map common activity keywords to specific signal details
            let actDetail = 'partnership_announcement'; // default
            const lwr = akwLower;
            if (lwr.includes('fund') || lwr.includes('raised') || lwr.includes('investment')) actDetail = 'funding_raised';
            else if (lwr.includes('vp') || lwr.includes('director') || lwr.includes('head of')) actDetail = 'new_hire_vp_sales';
            else if (lwr.includes('hiring') || lwr.includes('bdr') || lwr.includes('sdr') || lwr.includes('recruit')) actDetail = 'hiring_bdrs';
            else if (lwr.includes('expan') || lwr.includes('location') || lwr.includes('office')) actDetail = 'expansion_new_location';
            else if (lwr.includes('ceo') || lwr.includes('cto') || lwr.includes('leader')) actDetail = 'leadership_change';
            else if (lwr.includes('launch') || lwr.includes('product') || lwr.includes('release')) actDetail = 'product_launch';

            await recordIntentSignal({
              userId: user.id, companyId, companyName,
              personId: lead.id, personName: lead.contact_name || undefined, personEmail: lead.email || undefined,
              signalType: 'activity', signalDetail: actDetail,
              metadata: { matched_keyword: akw, lead_id: lead.id },
            });
            signalsCreated++;
            console.log(`[INTENT SCAN] Activity signal: "${akw}" matched for ${companyName} (${actDetail})`);
          }
        }
      }

      // ── Lead status → Activity signals ──────────────────────────────
      const statusSignalMap: Record<string, string> = {
        'interested': 'lead_status_interested',
        'meeting_scheduled': 'lead_status_meeting_scheduled',
        'replied': 'lead_status_replied',
        'engaged': 'lead_status_engaged',
        'converted': 'lead_status_converted',
        'customer': 'lead_status_converted',
      };
      const statusSignal = statusSignalMap[lead.status];
      if (statusSignal && signalsCreated < MAX_SIGNALS) {
        const dedupKey = `intent:status_dedup:${user.id}:${companyId}:${lead.status}`;
        const alreadyFired = await kv.get(dedupKey);
        if (!alreadyFired) {
          await kv.set(dedupKey, { fired: true });
          await recordIntentSignal({
            userId: user.id, companyId, companyName,
            personId: lead.id, personName: lead.contact_name || undefined, personEmail: lead.email || undefined,
            signalType: 'activity', signalDetail: statusSignal,
            metadata: { lead_status: lead.status, lead_id: lead.id },
          });
          signalsCreated++;
          console.log(`[INTENT SCAN] Activity signal from lead status: ${companyName} → ${lead.status}`);
        }
      }
    }

    console.log(`[INTENT SCAN] Complete: scanned ${leads.length} leads, created ${signalsCreated} signals`);
    return c.json({ ok: true, scanned: leads.length, signals_created: signalsCreated });
  } catch (error: any) {
    console.error('[INTENT SCAN] Error:', error);
    return c.json({ error: error.message }, error.message === 'Unauthorized' ? 401 : 500);
  }
});

export default intentApp;
export { recordIntentSignal as recordSignal };
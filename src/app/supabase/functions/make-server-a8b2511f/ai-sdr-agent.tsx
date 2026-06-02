/**
 * AI SDR Agent — fully autonomous outbound orchestrator.
 *
 * Goal: define ICP + product + caps once, then the agent runs an
 * outbound motion end-to-end on a schedule (or on-demand): finds new
 * leads, enrolls them in a configured campaign/sequence, optionally
 * triggers AI calls on high-intent ones, and writes everything back to
 * the CRM. Operator dashboard shows what it did, with a kill switch.
 *
 * Why this exists separately from Agent Mode (DashboardAgentMode):
 *   Agent Mode surfaces *priorities* (what should YOU do next?). The
 *   SDR Agent *does the work* (no human in the loop, just guardrails).
 *   Different audience: Agent Mode for owners/managers, SDR Agent for
 *   teams who want to set-and-forget the entire outbound motion.
 *
 * State layout (KV):
 *   ai_sdr_agent:<userId>          → config + status + last_run snapshot
 *   ai_sdr_agent_log:<userId>      → array of recent run records (last 50)
 *   ai_sdr_agent_counters:<userId>:<YYYY-MM-DD> → daily cap counters
 *
 * Safety:
 *   - Kill switch (status: 'paused' | 'stopped') checked at the top of
 *     every run.
 *   - Hard daily/weekly caps. The run aborts mid-cycle if a cap is hit.
 *   - Caps are checked and persisted on every run to keep autonomous
 *     activity bounded even if several triggers fire during the day.
 */

import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { authGetUser } from "./auth-helpers.tsx";
import { searchPool, type PoolLead, type SearchCriteria } from "./lead-pool.tsx";
import { enrollLeads as enrollLeadsInSequence } from "./sequence-engine.tsx";
import { processCampaign as processAICallCampaign } from "./ai-call-processor.tsx";

const app = new Hono();
app.use("*", cors());

export type AgentStatus = 'active' | 'paused' | 'stopped';

export interface SdrAgentConfig {
  status: AgentStatus;
  // What we're looking for
  icp: {
    /** Free-text industry/role description fed to the lead finder */
    description?: string;
    /** Industry filter passed to the lead finder */
    industries?: string[];
    /** Location filter (city/state/country) */
    locations?: string[];
    /** Min/max employee count */
    min_employees?: number;
    max_employees?: number;
    /** Job titles to target */
    target_titles?: string[];
  };
  // What we're selling — used for personalization. References the
  // Products library if set, otherwise free-text product blurb.
  product_id?: string;
  product_blurb?: string;
  // Where to enroll new leads
  default_sequence_id?: string;
  default_campaign_id?: string;
  // Whether to also auto-call high-intent prospects
  auto_call: boolean;
  auto_call_min_intent_score?: number; // default 70
  // Guardrails
  daily_lead_cap: number;        // default 50
  daily_email_cap: number;       // default 150
  daily_call_cap: number;        // default 25
  // Schedule — when the agent's allowed to run
  active_hours_start?: string;   // "09:00"
  active_hours_end?: string;     // "17:00"
  active_days?: number[];        // [1,2,3,4,5] = Mon-Fri
  timezone?: string;
}

export interface SdrAgentState {
  config: SdrAgentConfig;
  last_run_at?: string;
  last_run_summary?: AgentRunSummary;
  created_at: string;
  updated_at: string;
}

export interface AgentRunSummary {
  run_id: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  leads_discovered: number;
  leads_enrolled: number;
  calls_queued: number;
  errors: string[];
  capped: boolean;  // True if a daily cap stopped the run early
  trigger: 'manual' | 'cron';
}

const DEFAULT_CONFIG: SdrAgentConfig = {
  status: 'stopped',
  icp: {},
  auto_call: false,
  auto_call_min_intent_score: 70,
  daily_lead_cap: 50,
  daily_email_cap: 150,
  daily_call_cap: 25,
  active_hours_start: '09:00',
  active_hours_end: '17:00',
  active_days: [1, 2, 3, 4, 5],
};

const stateKey = (userId: string) => `ai_sdr_agent:${userId}`;
const logKey = (userId: string) => `ai_sdr_agent_log:${userId}`;
const counterKey = (userId: string, day: string) => `ai_sdr_agent_counters:${userId}:${day}`;

// ─── Config + state CRUD ─────────────────────────────────────────────

export async function getAgentState(userId: string): Promise<SdrAgentState> {
  try {
    const raw = await kv.get(stateKey(userId));
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // Backfill missing config fields with defaults so old states keep working
      return {
        ...parsed,
        config: { ...DEFAULT_CONFIG, ...(parsed.config || {}) },
      };
    }
  } catch (err) {
    console.warn(`[SDR AGENT] getAgentState failed for ${userId}:`, err);
  }
  const now = new Date().toISOString();
  return { config: DEFAULT_CONFIG, created_at: now, updated_at: now };
}

export async function saveAgentState(userId: string, patch: Partial<SdrAgentState>): Promise<SdrAgentState> {
  const existing = await getAgentState(userId);
  const next: SdrAgentState = {
    ...existing,
    ...patch,
    config: { ...existing.config, ...(patch.config || {}) },
    updated_at: new Date().toISOString(),
  };
  await kv.set(stateKey(userId), next);
  return next;
}

export async function getAgentLog(userId: string, limit = 25): Promise<AgentRunSummary[]> {
  try {
    const raw = await kv.get(logKey(userId));
    if (!raw) return [];
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.slice(0, limit) : [];
  } catch {
    return [];
  }
}

async function pushAgentLog(userId: string, summary: AgentRunSummary): Promise<void> {
  try {
    const existing = await getAgentLog(userId, 100);
    existing.unshift(summary);
    await kv.set(logKey(userId), existing.slice(0, 50));
  } catch (err) {
    console.warn(`[SDR AGENT] pushAgentLog failed for ${userId}:`, err);
  }
}

// ─── Daily caps ──────────────────────────────────────────────────────

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface DailyCounters {
  date: string;
  leads_added: number;
  emails_enrolled: number;
  calls_queued: number;
}

export async function getDailyCounters(userId: string, day = dayKey()): Promise<DailyCounters> {
  try {
    const raw = await kv.get(counterKey(userId, day));
    if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {}
  return { date: day, leads_added: 0, emails_enrolled: 0, calls_queued: 0 };
}

async function bumpCounter(userId: string, field: keyof Omit<DailyCounters, 'date'>, amount: number): Promise<DailyCounters> {
  const day = dayKey();
  const counters = await getDailyCounters(userId, day);
  counters[field] = (counters[field] || 0) + amount;
  await kv.set(counterKey(userId, day), counters);
  return counters;
}

// ─── Schedule guard ─────────────────────────────────────────────────

function isWithinActiveWindow(config: SdrAgentConfig, now = new Date()): { allowed: boolean; reason?: string } {
  if (!config.active_hours_start || !config.active_hours_end) return { allowed: true };
  let day = now.getDay(); // 0 = Sunday
  let hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (config.timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: config.timezone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(now);
      const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const weekday = parts.find((p) => p.type === "weekday")?.value || "";
      const hour = parts.find((p) => p.type === "hour")?.value || "00";
      const minute = parts.find((p) => p.type === "minute")?.value || "00";
      day = weekdays[weekday] ?? day;
      hhmm = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    } catch {
      // Invalid timezone falls back to runtime local time.
    }
  }
  if (Array.isArray(config.active_days) && config.active_days.length > 0 && !config.active_days.includes(day)) {
    return { allowed: false, reason: `Day ${day} is not in the agent's active days` };
  }
  if (hhmm < config.active_hours_start || hhmm > config.active_hours_end) {
    return { allowed: false, reason: `Current time ${hhmm} outside active window ${config.active_hours_start}-${config.active_hours_end}` };
  }
  return { allowed: true };
}

// ─── One agent run ──────────────────────────────────────────────────

export interface RunDependencies {
  /** Returns up to `limit` new lead candidates matching the ICP.
   *  Should de-dup against the user's existing CRM internally. */
  findLeads: (icp: SdrAgentConfig['icp'], limit: number) => Promise<Array<{
    id?: string;                // optional Supabase id if already in CRM
    business_name?: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    industry?: string;
    city?: string;
    state?: string;
    country?: string;
    linkedin_url?: string;
    website_url?: string;
    source?: string;
    intent_score?: number;
  }>>;
  /** Persists the lead to CRM and returns the new lead id. */
  upsertLead: (lead: any) => Promise<string | null>;
  /** Enrolls leads into the configured sequence. Returns how many took. */
  enrollLeads: (sequenceId: string, leadIds: string[]) => Promise<number>;
  /** Schedules an AI call for a single lead. Returns true if queued. */
  queueAICall: (leadId: string) => Promise<boolean>;
}

export async function runAgentOnce(
  userId: string,
  trigger: 'manual' | 'cron',
  deps: RunDependencies,
): Promise<AgentRunSummary> {
  const runId = `run_${crypto.randomUUID()}`;
  const started = Date.now();
  const errors: string[] = [];
  let leadsDiscovered = 0;
  let leadsEnrolled = 0;
  let callsQueued = 0;
  let capped = false;

  const state = await getAgentState(userId);
  const config = state.config;

  if (config.status !== 'active') {
    const summary: AgentRunSummary = {
      run_id: runId,
      started_at: new Date(started).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      leads_discovered: 0,
      leads_enrolled: 0,
      calls_queued: 0,
      errors: [`Agent is ${config.status}, not running`],
      capped: false,
      trigger,
    };
    await pushAgentLog(userId, summary);
    return summary;
  }

  // Schedule guard — cron triggers respect this, manual triggers bypass it
  if (trigger === 'cron') {
    const sched = isWithinActiveWindow(config);
    if (!sched.allowed) {
      const summary: AgentRunSummary = {
        run_id: runId,
        started_at: new Date(started).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        leads_discovered: 0, leads_enrolled: 0, calls_queued: 0,
        errors: [sched.reason || 'Outside active window'],
        capped: false,
        trigger,
      };
      await pushAgentLog(userId, summary);
      return summary;
    }
  }

  // Daily caps
  const counters = await getDailyCounters(userId);
  const leadBudget = Math.max(0, config.daily_lead_cap - (counters.leads_added || 0));
  if (leadBudget <= 0) {
    capped = true;
    const summary: AgentRunSummary = {
      run_id: runId,
      started_at: new Date(started).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      leads_discovered: 0, leads_enrolled: 0, calls_queued: 0,
      errors: [`Daily lead cap reached (${config.daily_lead_cap})`],
      capped: true,
      trigger,
    };
    await pushAgentLog(userId, summary);
    return summary;
  }

  // 1) Find new candidates
  let candidates: any[] = [];
  try {
    candidates = await deps.findLeads(config.icp, leadBudget);
    leadsDiscovered = candidates.length;
  } catch (err: any) {
    errors.push(`Lead discovery failed: ${err?.message || err}`);
    candidates = [];
  }

  // 2) Persist to CRM
  const newLeadIds: string[] = [];
  const candidateLeadIds = new Map<number, string>();
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    try {
      const id = cand.id || await deps.upsertLead(cand);
      if (id) {
        newLeadIds.push(id);
        candidateLeadIds.set(i, id);
        await bumpCounter(userId, 'leads_added', 1);
      }
    } catch (err: any) {
      errors.push(`Upsert failed: ${err?.message || err}`);
    }
  }

  // 3) Enroll in sequence
  if (config.default_sequence_id && newLeadIds.length > 0) {
    const emailBudget = Math.max(0, config.daily_email_cap - (counters.emails_enrolled || 0));
    const toEnroll = newLeadIds.slice(0, emailBudget);
    if (toEnroll.length < newLeadIds.length) capped = true;
    try {
      leadsEnrolled = await deps.enrollLeads(config.default_sequence_id, toEnroll);
      await bumpCounter(userId, 'emails_enrolled', leadsEnrolled);
    } catch (err: any) {
      errors.push(`Enrollment failed: ${err?.message || err}`);
    }
  }

  // 4) Auto-call high-intent ones
  if (config.auto_call && config.default_campaign_id) {
    const threshold = config.auto_call_min_intent_score ?? 70;
    const callBudget = Math.max(0, config.daily_call_cap - (counters.calls_queued || 0));
    const highIntent = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => (candidate.intent_score ?? 0) >= threshold)
      .filter(({ index }) => candidateLeadIds.has(index))
      .slice(0, callBudget);
    for (const { index } of highIntent) {
      const leadId = candidateLeadIds.get(index);
      if (!leadId) continue;
      try {
        const queued = await deps.queueAICall(leadId);
        if (queued) {
          callsQueued++;
          await bumpCounter(userId, 'calls_queued', 1);
        }
      } catch (err: any) {
        errors.push(`AI call queue failed for ${leadId}: ${err?.message || err}`);
      }
    }
  }

  const summary: AgentRunSummary = {
    run_id: runId,
    started_at: new Date(started).toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    leads_discovered: leadsDiscovered,
    leads_enrolled: leadsEnrolled,
    calls_queued: callsQueued,
    errors,
    capped,
    trigger,
  };
  await pushAgentLog(userId, summary);
  await saveAgentState(userId, { last_run_at: summary.finished_at, last_run_summary: summary });
  console.log(`[SDR AGENT] ${userId} run ${runId}: ${leadsDiscovered} found / ${leadsEnrolled} enrolled / ${callsQueued} called / ${errors.length} errors`);
  return summary;
}

// ─── API helpers ────────────────────────────────────────────────────

function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

async function requireUser(c: any) {
  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  const supabase = supabaseAdmin();
  const { user, error } = await authGetUser(supabase, token, "AI-SDR-AGENT");
  if (error || !user) return { supabase, user: null };
  return { supabase, user };
}

function asArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((v) => v.trim()).filter(Boolean);
  return [];
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sanitizeConfig(input: Partial<SdrAgentConfig>, existing: SdrAgentConfig): SdrAgentConfig {
  const next = { ...existing, ...input };
  const status = (["active", "paused", "stopped"].includes(String(next.status)) ? next.status : existing.status) as AgentStatus;
  return {
    ...next,
    status,
    icp: {
      ...(existing.icp || {}),
      ...(input.icp || {}),
      industries: asArray(input.icp?.industries ?? next.icp?.industries),
      locations: asArray(input.icp?.locations ?? next.icp?.locations),
      target_titles: asArray(input.icp?.target_titles ?? next.icp?.target_titles),
    },
    auto_call: Boolean(next.auto_call),
    auto_call_min_intent_score: clampNumber(next.auto_call_min_intent_score, 70, 1, 100),
    daily_lead_cap: clampNumber(next.daily_lead_cap, 50, 1, 500),
    daily_email_cap: clampNumber(next.daily_email_cap, 150, 1, 1000),
    daily_call_cap: clampNumber(next.daily_call_cap, 25, 0, 250),
    active_days: Array.isArray(next.active_days)
      ? next.active_days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : DEFAULT_CONFIG.active_days,
  };
}

function employeeRanges(icp: SdrAgentConfig["icp"]): string[] {
  const min = Number(icp.min_employees || 0);
  const max = Number(icp.max_employees || 0);
  if (!min && !max) return [];
  const ranges = [
    [1, 10, "1,10"],
    [11, 20, "11,20"],
    [21, 50, "21,50"],
    [51, 100, "51,100"],
    [101, 200, "101,200"],
    [201, 500, "201,500"],
    [501, 1000, "501,1000"],
    [1001, 2000, "1001,2000"],
    [2001, 5000, "2001,5000"],
    [5001, 10000, "5001,10000"],
    [10001, Number.MAX_SAFE_INTEGER, "10001,"],
  ];
  return ranges
    .filter(([lo, hi]) => (!min || Number(hi) >= min) && (!max || Number(lo) <= max))
    .map(([, , bucket]) => String(bucket));
}

function poolLeadToCandidate(lead: PoolLead) {
  const phone = lead.phone_numbers?.[0]?.raw_number || lead.organization?.phone || "";
  return {
    business_name: lead.organization?.name || "",
    contact_name: lead.name || [lead.first_name, lead.last_name].filter(Boolean).join(" "),
    first_name: lead.first_name || "",
    last_name: lead.last_name || "",
    title: lead.title || "",
    email: lead.email || "",
    phone,
    industry: lead.organization?.industry || "",
    city: lead.city || lead.organization?.city || "",
    state: lead.state || lead.organization?.state || "",
    country: lead.country || lead.organization?.country || "",
    linkedin_url: lead.linkedin_url || "",
    company_linkedin_url: lead.organization?.linkedin_url || "",
    website_url: lead.organization?.website_url || "",
    source: "ai_sdr_agent",
    intent_score: lead.email_status === "verified" ? 80 : 65,
  };
}

async function buildRunDependencies(userId: string, config: SdrAgentConfig, supabase: any): Promise<RunDependencies> {
  return {
    findLeads: async (icp, limit) => {
      const existingEmails = new Set<string>();
      const { data: existing } = await supabase
        .from("leads")
        .select("email")
        .eq("user_id", userId)
        .not("email", "is", null)
        .limit(5000);
      for (const row of existing || []) {
        if (row.email) existingEmails.add(String(row.email).toLowerCase());
      }

      const criteria: SearchCriteria = {
        person_titles: asArray(icp.target_titles),
        organization_locations: asArray(icp.locations),
        organization_industries: asArray(icp.industries),
        organization_num_employees_ranges: employeeRanges(icp),
        q_keywords: icp.description || asArray(icp.industries).join(" "),
        max_results: limit,
      };

      const pool = await searchPool(criteria, existingEmails, limit);
      return pool.leads.slice(0, limit).map(poolLeadToCandidate);
    },
    upsertLead: async (lead: any) => {
      const email = String(lead.email || "").trim().toLowerCase();
      if (!email) return null;

      const { data: found } = await supabase
        .from("leads")
        .select("id")
        .eq("user_id", userId)
        .eq("email", email)
        .maybeSingle();
      if (found?.id) return found.id;

      const insert = {
        user_id: userId,
        business_name: lead.business_name || lead.company || "",
        contact_name: lead.contact_name || "",
        first_name: lead.first_name || "",
        last_name: lead.last_name || "",
        title: lead.title || "",
        email,
        phone: lead.phone || "",
        category: lead.industry || "",
        city: lead.city || "",
        state: lead.state || "",
        country: lead.country || "",
        person_linkedin_url: lead.linkedin_url || "",
        website: lead.website_url || "",
        source: "ai_sdr_agent",
        status: "new",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase.from("leads").insert(insert).select("id").single();
      if (error) throw error;
      return data?.id || null;
    },
    enrollLeads: async (sequenceId, leadIds) => {
      if (!leadIds.length) return 0;
      const result = await enrollLeadsInSequence(userId, sequenceId, leadIds);
      return result.enrolled;
    },
    queueAICall: async (leadId) => {
      if (!config.default_campaign_id) return false;
      const key = `ai-call-campaign:${userId}:${config.default_campaign_id}`;
      const campaign = await kv.get(key);
      if (!campaign) throw new Error("AI call campaign not found");
      const selected = Array.isArray(campaign.selected_leads) ? campaign.selected_leads : [];
      if (!selected.includes(leadId)) selected.push(leadId);
      const next = {
        ...campaign,
        selected_leads: selected,
        total_leads: selected.length,
        status: "active",
        updated_at: new Date().toISOString(),
      };
      await kv.set(key, next);
      processAICallCampaign(config.default_campaign_id!, userId, next).catch((err) => {
        console.error(`[SDR AGENT] AI call processor failed for ${leadId}:`, err);
      });
      return true;
    },
  };
}

// ─── Routes ─────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const { user } = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const [state, counters, log] = await Promise.all([
    getAgentState(user.id),
    getDailyCounters(user.id),
    getAgentLog(user.id, 25),
  ]);
  return c.json({ success: true, state, counters, log });
});

app.put("/", async (c) => {
  const { user } = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const existing = await getAgentState(user.id);
  const config = sanitizeConfig(body.config || body, existing.config);
  const state = await saveAgentState(user.id, { config });
  return c.json({ success: true, state });
});

app.post("/run", async (c) => {
  const { supabase, user } = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const state = await getAgentState(user.id);
  const deps = await buildRunDependencies(user.id, state.config, supabase);
  const summary = await runAgentOnce(user.id, "manual", deps);
  const counters = await getDailyCounters(user.id);
  return c.json({ success: true, summary, counters });
});

app.post("/status", async (c) => {
  const { user } = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const existing = await getAgentState(user.id);
  const status = (["active", "paused", "stopped"].includes(String(body.status)) ? body.status : existing.config.status) as AgentStatus;
  const state = await saveAgentState(user.id, { config: { ...existing.config, status } });
  return c.json({ success: true, state });
});

export default app;

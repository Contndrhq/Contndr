import { Hono } from "npm:hono";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";

const app = new Hono();

// ─── Supabase Admin Client ──────────────────────────────────────────
let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );
  }
  return _supabase;
}

// ─── Auth helper ─────────────────────────────────────────────────────
async function getUserId(c: any): Promise<string | null> {
  const token = c.req.header("Authorization")?.split(" ")[1];
  if (!token) return null;
  const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(getSupabase(), token, "PIPELINE");
  if (error || !user?.id) return null;
  return user.id;
}

async function getFullUser(c: any): Promise<{ id: string; email: string } | null> {
  const token = c.req.header("Authorization")?.split(" ")[1];
  if (!token) return null;
  const { user, error } = await (await import("./auth-helpers.tsx")).authGetUser(getSupabase(), token, "PIPELINE");
  if (error || !user?.id) return null;
  return { id: user.id, email: user.email || "" };
}

// ─── KV key helpers ──────────────────────────────────────────────────
const dealsKey = (userId: string) => `pipeline:${userId}:deals`;
const settingsKey = (userId: string) => `pipeline:${userId}:settings`;
const aiInsightsKey = (userId: string) => `pipeline:${userId}:ai_insights`;
const triggerLogKey = (userId: string) => `pipeline:${userId}:trigger_log`;
const calendlyConfigKey = (userId: string) => `pipeline:${userId}:calendly_config`;

const INTERNAL_PIPELINE_OWNER_IDS: Record<string, string[]> = {};

function getPipelineReadOwnerIds(user: { id: string; email: string }): string[] {
  const linked = INTERNAL_PIPELINE_OWNER_IDS[user.email.toLowerCase().trim()] || [];
  return Array.from(new Set([user.id, ...linked]));
}

async function readPipelineDealsForUser(user: { id: string; email: string }): Promise<PipelineDeal[]> {
  for (const ownerId of getPipelineReadOwnerIds(user)) {
    const raw = await kv.get(dealsKey(ownerId));
    const deals: PipelineDeal[] = raw ? JSON.parse(raw) : [];
    if (deals.length > 0) return deals;
  }
  return [];
}

// ─── Demo auto-seed ──────────────────────────────────────────────────
const DEMO_EMAIL = "demo@contndr.com";
function _ri(a: number, b: number) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function _rp<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }

async function autoSeedDemoPipeline(userId: string): Promise<PipelineDeal[]> {
  console.log("[PIPELINE] Auto-seeding demo pipeline for demo account...");
  const now = new Date();
  const C = [
    { n:"Sarah Chen",b:"Luminary AI",c:"SaaS"},{ n:"Michael Torres",b:"GreenShift Labs",c:"Enterprise"},
    { n:"Emily Johansson",b:"NovaPeak Ventures",c:"Startup"},{ n:"James Okafor",b:"TrueNorth Analytics",c:"SaaS"},
    { n:"Jessica Park",b:"Meridian Health",c:"Enterprise"},{ n:"David Kessler",b:"Apex Growth Co",c:"Agency"},
    { n:"Amanda Liu",b:"CloudVault Systems",c:"SaaS"},{ n:"Robert Vasquez",b:"Ironwood Digital",c:"E-commerce"},
    { n:"Nicole Bauer",b:"Quantum Edge",c:"Startup"},{ n:"Christopher Patel",b:"Summit Strategies",c:"Agency"},
    { n:"Ashley Moreau",b:"BrightPath Consulting",c:"Enterprise"},{ n:"Daniel Kim",b:"Reef Capital Group",c:"SaaS"},
    { n:"Melissa Harper",b:"Vistara Commerce",c:"E-commerce"},{ n:"Ryan Whitfield",b:"PolarisX Labs",c:"Startup"},
    { n:"Karen Sullivan",b:"Helix Innovations",c:"SaaS"},{ n:"Andrew Nakamura",b:"TideWater Solutions",c:"Enterprise"},
    { n:"Lisa Fernandez",b:"Ember Creative",c:"Agency"},{ n:"Kevin Oduya",b:"Stratos Technologies",c:"SaaS"},
    { n:"Angela Rossi",b:"Canopy Health Group",c:"Enterprise"},{ n:"Matthew Ingram",b:"SilverLine Partners",c:"Agency"},
    { n:"Joshua Wu",b:"FrostByte Security",c:"SaaS"},{ n:"Michelle Dubois",b:"Elevate Marketing",c:"Agency"},
    { n:"Brian Novak",b:"CrestPoint Capital",c:"Enterprise"},{ n:"Jennifer Stein",b:"Bluewave Logistics",c:"E-commerce"},
    { n:"Rachel Adams",b:"Nimbly HQ",c:"Startup"},{ n:"Marcus Thompson",b:"Zenith Payments",c:"SaaS"},
    { n:"Sophia Grant",b:"Prism Analytics",c:"SaaS"},{ n:"Ethan Calloway",b:"RedOak Ventures",c:"Startup"},
  ];
  const SD: Record<string,number> = { prospect_identified:5,contacted:5,engaged:4,meeting_booked:4,proposal_sent:3,negotiation:3,closed_won:3,closed_lost:1 };
  const VR: Record<string,[number,number]> = { prospect_identified:[2000,12000],contacted:[3000,18000],engaged:[5000,25000],meeting_booked:[8000,40000],proposal_sent:[12000,65000],negotiation:[15000,85000],closed_won:[10000,120000],closed_lost:[5000,30000] };
  const NA=["Send follow-up with case study","Schedule product demo","Share pricing proposal","Follow up on proposal feedback","Send contract for review","Book a closing call","Reconnect with a new value prop","Send ROI analysis report"];
  const RL: Array<"low"|"medium"|"high">=["low","low","low","medium","medium","high"];
  const TG=["manual","email_sent","email_opened","email_replied","meeting_booked"];
  const deals: PipelineDeal[]=[];
  let ci=0;
  for(const stage of PIPELINE_STAGES){
    const cnt=SD[stage]||1;
    for(let i=0;i<cnt&&ci<C.length;i++,ci++){
      const ct=C[ci]; const da=_ri(2,60);
      const ca=new Date(now.getTime()-da*864e5).toISOString();
      const sed=Math.min(da,_ri(1,20));
      const sea=new Date(now.getTime()-sed*864e5).toISOString();
      const[lo,hi]=VR[stage]||[5e3,5e4];
      const val=Math.round(_ri(lo,hi)/500)*500;
      const dom=ct.b.toLowerCase().replace(/\s+/g,"")+".com";
      const sh:Array<{stage:string;entered_at:string;trigger?:string}>=[];
      const si=STAGE_INDEX[stage]??0;
      for(let s=0;s<=si;s++){
        const dA=da-(si-s)*_ri(2,5);
        sh.push({stage:PIPELINE_STAGES[s],entered_at:new Date(now.getTime()-Math.max(dA,1)*864e5).toISOString(),trigger:s>0?_rp(TG):undefined});
      }
      const ec=stage!=="closed_won"&&stage!=="closed_lost"?new Date(now.getTime()+_ri(7,45)*864e5).toISOString().split("T")[0]:undefined;
      deals.push({
        id:crypto.randomUUID(),contact_name:ct.n,business_name:ct.b,
        email:`${ct.n.split(" ")[0].toLowerCase()}@${dom}`,stage,value:val,currency:"USD",notes:"",category:ct.c,
        created_at:ca,updated_at:sea,
        closed_at:stage==="closed_won"||stage==="closed_lost"?sea:undefined,
        expected_close_date:ec,
        ai_score:stage==="closed_won"?95:stage==="closed_lost"?12:_ri(25,92),
        ai_next_action:stage!=="closed_won"&&stage!=="closed_lost"?_rp(NA):undefined,
        ai_risk_level:stage==="closed_won"?"low":stage==="closed_lost"?"high":_rp(RL),
        ai_predicted_close_date:ec,stage_history:sh,days_in_stage:sed,
      });
    }
  }
  await kv.set(dealsKey(userId),JSON.stringify(deals));
  // Also seed AI insights
  const ins={
    health_score:74,
    summary:"Your pipeline is healthy with strong mid-funnel activity. Focus on moving 4 engaged deals to meeting stage to maintain velocity.",
    deal_scores:deals.filter(d=>d.stage!=="closed_won"&&d.stage!=="closed_lost").map(d=>({deal_id:d.id,score:d.ai_score,risk_level:d.ai_risk_level,next_action:d.ai_next_action,predicted_days_to_close:_ri(7,35)})),
    recommendations:["Schedule demos for the 4 engaged prospects this week — they show high intent signals.","The negotiation stage has 3 deals worth $165K total; send revised proposals within 48 hours.","Re-engage the 5 prospects in the early stage with a personalized case study sequence.","Your win rate is trending up — maintain momentum by focusing on deals in proposal stage."],
    risk_deals:deals.filter(d=>d.ai_risk_level==="high"&&d.stage!=="closed_lost").map(d=>d.id),
    top_opportunities:deals.filter(d=>d.value>=40000&&d.stage!=="closed_lost").map(d=>d.id).slice(0,3),
    bottleneck_stage:"proposal_sent",forecast_adjustment:"+12% from last week",generated_at:now.toISOString(),
  };
  await kv.set(aiInsightsKey(userId),JSON.stringify(ins));
  console.log(`[PIPELINE] Auto-seeded ${deals.length} demo deals + AI insights`);
  return deals;
}

// ─── Pipeline stages ─────────────────────────────────────────────────
export const PIPELINE_STAGES = [
  "prospect_identified",
  "contacted",
  "engaged",
  "meeting_booked",
  "proposal_sent",
  "negotiation",
  "closed_won",
  "closed_lost",
] as const;

export const STAGE_LABELS: Record<string, string> = {
  prospect_identified: "Prospect Identified",
  contacted: "Contacted",
  engaged: "Engaged",
  meeting_booked: "Meeting Booked",
  proposal_sent: "Proposal Sent",
  negotiation: "Negotiation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};

const STAGE_INDEX: Record<string, number> = {
  prospect_identified: 0,
  contacted: 1,
  engaged: 2,
  meeting_booked: 3,
  proposal_sent: 4,
  negotiation: 5,
  closed_won: 6,
  closed_lost: 7,
};

const STAGE_PROBABILITY: Record<string, number> = {
  prospect_identified: 0.1,
  contacted: 0.2,
  engaged: 0.35,
  meeting_booked: 0.5,
  proposal_sent: 0.65,
  negotiation: 0.8,
  closed_won: 1.0,
  closed_lost: 0,
};

// ─── Stage → CRM lead status mapping ────────────────────────────────
const STAGE_TO_LEAD_STATUS: Record<string, string> = {
  prospect_identified: "Cold",
  contacted: "Warm",
  engaged: "Interested",
  meeting_booked: "Hot",
  proposal_sent: "Hot",
  negotiation: "Hot",
  closed_won: "Customer",
  closed_lost: "Churned",
};

/**
 * Sync a pipeline deal's stage change back to the CRM lead status.
 * Fire-and-forget — never throws to caller.
 */
async function syncLeadStatus(userId: string, deal: PipelineDeal, newStage: string): Promise<void> {
  try {
    if (!deal.lead_id) return;
    const newStatus = STAGE_TO_LEAD_STATUS[newStage];
    if (!newStatus) return;
    const supabase = getSupabase();
    const { error } = await supabase
      .from("leads")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", deal.lead_id)
      .eq("user_id", userId);
    if (error) {
      console.log(`[PIPELINE SYNC] Failed to sync lead ${deal.lead_id} status to "${newStatus}": ${error.message}`);
    } else {
      console.log(`[PIPELINE SYNC] Lead ${deal.lead_id} status → "${newStatus}" (deal stage: ${newStage})`);
    }
  } catch (err: any) {
    console.error(`[PIPELINE SYNC] Error syncing lead status: ${err.message}`);
  }
}

export interface PipelineDeal {
  id: string;
  contact_name: string;
  business_name: string;
  email: string;
  stage: string;
  value: number;
  currency: string;
  notes: string;
  category: string;
  lead_id?: string;
  is_recurring?: boolean;
  recurring_interval?: "month" | "year";
  created_at: string;
  updated_at: string;
  closed_at?: string;
  expected_close_date?: string;
  // Integration fields
  stripe_payment_id?: string;
  stripe_invoice_id?: string;
  stripe_payment_status?: string;
  stripe_payment_url?: string;
  qbo_invoice_id?: string;
  qbo_invoice_number?: string;
  qbo_invoice_status?: string;
  // AI fields
  ai_score?: number;
  ai_next_action?: string;
  ai_risk_level?: "low" | "medium" | "high";
  ai_predicted_close_date?: string;
  // Activity tracking
  stage_history?: Array<{ stage: string; entered_at: string; trigger?: string }>;
  days_in_stage?: number;
}

// ═══════════════════════════════════════════════════════════════════════
// AUTO-STAGE TRIGGER SYSTEM
// ═══════════════════════════════════════════════════════════════════════
// Exported function callable from other server modules (email-sender,
// inbox, campaign-worker, etc.) without going through HTTP.
//
// Event types and their target stages:
//   email_sent      → contacted   (only if currently prospect_identified)
//   email_opened    → contacted   (only if prospect_identified)
//   email_replied   → engaged     (if prospect_identified or contacted)
//   meeting_booked  → meeting_booked (if before meeting_booked)
//   proposal_sent   → proposal_sent  (if before proposal_sent)
//   invoice_paid    → closed_won  (any active stage)
// ═══════════════════════════════════════════════════════════════════════

interface TriggerEvent {
  event_type: "email_sent" | "email_opened" | "email_clicked" | "email_replied" | "meeting_booked" | "proposal_sent" | "invoice_paid";
  user_id: string;
  email?: string;      // lead email to match
  lead_id?: string;    // lead id to match
  metadata?: Record<string, any>;
}

// Maps event types to the target stage and the max current-stage index
// that allows the advancement (prevents backward moves).
const TRIGGER_RULES: Record<string, { target: string; max_current_index: number }> = {
  email_sent:     { target: "contacted",       max_current_index: 0 },  // only from prospect_identified
  email_opened:   { target: "contacted",       max_current_index: 0 },
  email_clicked:  { target: "contacted",       max_current_index: 0 },
  email_replied:  { target: "engaged",         max_current_index: 1 },  // from prospect_identified or contacted
  meeting_booked: { target: "meeting_booked",  max_current_index: 2 },  // from anything before meeting_booked
  proposal_sent:  { target: "proposal_sent",   max_current_index: 3 },
  invoice_paid:   { target: "closed_won",      max_current_index: 5 },  // any active stage up to negotiation
};

/**
 * Fire a pipeline trigger. Call this from email-sender, inbox, etc.
 * It finds matching deals by email/lead_id and advances them if the rule allows.
 * Designed to be fire-and-forget (never throws to caller).
 */
export async function firePipelineTrigger(event: TriggerEvent): Promise<void> {
  try {
    const { event_type, user_id, email, lead_id } = event;
    const rule = TRIGGER_RULES[event_type];
    if (!rule) return;

    const raw = await kv.get(dealsKey(user_id));
    const deals: PipelineDeal[] = raw ? JSON.parse(raw) : [];

    let modified = false;
    let foundDeal = false;
    const now = new Date().toISOString();

    for (let i = 0; i < deals.length; i++) {
      const deal = deals[i];
      // Skip closed deals
      if (deal.stage === "closed_won" || deal.stage === "closed_lost") continue;

      // Match by email or lead_id
      const emailMatch = email && deal.email && deal.email.toLowerCase() === email.toLowerCase();
      const leadMatch = lead_id && deal.lead_id && deal.lead_id === lead_id;
      if (!emailMatch && !leadMatch) continue;

      foundDeal = true;

      // Check if current stage allows advancement
      const currentIdx = STAGE_INDEX[deal.stage] ?? 99;
      if (currentIdx > rule.max_current_index) continue; // already past this stage

      // Advance the deal
      const oldStage = deal.stage;
      deal.stage = rule.target;
      deal.updated_at = now;
      deal.stage_history = [
        ...(deal.stage_history || []),
        { stage: rule.target, entered_at: now, trigger: event_type },
      ];

      // closed_won from invoice_paid
      if (rule.target === "closed_won") {
        deal.closed_at = now;
        // Log admin event for auto-closed deal
        try {
          const { logAdminEvent } = await import("./admin-events.tsx");
          const val = deal.value ? ` — $${Number(deal.value).toLocaleString()}` : '';
          logAdminEvent('deal_closed', 'Deal Won (Auto)', `${deal.contact_name || deal.business_name || 'Deal'} auto-closed via ${event_type}${val}`, {
            email: deal.email,
            metadata: { dealId: deal.id, value: deal.value, trigger: event_type }
          }).catch(() => {});
        } catch (_) {}
      }

      modified = true;
      console.log(`[PIPELINE TRIGGER] ${event_type}: deal "${deal.contact_name}" ${oldStage} → ${rule.target}`);
      // Sync to CRM lead status
      syncLeadStatus(user_id, deal, rule.target);

      // Enrich trigger log with deal context for the activity feed
      try {
        const logRaw = (await kv.get(triggerLogKey(user_id))) || [];
        const logArr = Array.isArray(logRaw) ? logRaw : [];
        logArr.unshift({
          ...event,
          triggered_at: now,
          deal_id: deal.id,
          deal_contact: deal.contact_name,
          deal_business: deal.business_name,
          deal_value: deal.value,
          old_stage: oldStage,
          new_stage: rule.target,
        });
        await kv.set(triggerLogKey(user_id), logArr.slice(0, 200));
      } catch { /* best-effort per-deal log */ }
    }

    // Auto-create deal if none exists and intent is high
    if (!foundDeal && (event_type === "email_opened" || event_type === "email_clicked" || event_type === "email_replied")) {
      const supabase = getSupabase();
      let leadToUse: any = null;

      if (lead_id) {
        const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
        leadToUse = data;
      } else if (email) {
        const { data } = await supabase.from('leads').select('*').eq('email', email).eq('user_id', user_id).limit(1).maybeSingle();
        leadToUse = data;
      }

      if (leadToUse) {
        const targetStage = rule.target;
        const newDeal: PipelineDeal = {
          id: crypto.randomUUID(),
          contact_name: leadToUse.contact_name || "",
          business_name: leadToUse.business_name || "",
          email: leadToUse.email || email || "",
          stage: targetStage,
          value: 0,
          currency: "USD",
          notes: `Auto-created from ${event_type}`,
          category: leadToUse.category || "",
          lead_id: leadToUse.id,
          created_at: now,
          updated_at: now,
          stage_history: [{ stage: targetStage, entered_at: now, trigger: event_type }],
        };
        deals.push(newDeal);
        modified = true;
        console.log(`[PIPELINE TRIGGER] Auto-created deal for lead ${leadToUse.id} via ${event_type} into stage ${targetStage}`);
        
        // Enrich trigger log
        try {
          const logRaw = (await kv.get(triggerLogKey(user_id))) || [];
          const logArr = Array.isArray(logRaw) ? logRaw : [];
          logArr.unshift({
            ...event,
            triggered_at: now,
            deal_id: newDeal.id,
            deal_contact: newDeal.contact_name,
            deal_business: newDeal.business_name,
            deal_value: newDeal.value,
            old_stage: "none",
            new_stage: targetStage,
          });
          await kv.set(triggerLogKey(user_id), logArr.slice(0, 200));
        } catch { /* ignore */ }
      }
    }

    if (modified) {
      await kv.set(dealsKey(user_id), JSON.stringify(deals));
    }
  } catch (err: any) {
    // Fire-and-forget — never crash the caller
    console.error(`[PIPELINE TRIGGER] Error processing ${event.event_type}:`, err.message);
  }
}

// ─── REST endpoint for trigger (internal / service-key calls) ────────
app.post("/triggers/event", async (c) => {
  // Accept service-key or user JWT
  const token = c.req.header("Authorization")?.split(" ")[1];
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  let userId: string | null = null;

  if (token === serviceKey) {
    // Service-key call — user_id must be in body
    const body = await c.req.json();
    userId = body.user_id;
    if (!userId) return c.json({ error: "user_id required for service-key calls" }, 400);
    await firePipelineTrigger({ ...body, user_id: userId });
    return c.json({ ok: true });
  }

  userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json();
  await firePipelineTrigger({ ...body, user_id: userId });
  return c.json({ ok: true });
});

// GET trigger log
app.get("/triggers/log", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const log = (await kv.get(triggerLogKey(userId))) || [];
  return c.json({ log: Array.isArray(log) ? log : [] });
});

// ═══════════════════════════════════════════════════════════════════════
// CRUD ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

app.get("/deals", async (c) => {
  const user = await getFullUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  try {
    let deals = await readPipelineDealsForUser(user);
    // Auto-seed demo pipeline if demo account has no deals
    if (deals.length === 0 && user.email.toLowerCase().trim() === DEMO_EMAIL) {
      deals = await autoSeedDemoPipeline(user.id);
    }
    return c.json({ deals });
  } catch (err: any) {
    console.log(`[PIPELINE] Error fetching deals: ${err.message}`);
    return c.json({ error: "Failed to fetch deals", message: err.message }, 500);
  }
});

// ─── GET /lead-ids — lightweight set of lead_ids in pipeline ─────────
app.get("/lead-ids", async (c) => {
  const user = await getFullUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  try {
    const deals = await readPipelineDealsForUser(user);
    const leadIds = deals
      .filter((d) => d.lead_id && d.stage !== "closed_lost")
      .map((d) => ({ lead_id: d.lead_id!, stage: d.stage }));
    return c.json({ lead_ids: leadIds });
  } catch (err: any) {
    console.log(`[PIPELINE] Error fetching lead-ids: ${err.message}`);
    return c.json({ error: "Failed to fetch pipeline lead IDs", message: err.message }, 500);
  }
});

app.post("/deals", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  try {
    const body = await c.req.json();
    const raw = await kv.get(dealsKey(userId));
    const deals: PipelineDeal[] = raw ? JSON.parse(raw) : [];
    const now = new Date().toISOString();
    const newDeal: PipelineDeal = {
      id: crypto.randomUUID(),
      contact_name: body.contact_name || "",
      business_name: body.business_name || "",
      email: body.email || "",
      stage: body.stage || "prospect_identified",
      value: Number(body.value) || 0,
      currency: body.currency || "USD",
      notes: body.notes || "",
      category: body.category || "",
      lead_id: body.lead_id || undefined,
      is_recurring: body.is_recurring || false,
      recurring_interval: body.recurring_interval || undefined,
      created_at: now,
      updated_at: now,
      expected_close_date: body.expected_close_date || undefined,
      stage_history: [{ stage: body.stage || "prospect_identified", entered_at: now }],
    };
    deals.push(newDeal);
    await kv.set(dealsKey(userId), JSON.stringify(deals));
    return c.json({ deal: newDeal }, 201);
  } catch (err: any) {
    console.log(`[PIPELINE] Error creating deal: ${err.message}`);
    return c.json({ error: "Failed to create deal", message: err.message }, 500);
  }
});

// ─── POST /deals/from-leads — Bulk import CRM leads into pipeline ────
app.post("/deals/from-leads", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  try {
    const { lead_ids, stage = "prospect_identified" } = await c.req.json();
    if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
      return c.json({ error: "lead_ids array is required" }, 400);
    }

    console.log(`[PIPELINE] Importing ${lead_ids.length} leads into stage "${stage}" for user ${userId}`);

    const supabase = getSupabase();
    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("id, contact_name, business_name, email, category, city, job_title, phone, website")
      .in("id", lead_ids)
      .eq("user_id", userId);

    if (leadsError) {
      console.log(`[PIPELINE] Error fetching leads: ${leadsError.message}`);
      return c.json({ error: "Failed to fetch leads", message: leadsError.message }, 500);
    }

    if (!leads || leads.length === 0) {
      return c.json({ error: "No leads found for the provided IDs" }, 404);
    }

    const raw = await kv.get(dealsKey(userId));
    const deals: any[] = raw ? JSON.parse(raw) : [];

    const existingLeadIds = new Set(deals.filter((d: any) => d.lead_id).map((d: any) => d.lead_id));
    const now = new Date().toISOString();

    let created = 0;
    let skipped = 0;
    const newDeals: any[] = [];

    for (const lead of leads) {
      if (existingLeadIds.has(lead.id)) {
        skipped++;
        continue;
      }

      const newDeal = {
        id: crypto.randomUUID(),
        contact_name: lead.contact_name || "",
        business_name: lead.business_name || "",
        email: lead.email || "",
        stage,
        value: 0,
        currency: "USD",
        notes: [
          lead.job_title ? `Title: ${lead.job_title}` : "",
          lead.city ? `Location: ${lead.city}` : "",
          lead.phone ? `Phone: ${lead.phone}` : "",
          lead.website ? `Website: ${lead.website}` : "",
        ].filter(Boolean).join("\n"),
        category: lead.category || "",
        lead_id: lead.id,
        created_at: now,
        updated_at: now,
        stage_history: [{ stage, entered_at: now, trigger: "crm_import" }],
      };

      newDeals.push(newDeal);
      created++;
    }

    if (newDeals.length > 0) {
      deals.push(...newDeals);
      await kv.set(dealsKey(userId), JSON.stringify(deals));
    }

    console.log(`[PIPELINE] Import complete: ${created} created, ${skipped} skipped (duplicates)`);
    return c.json({ success: true, created, skipped, deals: newDeals }, 201);
  } catch (err: any) {
    console.log(`[PIPELINE] Error importing leads: ${err.message}`);
    return c.json({ error: "Failed to import leads", message: err.message }, 500);
  }
});

app.put("/deals/:id", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const dealId = c.req.param("id");
  try {
    const body = await c.req.json();
    const raw = await kv.get(dealsKey(userId));
    const deals: PipelineDeal[] = raw ? JSON.parse(raw) : [];
    const idx = deals.findIndex((d) => d.id === dealId);
    if (idx === -1) return c.json({ error: "Deal not found" }, 404);
    const now = new Date().toISOString();
    const oldStage = deals[idx].stage;
    const newStage = body.stage || oldStage;
    let closedAt = deals[idx].closed_at;
    if ((newStage === "closed_won" || newStage === "closed_lost") && oldStage !== newStage) {
      closedAt = now;
    } else if (newStage !== "closed_won" && newStage !== "closed_lost") {
      closedAt = undefined;
    }
    let stageHistory = deals[idx].stage_history || [];
    if (newStage !== oldStage) {
      stageHistory = [...stageHistory, { stage: newStage, entered_at: now }];
    }
    deals[idx] = { ...deals[idx], ...body, id: dealId, updated_at: now, closed_at: closedAt, stage_history: stageHistory };
    await kv.set(dealsKey(userId), JSON.stringify(deals));
    // Sync stage change back to CRM lead status
    if (newStage !== oldStage) {
      syncLeadStatus(userId, deals[idx], newStage);
      // Log admin event for deal closures
      if (newStage === 'closed_won' || newStage === 'closed_lost') {
        try {
          const { logAdminEvent } = await import("./admin-events.tsx");
          const deal = deals[idx];
          const val = deal.value ? ` — $${Number(deal.value).toLocaleString()}` : '';
          if (newStage === 'closed_won') {
            logAdminEvent('deal_closed', 'Deal Won', `${deal.contact_name || deal.business_name || 'Deal'} closed won${val}`, {
              email: deal.email,
              metadata: { dealId, value: deal.value, business: deal.business_name }
            }).catch(() => {});
          }
        } catch (_) {}
      }
    }
    return c.json({ deal: deals[idx] });
  } catch (err: any) {
    console.log(`[PIPELINE] Error updating deal ${dealId}: ${err.message}`);
    return c.json({ error: "Failed to update deal", message: err.message }, 500);
  }
});

app.delete("/deals/:id", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const dealId = c.req.param("id");
  try {
    const raw = await kv.get(dealsKey(userId));
    const deals: PipelineDeal[] = raw ? JSON.parse(raw) : [];
    const filtered = deals.filter((d) => d.id !== dealId);
    if (filtered.length === deals.length) return c.json({ error: "Deal not found" }, 404);
    await kv.set(dealsKey(userId), JSON.stringify(filtered));
    return c.json({ ok: true });
  } catch (err: any) {
    console.log(`[PIPELINE] Error deleting deal ${dealId}: ${err.message}`);
    return c.json({ error: "Failed to delete deal", message: err.message }, 500);
  }
});

// ─── GET /metrics ────────────────────────────────────────────────────
app.get("/metrics", async (c) => {
  const user = await getFullUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  try {
    let deals = await readPipelineDealsForUser(user);
    // Auto-seed demo pipeline if demo account has no deals
    if (deals.length === 0 && user.email.toLowerCase().trim() === DEMO_EMAIL) {
      deals = await autoSeedDemoPipeline(user.id);
    }
    const activeDeals = deals.filter((d) => d.stage !== "closed_won" && d.stage !== "closed_lost");
    const wonDeals = deals.filter((d) => d.stage === "closed_won");
    const lostDeals = deals.filter((d) => d.stage === "closed_lost");
    const totalPipelineValue = activeDeals.reduce((sum, d) => sum + (d.value || 0), 0);
    const wonValue = wonDeals.reduce((sum, d) => sum + (d.value || 0), 0);
    const closedCount = wonDeals.length + lostDeals.length;
    const closeRate = closedCount > 0 ? (wonDeals.length / closedCount) * 100 : 0;
    const forecast = activeDeals.reduce((sum, d) => sum + (d.value || 0) * (STAGE_PROBABILITY[d.stage] || 0), 0);
    const stageCounts: Record<string, number> = {};
    const stageValues: Record<string, number> = {};
    for (const stage of PIPELINE_STAGES) { stageCounts[stage] = 0; stageValues[stage] = 0; }
    for (const deal of deals) {
      stageCounts[deal.stage] = (stageCounts[deal.stage] || 0) + 1;
      stageValues[deal.stage] = (stageValues[deal.stage] || 0) + (deal.value || 0);
    }
    let avgDaysToClose = 0;
    if (wonDeals.length > 0) {
      const totalDays = wonDeals.reduce((sum, d) => {
        const created = new Date(d.created_at).getTime();
        const closed = new Date(d.closed_at || d.updated_at).getTime();
        return sum + (closed - created) / (1000 * 60 * 60 * 24);
      }, 0);
      avgDaysToClose = Math.round(totalDays / wonDeals.length);
    }
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklyVelocity = deals.filter((d) => new Date(d.updated_at).getTime() > weekAgo).length;
    return c.json({
      totalDeals: deals.length, activeDeals: activeDeals.length, wonDeals: wonDeals.length,
      lostDeals: lostDeals.length, totalPipelineValue, wonValue,
      closeRate: Math.round(closeRate * 10) / 10, forecast: Math.round(forecast),
      stageCounts, stageValues, avgDaysToClose, weeklyVelocity,
    });
  } catch (err: any) {
    console.log(`[PIPELINE] Error computing metrics: ${err.message}`);
    return c.json({ error: "Failed to compute metrics", message: err.message }, 500);
  }
});

// ─── POST /deals/:id/move ────────────────────────────────────────────
app.post("/deals/:id/move", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const dealId = c.req.param("id");
  try {
    const { stage } = await c.req.json();
    if (!stage || !PIPELINE_STAGES.includes(stage)) return c.json({ error: "Invalid stage" }, 400);
    const raw = await kv.get(dealsKey(userId));
    const deals: PipelineDeal[] = raw ? JSON.parse(raw) : [];
    const idx = deals.findIndex((d) => d.id === dealId);
    if (idx === -1) return c.json({ error: "Deal not found" }, 404);
    const now = new Date().toISOString();
    const oldStage = deals[idx].stage;
    let closedAt = deals[idx].closed_at;
    if ((stage === "closed_won" || stage === "closed_lost") && oldStage !== stage) closedAt = now;
    else if (stage !== "closed_won" && stage !== "closed_lost") closedAt = undefined;
    const stageHistory = [...(deals[idx].stage_history || []), { stage, entered_at: now }];
    deals[idx] = { ...deals[idx], stage, updated_at: now, closed_at: closedAt, stage_history: stageHistory, days_in_stage: 0 };
    await kv.set(dealsKey(userId), JSON.stringify(deals));
    // Sync stage change back to CRM lead status
    if (stage !== oldStage) {
      syncLeadStatus(userId, deals[idx], stage);
    }
    return c.json({ deal: deals[idx] });
  } catch (err: any) {
    console.log(`[PIPELINE] Error moving deal ${dealId}: ${err.message}`);
    return c.json({ error: "Failed to move deal", message: err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// INTEGRATION STATUS
// ═══════════════════════════════════════════════════════════════════════

async function getUserStripeKey(userId: string): Promise<string | null> {
  let apiKey = await kv.get(`stripe_config:${userId}:default:secret_key`);
  if (!apiKey) apiKey = Deno.env.get("STRIPE_SECRET_KEY");
  return apiKey || null;
}

async function getQboConnection(userId: string): Promise<any | null> {
  const data = await kv.get(`qbo_connection:${userId}`);
  if (!data || (typeof data === "object" && data.status === "disconnected")) return null;
  return typeof data === "string" ? JSON.parse(data) : data;
}

async function getQboValidToken(userId: string): Promise<string | null> {
  const conn = await getQboConnection(userId);
  if (!conn || conn.status !== "connected") return null;
  if (conn.expires_at < Date.now() + 2 * 60 * 1000) {
    try {
      const clientId = Deno.env.get("QBO_CLIENT_ID_PRODUCTION");
      const clientSecret = Deno.env.get("QBO_CLIENT_SECRET_PRODUCTION");
      if (!clientId || !clientSecret) return null;
      const basicAuth = btoa(`${clientId}:${clientSecret}`);
      const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}`, Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
      });
      if (!res.ok) return null;
      const td = await res.json();
      conn.access_token = td.access_token;
      conn.refresh_token = td.refresh_token;
      conn.expires_at = Date.now() + td.expires_in * 1000;
      conn.last_refreshed_at = new Date().toISOString();
      await kv.set(`qbo_connection:${userId}`, conn);
    } catch { return null; }
  }
  return conn.access_token;
}

app.get("/integrations/status", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  try {
    const stripeKey = await getUserStripeKey(userId);
    const qboConn = await getQboConnection(userId);
    const aiKey = Deno.env.get("OPENAI_API_KEY");
    const calendlyConfig = await kv.get(calendlyConfigKey(userId));
    const calendlyApiKey = Deno.env.get("CALENDLY_API_KEY");
    return c.json({
      stripe: { connected: !!stripeKey },
      quickbooks: { connected: qboConn?.status === "connected", company_name: qboConn?.company_name || null, realm_id: qboConn?.realm_id || null },
      ai: { enabled: !!aiKey },
      calendly: { connected: !!(calendlyConfig?.webhook_uri || calendlyApiKey), webhook_configured: !!calendlyConfig?.webhook_uri },
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// STRIPE INTEGRATION
// ═══════════════════════════════════════════════════════════════════════

app.post("/integrations/stripe/create-invoice", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  try {
    const { deal_id } = await c.req.json();
    if (!deal_id) return c.json({ error: "deal_id required" }, 400);
    const raw = await kv.get(dealsKey(userId));
    const deals: PipelineDeal[] = raw ? JSON.parse(raw) : [];
    const idx = deals.findIndex((d) => d.id === deal_id);
    if (idx === -1) return c.json({ error: "Deal not found" }, 404);
    const deal = deals[idx];
    const stripeKey = await getUserStripeKey(userId);
    if (!stripeKey) return c.json({ error: "Stripe not configured. Add your Stripe secret key in Settings > Integrations." }, 400);
    const Stripe = (await import("npm:stripe@17")).default;
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });
    let customerId: string;
    if (deal.email) {
      const existing = await stripe.customers.list({ email: deal.email, limit: 1 });
      if (existing.data.length > 0) { customerId = existing.data[0].id; }
      else {
        const cust = await stripe.customers.create({ email: deal.email, name: deal.contact_name || deal.business_name || undefined, metadata: { pipeline_deal_id: deal.id } });
        customerId = cust.id;
      }
    } else {
      const cust = await stripe.customers.create({ name: deal.contact_name || deal.business_name || "Pipeline Deal", metadata: { pipeline_deal_id: deal.id } });
      customerId = cust.id;
    }
    const invoice = await stripe.invoices.create({ customer: customerId, collection_method: "send_invoice", days_until_due: 30, metadata: { pipeline_deal_id: deal.id, pipeline_user_id: userId, source: "contndr_pipeline" } });
    await stripe.invoiceItems.create({ customer: customerId, invoice: invoice.id, amount: Math.round(deal.value * 100), currency: (deal.currency || "USD").toLowerCase(), description: `${deal.business_name || deal.contact_name} — ${deal.category || "Service"}` });
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    deals[idx] = { ...deals[idx], stripe_invoice_id: finalized.id, stripe_payment_status: finalized.status || "open", stripe_payment_url: finalized.hosted_invoice_url || undefined, updated_at: new Date().toISOString() };
    await kv.set(dealsKey(userId), JSON.stringify(deals));
    console.log(`[PIPELINE] Stripe invoice ${finalized.id} created for deal ${deal_id}`);
    return c.json({ success: true, invoice_id: finalized.id, invoice_url: finalized.hosted_invoice_url, status: finalized.status, amount: deal.value });
  } catch (err: any) {
    console.log(`[PIPELINE] Stripe invoice error: ${err.message}`);
    return c.json({ error: "Failed to create Stripe invoice", message: err.message }, 500);
  }
});

app.post("/integrations/stripe/create-payment-link", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  try {
    const { deal_id } = await c.req.json();
    if (!deal_id) return c.json({ error: "deal_id required" }, 400);
    const raw = await kv.get(dealsKey(userId));
    const deals: PipelineDeal[] = raw ? JSON.parse(raw) : [];
    const idx = deals.findIndex((d) => d.id === deal_id);
    if (idx === -1) return c.json({ error: "Deal not found" }, 404);
    const deal = deals[idx];
    const stripeKey = await getUserStripeKey(userId);
    if (!stripeKey) return c.json({ error: "Stripe not configured" }, 400);
    const Stripe = (await import("npm:stripe@17")).default;
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });
    const product = await stripe.products.create({ name: `${deal.business_name || deal.contact_name} — ${deal.category || "Deal"}`, metadata: { pipeline_deal_id: deal.id } });
    const price = await stripe.prices.create({ product: product.id, unit_amount: Math.round(deal.value * 100), currency: (deal.currency || "USD").toLowerCase() });
    const paymentLink = await stripe.paymentLinks.create({ line_items: [{ price: price.id, quantity: 1 }], metadata: { pipeline_deal_id: deal.id, pipeline_user_id: userId, source: "contndr_pipeline" } });
    deals[idx] = { ...deals[idx], stripe_payment_url: paymentLink.url, stripe_payment_status: "pending", updated_at: new Date().toISOString() };
    await kv.set(dealsKey(userId), JSON.stringify(deals));
    return c.json({ success: true, payment_url: paymentLink.url, amount: deal.value });
  } catch (err: any) {
    console.log(`[PIPELINE] Stripe payment link error: ${err.message}`);
    return c.json({ error: "Failed to create payment link", message: err.message }, 500);
  }
});

app.post("/integrations/stripe/sync", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  try {
    const stripeKey = await getUserStripeKey(userId);
    if (!stripeKey) return c.json({ error: "Stripe not configured" }, 400);
    const Stripe = (await import("npm:stripe@17")).default;
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });
    const raw = await kv.get(dealsKey(userId));
    const deals: PipelineDeal[] = raw ? JSON.parse(raw) : [];
    if (deals.length === 0) return c.json({ success: true, matched: 0 });
    const created = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;
    const paymentIntents = await stripe.paymentIntents.list({ created: { gte: created }, limit: 100 });
    let matched = 0;
    const dealsByEmail = new Map<string, number[]>();
    deals.forEach((d, i) => { if (d.email) { const e = d.email.toLowerCase(); dealsByEmail.set(e, [...(dealsByEmail.get(e) || []), i]); } });
    for (const pi of paymentIntents.data) {
      if (pi.status !== "succeeded" || !pi.customer) continue;
      if (pi.metadata?.pipeline_deal_id) {
        const i = deals.findIndex((d) => d.id === pi.metadata.pipeline_deal_id);
        if (i !== -1) { deals[i].stripe_payment_id = pi.id; deals[i].stripe_payment_status = "paid"; if (deals[i].stage !== "closed_won") { deals[i].stage = "closed_won"; deals[i].closed_at = new Date().toISOString(); deals[i].stage_history = [...(deals[i].stage_history || []), { stage: "closed_won", entered_at: new Date().toISOString(), trigger: "stripe_sync" }]; } matched++; continue; }
      }
      try {
        const customer = await stripe.customers.retrieve(pi.customer as string);
        if (!customer.deleted && customer.email) {
          const indices = dealsByEmail.get(customer.email.toLowerCase());
          if (indices?.length) {
            const amtDollars = pi.amount / 100;
            let bestIdx = indices[0]; let bestDiff = Math.abs(deals[indices[0]].value - amtDollars);
            for (const i of indices) { const diff = Math.abs(deals[i].value - amtDollars); if (diff < bestDiff) { bestDiff = diff; bestIdx = i; } }
            deals[bestIdx].stripe_payment_id = pi.id; deals[bestIdx].stripe_payment_status = "paid";
            if (deals[bestIdx].stage !== "closed_won") { deals[bestIdx].stage = "closed_won"; deals[bestIdx].closed_at = new Date().toISOString(); deals[bestIdx].stage_history = [...(deals[bestIdx].stage_history || []), { stage: "closed_won", entered_at: new Date().toISOString(), trigger: "stripe_sync" }]; }
            matched++;
          }
        }
      } catch { /* skip */ }
    }
    if (matched > 0) await kv.set(dealsKey(userId), JSON.stringify(deals));
    console.log(`[PIPELINE] Stripe sync: matched ${matched} payments`);
    return c.json({ success: true, matched, total_payments: paymentIntents.data.length });
  } catch (err: any) {
    console.log(`[PIPELINE] Stripe sync error: ${err.message}`);
    return c.json({ error: "Stripe sync failed", message: err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// STRIPE WEBHOOK — invoice.paid auto-progression
// Public endpoint (no auth) — Stripe signs the payload
// ═══════════════════════════════════════════════════════════════════════

app.post("/webhooks/stripe", async (c) => {
  try {
    const payload = await c.req.text();
    const sig = c.req.header("stripe-signature");

    // Verify signature if webhook secret is set
    let event: any;
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    if (webhookSecret && sig) {
      try {
        const Stripe = (await import("npm:stripe@17")).default;
        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
        const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });
        event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
      } catch (err: any) {
        console.log(`[PIPELINE WEBHOOK] Signature verification failed: ${err.message}`);
        return c.json({ error: "Invalid signature" }, 400);
      }
    } else {
      // No secret configured — parse raw (dev/testing mode)
      event = JSON.parse(payload);
    }

    console.log(`[PIPELINE WEBHOOK] Received event: ${event.type}`);

    if (event.type === "invoice.paid" || event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
      const obj = event.data?.object;
      if (!obj) return c.json({ received: true });

      // Extract pipeline deal ID from metadata
      const dealId = obj.metadata?.pipeline_deal_id;
      const pipelineUserId = obj.metadata?.pipeline_user_id;

      if (dealId && pipelineUserId) {
        console.log(`[PIPELINE WEBHOOK] Payment received for deal ${dealId}, user ${pipelineUserId}`);

        const raw = await kv.get(dealsKey(pipelineUserId));
        const deals: PipelineDeal[] = raw ? JSON.parse(raw) : [];
        const idx = deals.findIndex((d) => d.id === dealId);

        if (idx !== -1 && deals[idx].stage !== "closed_won") {
          const now = new Date().toISOString();
          deals[idx].stage = "closed_won";
          deals[idx].closed_at = now;
          deals[idx].updated_at = now;
          deals[idx].stripe_payment_status = "paid";
          if (obj.id) deals[idx].stripe_payment_id = obj.id;
          deals[idx].stage_history = [
            ...(deals[idx].stage_history || []),
            { stage: "closed_won", entered_at: now, trigger: "stripe_webhook_" + event.type },
          ];
          await kv.set(dealsKey(pipelineUserId), JSON.stringify(deals));
          console.log(`[PIPELINE WEBHOOK] ✅ Deal "${deals[idx].contact_name}" auto-closed as WON via ${event.type}`);
        }
      } else {
        // Try to match by customer email across all users (fallback)
        const customerEmail = obj.customer_email || obj.receipt_email || obj.customer_details?.email;
        if (customerEmail) {
          console.log(`[PIPELINE WEBHOOK] No deal metadata — attempting email match for ${customerEmail}`);
          // We can't iterate all users efficiently, so just log
          // The manual Stripe sync will catch these
        }
      }
    }

    return c.json({ received: true });
  } catch (err: any) {
    console.error(`[PIPELINE WEBHOOK] Error: ${err.message}`);
    return c.json({ error: err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// QUICKBOOKS INTEGRATION
// ═══════════════════════════════════════════════════════════════════════

function getQboApiBase(): string {
  const env = Deno.env.get("QBO_ENV") || "production";
  return env === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
}

app.post("/integrations/qbo/create-invoice", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  try {
    const { deal_id } = await c.req.json();
    if (!deal_id) return c.json({ error: "deal_id required" }, 400);
    const raw = await kv.get(dealsKey(userId));
    const deals: PipelineDeal[] = raw ? JSON.parse(raw) : [];
    const idx = deals.findIndex((d) => d.id === deal_id);
    if (idx === -1) return c.json({ error: "Deal not found" }, 404);
    const deal = deals[idx];
    const accessToken = await getQboValidToken(userId);
    const qboConn = await getQboConnection(userId);
    if (!accessToken || !qboConn) return c.json({ error: "QuickBooks not connected. Go to Settings > Integrations to connect." }, 400);
    const realmId = qboConn.realm_id;
    const apiBase = getQboApiBase();
    // Find or create customer
    let customerId: string | null = null;
    const customerName = deal.business_name || deal.contact_name || "Pipeline Customer";
    const searchQuery = encodeURIComponent(`DisplayName = '${customerName.replace(/'/g, "\\'")}'`);
    const searchRes = await fetch(`${apiBase}/v3/company/${realmId}/query?query=select * from Customer where ${searchQuery}&minorversion=65`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    if (searchRes.ok) { const sd = await searchRes.json(); if (sd.QueryResponse?.Customer?.length > 0) customerId = sd.QueryResponse.Customer[0].Id; }
    if (!customerId) {
      const nameParts = (deal.contact_name || "").split(" ");
      const customerBody: any = { DisplayName: customerName, CompanyName: deal.business_name || undefined, GivenName: nameParts[0] || undefined, FamilyName: nameParts.slice(1).join(" ") || undefined };
      if (deal.email) customerBody.PrimaryEmailAddr = { Address: deal.email };
      const createRes = await fetch(`${apiBase}/v3/company/${realmId}/customer?minorversion=65`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(customerBody) });
      if (!createRes.ok) { const errText = await createRes.text(); return c.json({ error: `Failed to create QBO customer: ${errText}` }, 500); }
      const cd = await createRes.json(); customerId = cd.Customer.Id;
    }
    // Create invoice
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 30);
    const invoiceBody = { CustomerRef: { value: customerId }, DueDate: dueDate.toISOString().split("T")[0], Line: [{ Amount: deal.value, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 1, UnitPrice: deal.value }, Description: `${deal.category || "Services"} — ${deal.contact_name || deal.business_name}` }], PrivateNote: `Contndr Pipeline Deal: ${deal.id}` };
    const invoiceRes = await fetch(`${apiBase}/v3/company/${realmId}/invoice?minorversion=65`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(invoiceBody) });
    if (!invoiceRes.ok) { const errText = await invoiceRes.text(); return c.json({ error: `Failed to create QBO invoice: ${errText}` }, 500); }
    const invData = await invoiceRes.json();
    const qboInvoice = invData.Invoice;
    deals[idx] = { ...deals[idx], qbo_invoice_id: qboInvoice.Id, qbo_invoice_number: qboInvoice.DocNumber, qbo_invoice_status: "open", updated_at: new Date().toISOString() };
    await kv.set(dealsKey(userId), JSON.stringify(deals));
    console.log(`[PIPELINE] QBO invoice #${qboInvoice.DocNumber} created for deal ${deal_id}`);
    return c.json({ success: true, invoice_id: qboInvoice.Id, invoice_number: qboInvoice.DocNumber, amount: deal.value, due_date: dueDate.toISOString().split("T")[0] });
  } catch (err: any) {
    console.log(`[PIPELINE] QBO invoice error: ${err.message}`);
    return c.json({ error: "Failed to create QuickBooks invoice", message: err.message }, 500);
  }
});

app.post("/integrations/qbo/sync", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  try {
    const accessToken = await getQboValidToken(userId);
    const qboConn = await getQboConnection(userId);
    if (!accessToken || !qboConn) return c.json({ error: "QuickBooks not connected" }, 400);
    const raw = await kv.get(dealsKey(userId));
    const deals: PipelineDeal[] = raw ? JSON.parse(raw) : [];
    if (deals.length === 0) return c.json({ success: true, matched: 0 });
    const realmId = qboConn.realm_id;
    const apiBase = getQboApiBase();
    const query = encodeURIComponent("select * from Invoice orderby MetaData.CreateTime desc maxresults 100");
    const res = await fetch(`${apiBase}/v3/company/${realmId}/query?query=${query}&minorversion=65`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    if (!res.ok) return c.json({ error: "Failed to query QBO invoices" }, 500);
    const data = await res.json();
    const invoices = data.QueryResponse?.Invoice || [];
    let matched = 0;
    for (const inv of invoices) {
      const linkedIdx = deals.findIndex((d) => d.qbo_invoice_id === inv.Id);
      if (linkedIdx !== -1) {
        const balance = parseFloat(inv.Balance) || 0;
        deals[linkedIdx].qbo_invoice_status = balance === 0 ? "paid" : "open";
        deals[linkedIdx].qbo_invoice_number = inv.DocNumber;
        // Auto-close if paid
        if (balance === 0 && deals[linkedIdx].stage !== "closed_won" && deals[linkedIdx].stage !== "closed_lost") {
          deals[linkedIdx].stage = "closed_won";
          deals[linkedIdx].closed_at = new Date().toISOString();
          deals[linkedIdx].stage_history = [...(deals[linkedIdx].stage_history || []), { stage: "closed_won", entered_at: new Date().toISOString(), trigger: "qbo_invoice_paid" }];
        }
        matched++;
        continue;
      }
      if (inv.PrivateNote?.includes("Contndr Pipeline Deal:")) {
        const m = inv.PrivateNote.match(/Contndr Pipeline Deal: ([a-f0-9-]+)/);
        if (m) { const dIdx = deals.findIndex((d) => d.id === m[1]); if (dIdx !== -1) { deals[dIdx].qbo_invoice_id = inv.Id; deals[dIdx].qbo_invoice_number = inv.DocNumber; const balance = parseFloat(inv.Balance) || 0; deals[dIdx].qbo_invoice_status = balance === 0 ? "paid" : "open"; matched++; } }
      }
    }
    if (matched > 0) await kv.set(dealsKey(userId), JSON.stringify(deals));
    return c.json({ success: true, matched, total_invoices: invoices.length });
  } catch (err: any) {
    return c.json({ error: "QBO sync failed", message: err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// AI INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════

app.post("/ai/analyze", async (c) => {
  const user = await getFullUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  try {
    const aiKey = Deno.env.get("OPENAI_API_KEY");
    if (!aiKey) return c.json({ error: "AI provider not configured" }, 400);
    const raw = await kv.get(dealsKey(user.id));
    const deals: PipelineDeal[] = raw ? JSON.parse(raw) : [];
    if (deals.length === 0) return c.json({ insights: { summary: "Your pipeline is empty. Start by adding deals from your CRM leads.", deal_scores: [], recommendations: ["Add your first deal to get AI-powered insights"], health_score: 0, risk_deals: [], top_opportunities: [] } });
    const activeDeals = deals.filter((d) => d.stage !== "closed_won" && d.stage !== "closed_lost");
    const wonDeals = deals.filter((d) => d.stage === "closed_won");
    const lostDeals = deals.filter((d) => d.stage === "closed_lost");
    const pipelineSummary = {
      total_deals: deals.length, active_deals: activeDeals.length, won: wonDeals.length, lost: lostDeals.length,
      total_pipeline_value: activeDeals.reduce((s, d) => s + d.value, 0), won_value: wonDeals.reduce((s, d) => s + d.value, 0),
      stages: Object.fromEntries(PIPELINE_STAGES.map((s) => [s, { count: deals.filter((d) => d.stage === s).length, value: deals.filter((d) => d.stage === s).reduce((sum, d) => sum + d.value, 0) }])),
    };
    const dealDetails = activeDeals.slice(0, 20).map((d) => ({
      id: d.id, contact: d.contact_name, business: d.business_name, stage: d.stage, value: d.value,
      days_since_created: Math.round((Date.now() - new Date(d.created_at).getTime()) / 86400000),
      days_since_update: Math.round((Date.now() - new Date(d.updated_at).getTime()) / 86400000),
      has_email: !!d.email, has_close_date: !!d.expected_close_date, category: d.category,
      stage_count: (d.stage_history || []).length,
      stripe_linked: !!d.stripe_payment_id || !!d.stripe_invoice_id, qbo_linked: !!d.qbo_invoice_id,
      auto_triggered: (d.stage_history || []).some((h) => h.trigger),
    }));
    const prompt = `You are an expert B2B sales AI analyst for Contndr (cold outreach platform). Analyze this pipeline.\n\nOVERVIEW:\n${JSON.stringify(pipelineSummary, null, 2)}\n\nACTIVE DEALS (top 20):\n${JSON.stringify(dealDetails, null, 2)}\n\nRespond ONLY valid JSON (no markdown):\n{"health_score":<0-100>,"summary":"<2-3 sentences>","deal_scores":[{"deal_id":"<id>","score":<0-100>,"risk_level":"low|medium|high","next_action":"<max 80 chars>","predicted_days_to_close":<number|null>}],"recommendations":["<top 3-5>"],"risk_deals":["<ids>"],"top_opportunities":["<ids>"],"bottleneck_stage":"<stage key|null>","forecast_adjustment":"up|down|stable"}`;
    const { generateAI } = await import("./ai-provider.tsx");
    const aiResult = await generateAI({ messages: [{ role: "user", content: prompt }], temperature: 0.3, maxTokens: 2000, jsonMode: true });
    const content = aiResult.text || "{}";
    let insights: any;
    try { insights = JSON.parse(content.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim()); } catch { insights = { health_score: 50, summary: "Unable to parse AI response.", deal_scores: [], recommendations: [], risk_deals: [], top_opportunities: [] }; }
    if (insights.deal_scores?.length > 0) {
      let updated = false;
      for (const score of insights.deal_scores) {
        const dIdx = deals.findIndex((d) => d.id === score.deal_id);
        if (dIdx !== -1) { deals[dIdx].ai_score = score.score; deals[dIdx].ai_next_action = score.next_action; deals[dIdx].ai_risk_level = score.risk_level; if (score.predicted_days_to_close) { const p = new Date(); p.setDate(p.getDate() + score.predicted_days_to_close); deals[dIdx].ai_predicted_close_date = p.toISOString().split("T")[0]; } updated = true; }
      }
      if (updated) await kv.set(dealsKey(user.id), JSON.stringify(deals));
    }
    await kv.set(aiInsightsKey(user.id), { ...insights, generated_at: new Date().toISOString() });
    return c.json({ insights });
  } catch (err: any) {
    console.log(`[PIPELINE AI] Error: ${err.message}`);
    return c.json({ error: "AI analysis failed", message: err.message }, 500);
  }
});

app.get("/ai/insights", async (c) => {
  const user = await getFullUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const userId = user.id;
  try {
    let cached = await kv.get(aiInsightsKey(userId));
    // Auto-seed if demo account has no insights and no deals
    if (!cached && user.email.toLowerCase().trim() === DEMO_EMAIL) {
      const rawDeals = await kv.get(dealsKey(userId));
      if (!rawDeals || JSON.parse(rawDeals).length === 0) await autoSeedDemoPipeline(userId);
      cached = await kv.get(aiInsightsKey(userId));
    }
    if (!cached) return c.json({ insights: null, stale: true });
    const age = Date.now() - new Date(cached.generated_at || 0).getTime();
    return c.json({ insights: cached, stale: age > 60 * 60 * 1000 });
  } catch (err: any) { return c.json({ error: err.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════════════
// CALENDLY INTEGRATION
// ═══════════════════════════════════════════════════════════════════════
// Calendly sends webhook events when invitees schedule/cancel meetings.
// We listen for `invitee.created` and fire a `meeting_booked` trigger
// matching the invitee email against pipeline deals.
//
// Setup:
//   1. Save your Calendly webhook signing key via PUT /integrations/calendly/config
//   2. Create a Calendly webhook subscription pointing to:
//        POST /make-server-a8b2511f/pipeline/webhooks/calendly
//      for the event `invitee.created`
//   3. When a prospect books a meeting, the deal auto-advances to "Meeting Booked"
// ═══════════════════════════════════════════════════════════════════════

// ─── Calendly config CRUD ────────────────────────────────────────────

app.get("/integrations/calendly/config", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  try {
    const config = (await kv.get(calendlyConfigKey(userId))) || {};
    return c.json({
      webhook_uri: config.webhook_uri || null,
      signing_key_set: !!config.signing_key,
      created_at: config.created_at || null,
    });
  } catch (err: any) { return c.json({ error: err.message }, 500); }
});

app.put("/integrations/calendly/config", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  try {
    const body = await c.req.json();
    const existing = (await kv.get(calendlyConfigKey(userId))) || {};
    const updated = {
      ...existing,
      webhook_uri: body.webhook_uri ?? existing.webhook_uri,
      signing_key: body.signing_key ?? existing.signing_key,
      user_uri: body.user_uri ?? existing.user_uri,
      updated_at: new Date().toISOString(),
      created_at: existing.created_at || new Date().toISOString(),
    };
    await kv.set(calendlyConfigKey(userId), updated);
    return c.json({ success: true, webhook_uri: updated.webhook_uri, signing_key_set: !!updated.signing_key });
  } catch (err: any) { return c.json({ error: err.message }, 500); }
});

app.delete("/integrations/calendly/config", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  try {
    await kv.set(calendlyConfigKey(userId), null);
    return c.json({ success: true });
  } catch (err: any) { return c.json({ error: err.message }, 500); }
});

// ─── Calendly webhook verify helper ──────────────────────────────────
async function verifyCalendlySignature(payload: string, sigHeader: string, signingKey: string): Promise<boolean> {
  try {
    // Calendly sends: t=<timestamp>,v1=<signature>
    const parts: Record<string, string> = {};
    for (const part of sigHeader.split(",")) {
      const [k, v] = part.split("=", 2);
      if (k && v) parts[k.trim()] = v.trim();
    }
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) return false;

    // tolerance: 5 minutes
    const diff = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
    if (diff > 300) return false;

    const data = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(signingKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
    return hex === signature;
  } catch { return false; }
}

// ─── Calendly Webhook Endpoint (Public — no auth) ───────────────────
app.post("/webhooks/calendly", async (c) => {
  try {
    const payload = await c.req.text();
    const sigHeader = c.req.header("Calendly-Webhook-Signature") || "";
    let event: any;

    try {
      event = JSON.parse(payload);
    } catch {
      console.log("[CALENDLY WEBHOOK] Invalid JSON payload");
      return c.json({ error: "Invalid JSON" }, 400);
    }

    console.log(`[CALENDLY WEBHOOK] Received event: ${event.event}`);

    // Only handle invitee.created (meeting booked)
    if (event.event !== "invitee.created") {
      return c.json({ received: true, skipped: true });
    }

    const inviteePayload = event.payload;
    if (!inviteePayload) return c.json({ received: true });

    const inviteeEmail = inviteePayload.email?.toLowerCase();
    const inviteeName = inviteePayload.name || "";
    const eventUri = inviteePayload.event || inviteePayload.scheduled_event?.uri || "";
    const meetingStartTime = inviteePayload.scheduled_event?.start_time || "";
    const meetingName = inviteePayload.scheduled_event?.name || inviteePayload.event_type?.name || "Meeting";

    if (!inviteeEmail) {
      console.log("[CALENDLY WEBHOOK] No invitee email found, skipping");
      return c.json({ received: true, skipped: true });
    }

    console.log(`[CALENDLY WEBHOOK] Invitee: ${inviteeName} <${inviteeEmail}> for "${meetingName}"`);

    // Find which Contndr user this webhook belongs to.
    // Strategy: look up all users who have configured Calendly and check
    // if the webhook signing key matches or the event URI matches their user_uri.
    // For simplicity, we scan all calendly configs.
    const calendlyConfigs = await kv.getByPrefix("pipeline:");
    const userCandidates: string[] = [];

    if (Array.isArray(calendlyConfigs)) {
      for (const entry of calendlyConfigs) {
        if (!entry?.key?.endsWith(":calendly_config") || !entry?.value) continue;
        const config = typeof entry.value === "string" ? JSON.parse(entry.value) : entry.value;
        const userId = entry.key.replace("pipeline:", "").replace(":calendly_config", "");

        // Verify signature if signing key is configured
        if (config.signing_key && sigHeader) {
          const valid = await verifyCalendlySignature(payload, sigHeader, config.signing_key);
          if (valid) {
            userCandidates.push(userId);
            continue;
          }
        }

        // Fallback: match by user_uri in the event
        if (config.user_uri && eventUri.includes(config.user_uri)) {
          userCandidates.push(userId);
        }

        // If no signing_key and no user_uri, add as candidate (for simple setups)
        if (!config.signing_key && !config.user_uri && config.webhook_uri) {
          userCandidates.push(userId);
        }
      }
    }

    if (userCandidates.length === 0) {
      // Fallback: try env-level CALENDLY_WEBHOOK_SIGNING_KEY for signature verification
      const envSigningKey = Deno.env.get("CALENDLY_WEBHOOK_SIGNING_KEY");
      if (envSigningKey && sigHeader) {
        const valid = await verifyCalendlySignature(payload, sigHeader, envSigningKey);
        if (valid) {
          console.log("[CALENDLY WEBHOOK] Signature verified via env CALENDLY_WEBHOOK_SIGNING_KEY — attempting global email match");
        }
      }

      // Global email match: search all users with deals matching this invitee email
      console.log("[CALENDLY WEBHOOK] No user matched via config — attempting global email match");
      const allDealKeys = await kv.getByPrefix("pipeline:");
      if (Array.isArray(allDealKeys)) {
        for (const entry of allDealKeys) {
          if (!entry?.key?.endsWith(":deals") || !entry?.value) continue;
          const userId = entry.key.replace("pipeline:", "").replace(":deals", "");
          const deals: PipelineDeal[] = typeof entry.value === "string" ? JSON.parse(entry.value) : entry.value;
          const hasMatch = deals.some(d =>
            d.email?.toLowerCase() === inviteeEmail &&
            d.stage !== "closed_won" && d.stage !== "closed_lost"
          );
          if (hasMatch) userCandidates.push(userId);
        }
      }
    }

    let triggered = 0;
    for (const userId of [...new Set(userCandidates)]) {
      await firePipelineTrigger({
        event_type: "meeting_booked",
        user_id: userId,
        email: inviteeEmail,
        metadata: {
          source: "calendly",
          invitee_name: inviteeName,
          meeting_name: meetingName,
          meeting_start: meetingStartTime,
          event_uri: eventUri,
        },
      });
      triggered++;
    }

    console.log(`[CALENDLY WEBHOOK] Fired meeting_booked for ${triggered} user(s), invitee: ${inviteeEmail}`);
    return c.json({ received: true, triggered });
  } catch (err: any) {
    console.error(`[CALENDLY WEBHOOK] Error: ${err.message}`);
    return c.json({ error: err.message }, 500);
  }
});

// ─── Register Calendly webhook via API (convenience) ─────────────────
app.post("/integrations/calendly/register-webhook", async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  try {
    const apiKey = Deno.env.get("CALENDLY_API_KEY");
    if (!apiKey) return c.json({ error: "CALENDLY_API_KEY not configured" }, 400);

    // Get current user URI from Calendly
    const meRes = await fetch("https://api.calendly.com/users/me", {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    if (!meRes.ok) return c.json({ error: "Failed to authenticate with Calendly" }, 400);
    const meData = await meRes.json();
    const userUri = meData.resource?.uri;
    const orgUri = meData.resource?.current_organization;
    if (!userUri) return c.json({ error: "Could not retrieve Calendly user URI" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const callbackUrl = `${supabaseUrl}/functions/v1/make-server-a8b2511f/pipeline/webhooks/calendly`;

    // Create webhook subscription
    const whRes = await fetch("https://api.calendly.com/webhook_subscriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: callbackUrl,
        events: ["invitee.created", "invitee.canceled"],
        organization: orgUri,
        user: userUri,
        scope: "user",
        signing_key: undefined, // Calendly will auto-generate
      }),
    });

    if (!whRes.ok) {
      const errData = await whRes.json().catch(() => ({}));
      console.log(`[CALENDLY] Webhook registration failed: ${JSON.stringify(errData)}`);
      return c.json({ error: "Failed to register Calendly webhook", details: errData }, 400);
    }

    const whData = await whRes.json();
    const webhookUri = whData.resource?.uri;
    const signingKey = whData.resource?.creator?.signing_key;

    // Save config
    const config = {
      webhook_uri: webhookUri,
      callback_url: callbackUrl,
      user_uri: userUri,
      organization_uri: orgUri,
      signing_key: signingKey || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await kv.set(calendlyConfigKey(userId), config);

    console.log(`[CALENDLY] Webhook registered: ${webhookUri} → ${callbackUrl}`);
    return c.json({
      success: true,
      webhook_uri: webhookUri,
      callback_url: callbackUrl,
      user_uri: userUri,
    });
  } catch (err: any) {
    console.log(`[CALENDLY] Registration error: ${err.message}`);
    return c.json({ error: "Failed to register webhook", message: err.message }, 500);
  }
});

export default app;

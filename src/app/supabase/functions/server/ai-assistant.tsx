// AI Assistant — Contndr Platform Agent (v3)
// Deeply connected to all platform data: leads (DB), campaigns (KV+DB), emails (DB),
// settings (KV), signature (KV), and analytics.
// Persistent chat sessions stored in KV for conversation history.

import { Hono } from "npm:hono";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { generateAI } from "./ai-provider.tsx";

const app = new Hono();

// ── Singleton service-role Supabase client ──────────────────────
let _supabase: any = null;
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

// ── Auth: resolve user from JWT ─────────────────────────────────
async function getAuthUser(c: any): Promise<{ id: string; email: string; name: string } | null> {
  const token = c.req.header("Authorization")?.split(" ")[1];
  if (!token) return null;
  const supabase = getSupabase();
  const { user: authUser, error } = await (await import("./auth-helpers.tsx")).authGetUser(supabase, token, "AI-ASSISTANT");
  const data = { user: authUser };
  if (error || !data?.user?.id) return null;
  return {
    id: data.user.id,
    email: data.user.email || "",
    name: data.user.user_metadata?.name || data.user.user_metadata?.full_name || "",
  };
}

// ── Admin check ─────────────────────────────────────────────────
const ADMIN_EMAILS = ["admin@contndr.com", "or@roadr.com", "or@contndr.com"];
const ADMIN_UIDS = ["004b2df9-3e3f-48ec-acfd-5374ab55b09f"];
function isAdminEmail(email: string, uid?: string) {
  if (uid && ADMIN_UIDS.includes(uid)) return true;
  return ADMIN_EMAILS.includes(email.toLowerCase().trim());
}

// ── Helper: safe DB count ───────────────────────────────────────
async function safeCount(query: any): Promise<number> {
  try {
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    console.log("[AI-CTX] Count error:", e);
    return 0;
  }
}

// ── Helper: safe DB data fetch ──────────────────────────────────
async function safeData(query: any): Promise<any[]> {
  try {
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  } catch (e) {
    console.log("[AI-CTX] Data error:", e);
    return [];
  }
}

// ── Robust inline action JSON extractor ─────────────────────────
// Handles merge tags like {{first_name}} and literal newlines in string values.
// Uses brace-depth counting with string-boundary awareness.
function extractInlineActions(text: string): { actions: any[]; cleanedText: string } {
  const ACTION_TYPES = ["launch_campaign", "find_leads", "navigate", "open_campaign_builder", "search_leads", "draft_email"];
  const extracted: { action: any; start: number; end: number }[] = [];

  for (const type of ACTION_TYPES) {
    const needle = `"${type}"`;
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const typeIdx = text.indexOf(needle, searchFrom);
      if (typeIdx === -1) break;

      // Walk backwards to find the opening brace of the JSON object
      let start = -1;
      for (let i = typeIdx - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === "{") { start = i; break; }
        // If we hit a closing brace first, this isn't our object
        if (ch === "}") break;
      }
      if (start === -1) { searchFrom = typeIdx + needle.length; continue; }

      // Walk forward from `start` to find the matching closing brace
      // Track string boundaries so braces inside strings (e.g. {{first_name}}) are ignored
      let depth = 0;
      let end = -1;
      let inStr = false;
      let esc = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (esc) { esc = false; continue; }
        if (ch === "\\" && inStr) { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (!inStr) {
          if (ch === "{") depth++;
          if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
        }
      }
      if (end === -1) { searchFrom = typeIdx + needle.length; continue; }

      const jsonStr = text.substring(start, end + 1);
      try {
        // Sanitize literal newlines/tabs inside JSON string values before parsing
        const sanitized = jsonStr.replace(/"((?:[^"\\]|\\.)*)"/g, (m: string) =>
          m.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
        );
        const obj = JSON.parse(sanitized);
        if (obj && obj.type) {
          extracted.push({ action: obj, start, end: end + 1 });
        }
      } catch (e) {
        console.log(`[AI-EXTRACT] JSON parse failed for ${type}:`, (e as Error).message?.slice(0, 80));
      }
      searchFrom = end + 1;
    }
  }

  // Sort by position (descending) so we can remove from end to start without index shift
  extracted.sort((a, b) => b.start - a.start);
  let cleaned = text;
  for (const e of extracted) {
    cleaned = cleaned.substring(0, e.start) + cleaned.substring(e.end);
  }
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return { actions: extracted.map(e => e.action), cleanedText: cleaned };
}

// ── Session helpers ─────────────────────────────────────────────
function sessionKey(userId: string, sessionId: string) {
  return `ai_session:${userId}:${sessionId}`;
}

function generateSessionId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateTitle(firstMessage: string): string {
  const cleaned = firstMessage.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= 50) return cleaned;
  return cleaned.slice(0, 47) + '...';
}

// ── Gather deep platform context ────────────────────────────────
async function gatherContext(userId: string, userEmail: string) {
  const supabase = getSupabase();
  const ctx: Record<string, any> = {};
  const isAdmin = isAdminEmail(userEmail, userId);

  // Determine target user IDs (admins see all admin data)
  let targetUserIds = [userId];
  if (isAdmin) {
    // Get all admin user IDs
    try {
      const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 100 });
      const adminIds = (users || [])
        .filter((u: any) => ADMIN_EMAILS.includes(u.email?.toLowerCase().trim()))
        .map((u: any) => u.id);
      targetUserIds = Array.from(new Set([...adminIds, userId]));
    } catch { /* fallback to single user */ }
  }

  try {
    // ── 1) LEADS from Supabase DB (the actual source of truth) ──────
    const [totalLeads, recentLeadsData, industryData, statusData, leadsWithEmail, leadsWithPhone, bouncedCount] = await Promise.all([
      // Total count
      safeCount(
        supabase.from("leads").select("*", { count: "exact", head: true }).in("user_id", targetUserIds)
      ),
      // Recent 8 leads
      safeData(
        supabase.from("leads")
          .select("id, contact_name, email, phone, business_name, category, industry, status, city, state, country, created_at, job_title, seniority")
          .in("user_id", targetUserIds)
          .order("created_at", { ascending: false })
          .limit(8)
      ),
      // All industries for breakdown (lightweight — just category column)
      safeData(
        supabase.from("leads")
          .select("category")
          .in("user_id", targetUserIds)
          .not("category", "is", null)
          .limit(2000)
      ),
      // All statuses for breakdown
      safeData(
        supabase.from("leads")
          .select("status")
          .in("user_id", targetUserIds)
          .limit(2000)
      ),
      // Count with email
      safeCount(
        supabase.from("leads").select("*", { count: "exact", head: true }).in("user_id", targetUserIds).not("email", "is", null)
      ),
      // Count with phone
      safeCount(
        supabase.from("leads").select("*", { count: "exact", head: true }).in("user_id", targetUserIds).not("phone", "is", null)
      ),
      // Bounced count
      safeCount(
        supabase.from("leads").select("*", { count: "exact", head: true }).in("user_id", targetUserIds).eq("bounced", true)
      ),
    ]);

    ctx.totalLeads = totalLeads;
    ctx.leadsWithEmail = leadsWithEmail;
    ctx.leadsWithPhone = leadsWithPhone;
    ctx.bouncedLeads = bouncedCount;

    // Industry breakdown (top 8)
    const industries: Record<string, number> = {};
    industryData.forEach((l: any) => {
      const cat = l.category || "Uncategorized";
      industries[cat] = (industries[cat] || 0) + 1;
    });
    ctx.topIndustries = Object.entries(industries)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    // Status breakdown
    const statuses: Record<string, number> = {};
    statusData.forEach((l: any) => {
      const s = l.status || "new";
      statuses[s] = (statuses[s] || 0) + 1;
    });
    ctx.leadStatuses = statuses;

    // Recent leads (formatted)
    ctx.recentLeads = recentLeadsData.map((l: any) => ({
      name: l.contact_name || "Unknown",
      email: l.email || "",
      company: l.business_name || "",
      industry: l.category || l.industry || "",
      status: l.status || "new",
      location: [l.city, l.state, l.country].filter(Boolean).join(", "),
      title: l.job_title || "",
      created: l.created_at,
    }));

    // ── 2) CAMPAIGNS from KV + DB ───────────────────────────────────
    const [campaignsKV, campaignsDB] = await Promise.all([
      kv.getByPrefix(`campaign:${userId}:`).catch(() => []),
      safeData(
        supabase.from("campaigns").select("id, name, status, created_at, user_id, product").in("user_id", targetUserIds)
      ),
    ]);

    // Merge (KV is source of truth for full data)
    const campaignsMap = new Map();
    (campaignsDB || []).forEach((c: any) => campaignsMap.set(c.id, { id: c.id, name: c.name, status: c.status, created_at: c.created_at, product: c.product }));
    (campaignsKV || []).forEach((c: any) => {
      if (c && c.id) campaignsMap.set(c.id, c);
    });

    const allCampaigns = Array.from(campaignsMap.values());
    ctx.totalCampaigns = allCampaigns.length;

    const activeCampaigns = allCampaigns.filter((c: any) => c.status === "active");
    const completedCampaigns = allCampaigns.filter((c: any) => c.status === "completed");
    const draftCampaigns = allCampaigns.filter((c: any) => c.status === "draft");

    ctx.campaignBreakdown = {
      active: activeCampaigns.length,
      completed: completedCampaigns.length,
      draft: draftCampaigns.length,
    };

    ctx.recentCampaigns = allCampaigns
      .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, 5)
      .map((c: any) => ({
        name: c.name || "Untitled",
        status: c.status || "draft",
        product: c.product || "",
        leads: c.leads?.length || c.lead_ids?.length || 0,
        sent: c.sent_count || 0,
        created: c.created_at,
      }));

    // ── 3) EMAILS from DB ───────────────────────────────────────────
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [totalEmailsSent, emailsLast30, openedEmails, clickedEmails, bouncedEmails, repliedEmails] = await Promise.all([
      // All-time sent
      safeCount(
        supabase.from("emails").select("*", { count: "exact", head: true }).in("user_id", targetUserIds).not("sent_at", "is", null)
      ),
      // Last 30 days sent
      safeCount(
        supabase.from("emails").select("*", { count: "exact", head: true }).in("user_id", targetUserIds).not("sent_at", "is", null).gte("sent_at", thirtyDaysAgo)
      ),
      // Opened (last 30 days)
      safeCount(
        supabase.from("emails").select("*", { count: "exact", head: true }).in("user_id", targetUserIds).not("sent_at", "is", null).not("opened_at", "is", null).gte("sent_at", thirtyDaysAgo)
      ),
      // Clicked (last 30 days)
      safeCount(
        supabase.from("emails").select("*", { count: "exact", head: true }).in("user_id", targetUserIds).not("sent_at", "is", null).not("clicked_at", "is", null).gte("sent_at", thirtyDaysAgo)
      ),
      // Bounced
      safeCount(
        supabase.from("emails").select("*", { count: "exact", head: true }).in("user_id", targetUserIds).eq("status", "bounced")
      ),
      // Replied
      safeCount(
        supabase.from("emails").select("*", { count: "exact", head: true }).in("user_id", targetUserIds).eq("status", "replied")
      ),
    ]);

    const pct = (num: number, den: number) => den > 0 ? Number(((num / den) * 100).toFixed(1)) : 0;

    ctx.emailStats = {
      totalSent: totalEmailsSent,
      last30Days: emailsLast30,
      opened: openedEmails,
      clicked: clickedEmails,
      bounced: bouncedEmails,
      replied: repliedEmails,
      openRate: pct(openedEmails, emailsLast30),
      clickRate: pct(clickedEmails, emailsLast30),
      bounceRate: pct(bouncedEmails, totalEmailsSent),
      replyRate: pct(repliedEmails, emailsLast30),
    };

    // ── 4) SETTINGS from KV ─────────────────────────────────────────
    const [signatureRaw, emailConfigRoadr, emailConfigSourcer] = await Promise.all([
      kv.get(`signature:${userId}`).catch(() => null),
      kv.get(`email_config:${userId}:roadr_sender`).catch(() => null),
      kv.get(`email_config:${userId}:sourcr_sender`).catch(() => null),
    ]);

    ctx.hasSignature = !!signatureRaw;
    if (signatureRaw) {
      try {
        const sig = typeof signatureRaw === "string" ? JSON.parse(signatureRaw) : signatureRaw;
        ctx.signatureName = sig.full_name || sig.name || "";
        ctx.signatureTitle = sig.title || "";
        ctx.signatureEmail = sig.email || "";
        ctx.signaturePhone = sig.phone || "";
        ctx.signatureWebsite = sig.website || "";
        ctx.signatureClosingLine = sig.closing_line || "Best Regards";
      } catch {}
    }

    // Get user's email provider settings
    try {
      const { getEmailSettingsFromKV } = await import("./oauth-email.tsx");
      const emailSettings = await getEmailSettingsFromKV(userId);
      ctx.emailProvider = emailSettings.provider || "resend";
      ctx.connectedEmail = emailSettings.connected_email || "";
      ctx.fromEmail = emailSettings.connected_email || ctx.signatureEmail || "";
    } catch {
      ctx.fromEmail = ctx.signatureEmail || "";
    }

    // Get user's brand from metadata
    try {
      const { data: { user: authUser } } = await supabase.auth.admin.getUserById(userId);
      ctx.userBrand = authUser?.user_metadata?.brand || "custom";
    } catch {
      ctx.userBrand = "custom";
    }

    // Get knowledge base brands (what brands the user has KB entries for)
    try {
      const { getKnowledgeBaseByBrand } = await import("./knowledge-base.tsx");
      // Check for team-based KB
      let teamId = userId;
      try {
        const t = await kv.get(`team_member:${userId}`);
        if (t?.team_id) teamId = t.team_id;
      } catch {}
      const kbEntries = await getKnowledgeBaseByBrand(teamId, "all");
      const kbBrands = [...new Set((kbEntries || []).map((e: any) => e.brand).filter(Boolean))];
      ctx.knowledgeBrands = kbBrands;
      ctx.hasKnowledgeBase = kbBrands.length > 0;
    } catch {
      ctx.knowledgeBrands = [];
      ctx.hasKnowledgeBase = false;
    }

    ctx.emailSenders = {
      primary: emailConfigRoadr || "partner@roadr.com",
      secondary: emailConfigSourcer || "or@covera.co",
    };

    // ── 5) AI Call campaigns from KV ────────────────────────────────
    try {
      const aiCallCampaigns = await kv.getByPrefix(`ai-call-campaign:${userId}:`);
      ctx.aiCallCampaigns = (aiCallCampaigns || []).length;
    } catch { ctx.aiCallCampaigns = 0; }

  } catch (e) {
    console.log("[AI-CTX] Top-level error gathering context:", e);
  }

  return ctx;
}

// ── System prompt builder ───────────────────────────────────────
function buildSystemPrompt(ctx: Record<string, any>, userName: string, userEmail: string) {
  const emailStats = ctx.emailStats || {};
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

  return `You are the Contndr AI Assistant — a premium, deeply-connected command agent for the Contndr cold outreach platform. You have direct access to the user's live platform data and can help them with any task.

CURRENT DATE/TIME: ${timeStr}
USER: ${userName || "User"} (${userEmail})

═══════════════════════════════════════════════════════
PERSONALITY & RULES:
═══════════════════════════════════════════════════════
- Professional, direct, efficient — never verbose
- Use structured formatting: bullet points (•), section headers (##), **bold** for key numbers
- NEVER mention third-party tool names: Apollo, SerpAPI, Hunter, Findymail, Explorium, Telnyx
- Use Contndr feature names: "Smart Discovery" (lead search), "Campaigns" (outreach), "AI Calls" (voice)
- When presenting data, always include specific numbers from the context below
- If data shows zeros, acknowledge it naturally and suggest next steps
- Be proactive: suggest actions the user should take based on their data

═══════════════════════════════════════════════════════
COLD OUTREACH EXPERTISE — You are a deep expert in:
═══════════════════════════════════════════════════════
When the user asks for advice, strategy, best practices, or recommendations, draw from this knowledge:

**Email Best Practices:**
- Subject lines: 3-7 words, lowercase, personal, curiosity-driven. Avoid spam triggers (FREE, ACT NOW, !!!). Best performers: question-based, name-drop, or pain-point.
- Body: Max 125 words for cold emails. First line MUST be personalized (mention their company, role, recent news, or a shared connection). Never lead with "I" or "We."
- CTA: One clear ask per email — soft CTAs ("worth a quick chat?") outperform hard CTAs ("book a meeting"). Always give an easy out.
- Timing: Tuesday-Thursday, 8-10 AM recipient's local time. Avoid Mondays and Fridays. B2B response rates peak Tuesday 9 AM.
- Follow-ups: 3-5 follow-ups spaced 3, 5, 7, 14 days apart. Each follow-up should add NEW value (case study, insight, social proof), never just "bumping this up."

**Deliverability:**
- Warm up new domains for 2-4 weeks before volume sending. Start with 5-10/day, increase gradually.
- Keep bounce rate under 3%. Remove bounced emails immediately.
- Ideal daily send volume: 50-80 emails per inbox per day for cold outreach. More risks spam filters.
- Use custom tracking domains. Avoid link-heavy emails. Plain text often outperforms HTML.
- SPF, DKIM, DMARC must be configured. Check MX records.

**Prospecting Strategy:**
- ICP (Ideal Customer Profile): Define by industry, company size, revenue, tech stack, job title, and pain points.
- Decision-maker hierarchy: C-Suite for deals >$50K, VP/Director for $10K-$50K, Managers for <$10K.
- Multi-channel approach: Email → LinkedIn connection → Email follow-up → Phone call.
- Lead quality > quantity. 100 well-targeted leads outperform 1,000 spray-and-pray.
- Research before outreach: Check LinkedIn, company news, funding rounds, job postings for personalization hooks.

**Campaign Strategy:**
- A/B test one variable at a time: subject line, opening line, CTA, or send time.
- Segment leads by industry/role/size for tailored messaging. Generic campaigns get <1% reply rates.
- Sequences: 4-7 touchpoints, mix email with LinkedIn and phone.
- Track reply rates, not just open rates. Industry benchmark: 2-5% reply rate is good, 5-10% is excellent.
- Negative replies still count — track positive reply rate separately.

**Industry-Specific Targeting Tips:**
- SaaS: Target VP of Engineering, CTO, Head of Product. Pain: scaling, technical debt, hiring.
- Real Estate: Target agents, brokers, property managers. Pain: lead gen, client acquisition, market trends.
- Healthcare: Target practice managers, CMOs, clinic owners. Pain: patient acquisition, compliance, billing.
- Financial Services: Target CFOs, Controllers, Wealth Managers. Pain: compliance, client retention, reporting.
- E-commerce: Target founders, CMOs, Head of Growth. Pain: CAC, retention, conversion optimization.
- Agencies: Target CEOs, founders, business development managers. Pain: client acquisition, project management, margins.
- Construction: Target project managers, estimators, owners. Pain: bidding, workforce, supply chain.
- Legal: Target managing partners, practice heads. Pain: client intake, billing, case management.

**CONVERSATION MEMORY:**
- You have access to the full conversation history. ALWAYS refer back to earlier messages when the user asks follow-up questions.
- If the user previously searched for leads, you know the search parameters and results.
- If the user mentioned their business, target market, or goals earlier, reference them without asking again.
- Track context across the conversation — never make the user repeat themselves.
- When giving advice, consider what the user has already told you in this session (industry, product, ICP, challenges).

═══════════════════════════════════════════════════════
LIVE PLATFORM DATA:
═══════════════════════════════════════════════════════

## Leads (CRM)
- Total leads in CRM: **${ctx.totalLeads || 0}**
- Leads with email: ${ctx.leadsWithEmail || 0}
- Leads with phone: ${ctx.leadsWithPhone || 0}
- Bounced leads: ${ctx.bouncedLeads || 0}
- Status breakdown: ${JSON.stringify(ctx.leadStatuses || {})}
- Top industries: ${JSON.stringify(ctx.topIndustries || [])}
- Recent leads: ${JSON.stringify(ctx.recentLeads || [])}

## Campaigns
- Total campaigns: **${ctx.totalCampaigns || 0}**
- Active: ${ctx.campaignBreakdown?.active || 0}, Completed: ${ctx.campaignBreakdown?.completed || 0}, Draft: ${ctx.campaignBreakdown?.draft || 0}
- Recent campaigns: ${JSON.stringify(ctx.recentCampaigns || [])}

## Email Performance (Last 30 Days)
- Total emails sent (all-time): **${emailStats.totalSent || 0}**
- Sent last 30 days: ${emailStats.last30Days || 0}
- Opened: ${emailStats.opened || 0} (${emailStats.openRate || 0}% open rate)
- Clicked: ${emailStats.clicked || 0} (${emailStats.clickRate || 0}% click rate)
- Replied: ${emailStats.replied || 0} (${emailStats.replyRate || 0}% reply rate)
- Bounced: ${emailStats.bounced || 0} (${emailStats.bounceRate || 0}% bounce rate)

## Account Setup
- Email signature configured: ${ctx.hasSignature ? "Yes" : "No"}
${ctx.signatureName ? `- Signature name: ${ctx.signatureName}` : ""}
${ctx.signatureTitle ? `- Signature title: ${ctx.signatureTitle}` : ""}
${ctx.fromEmail ? `- From email: ${ctx.fromEmail}` : ""}
${ctx.signatureWebsite ? `- Website: ${ctx.signatureWebsite}` : ""}
- Default brand: ${ctx.userBrand || "custom"}
${ctx.knowledgeBrands?.length > 0 ? `- Knowledge base brands: ${ctx.knowledgeBrands.join(", ")}` : "- No knowledge base configured"}
- Sending email: ${ctx.emailSenders?.primary || "Not configured"}
- AI Call campaigns: ${ctx.aiCallCampaigns || 0}

═══════════════════════════════════════════════════════
CAPABILITIES — ACTIONS YOU CAN TRIGGER:
═══════════════════════════════════════════════════════
1. **Navigate**: Send user to any view → Dashboard, CRM, Lead Finder (Smart Discovery), Campaigns, Inbox, Analytics, Revenue, Settings, Automations, AI Calls, Team Leaderboard, Admin
2. **Open Campaign Builder**: Launch the campaign creation flow directly
3. **Search Leads**: Direct user to Smart Discovery with a search query
4. **Draft Emails**: Write personalized cold outreach emails (subject + body) that user can copy
5. **Launch Campaign**: Create and immediately send a campaign — renders an interactive campaign card the user can review and launch with one click
6. **Platform Guidance**: Explain any feature, troubleshoot issues, suggest best practices

PLATFORM FEATURES YOU CAN EXPLAIN:
- **Smart Discovery**: Multi-phase lead enrichment pipeline — search by industry, location, job title
- **CRM**: Full contact management with tags, status tracking, notes, activity feed
- **Campaigns**: Multi-step email campaigns with A/B testing, scheduling, follow-ups
- **Send Immediately**: Real-time sending with live progress overlay
- **Inbox**: Unified inbox for replies, with thread view and lead status updates
- **Analytics**: Open rates, click rates, reply rates, bounce rates, daily trends
- **Revenue**: Pipeline tracking and deal management
- **AI Calls**: Voice outreach campaigns with AI-powered conversations
- **Automations**: Automated follow-up sequences and triggers
- **Team Leaderboard**: Performance tracking across team members
- **Lead Pool**: Shared lead database for discovery

ACTION SYSTEM — Include these in your response when appropriate:
- { "type": "navigate", "view": "dashboard|crm|lead-finder|campaigns|inbox|analytics|revenue|settings|automations|ai-calls|team|admin" }
- { "type": "open_campaign_builder" }
- { "type": "search_leads", "query": "search terms" }
- { "type": "draft_email", "subject": "...", "body": "..." }
- { "type": "find_leads", "person_titles": ["CEO", "Founder"], "organization_locations": ["New York"], "organization_industries": ["SaaS"], "q_keywords": "optional keywords", "max_results": 25 }
- { "type": "launch_campaign", "campaign_name": "...", "subject": "...", "body": "...", "tone": "casual|formal|friendly|professional|enthusiastic", "lead_filter": "...", "campaign_knowledge": "optional extra context" }

CRITICAL — LAUNCH_CAMPAIGN ACTION:
You are a cold email expert. When the user wants to send a campaign, you MUST auto-generate everything: campaign name, subject line, and body. Be proactive — use the user's Account Setup info above (signature name, title, brand, website) to craft the email. Never ask "what's your name" or "what do you do" — you already have it.

Campaigns ALWAYS pull leads from the CRM only. The user must have leads saved in CRM groups. If they just discovered leads in this chat, remind them to save leads to CRM and organize them into a group first.

You need at minimum:
1. **A specific target audience** — a CRM group, industry segment, or job role. "All leads" is NOT a valid audience.

NEVER create a campaign targeting "all CRM leads." That's spray-and-pray and it kills deliverability. You are an expert — always push the user to segment. 100 well-targeted leads outperform 1,000 generic blasts.

The email signature is applied automatically from the user's settings. Do NOT include a sign-off or signature in the email body you generate — it will be appended automatically. Focus only on the email content.

If the user says "email my construction leads" — that's enough (audience = construction industry). Immediately generate the campaign with a killer subject and body using their brand/signature context. The user can always edit inline before launching.

WHEN GENERATING THE EMAIL:
- Do NOT include any sign-off, signature, name, title, phone, email, or website at the end of the body. The user's full email signature is appended automatically by the system. Just end with the CTA or closing line.
- Reference the user's brand/product naturally if they have a knowledge base configured
- Subject: 3-7 words, curiosity-driven, lowercase feel (not ALL CAPS), personalized with {{first_name}} when appropriate
- Body: Under 125 words. First line personalized. Use merge tags: {{first_name}}, {{company}}, {{title}}. Soft CTA. Never start with "I" or "We".
- Match the tone to context (default: casual)
- NEVER ask the user to provide the subject or body — always generate them yourself

WHEN TO ASK vs WHEN TO GENERATE:
- "Email my construction leads" → GENERATE immediately ✓ (specific audience: construction)
- "Campaign for real estate agents about free consultation" → GENERATE immediately ✓ (audience: real estate agents + topic)
- "Send to my VIP group" → GENERATE immediately ✓ (audience: specific group)
- "Email leads in the SaaS group" → GENERATE immediately ✓ (audience: specific group)

Examples of INSUFFICIENT — ALWAYS ask first:
- "Send a campaign to all leads" → Too broad. Ask: "Let's make this effective — which segment should we target? For example: a specific industry, job title, or one of your lead groups?"
- "Email all my CRM leads" → Too broad. Ask the same qualifying question.
- "Launch a campaign" → Too vague, ask who to target
- "Send some emails" → Too vague, ask who to target
- "Email my leads" → Too vague — which leads? Ask for industry, role, or group

When you DO generate, set the lead_filter field to describe the specific audience segment (e.g. "construction", "real estate agents", "SaaS founders"). NEVER set lead_filter to "all" or "all CRM leads."

Your message should be ONLY: "Here's your campaign — review and hit Launch when ready." DO NOT also list the campaign name, subject, body, or other details in your message text — the system renders an interactive campaign card with all those fields. Repeating them in the message creates a bad experience. Keep message minimal.

CRITICAL JSON FORMATTING FOR ACTIONS:
- In the body field, use the JSON escape \\n for newlines — NOT actual line breaks. The body must be a single-line JSON string value.
- Merge tags like {{first_name}}, {{company}}, {{title}} with double braces are expected and correct.
- Example: {"type":"launch_campaign","campaign_name":"Tech Leaders","subject":"{{first_name}}, quick question","body":"Hi {{first_name}},\\n\\nAs a {{title}} at {{company}}, I thought this would resonate.\\n\\nWould a quick chat be worth exploring?","tone":"casual","lead_filter":"technology CEOs"}

CRITICAL  FIND_LEADS ACTION:
DO NOT immediately trigger find_leads when the user's request is vague or missing key details. You MUST have at minimum TWO of these three parameters before triggering a search:
1. **Industry/vertical** (e.g. "SaaS", "Real Estate", "Healthcare")
2. **Job title/role** (e.g. "CEO", "Marketing Director", "Dentist")
3. **Location** (e.g. "New York", "California", "UK")

WHEN THE REQUEST IS VAGUE (e.g. "I want to find new leads", "help me find contacts", "search for prospects"):
- Do NOT include a find_leads action
- Instead, ask 2-3 quick qualifying questions in a friendly, concise way
- Ask about: What industry? What job titles/roles? Any specific location?
- Keep it conversational and short — use bullet points for the questions
- Example response: "Let's find you the right contacts. A few quick questions:\n\n• **What industry** are you targeting? (e.g. SaaS, Real Estate, Healthcare)\n• **What roles** are you looking for? (e.g. CEO, Marketing Director, Sales Manager)\n• **Any specific location?** (e.g. New York, California, or worldwide)"

WHEN THE REQUEST HAS ENOUGH DETAIL (at least industry + role, or role + location):
- Include the find_leads action with parsed parameters
- Parse their natural language into structured parameters:
  - person_titles: job titles like ["CEO", "CTO", "VP of Sales"]. Always capitalize properly.
  - organization_locations: cities, states, or countries like ["New York", "California"]
  - organization_industries: industries like ["SaaS", "Real Estate", "Healthcare"]
  - q_keywords: additional search keywords if specified
  - max_results: default 25, can be 10-50 based on user request

Examples of SUFFICIENT requests → trigger find_leads:
- "Find me real estate agents in Miami" → HAS role + industry + location ✓
- "Get CEOs of tech startups" → HAS role + industry ✓
- "Search for marketing directors in London" → HAS role + location ✓
- "Find 40 dentists in California" → HAS role + location ✓

Examples of INSUFFICIENT requests → ask questions first:
- "I want to find new leads" → too vague, ask what kind
- "Find me some contacts" → too vague, ask industry and role
- "Help me with lead generation" → too vague, ask specifics
- "Search for people" → way too vague

When you DO trigger find_leads, your message should be a brief confirmation like "Searching for [description]... I'll check the local database first." Keep it SHORT — the lead cards will do the talking. The system always checks local database first before external sources to save API credits and return faster results.

CRITICAL — EMAILING SPECIFIC DISCOVERED LEADS:
When the user asks to "send email to [name]" or "email [name]" referring to a specific lead from earlier search results in this conversation:
- ALWAYS generate a launch_campaign action with the lead's name in the lead_filter field
- Set lead_filter to the person's name exactly as it appeared in the search results (e.g. "Andres Korda")
- The frontend will automatically match this name to the discovered lead and use their data
- Generate a personalized subject and body using the lead's actual info from the search results (name, title, company)
- Use the lead's actual first name in the email, NOT merge tags like {{first_name}}
- Example: User says "send email to Andres Korda" (who was found as Co-Founder at Avanti Way Realty)
  → Generate: {"type":"launch_campaign","campaign_name":"Outreach to Andres Korda","subject":"Andres, quick question about Avanti Way","body":"Hi Andres,\\n\\nAs a Co-Founder at Avanti Way Realty, I thought...","tone":"casual","lead_filter":"Andres Korda"}

RESPONSE FORMAT — Always respond with valid JSON:
{
  "message": "Your response (supports **bold**, • bullet points, ## headers)",
  "actions": [...] // optional array of action objects — MUST be in this array, never inline in the message
}

CRITICAL: Actions MUST go in the "actions" array. NEVER embed action JSON objects inside the "message" string. The system only reads actions from the "actions" array.

IMPORTANT: Respond with raw JSON only — no markdown code blocks wrapping it.`;
}

// ── Chat endpoint ───────────────────────────────────────────────
app.post("/make-server-a8b2511f/ai-assistant/chat", async (c) => {
  const t0 = Date.now();
  try {
    const user = await getAuthUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { message, history } = await c.req.json();
    if (!message) {
      return c.json({ error: "Message is required" }, 400);
    }

    // Gather deep platform context
    const ctx = await gatherContext(user.id, user.email);
    console.log(`[AI-ASSISTANT] Context gathered in ${Date.now() - t0}ms — leads:${ctx.totalLeads}, campaigns:${ctx.totalCampaigns}, emails:${ctx.emailStats?.totalSent || 0}`);

    // Build messages array
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: "system", content: buildSystemPrompt(ctx, user.name, user.email) },
    ];

    // Add conversation history (last 20 messages for better follow-up context)
    if (history && Array.isArray(history)) {
      const recentHistory = history.slice(-20);
      for (const h of recentHistory) {
        messages.push({
          role: h.role === "assistant" ? "assistant" : "user",
          content: typeof h.content === "string" ? h.content : JSON.stringify(h.content),
        });
      }
    }

    messages.push({ role: "user", content: message });

    // Call AI provider (OpenAI)
    let rawContent = "";
    try {
      const aiResult = await generateAI({
        messages,
        temperature: 0.7,
        maxTokens: 4096,
        jsonMode: true,
      });
      rawContent = aiResult.text?.trim() || "";
      console.log(`[AI-ASSISTANT] Response via ${(aiResult as any).model || aiResult.provider} in ${(aiResult as any).latency_ms || '?'}ms, finish_reason: ${(aiResult as any).finish_reason || '?'} (first 300 chars): ${rawContent.slice(0, 300)}`);
    } catch (aiErr: any) {
      console.error("[AI-ASSISTANT] AI provider error:", aiErr.message);
      return c.json({ error: "AI service temporarily unavailable", details: aiErr.message }, 502);
    }

    // Parse the JSON response
    let parsed: any;
    try {
      const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
      console.log(`[AI-ASSISTANT] JSON parsed OK. actions: [${(parsed.actions || []).map((a: any) => a.type).join(", ")}], message length: ${(parsed.message || "").length}`);
    } catch (jsonErr) {
      console.warn(`[AI-ASSISTANT] JSON parse failed: ${(jsonErr as Error).message?.slice(0, 100)}. Raw content (first 200): ${rawContent.slice(0, 200)}`);
      
      // Try to extract just the "message" field from partial JSON
      let extractedMessage = "";
      try {
        const msgMatch = rawContent.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (msgMatch) {
          extractedMessage = msgMatch[1]
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
          console.log(`[AI-ASSISTANT] Extracted message field from broken JSON: ${extractedMessage.length} chars`);
        }
      } catch {}

      // Try to extract structured action objects from the raw content
      const { actions, cleanedText } = extractInlineActions(rawContent);
      parsed = { 
        message: extractedMessage || cleanedText || rawContent, 
        actions 
      };
      if (actions.length > 0) {
        console.log(`[AI-ASSISTANT] Extracted ${actions.length} inline action(s) from raw text: ${actions.map(a => a.type).join(", ")}`);
      }
    }

    // Ensure parsed.message is always a string
    if (parsed.message && typeof parsed.message !== 'string') {
      console.warn(`[AI-ASSISTANT] parsed.message is ${typeof parsed.message}, converting to string`);
      try {
        parsed.message = typeof parsed.message === 'object' 
          ? (parsed.message.text || parsed.message.content || JSON.stringify(parsed.message))
          : String(parsed.message);
      } catch {
        parsed.message = "I processed your request but had trouble formatting the response. Please try again.";
      }
    }

    // If message is empty or just whitespace, provide a fallback
    if (!parsed.message || !parsed.message.trim()) {
      console.warn(`[AI-ASSISTANT] Empty message after parsing. rawContent length: ${rawContent.length}`);
      parsed.message = rawContent.startsWith('{') 
        ? "I processed your request but the response was incomplete. Please try again."
        : rawContent || "I couldn't generate a response. Please try again.";
    }

    // CRITICAL: Also extract inline actions from parsed.message text.
    // The AI sometimes embeds action JSON inside the message string even when the outer JSON parses fine.
    // e.g. { "message": "Searching... {\"type\":\"find_leads\",...}", "actions": [] }
    if (parsed.message) {
      const { actions: inlineActions, cleanedText } = extractInlineActions(parsed.message);
      if (inlineActions.length > 0) {
        console.log(`[AI-ASSISTANT] Extracted ${inlineActions.length} inline action(s) from message text: ${inlineActions.map(a => a.type).join(", ")}`);
        // Merge into actions array, avoiding duplicates by type
        const existingTypes = new Set((parsed.actions || []).map((a: any) => a.type));
        for (const ia of inlineActions) {
          if (!existingTypes.has(ia.type)) {
            parsed.actions = parsed.actions || [];
            parsed.actions.push(ia);
            existingTypes.add(ia.type);
          }
        }
        parsed.message = cleanedText;
      }
    }

    // Store last interaction for future context
    try {
      await kv.set(`ai_chat:${user.id}:last`, JSON.stringify({
        userMessage: message,
        assistantMessage: parsed.message?.slice(0, 200),
        timestamp: new Date().toISOString(),
      }));
    } catch {}

    console.log(`[AI-ASSISTANT] Response generated in ${Date.now() - t0}ms for user ${user.email}`);

    const finalActions = parsed.actions || [];
    console.log(`[AI-ASSISTANT] Final response: message=${(parsed.message || "").length} chars, actions=[${finalActions.map((a: any) => a.type).join(", ")}]`);

    return c.json({
      success: true,
      message: parsed.message || rawContent,
      actions: finalActions,
    });
  } catch (error) {
    console.log("[AI-ASSISTANT] Chat error:", error);
    return c.json({ error: `Failed to process request: ${error}` }, 500);
  }
});

// ── Context endpoint (lightweight, for debugging) ───────────────
app.get("/make-server-a8b2511f/ai-assistant/context", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const ctx = await gatherContext(user.id, user.email);
    return c.json({ success: true, context: ctx });
  } catch (error) {
    console.log("[AI-ASSISTANT] Context error:", error);
    return c.json({ error: `Failed to gather context: ${error}` }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════
// SESSION CRUD — Persistent chat history
// ══════════════════════════════════════════════════════════════════

// LIST sessions (lightweight index)
app.get("/make-server-a8b2511f/ai-assistant/sessions", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const prefix = `ai_session:${user.id}:`;
    const raw = await kv.getByPrefix(prefix).catch(() => []);

    // Parse and build lightweight index
    const sessions = (raw || [])
      .map((item: any) => {
        try {
          const s = typeof item === "string" ? JSON.parse(item) : item;
          if (!s || !s.id) return null;
          return {
            id: s.id,
            title: s.title || "Untitled",
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            messageCount: s.messages?.length || 0,
            leadCount: s.leadCount || 0,
            preview: s.preview || "",
          };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());

    return c.json({ success: true, sessions });
  } catch (error) {
    console.log("[AI-SESSIONS] List error:", error);
    return c.json({ error: `Failed to list sessions: ${error}` }, 500);
  }
});

// GET single session (full data with messages + leads)
app.get("/make-server-a8b2511f/ai-assistant/sessions/:id", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const sid = c.req.param("id");
    const raw = await kv.get(sessionKey(user.id, sid));
    if (!raw) return c.json({ error: "Session not found" }, 404);

    const session = typeof raw === "string" ? JSON.parse(raw) : raw;
    return c.json({ success: true, session });
  } catch (error) {
    console.log("[AI-SESSIONS] Get error:", error);
    return c.json({ error: `Failed to get session: ${error}` }, 500);
  }
});

// SAVE/UPDATE session
app.put("/make-server-a8b2511f/ai-assistant/sessions/:id", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const sid = c.req.param("id");
    const body = await c.req.json();

    // Build session object
    const existing = await kv.get(sessionKey(user.id, sid)).catch(() => null);
    const prev = existing ? (typeof existing === "string" ? JSON.parse(existing) : existing) : null;

    const session = {
      id: sid,
      title: body.title || prev?.title || "Untitled",
      messages: body.messages || prev?.messages || [],
      createdAt: prev?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      leadCount: body.leadCount ?? prev?.leadCount ?? 0,
      preview: body.preview || prev?.preview || "",
    };

    await kv.set(sessionKey(user.id, sid), JSON.stringify(session));
    console.log(`[AI-SESSIONS] Saved session ${sid} for user ${user.email} — ${session.messages.length} messages, ${session.leadCount} leads`);

    return c.json({ success: true, session: { id: session.id, title: session.title, updatedAt: session.updatedAt } });
  } catch (error) {
    console.log("[AI-SESSIONS] Save error:", error);
    return c.json({ error: `Failed to save session: ${error}` }, 500);
  }
});

// CREATE new session
app.post("/make-server-a8b2511f/ai-assistant/sessions", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json().catch(() => ({}));
    const sid = generateSessionId();

    const session = {
      id: sid,
      title: body.title || "New conversation",
      messages: body.messages || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      leadCount: 0,
      preview: "",
    };

    await kv.set(sessionKey(user.id, sid), JSON.stringify(session));
    console.log(`[AI-SESSIONS] Created session ${sid} for user ${user.email}`);

    return c.json({ success: true, session });
  } catch (error) {
    console.log("[AI-SESSIONS] Create error:", error);
    return c.json({ error: `Failed to create session: ${error}` }, 500);
  }
});

// DELETE session
app.delete("/make-server-a8b2511f/ai-assistant/sessions/:id", async (c) => {
  try {
    const user = await getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const sid = c.req.param("id");
    await kv.del(sessionKey(user.id, sid));
    console.log(`[AI-SESSIONS] Deleted session ${sid} for user ${user.email}`);

    return c.json({ success: true });
  } catch (error) {
    console.log("[AI-SESSIONS] Delete error:", error);
    return c.json({ error: `Failed to delete session: ${error}` }, 500);
  }
});

export default app;
/**
 * Team Sharing — Backend endpoints for shared team data
 * 
 * Provides endpoints so team members can see:
 * 1. Team campaigns (with attribution)
 * 2. Team dashboard stats (aggregated)
 * 3. Team visitor/tracking data (from owner's account)
 * 4. Recent activity across the whole team
 * 5. Per-member competitive leaderboard stats
 */
import { Hono } from "npm:hono";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { getTeamMemberIds, getTeamId } from "./team.tsx";
import { migrateV4IfNeeded } from "./sales-leaderboard.tsx";

const app = new Hono();

// ─── Supabase admin singleton ──────────────────────────────────────
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

// ─── Auth helper ───────────────────────────────────────────────────
async function getAuthenticatedUser(c: any) {
  const accessToken = c.req.header("Authorization")?.split(" ")[1];
  if (!accessToken) throw Object.assign(new Error("No authorization token"), { status: 401 });
  const supabase = getSupabase();

  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { data: { user }, error } = await supabase.auth.getUser(accessToken);
      if (error) throw error;
      if (!user) throw new Error("No user returned");
      return { user, supabase };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
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
        console.log(`[TEAM SHARING] Auth retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms: ${msg}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw Object.assign(new Error("Authentication failed"), { status: 401 });
    }
  }
  throw Object.assign(new Error("Authentication failed after retries"), { status: 401 });
}

// ─── Build member attribution map ──────────────────────────────────
async function getMemberMap(userId: string) {
  const teamId = await getTeamId(userId);
  const members: any[] = await kv.get(`team:${teamId}:members`) || [];
  const map = new Map<string, { name: string; email: string }>();
  for (const m of members) {
    map.set(m.id, { name: m.name || m.email?.split("@")[0] || "Team Member", email: m.email || "" });
  }
  return { map, teamId, members };
}

// ─── Override current user's name from auth metadata / signature ───
// The KV team store may have stale names; always prefer fresh auth data.
async function overrideCurrentUserName(
  memberMap: Map<string, { name: string; email: string }>,
  user: any
) {
  let authName = user.user_metadata?.full_name || user.user_metadata?.name || "";
  try {
    const sigRaw = await kv.get(`signature:${user.id}`);
    if (sigRaw) {
      const sig = typeof sigRaw === "string" ? JSON.parse(sigRaw) : sigRaw;
      if (sig.full_name && sig.full_name.trim()) authName = sig.full_name.trim();
    }
  } catch { /* non-fatal */ }
  if (!authName) authName = user.email?.split("@")[0] || "You";
  memberMap.set(user.id, { name: authName, email: user.email || "" });
}


// ════════════════════════════════════════════════════════════════════
//  GET /campaigns — All team members' campaigns with attribution
// ════════════════════════════════════════════════════════════════════
app.get("/campaigns", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    const teamMemberIds = await getTeamMemberIds(user.id);

    if (teamMemberIds.length <= 1) {
      return c.json({ campaigns: [], team_size: 1, members: [] });
    }

    const { map: memberMap } = await getMemberMap(user.id);
    // Ensure current user is in map
    await overrideCurrentUserName(memberMap, user);

    // Query campaigns for ALL team members
    const { data: campaigns, error } = await supabase
      .from("campaigns")
      .select("id, name, product, brand, tone, status, from_email, created_at, user_id")
      .in("user_id", teamMemberIds)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[TEAM SHARING] Campaigns query error:", error);
      return c.json({ error: error.message }, 500);
    }

    // Also fetch from KV for richer data
    const enrichedCampaigns = (campaigns || []).map((c: any) => {
      const member = memberMap.get(c.user_id);
      return {
        ...c,
        created_by: member?.name || "Team Member",
        created_by_email: member?.email || "",
        is_own: c.user_id === user.id,
      };
    });

    console.log(`[TEAM SHARING] Returning ${enrichedCampaigns.length} team campaigns for ${teamMemberIds.length} members`);

    return c.json({
      campaigns: enrichedCampaigns,
      team_size: teamMemberIds.length,
      members: Array.from(memberMap.entries()).map(([id, m]) => ({ id, ...m })),
    });
  } catch (error: any) {
    console.error("[TEAM SHARING] Team campaigns error:", error);
    return c.json({ error: error.message }, error.status || 500);
  }
});


// ════════════════════════════════════════════════════════════════════
//  GET /dashboard — Aggregated team dashboard stats
// ════════════════════════════════════════════════════════════════════
app.get("/dashboard", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    const teamMemberIds = await getTeamMemberIds(user.id);

    if (teamMemberIds.length <= 1) {
      return c.json({ stats: null, team_size: 1 });
    }

    const { map: memberMap } = await getMemberMap(user.id);
    await overrideCurrentUserName(memberMap, user);

    // Count leads, campaigns, emails across ALL team members
    const [leadsRes, campaignsRes, emailsSentRes, emailsOpenedRes, emailsClickedRes] = await Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true }).in("user_id", teamMemberIds),
      supabase.from("campaigns").select("id", { count: "exact", head: true }).in("user_id", teamMemberIds),
      supabase.from("emails").select("id", { count: "exact", head: true }).in("user_id", teamMemberIds).in("status", ["sent", "delivered", "opened", "clicked", "bounced", "complained"]),
      supabase.from("emails").select("id", { count: "exact", head: true }).in("user_id", teamMemberIds).in("status", ["opened", "clicked"]),
      supabase.from("emails").select("id", { count: "exact", head: true }).in("user_id", teamMemberIds).in("status", ["clicked"]),
    ]);

    const totalLeads = leadsRes.count || 0;
    const totalCampaigns = campaignsRes.count || 0;
    const emailsSent = emailsSentRes.count || 0;
    const emailsOpened = emailsOpenedRes.count || 0;
    const emailsClicked = emailsClickedRes.count || 0;

    // Get per-member breakdown
    const memberBreakdown: any[] = [];
    for (const memberId of teamMemberIds) {
      const member = memberMap.get(memberId);
      const [mLeads, mCampaigns, mEmails] = await Promise.all([
        supabase.from("leads").select("id", { count: "exact", head: true }).eq("user_id", memberId),
        supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("user_id", memberId),
        supabase.from("emails").select("id", { count: "exact", head: true }).eq("user_id", memberId).in("status", ["sent", "delivered", "opened", "clicked", "bounced", "complained"]),
      ]);
      memberBreakdown.push({
        id: memberId,
        name: member?.name || "Unknown",
        email: member?.email || "",
        is_you: memberId === user.id,
        leads: mLeads.count || 0,
        campaigns: mCampaigns.count || 0,
        emails_sent: mEmails.count || 0,
      });
    }

    // Get recent team campaigns
    const { data: recentCampaigns } = await supabase
      .from("campaigns")
      .select("id, name, product, brand, status, created_at, user_id")
      .in("user_id", teamMemberIds)
      .order("created_at", { ascending: false })
      .limit(5);

    const enrichedRecent = (recentCampaigns || []).map((c: any) => ({
      ...c,
      created_by: memberMap.get(c.user_id)?.name || "Team Member",
      is_own: c.user_id === user.id,
    }));

    return c.json({
      stats: {
        totalLeads,
        totalCampaigns,
        emailsSent,
        emailsOpened,
        emailsClicked,
        openRate: emailsSent > 0 ? Number(((emailsOpened / emailsSent) * 100).toFixed(1)) : 0,
        clickRate: emailsSent > 0 ? Number(((emailsClicked / emailsSent) * 100).toFixed(1)) : 0,
      },
      memberBreakdown,
      recentCampaigns: enrichedRecent,
      team_size: teamMemberIds.length,
    });
  } catch (error: any) {
    console.error("[TEAM SHARING] Team dashboard error:", error);
    return c.json({ error: error.message }, error.status || 500);
  }
});


// ════════════════════════════════════════════════════════════════════
//  GET /visitor-stats — Owner's visitor/tracking data for team members
// ════════════════════════════════════════════════════════════════════
app.get("/visitor-stats", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    const teamId = await getTeamId(user.id);
    const range = c.req.query("range") || "7d";

    // Get the team owner's visitor data from KV
    // Visitor data is stored under the owner's ID
    const ownerId = teamId; // teamId IS the owner's user ID

    // Compute date range
    const now = new Date();
    let msAgo = 7 * 24 * 60 * 60 * 1000;
    if (range === "24h") msAgo = 24 * 60 * 60 * 1000;
    if (range === "30d") msAgo = 30 * 24 * 60 * 60 * 1000;
    const since = new Date(now.getTime() - msAgo);

    // Query tracking_events for the owner
    const { data: events, error } = await supabase
      .from("tracking_events")
      .select("id, created_at, event_type, page_url, referrer, ip_address, user_agent, country, city, state, brand, metadata")
      .eq("user_id", ownerId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("[TEAM SHARING] Visitor stats error:", error);
      // Fallback: return empty data instead of crashing
      return c.json({ history: [], visitors: [], totalVisitors: 0, range });
    }

    // Group by date/hour for the chart
    const isHourly = range === "24h";
    const buckets = new Map<string, { total: number; brands: Record<string, number> }>();

    for (const event of events || []) {
      const d = new Date(event.created_at);
      const key = isHourly
        ? d.toISOString().slice(0, 13) // YYYY-MM-DDTHH
        : d.toISOString().split("T")[0]; // YYYY-MM-DD

      if (!buckets.has(key)) {
        buckets.set(key, { total: 0, brands: {} });
      }
      const bucket = buckets.get(key)!;
      bucket.total++;
      const brand = event.brand || "visits";
      bucket.brands[brand] = (bucket.brands[brand] || 0) + 1;
    }

    // Build history array
    const history = Array.from(buckets.entries())
      .map(([date, data]) => ({
        date: isHourly ? new Date(date + ":00:00Z").toISOString() : date,
        label: isHourly ? new Date(date + ":00:00Z").getHours() + ":00" : undefined,
        total: data.total,
        brands: data.brands,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Recent unique visitors
    const recentVisitors = (events || []).slice(0, 20).map(e => ({
      id: e.id,
      page: e.page_url,
      referrer: e.referrer,
      country: e.country,
      city: e.city,
      state: e.state,
      brand: e.brand,
      time: e.created_at,
    }));

    return c.json({
      history,
      visitors: recentVisitors,
      totalVisitors: (events || []).length,
      range,
      owner_id: ownerId,
    });
  } catch (error: any) {
    console.error("[TEAM SHARING] Team visitor stats error:", error);
    return c.json({ error: error.message }, error.status || 500);
  }
});


// ════════════════════════════════════════════════════════════════════
//  GET /activity — Recent activity feed across all team members
//  Returns email sends, engagement events, campaigns, and lead additions
// ════════════════════════════════════════════════════════════════════
app.get("/activity", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    const dashboardMode = c.req.query("dashboard") === "1" || c.req.query("fast") === "1";
    const requestedLimit = Math.min(30, Math.max(6, Number(c.req.query("limit") || 12)));

    // PARALLELIZED KV FETCHES with timeout protection
    const timeout = (ms: number) => new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms)
    );

    const [teamMemberIdsRes, memberMapRes] = await Promise.allSettled([
      Promise.race([
        getTeamMemberIds(user.id),
        timeout(dashboardMode ? 1500 : 5000)
      ]),
      Promise.race([
        getMemberMap(user.id),
        timeout(dashboardMode ? 1500 : 5000)
      ]),
    ]);

    // Extract with fallback — if KV fails, still show solo activity
    const teamMemberIds = teamMemberIdsRes.status === 'fulfilled' ? teamMemberIdsRes.value : [user.id];
    const { map: memberMap } = memberMapRes.status === 'fulfilled' ? memberMapRes.value : { 
      map: new Map([[user.id, { name: user.email?.split('@')[0] || 'You', email: user.email || '' }]]),
      teamId: null,
      members: []
    };

    await overrideCurrentUserName(memberMap, user);

    const oneWeekAgo = new Date(Date.now() - (dashboardMode ? 14 : 30) * 24 * 60 * 60 * 1000).toISOString();
    const activities: any[] = [];

    // Helper to resolve member info
    const memberInfo = (uid: string) => {
      const m = memberMap.get(uid);
      return { name: m?.name || "Teammate", isYou: uid === user.id };
    };

    console.log(`[TEAM ACTIVITY] Loading activity for ${teamMemberIds.length} members, since ${oneWeekAgo}, memberIds: ${teamMemberIds.join(", ")}`);

    if (dashboardMode) {
      const [sentEmailsRes, campaignsRes, leadsRes] = await Promise.allSettled([
        supabase
          .from("emails")
          .select("id, subject, user_id, created_at, status, open_count, click_count, leads(business_name, contact_name)")
          .in("user_id", teamMemberIds)
          .in("status", ["sent", "delivered", "opened", "clicked", "replied"])
          .gte("created_at", oneWeekAgo)
          .order("created_at", { ascending: false })
          .limit(requestedLimit),
        supabase
          .from("campaigns")
          .select("id, name, user_id, created_at")
          .in("user_id", teamMemberIds)
          .gte("created_at", oneWeekAgo)
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("leads")
          .select("id, business_name, contact_name, user_id, created_at")
          .in("user_id", teamMemberIds)
          .gte("created_at", oneWeekAgo)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

      const sentEmails = sentEmailsRes.status === "fulfilled" ? sentEmailsRes.value.data || [] : [];
      sentEmails.forEach((email: any) => {
        const { name, isYou } = memberInfo(email.user_id);
        const biz = email.leads?.business_name || email.leads?.contact_name || "a lead";
        const engagement: any = {};
        if (email.open_count > 0) engagement.opens = email.open_count;
        if (email.click_count > 0) engagement.clicks = email.click_count;
        if (email.status === "replied") engagement.replied = true;
        if (["opened", "clicked", "replied"].includes(email.status)) engagement.status = email.status;

        activities.push({
          id: `sent-${email.id}`,
          type: "email_sent",
          message: isYou ? `You emailed ${biz}` : `${name} emailed ${biz}`,
          timestamp: email.created_at,
          metadata: { subject: email.subject || "", ...engagement },
          member_name: name,
          is_you: isYou,
        });

        const baseTs = new Date(email.created_at).getTime();
        if (email.open_count > 0 || ["opened", "clicked", "replied"].includes(email.status)) {
          activities.push({
            id: `synth-open-${email.id}`,
            type: "email_opened",
            message: isYou ? `${biz} opened your email` : `${biz} opened ${name}'s email`,
            timestamp: new Date(baseTs + 60000).toISOString(),
            metadata: { subject: email.subject || "", email_id: email.id, opens: email.open_count || 1 },
            member_name: name,
            is_you: isYou,
          });
        }
        if (email.click_count > 0 || email.status === "clicked") {
          activities.push({
            id: `synth-click-${email.id}`,
            type: "email_clicked",
            message: isYou ? `${biz} clicked a link in your email` : `${biz} clicked a link in ${name}'s email`,
            timestamp: new Date(baseTs + 120000).toISOString(),
            metadata: { subject: email.subject || "", email_id: email.id, clicks: email.click_count || 1 },
            member_name: name,
            is_you: isYou,
          });
        }
        if (email.status === "replied") {
          activities.push({
            id: `synth-reply-${email.id}`,
            type: "email_replied",
            message: isYou ? `${biz} replied to your email` : `${biz} replied to ${name}'s email`,
            timestamp: new Date(baseTs + 180000).toISOString(),
            metadata: { subject: email.subject || "", email_id: email.id },
            member_name: name,
            is_you: isYou,
          });
        }
      });

      const campaigns = campaignsRes.status === "fulfilled" ? campaignsRes.value.data || [] : [];
      campaigns.forEach((camp: any) => {
        const { name, isYou } = memberInfo(camp.user_id);
        activities.push({
          id: `camp-${camp.id}`,
          type: "campaign_created",
          message: "",
          timestamp: camp.created_at,
          metadata: { campaign_name: camp.name },
          member_name: name,
          is_you: isYou,
        });
      });

      const leads = leadsRes.status === "fulfilled" ? leadsRes.value.data || [] : [];
      leads.forEach((lead: any) => {
        const { name, isYou } = memberInfo(lead.user_id);
        activities.push({
          id: `lead-${lead.id}`,
          type: "lead_added",
          message: "",
          timestamp: lead.created_at,
          metadata: { business_name: lead.business_name || lead.contact_name || "a new lead" },
          member_name: name,
          is_you: isYou,
        });
      });

      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      c.header("Cache-Control", "private, max-age=20, stale-while-revalidate=60");
      return c.json({
        activities: activities.slice(0, requestedLimit),
        team_size: teamMemberIds.length,
      });
    }

    // ── 1. Email engagement events (opens, clicks, replies) ──
    // Two-step approach: get team email IDs first, then query events
    try {
      const { data: teamEmails } = await supabase
        .from("emails")
        .select("id, subject, user_id, leads(business_name, contact_name)")
        .in("user_id", teamMemberIds)
        .gte("created_at", oneWeekAgo)
        .limit(500);

      if (teamEmails && teamEmails.length > 0) {
        const emailMap = new Map<string, any>();
        teamEmails.forEach((e: any) => emailMap.set(e.id, e));
        const emailIds = teamEmails.map((e: any) => e.id);

        const { data: events } = await supabase
          .from("email_events")
          .select("id, event_type, created_at, email_id")
          .in("email_id", emailIds)
          .in("event_type", ["opened", "clicked", "replied"])
          .order("created_at", { ascending: false })
          .limit(20);

        if (events) {
          events.forEach((event: any) => {
            const email = emailMap.get(event.email_id);
            if (!email) return;
            const { name, isYou } = memberInfo(email.user_id);
            const biz = email.leads?.business_name || email.leads?.contact_name || "Someone";

            let message = "";
            switch (event.event_type) {
              case "opened":
                message = isYou ? `${biz} opened your email` : `${biz} opened ${name}'s email`;
                break;
              case "clicked":
                message = isYou ? `${biz} clicked a link in your email` : `${biz} clicked a link in ${name}'s email`;
                break;
              case "replied":
                message = isYou ? `${biz} replied to your email` : `${biz} replied to ${name}'s email`;
                break;
            }

            activities.push({
              id: event.id,
              type: `email_${event.event_type}`,
              message,
              timestamp: event.created_at,
              metadata: { subject: email.subject || "" },
              member_name: name,
              is_you: isYou,
            });
          });
        }
        console.log(`[TEAM ACTIVITY] Section 1: ${teamEmails.length} team emails found, ${events?.length || 0} engagement events`);
      } else {
        console.log(`[TEAM ACTIVITY] Section 1: No team emails found in the last 30 days`);
      }
    } catch (e) {
      console.error("[TEAM ACTIVITY] Email events query error:", e);
    }

    // ── 2. Recent emails sent ──
    try {
      const { data: sentEmails } = await supabase
        .from("emails")
        .select("id, subject, user_id, created_at, status, open_count, click_count, leads(business_name, contact_name)")
        .in("user_id", teamMemberIds)
        .in("status", ["sent", "delivered", "opened", "clicked", "replied"])
        .gte("created_at", oneWeekAgo)
        .order("created_at", { ascending: false })
        .limit(30);

      if (sentEmails) {
        console.log(`[TEAM ACTIVITY] Section 2: ${sentEmails.length} sent emails found`);

        // Track which email IDs already have engagement activities from section 1
        const engagementEmailIds = new Set(
          activities.filter(a => a.type !== "email_sent").map(a => a.metadata?.email_id).filter(Boolean)
        );

        sentEmails.forEach((email: any) => {
          const { name, isYou } = memberInfo(email.user_id);
          const biz = email.leads?.business_name || email.leads?.contact_name || "a lead";
          const message = isYou ? `You emailed ${biz}` : `${name} emailed ${biz}`;

          // Include engagement stats as metadata on the sent email item
          const engagement: any = {};
          if (email.open_count > 0) engagement.opens = email.open_count;
          if (email.click_count > 0) engagement.clicks = email.click_count;
          if (email.status === "replied") engagement.replied = true;
          if (email.status === "opened" || email.status === "clicked" || email.status === "replied") {
            engagement.status = email.status;
          }

          activities.push({
            id: `sent-${email.id}`,
            type: "email_sent",
            message,
            timestamp: email.created_at,
            metadata: { subject: email.subject || "", ...engagement },
            member_name: name,
            is_you: isYou,
          });

          // ── Synthesize engagement activities from email status ──
          // If no email_events exist for this email, create synthetic ones
          // so the feed shows engagement even without webhook-driven events
          if (!engagementEmailIds.has(email.id)) {
            const baseTs = new Date(email.created_at).getTime();
            
            if ((email.open_count > 0 || email.status === "opened" || email.status === "clicked" || email.status === "replied")) {
              activities.push({
                id: `synth-open-${email.id}`,
                type: "email_opened",
                message: isYou ? `${biz} opened your email` : `${biz} opened ${name}'s email`,
                timestamp: new Date(baseTs + 60000).toISOString(), // 1 min after send
                metadata: { subject: email.subject || "", email_id: email.id, opens: email.open_count || 1 },
                member_name: name,
                is_you: isYou,
              });
            }

            if ((email.click_count > 0 || email.status === "clicked")) {
              activities.push({
                id: `synth-click-${email.id}`,
                type: "email_clicked",
                message: isYou ? `${biz} clicked a link in your email` : `${biz} clicked a link in ${name}'s email`,
                timestamp: new Date(baseTs + 120000).toISOString(), // 2 min after send
                metadata: { subject: email.subject || "", email_id: email.id, clicks: email.click_count || 1 },
                member_name: name,
                is_you: isYou,
              });
            }

            if (email.status === "replied") {
              activities.push({
                id: `synth-reply-${email.id}`,
                type: "email_replied",
                message: isYou ? `${biz} replied to your email` : `${biz} replied to ${name}'s email`,
                timestamp: new Date(baseTs + 180000).toISOString(), // 3 min after send
                metadata: { subject: email.subject || "", email_id: email.id },
                member_name: name,
                is_you: isYou,
              });
            }
          }
        });
      }
    } catch (e) {
      console.error("[TEAM ACTIVITY] Sent emails query error:", e);
    }

    // ── 3. Recent campaigns created ──
    try {
      const { data: campaigns } = await supabase
        .from("campaigns")
        .select("id, name, user_id, created_at")
        .in("user_id", teamMemberIds)
        .gte("created_at", oneWeekAgo)
        .order("created_at", { ascending: false })
        .limit(10);

      if (campaigns) {
        console.log(`[TEAM ACTIVITY] Section 3: ${campaigns.length} campaigns found`);
        campaigns.forEach((camp: any) => {
          const { name, isYou } = memberInfo(camp.user_id);

          activities.push({
            id: `camp-${camp.id}`,
            type: "campaign_created",
            message: "",  // Empty - will be translated on client
            timestamp: camp.created_at,
            metadata: {
              campaign_name: camp.name
            },
            member_name: name,
            is_you: isYou,
          });
        });
      }
    } catch (e) {
      console.error("[TEAM ACTIVITY] Campaigns query error:", e);
    }

    // ── 4. Recent leads added ──
    try {
      const { data: leads } = await supabase
        .from("leads")
        .select("id, business_name, contact_name, user_id, created_at")
        .in("user_id", teamMemberIds)
        .gte("created_at", oneWeekAgo)
        .order("created_at", { ascending: false })
        .limit(15);

      if (leads) {
        console.log(`[TEAM ACTIVITY] Section 4: ${leads.length} leads found`);
        leads.forEach((lead: any) => {
          const { name, isYou } = memberInfo(lead.user_id);
          const biz = lead.business_name || lead.contact_name || "a new lead";

          activities.push({
            id: `lead-${lead.id}`,
            type: "lead_added",
            message: "",  // Empty - will be translated on client
            timestamp: lead.created_at,
            metadata: {
              business_name: biz
            },
            member_name: name,
            is_you: isYou,
          });
        });
      }
    } catch (e) {
      console.error("[TEAM ACTIVITY] Leads query error:", e);
    }

    // Sort all activities by timestamp descending and take top 20
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Deduplicate: prefer real email_events over synthetic ones
    const seen = new Set<string>();
    const deduped = activities.filter(a => {
      // For synthetic entries, check if a real event already covers same email+type
      if (a.id.startsWith("synth-")) {
        const emailId = a.metadata?.email_id;
        const type = a.type;
        const realKey = `${type}-${emailId}`;
        if (seen.has(realKey)) return false;
        seen.add(realKey);
        seen.add(a.id);
        return true;
      }
      // Real events — mark their email_id+type as seen
      if (a.metadata?.email_id) {
        seen.add(`${a.type}-${a.metadata.email_id}`);
      }
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });

    console.log(`[TEAM ACTIVITY] Total activities collected: ${activities.length}, deduped: ${deduped.length}, returning top 30`);

    return c.json({
      activities: deduped.slice(0, 30),
      team_size: teamMemberIds.length,
    });
  } catch (error: any) {
    console.error("[TEAM SHARING] Team activity error:", error);
    return c.json({ error: error.message }, error.status || 500);
  }
});


// ═══════════════════════════════════════════════════════════════════
//  GET /leaderboard — Per-member competitive leaderboard stats
//  Returns leads, emails_sent, opens, clicks, replies, meetings,
//  pipeline size, and revenue attribution for each team member.
// ════════════════════════════════════════════════════════════════════
app.get("/leaderboard", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    const teamMemberIds = await getTeamMemberIds(user.id);

    // Admin emails excluded from leaderboard (admins, not sales reps)
    // NOTE: Never exclude the current user — they should always see their own stats.
    // NOTE: or@contndr.com (Otiniel) is a sales rep with active revenue — do NOT exclude.
    const LEADERBOARD_EXCLUDED_EMAILS = ["admin@contndr.com"];

    // Determine if this user belongs to the Contndr org (strictly @contndr.com only).
    // @roadr.com is a separate brand — admin privileges ≠ team membership.
    const isContndrTeam = (user.email || "").endsWith("@contndr.com");

    // Solo users: still compute their own stats (don't return empty)
    if (teamMemberIds.length <= 1) {
      // Ensure the current user is in the list so their stats get computed
      if (!teamMemberIds.includes(user.id)) {
        teamMemberIds.push(user.id);
      }
    }

    // Add timeout for member map loading
    const memberMapTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Member map timeout')), 4000)
    );
    
    const { map: memberMap, members: rawMembers } = await Promise.race([
      getMemberMap(user.id),
      memberMapTimeout
    ]).catch(() => ({ map: new Map(), teamId: '', members: [] }));
    
    // Always override current user's name/email from auth metadata (KV may be stale)
    // Try signature full_name first (most accurate), then auth metadata
    await overrideCurrentUserName(memberMap, user);

    // Time boundaries
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // ── Load meeting overrides from KV (for manually tracked meetings) ──
    let meetingOverrides: Record<string, number> = {};
    try {
      const overridesTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Override timeout')), 3000)
      );
      
      const raw = await Promise.race([
        kv.get("team_meeting_overrides"),
        overridesTimeout
      ]).catch(() => null);
      
      if (raw) {
        meetingOverrides = typeof raw === "string" ? JSON.parse(raw) : raw;
      }
    } catch {
      // No overrides — that's fine
    }
    // Seed default meeting overrides if not set yet
    if (!meetingOverrides || Object.keys(meetingOverrides).length === 0) {
      meetingOverrides = {
        "or@contndr.com": 2,
        "ax@contndr.com": 4,
      };
      try { await kv.set("team_meeting_overrides", meetingOverrides); } catch {}
    }

    // ── Ensure sales-leaderboard migrations have run (e.g. new seed deals) ──
    // Only needed for Contndr team — other orgs use DB-driven leaderboard.
    if (isContndrTeam) {
      try { await migrateV4IfNeeded(); } catch (migErr) {
        console.log(`[TEAM SHARING] Sales migration v4 check failed (non-fatal): ${migErr}`);
      }
    }

    // ── Load all sales-leaderboard deals once (attributed by sales_rep_email) ──
    // Only load for Contndr team — these are Contndr-specific KV deals.
    let allSalesDeals: any[] = [];
    const salesByEmail = new Map<string, { revenue: number; conversions: number }>();
    if (isContndrTeam) {
      try {
        // Add timeout to prevent dashboard hanging
        const salesDealsTimeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Sales deals query timeout')), 5000)
        );
        
        const rawSalesDeals = await Promise.race([
          kv.getByPrefix("sales_deal:contndr:"),
          salesDealsTimeout
        ]).catch(() => []);
        
        allSalesDeals = (rawSalesDeals || []) as any[];
      } catch (salesErr) {
        console.log(`[TEAM SHARING] Leaderboard error: ${salesErr}`);
        allSalesDeals = [];
      }

      // Build a map of email → { revenue, conversions } from active sales deals
      for (const deal of allSalesDeals) {
        if (deal.status !== "active") continue;
        const email = (deal.sales_rep_email || "").toLowerCase();
        if (!email) continue;
        const entry = salesByEmail.get(email) || { revenue: 0, conversions: 0 };
        entry.revenue += deal.amount || 0;
        entry.conversions += 1;
        salesByEmail.set(email, entry);
      }
      console.log(`[TEAM SHARING] Sales deals loaded: ${allSalesDeals.length} total, ${salesByEmail.size} reps with active revenue`);
    }

    // ── Parallel queries per member ──────────────────────────────
    const memberStats = await Promise.all(
      teamMemberIds.map(async (memberId) => {
        const info = memberMap.get(memberId);
        const rawMember = rawMembers.find((m: any) => m.id === memberId);

        // Leads total & this month
        const [leadsTotal, leadsMonth] = await Promise.all([
          supabase.from("leads").select("id", { count: "exact", head: true }).eq("user_id", memberId),
          supabase.from("leads").select("id", { count: "exact", head: true }).eq("user_id", memberId).gte("created_at", thirtyDaysAgo),
        ]);

        // Emails: sent, opened, clicked, bounced (all-time for rate calculation)
        const [emailsSent, emailsOpened, emailsClicked, emailsBounced] = await Promise.all([
          supabase.from("emails").select("id", { count: "exact", head: true }).eq("user_id", memberId).in("status", ["sent", "delivered", "opened", "clicked", "bounced", "complained"]),
          supabase.from("emails").select("id", { count: "exact", head: true }).eq("user_id", memberId).in("status", ["opened", "clicked"]),
          supabase.from("emails").select("id", { count: "exact", head: true }).eq("user_id", memberId).in("status", ["clicked"]),
          supabase.from("emails").select("id", { count: "exact", head: true }).eq("user_id", memberId).eq("status", "bounced"),
        ]);

        // Lead statuses for meetings & pipeline
        const { data: leadStatuses } = await supabase
          .from("leads")
          .select("status")
          .eq("user_id", memberId);

        const statusList = (leadStatuses || []).map((l: any) => l.status);
        const meetings = statusList.filter((s: string) => s === "meeting_scheduled").length;
        const pipelineStatuses = ["interested", "meeting_scheduled", "replied"];
        const pipeline = statusList.filter((s: string) => pipelineStatuses.includes(s)).length;

        // Replies (replied + interested + not_interested + not_now + meeting_scheduled)
        const replyStatuses = ["replied", "interested", "not_interested", "not_now", "meeting_scheduled"];
        const replies = statusList.filter((s: string) => replyStatuses.includes(s)).length;

        // Campaigns count
        const campaignsRes = await supabase
          .from("campaigns")
          .select("id", { count: "exact", head: true })
          .eq("user_id", memberId);

        // Revenue: from sales-leaderboard deals (attributed by sales_rep_email)
        // Match this member's email to the salesByEmail map we built above.
        const memberEmail = (info?.email || "").toLowerCase();
        const salesData = salesByEmail.get(memberEmail);
        const revenue = salesData?.revenue || 0;
        const conversions = salesData?.conversions || 0;

        // Pipeline: deal count & value from pipeline deals KV
        let dealCount = 0;
        let pipelineValue = 0;
        try {
          const rawDeals = await kv.get(`pipeline:${memberId}:deals`);
          if (rawDeals) {
            const deals: any[] = typeof rawDeals === "string" ? JSON.parse(rawDeals) : rawDeals;
            if (Array.isArray(deals)) {
              const activeDeals = deals.filter((d: any) => d.stage !== "closed_lost" && d.stage !== "closed_won");
              dealCount = activeDeals.length;
              pipelineValue = activeDeals.reduce((sum: number, d: any) => sum + (d.value || 0), 0);
            }
          }
        } catch (pipeErr) {
          console.log(`[TEAM SHARING] Pipeline lookup failed for ${memberId}: ${pipeErr}`);
        }

        const sent = emailsSent.count || 0;
        const opened = emailsOpened.count || 0;
        const clicked = emailsClicked.count || 0;
        const bounced = emailsBounced.count || 0;

        return {
          id: memberId,
          name: info?.name || "Team Member",
          email: info?.email || "",
          avatar_url: rawMember?.avatar_url || (memberId === user.id ? (user.user_metadata?.avatar_url || null) : null),
          is_you: memberId === user.id,
          leads: leadsTotal.count || 0,
          leads_this_month: leadsMonth.count || 0,
          emails_sent: sent,
          emails_opened: opened,
          emails_clicked: clicked,
          open_rate: sent > 0 ? Number(((opened / sent) * 100).toFixed(1)) : 0,
          click_rate: sent > 0 ? Number(((clicked / sent) * 100).toFixed(1)) : 0,
          replies,
          meetings: meetingOverrides[memberEmail] || meetings,
          pipeline,
          campaigns: campaignsRes.count || 0,
          revenue,
          deal_count: dealCount,
          pipeline_value: pipelineValue,
        };
      })
    );

    // ── Contndr team: inject virtual entries for sales reps NOT in team members ──
    // This ensures the Dashboard Team Leaderboard mirrors the Sales Admin Panel.
    // Only applies to @contndr.com team accounts (NOT @roadr.com — separate org).
    if (isContndrTeam) {
      const existingEmails = new Set(memberStats.map(m => (m.email || "").toLowerCase()));
      for (const [repEmail, salesData] of salesByEmail) {
        if (!existingEmails.has(repEmail) && repEmail.endsWith("@contndr.com")) {
          // Build name from deal data or email prefix
          let repName = repEmail.split("@")[0];
          // Try to get a proper name from the deals
          for (const deal of allSalesDeals) {
            if ((deal.sales_rep_email || "").toLowerCase() === repEmail && deal.sales_rep_name) {
              repName = deal.sales_rep_name;
              break;
            }
          }
          memberStats.push({
            id: `sales-rep-${repEmail}`,
            name: repName,
            email: repEmail,
            avatar_url: null,
            is_you: false,
            leads: 0,
            leads_this_month: 0,
            emails_sent: 0,
            emails_opened: 0,
            emails_clicked: 0,
            open_rate: 0,
            click_rate: 0,
            replies: 0,
            meetings: meetingOverrides[repEmail] || 0,
            pipeline: 0,
            campaigns: 0,
            revenue: salesData.revenue,
            deal_count: salesData.conversions,
            pipeline_value: 0,
          });
          console.log(`[TEAM SHARING] Injected virtual sales rep ${repEmail} (${repName}) with $${salesData.revenue} revenue, ${salesData.conversions} deals`);
        }
      }
    }

    // ── Filter out admin/excluded emails from the leaderboard ──
    // NEVER exclude the current user — they should always see their own stats
    const visibleMembers = memberStats.filter(
      (m) => m.is_you || !LEADERBOARD_EXCLUDED_EMAILS.includes((m.email || "").toLowerCase())
    );

    // ── Team totals (only from visible sales members) ─────────────────────
    const team_totals = {
      leads: visibleMembers.reduce((s, m) => s + m.leads, 0),
      leads_this_month: visibleMembers.reduce((s, m) => s + m.leads_this_month, 0),
      emails_sent: visibleMembers.reduce((s, m) => s + m.emails_sent, 0),
      emails_opened: visibleMembers.reduce((s, m) => s + m.emails_opened, 0),
      emails_clicked: visibleMembers.reduce((s, m) => s + m.emails_clicked, 0),
      replies: visibleMembers.reduce((s, m) => s + m.replies, 0),
      meetings: visibleMembers.reduce((s, m) => s + m.meetings, 0),
      pipeline: visibleMembers.reduce((s, m) => s + m.pipeline, 0),
      campaigns: visibleMembers.reduce((s, m) => s + m.campaigns, 0),
      revenue: visibleMembers.reduce((s, m) => s + m.revenue, 0),
    };
    const totalSent = team_totals.emails_sent;
    (team_totals as any).open_rate = totalSent > 0 ? Number(((team_totals.emails_opened / totalSent) * 100).toFixed(1)) : 0;
    (team_totals as any).click_rate = totalSent > 0 ? Number(((team_totals.emails_clicked / totalSent) * 100).toFixed(1)) : 0;

    console.log(`[TEAM SHARING] Leaderboard: ${visibleMembers.length} visible members (${memberStats.length - visibleMembers.length} admins excluded), ${team_totals.leads} total leads, ${team_totals.emails_sent} emails sent`);

    return c.json({
      members: visibleMembers,
      team_totals,
      team_size: visibleMembers.length,
    });
  } catch (error: any) {
    console.error("[TEAM SHARING] Leaderboard error:", error);
    return c.json({ error: error.message }, error.status || 500);
  }
});


// ════════════════════════════════════════════════════════════════════
//  POST /contact-check — Bulk email dedup across the team
//
//  Body: { emails: string[] }
//  Returns: { contacts: { [email]: TeamContact[] } }
//
//  TeamContact = {
//    contacted_by: string,       // Team member name
//    contacted_by_email: string, // Team member email
//    user_id: string,            // Team member ID
//    campaign_name: string,
//    campaign_id: string,
//    sent_at: string,
//    status: string              // sent/delivered/opened/clicked etc
//  }
// ════════════════════════════════════════════════════════════════════
app.post("/contact-check", async (c) => {
  try {
    const { user, supabase } = await getAuthenticatedUser(c);
    const teamMemberIds = await getTeamMemberIds(user.id);

    const body = await c.req.json();
    const rawEmails: string[] = body.emails || [];
    if (rawEmails.length === 0) {
      return c.json({ contacts: {} });
    }

    // Normalise to lowercase, dedupe, cap at 500 to prevent abuse
    const emails = [...new Set(rawEmails.map(e => e.trim().toLowerCase()))].slice(0, 500);

    console.log(`[TEAM SHARING] Contact-check: ${emails.length} emails, ${teamMemberIds.length} team members`);

    // Solo user → no team contacts to check (their own emails don't count as "team" collision)
    if (teamMemberIds.length <= 1) {
      return c.json({ contacts: {} });
    }

    const { map: memberMap } = await getMemberMap(user.id);
    await overrideCurrentUserName(memberMap, user);

    // Query emails table: all sends from ANY team member TO these addresses
    // The `emails` table does NOT have a `to_email` column.
    // Instead, emails link to recipients via `lead_id` → `leads.email`.
    // Two-step approach: (1) find leads by email, (2) query emails by lead_id.
    const BATCH_SIZE = 100;
    const allEmailRows: any[] = [];

    // Step 1: Find all leads whose email is in the requested list (across all team members)
    const leadIdToEmail = new Map<string, string>();
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      const { data: leads, error: leadsErr } = await supabase
        .from("leads")
        .select("id, email")
        .in("email", batch);
      if (leadsErr) {
        console.error("[TEAM SHARING] Contact-check leads lookup error:", leadsErr);
      } else if (leads) {
        for (const lead of leads) {
          leadIdToEmail.set(lead.id, (lead.email || "").toLowerCase());
        }
      }
    }

    // Step 2: Query emails by lead_id for those leads, filtered to team members
    const leadIds = Array.from(leadIdToEmail.keys());
    if (leadIds.length > 0) {
      for (let i = 0; i < leadIds.length; i += BATCH_SIZE) {
        const batch = leadIds.slice(i, i + BATCH_SIZE);
        const { data: rows, error } = await supabase
          .from("emails")
          .select("id, user_id, campaign_id, sent_at, status, lead_id")
          .in("user_id", teamMemberIds)
          .in("lead_id", batch)
          .in("status", ["sent", "delivered", "opened", "clicked", "bounced", "complained"])
          .order("sent_at", { ascending: false })
          .limit(2000);

        if (error) {
          console.error("[TEAM SHARING] Contact-check emails query error:", error);
        } else if (rows) {
          allEmailRows.push(...rows);
        }
      }
    }

    // Build campaign name lookup (batch fetch unique campaign IDs)
    const campaignIds = [...new Set(allEmailRows.map(r => r.campaign_id).filter(Boolean))];
    const campaignNameMap = new Map<string, string>();
    if (campaignIds.length > 0) {
      for (let i = 0; i < campaignIds.length; i += BATCH_SIZE) {
        const batch = campaignIds.slice(i, i + BATCH_SIZE);
        const { data: campaigns } = await supabase
          .from("campaigns")
          .select("id, name")
          .in("id", batch);
        if (campaigns) {
          for (const c of campaigns) {
            campaignNameMap.set(c.id, c.name);
          }
        }
      }
    }

    // Group by email (resolve lead_id → email via our map)
    const contacts: Record<string, any[]> = {};
    for (const row of allEmailRows) {
      const normEmail = leadIdToEmail.get(row.lead_id) || "";
      if (!normEmail) continue;
      if (!contacts[normEmail]) contacts[normEmail] = [];

      const member = memberMap.get(row.user_id);
      contacts[normEmail].push({
        contacted_by: member?.name || "Team Member",
        contacted_by_email: member?.email || "",
        user_id: row.user_id,
        is_you: row.user_id === user.id,
        campaign_name: campaignNameMap.get(row.campaign_id) || "Unknown Campaign",
        campaign_id: row.campaign_id,
        sent_at: row.sent_at,
        status: row.status,
      });
    }

    // Deduplicate per email: keep the most recent per (user_id, campaign_id) pair
    for (const email of Object.keys(contacts)) {
      const seen = new Map<string, any>();
      for (const c of contacts[email]) {
        const key = `${c.user_id}:${c.campaign_id}`;
        if (!seen.has(key) || new Date(c.sent_at) > new Date(seen.get(key).sent_at)) {
          seen.set(key, c);
        }
      }
      contacts[email] = Array.from(seen.values()).sort(
        (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
      );
    }

    console.log(`[TEAM SHARING] Contact-check result: ${Object.keys(contacts).length} emails have team outreach`);

    return c.json({ contacts });
  } catch (error: any) {
    console.error("[TEAM SHARING] Contact-check error:", error);
    return c.json({ error: error.message }, error.status || 500);
  }
});


export default app;

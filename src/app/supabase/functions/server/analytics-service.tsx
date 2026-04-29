import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Analytics Overview (fixed)
 *
 * Key fixes:
 * - Use sent_at (not created_at) for "sent" metrics + 30-day window
 * - Provide BOTH all-time overview + last-30-days overview (so UI isn’t confusing)
 * - Add error handling + safe fallbacks
 * - Normalize date bucketing from sent_at (fallback created_at only if sent_at missing)
 * - Subject/campaign/hour analytics based on actually-sent emails
 */
export async function getAnalyticsOverview(user: any, supabase: any) {
  const now = Date.now();
  const thirtyDaysAgoIso = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  // ---------- helpers ----------
  const _isTransientAnalytics = (msg: string) =>
    !msg  // empty message is always a transient Supabase internal error
    || msg.includes('schema cache') || msg.includes('PGRST002') || msg.includes('Database error')
    || msg.includes('Failed to fetch') || msg.includes('fetch failed')
    || msg.includes('connection reset') || msg.includes('Unexpected failure')
    || msg.includes('57014') || msg.includes('statement timeout') || msg.includes('canceling statement');

  const safeCount = async (queryBuilder: any, label: string, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      const { count, error } = await queryBuilder;
      if (error) {
        const msg = error?.message || error?.code || String(error);
        if (_isTransientAnalytics(msg) && i < retries - 1) {
          const delay = 600 * Math.pow(2, i);
          console.warn(`[analytics] ${label} transient error (attempt ${i + 1}/${retries}), retrying in ${delay}ms: ${msg}`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error(`[analytics] count error: ${label}`, error);
      }
      return count ?? 0;
    }
    return 0;
  };

  const safeData = async (queryBuilder: any, label: string, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      const { data, error } = await queryBuilder;
      if (error) {
        const msg = error?.message || error?.code || String(error);
        if (_isTransientAnalytics(msg) && i < retries - 1) {
          const delay = 600 * Math.pow(2, i);
          console.warn(`[analytics] ${label} transient error (attempt ${i + 1}/${retries}), retrying in ${delay}ms: ${msg}`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error(`[analytics] query error: ${label}`, error);
      }
      return data ?? [];
    }
    return [];
  };

  const pct = (num: number, den: number) => (den > 0 ? Number(((num / den) * 100).toFixed(1)) : 0.0);

  const dayKeyUTC = (d: string | Date) => new Date(d).toISOString().split("T")[0];

  // ---------- 1) Fetch campaigns ----------
  const campaigns = await safeData(
    supabase
      .from("campaigns")
      .select("id, name, created_at")
      .eq("user_id", user.id),
    "campaigns"
  );

  // Map campaign id -> name
  const campaignNameById = new Map<string, string>();
  for (const c of campaigns) campaignNameById.set(c.id, c.name);

  // ---------- 2) Fetch emails (last 30 days) ----------
  // IMPORTANT: analytics should be based on sent emails -> sent_at not null
  // Fetch in batches to handle >1000 emails
  // OPTIMIZATION: Limit to 5000 emails for trend analysis to prevent OOM/Timeout
  let emailsLast30Days: any[] = [];
  let from = 0;
  const batchSize = 1000;
  const MAX_ANALYTICS_ROWS = 5000; // Hard limit for analysis
  let hasMore = true;

  while (hasMore && emailsLast30Days.length < MAX_ANALYTICS_ROWS) {
    const { data, error } = await supabase
      .from("emails")
      .select("id, subject, status, created_at, opened_at, clicked_at, sent_at, campaign_id")
      .eq("user_id", user.id)
      .not("sent_at", "is", null)
      .gte("sent_at", thirtyDaysAgoIso)
      .order("sent_at", { ascending: false })
      .range(from, from + batchSize - 1);
    
    if (error) {
      const errMsg = error?.message || error?.code || String(error);
      if (_isTransientAnalytics(errMsg)) {
        // Retry up to 3 times with backoff for transient DB errors
        let retryOk = false;
        for (let _r = 0; _r < 3; _r++) {
          const delay = 600 * Math.pow(2, _r);
          console.warn(`[analytics] emails_last_30_days transient error, retry ${_r + 1}/3 in ${delay}ms: ${errMsg}`);
          await new Promise(r => setTimeout(r, delay));
          const retry = await supabase
            .from("emails")
            .select("id, subject, status, created_at, opened_at, clicked_at, sent_at, campaign_id")
            .eq("user_id", user.id)
            .not("sent_at", "is", null)
            .gte("sent_at", thirtyDaysAgoIso)
            .order("sent_at", { ascending: false })
            .range(from, from + batchSize - 1);
          if (!retry.error && retry.data) {
            emailsLast30Days = emailsLast30Days.concat(retry.data);
            from += batchSize;
            hasMore = retry.data.length === batchSize;
            retryOk = true;
            break;
          }
          const retryMsg = retry.error?.message || '';
          if (!_isTransientAnalytics(retryMsg)) break;
        }
        if (!retryOk) break;
        continue; // skip the normal data handling below since retry handled it
      }
      console.error('[analytics] query error: emails_last_30_days', error);
      break;
    }

    if (data && data.length > 0) {
      emailsLast30Days = emailsLast30Days.concat(data);
      from += batchSize;
      hasMore = data.length === batchSize;
    } else {
      hasMore = false;
    }
  }

  // ---------- 3) Overview counts ----------
  // All time (sent emails only)
  const totalEmailsAllTime = await safeCount(
    supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("sent_at", "is", null),
    "totalEmailsAllTime"
  );

  const totalOpenedAllTime = await safeCount(
    supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("sent_at", "is", null)
      .not("opened_at", "is", null),
    "totalOpenedAllTime"
  );

  const totalClickedAllTime = await safeCount(
    supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("sent_at", "is", null)
      .not("clicked_at", "is", null),
    "totalClickedAllTime"
  );

  // If you truly track replies differently, adjust this.
  // For now: status === 'replied'
  const totalRepliedAllTime = await safeCount(
    supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("sent_at", "is", null)
      .eq("status", "replied"),
    "totalRepliedAllTime"
  );

  const totalBouncedAllTime = await safeCount(
    supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("sent_at", "is", null)
      .eq("status", "bounced"),
    "totalBouncedAllTime"
  );

  // Last 30 days (computed from fetched dataset to avoid extra queries)
  const totalEmails30d = emailsLast30Days.length;
  const totalOpened30d = emailsLast30Days.filter((e: any) => !!e.opened_at).length;
  const totalClicked30d = emailsLast30Days.filter((e: any) => !!e.clicked_at).length;
  const totalReplied30d = emailsLast30Days.filter((e: any) => e.status === "replied").length;
  const totalBounced30d = emailsLast30Days.filter((e: any) => e.status === "bounced").length;

  const overviewAllTime = {
    totalEmails: totalEmailsAllTime,
    totalOpened: totalOpenedAllTime,
    totalClicked: totalClickedAllTime,
    totalReplied: totalRepliedAllTime,
    totalBounced: totalBouncedAllTime,
    openRate: pct(totalOpenedAllTime, totalEmailsAllTime),
    clickRate: pct(totalClickedAllTime, totalEmailsAllTime),
    replyRate: pct(totalRepliedAllTime, totalEmailsAllTime),
    bounceRate: pct(totalBouncedAllTime, totalEmailsAllTime),
  };

  const overviewLast30Days = {
    totalEmails: totalEmails30d,
    totalOpened: totalOpened30d,
    totalClicked: totalClicked30d,
    totalReplied: totalReplied30d,
    totalBounced: totalBounced30d,
    openRate: pct(totalOpened30d, totalEmails30d),
    clickRate: pct(totalClicked30d, totalEmails30d),
    replyRate: pct(totalReplied30d, totalEmails30d),
    bounceRate: pct(totalBounced30d, totalEmails30d),
  };

  // ---------- 4) Time Series (Daily, last 30 days) ----------
  const timeSeriesMap = new Map<string, { date: string; sent: number; opened: number; clicked: number; replied: number }>();

  // Initialize last 30 days buckets (UTC day keys)
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    timeSeriesMap.set(dateStr, { date: dateStr, sent: 0, opened: 0, clicked: 0, replied: 0 });
  }

  for (const email of emailsLast30Days) {
    // Base sent day on sent_at; fallback to created_at if somehow missing
    const base = email.sent_at ?? email.created_at;
    if (!base) continue;

    const dateStr = dayKeyUTC(base);
    const entry = timeSeriesMap.get(dateStr);
    if (!entry) continue;

    // Since our dataset is filtered to sent_at != null, this counts actual sent
    entry.sent += 1;
    if (email.opened_at) entry.opened += 1;
    if (email.clicked_at) entry.clicked += 1;
    if (email.status === "replied") entry.replied += 1;
  }

  const timeSeries = Array.from(timeSeriesMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // ---------- 5) Best Subjects (from last 30 days sent emails) ----------
  const subjectMap = new Map<string, { subject: string; sent: number; opened: number; clicked: number }>();

  for (const email of emailsLast30Days) {
    const subject = (email.subject || "").trim();
    if (!subject) continue;

    if (!subjectMap.has(subject)) {
      subjectMap.set(subject, { subject, sent: 0, opened: 0, clicked: 0 });
    }
    const entry = subjectMap.get(subject)!;
    entry.sent += 1;
    if (email.opened_at) entry.opened += 1;
    if (email.clicked_at) entry.clicked += 1;
  }

  const bestSubjects = Array.from(subjectMap.values())
    .map((s) => ({
      ...s,
      openRate: pct(s.opened, s.sent),
      clickRate: pct(s.clicked, s.sent),
    }))
    // You can sort by clickRate if you prefer
    .sort((a, b) => b.openRate - a.openRate)
    .slice(0, 10);

  // ---------- 6) Campaign Comparison (last 30 days sent emails) ----------
  const campaignStats = new Map<string, { id: string; name: string; sent: number; opened: number; clicked: number; replied: number }>();

  for (const c of campaigns) {
    campaignStats.set(c.id, { id: c.id, name: c.name, sent: 0, opened: 0, clicked: 0, replied: 0 });
  }

  for (const email of emailsLast30Days) {
    const cid = email.campaign_id;
    if (!cid) continue;

    if (!campaignStats.has(cid)) {
      // In case campaigns list didn’t include this campaign (edge cases)
      campaignStats.set(cid, { id: cid, name: campaignNameById.get(cid) ?? "Untitled Campaign", sent: 0, opened: 0, clicked: 0, replied: 0 });
    }

    const stats = campaignStats.get(cid)!;
    stats.sent += 1;
    if (email.opened_at) stats.opened += 1;
    if (email.clicked_at) stats.clicked += 1;
    if (email.status === "replied") stats.replied += 1;
  }

  const campaignComparison = Array.from(campaignStats.values())
    .filter((c) => c.sent > 0)
    .map((c) => ({
      ...c,
      openRate: pct(c.opened, c.sent),
      clickRate: pct(c.clicked, c.sent),
      replyRate: pct(c.replied, c.sent),
    }))
    .sort((a, b) => b.sent - a.sent);

  // ---------- 7) Best Send Times (Hourly) ----------
  const hourMap = new Map<number, { hour: number; sent: number; opened: number }>();
  for (let i = 0; i < 24; i++) hourMap.set(i, { hour: i, sent: 0, opened: 0 });

  for (const email of emailsLast30Days) {
    if (!email.sent_at) continue;
    const hour = new Date(email.sent_at).getHours(); // NOTE: this uses server/runtime timezone
    const entry = hourMap.get(hour);
    if (!entry) continue;

    entry.sent += 1;
    if (email.opened_at) entry.opened += 1;
  }

  const bestSendTimes = Array.from(hourMap.values())
    .map((h) => ({
      ...h,
      openRate: pct(h.opened, h.sent),
    }))
    .filter((h) => h.sent >= 5) // reduce noise
    .sort((a, b) => b.openRate - a.openRate);

  return {
    overviewAllTime,
    overviewLast30Days,
    timeSeries,
    bestSubjects,
    campaignComparison,
    bestSendTimes,
  };
}
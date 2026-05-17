/**
 * UNIFIED INBOX & REPLY DETECTION MODULE
 * 
 * Features:
 * - Email reply monitoring via Resend webhooks
 * - Auto-pause campaigns when someone replies
 * - Sentiment analysis on replies (OpenAI)
 * - Thread management and conversation tracking
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { firePipelineTrigger } from "./pipeline.tsx";
import { attachCachedAvatars } from "./avatar-cache.tsx";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

export interface EmailReply {
  id: string;
  leadId: string;
  campaignId: string;
  emailId: string; // Original sent email ID
  from: string;
  to: string;
  subject: string;
  body: string;
  htmlBody?: string;
  receivedAt: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'pending';
  sentimentScore: number; // 0-100
  isInterested: boolean;
  tags: string[]; // ['interested', 'pricing-question', 'meeting-request', etc.]
  threadId: string;
  read: boolean;
  archived: boolean;
}

export interface ConversationThread {
  threadId: string;
  leadId: string;
  campaignId: string;
  brand: string;
  leadName: string;
  leadEmail: string;
  avatarUrl?: string | null;
  avatar_url?: string | null;
  avatarConfidence?: number;
  avatar_confidence?: number;
  leadLinkedinUrl?: string | null;
  leadPhone?: string;
  leadCompany?: string;
  lastMessageAt: string;
  messageCount: number;
  unreadCount: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  status: 'active' | 'paused' | 'closed';
  tags: string[];
  messages: EmailMessage[];
}

export interface EmailMessage {
  id: string;
  direction: 'sent' | 'received';
  from: string;
  to: string;
  subject: string;
  body: string;
  htmlBody?: string;
  sentAt: string;
  read: boolean;
  status?: string;       // sent, delivered, opened, clicked, replied, bounced, failed
  openedAt?: string | null;
  clickedAt?: string | null;
  deliveredAt?: string | null;
}

/**
 * Process incoming email webhook from Resend
 * This gets called when someone replies to an email
 */
export async function processIncomingEmail(webhookData: any): Promise<void> {
  try {
    console.log('Processing incoming email:', webhookData);

    const {
      from,
      to,
      subject,
      html,
      text,
      messageId,
      inReplyTo, // Thread reference
      references,
      receivedAt
    } = webhookData;

    // Extract lead email from 'from' field
    const leadEmail = extractEmail(from);
    // Recipient address — this is the user's sending mailbox and the
    // ONLY reliable signal for which tenant this reply belongs to.
    // Without it, a lookup by `from` alone matches across all tenants
    // and silently flips the wrong user's lead to "Replied."
    const recipientEmail = extractEmail(to);

    // Find the original sent email by inReplyTo/References FIRST (most
    // reliable), then by recipient+lead combination. Always scoped to
    // a single tenant.
    const originalEmail = await findOriginalEmail({
      recipientEmail,
      leadEmail,
      inReplyTo,
      references,
    });

    let leadId = originalEmail?.leadId;
    let campaignId = originalEmail?.campaignId || '';
    let emailId = originalEmail?.emailId || '';
    let leadUserId: string | undefined = originalEmail?.userId;

    // If thread match didn't resolve the user, look up via the recipient
    // address (campaign sender) — NOT by `from` alone, which would
    // cross-tenant collide. We use the recipient to find the user_id,
    // then look up the lead within that user's leads only.
    if (!leadUserId && recipientEmail) {
      leadUserId = await resolveUserIdFromRecipient(recipientEmail);
    }

    if (!leadId && leadUserId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('user_id', leadUserId)   // ← critical: scope by tenant
        .eq('email', leadEmail)
        .maybeSingle();
      if (lead) leadId = lead.id;
    }

    if (!leadId || !leadUserId) {
      console.log(`[inbox] Could not match reply (from=${leadEmail}, to=${recipientEmail}, inReplyTo=${inReplyTo || 'none'}) — dropping`);
      return;
    }

    // Generate thread ID (use leadId if campaignId is missing to ensure uniqueness per lead)
    const threadId = generateThreadId(leadEmail, campaignId || 'general');

    if (leadUserId) {
      // Store in Emails table (Postgres)
      const { data: replyEmail } = await supabase.from('emails').insert({
        user_id: leadUserId,
        lead_id: leadId,
        campaign_id: campaignId || null, // Allow null if unknown
        direction: 'inbound',
        status: 'replied',
        subject: subject,
        text_body: text || stripHtml(html || ''),
        html_body: html,
        body: text || stripHtml(html || ''), // Redundant but safe
        replied_at: receivedAt || new Date().toISOString(),
      }).select('id').single();

      // Log event
      if (replyEmail) {
        try {
          await supabase.from('email_events').insert({
            email_id: replyEmail.id,
            event_type: 'replied',
            created_at: new Date().toISOString()
          });
        } catch (evtError) {
          console.error('Error logging reply event:', evtError);
        }
      }
    }

    // Store the reply in KV (Legacy/Redundant but keeping for safety)
    const replyId = `reply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const reply: EmailReply = {
      id: replyId,
      leadId: leadId,
      campaignId,
      emailId,
      from: leadEmail,
      to,
      subject,
      body: text || stripHtml(html || ''),
      htmlBody: html,
      receivedAt: receivedAt || new Date().toISOString(),
      sentiment: 'pending',
      sentimentScore: 0,
      isInterested: false,
      tags: [],
      threadId,
      read: false,
      archived: false,
    };

    // Write under the per-user prefix so future reads can scope by user.
    // The legacy `reply:${replyId}` key range is still scanned for
    // backward compatibility but new replies don't pollute it.
    await kv.set(`reply:${leadUserId}:${replyId}`, reply);

    // Add to thread
    await addReplyToThread(threadId, reply);

    // Auto-pause campaign for this lead
    await autoPauseCampaignForLead(leadId, campaignId);

    // Analyze sentiment asynchronously
    analyzeSentiment(replyId, reply.body).catch(err => 
      console.error('Sentiment analysis error:', err)
    );

    // Update lead status
    await updateLeadStatus(leadId, 'replied');

    // Pipeline auto-stage trigger: email_replied → move to "engaged"
    if (leadUserId && leadEmail) {
      firePipelineTrigger({
        event_type: 'email_replied',
        user_id: leadUserId,
        email: leadEmail,
        lead_id: leadId,
      }).catch(() => {});
    }

    console.log(`Reply ${replyId} processed successfully`);
  } catch (error) {
    console.error('Error processing incoming email:', error);
    throw error;
  }
}

/**
 * Resolve the tenant (user_id) for a reply by looking at the recipient
 * mailbox. The recipient is the user's sending address — every send
 * record on `emails` has a `from_email` field that uniquely identifies
 * the owner. This is the only safe way to scope the reply to one tenant
 * before doing any per-user lookups.
 */
async function resolveUserIdFromRecipient(recipientEmail: string): Promise<string | undefined> {
  if (!recipientEmail) return undefined;
  try {
    const { data } = await supabase
      .from('emails')
      .select('user_id')
      .eq('from_email', recipientEmail)
      .limit(1)
      .maybeSingle();
    return data?.user_id || undefined;
  } catch (err) {
    console.error('[inbox] resolveUserIdFromRecipient failed:', err);
    return undefined;
  }
}

/**
 * Find the original sent email this reply belongs to.
 *
 * Lookup order (most → least reliable):
 *  1. By `In-Reply-To` / `References` header against `emails.message_id`
 *     — proper RFC-5322 threading, can't collide across tenants.
 *  2. By (recipient sender address, lead address) — scoped to one
 *     tenant via the recipient. Returns the most recent send.
 *  3. KV legacy fallback, scoped by user_id when available.
 *
 * IMPORTANT: never look up by `to_email = leadEmail` alone. That ignores
 * the tenant and will silently match another user's send.
 */
async function findOriginalEmail(opts: {
  recipientEmail: string;
  leadEmail: string;
  inReplyTo?: string;
  references?: string;
}): Promise<{
  leadId: string;
  campaignId: string;
  emailId: string;
  userId: string;
} | null> {
  const { recipientEmail, leadEmail, inReplyTo, references } = opts;
  try {
    // 1. RFC-5322 threading via Message-ID. Resend stores the Message-ID
    // it sent as `resend_id`. The In-Reply-To header arrives as either
    // `<id>` or `<id@resend.com>`; we strip both the brackets and the
    // optional `@resend.com` suffix and try both forms.
    const candidateIds = collectMessageIds(inReplyTo, references);
    if (candidateIds.length > 0) {
      const { data: byMsgId } = await supabase
        .from('emails')
        .select('id, lead_id, campaign_id, user_id')
        .in('resend_id', candidateIds)
        .limit(1)
        .maybeSingle();
      if (byMsgId) {
        return {
          leadId: byMsgId.lead_id,
          campaignId: byMsgId.campaign_id,
          emailId: byMsgId.id,
          userId: byMsgId.user_id,
        };
      }
    }

    // 2. Tenant-scoped lookup: most recent send FROM the recipient TO
    // the lead. The `from_email = recipientEmail` constraint scopes
    // this to a single tenant (the owner of that mailbox).
    if (recipientEmail) {
      const { data: lastEmail } = await supabase
        .from('emails')
        .select('id, lead_id, campaign_id, user_id')
        .eq('from_email', recipientEmail)
        .eq('to_email', leadEmail)
        .or('direction.eq.sent,direction.eq.outbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastEmail) {
        return {
          leadId: lastEmail.lead_id,
          campaignId: lastEmail.campaign_id,
          emailId: lastEmail.id,
          userId: lastEmail.user_id,
        };
      }
    }

    // 3. KV legacy fallback — only match rows that have BOTH our lead
    // email AND a matching sender (if we know it). Without a sender
    // filter we'd be back to the cross-tenant bug.
    const sentEmailsData = await kv.getByPrefix('email:sent:');
    for (const emailData of sentEmailsData) {
      const email = emailData as any;
      const matchesLead = email.to === leadEmail;
      const matchesSender = !recipientEmail || email.from === recipientEmail;
      if (matchesLead && matchesSender) {
        return {
          leadId: email.leadId,
          campaignId: email.campaignId,
          emailId: email.id,
          userId: email.userId || email.user_id,
        };
      }
    }

    return null;
  } catch (error) {
    console.error('[inbox] findOriginalEmail error:', error);
    return null;
  }
}

/** Parse Message-IDs out of In-Reply-To / References headers and return
 *  every plausible form: the full `id@domain`, just `id`, and the
 *  bracketless variants. We try them all against `emails.resend_id`. */
function collectMessageIds(inReplyTo?: string, references?: string): string[] {
  const ids = new Set<string>();
  const extract = (raw: string | undefined) => {
    if (!raw) return;
    const matches = raw.match(/<[^>\s]+>|\S+@\S+/g);
    if (!matches) return;
    for (const m of matches) {
      const cleaned = m.replace(/^<|>$/g, '').trim();
      if (!cleaned) continue;
      ids.add(cleaned);
      // Also try the id part before @ — Resend's resend_id often does
      // not include the domain suffix.
      const at = cleaned.indexOf('@');
      if (at > 0) ids.add(cleaned.slice(0, at));
    }
  };
  extract(inReplyTo);
  extract(references);
  return Array.from(ids);
}

/**
 * Analyze sentiment of reply using OpenAI
 */
async function analyzeSentiment(replyId: string, body: string): Promise<void> {
  try {
    const { generateAI } = await import("./ai-provider.tsx");

    const prompt = `Analyze this email reply and determine:
1. Sentiment (positive/neutral/negative)
2. Interest level (0-100)
3. Whether they're interested in continuing the conversation
4. Classify into one of these EXACT tags: "Interested", "Not now", "Not interested"

Email: "${body}"

Respond in JSON format:
{
  "sentiment": "positive|neutral|negative",
  "score": 0-100,
  "isInterested": true/false,
  "tags": ["Interested"|"Not now"|"Not interested"],
  "reasoning": "brief explanation"
}`;

    let aiResult;
    try {
      aiResult = await generateAI({
        messages: [
          {
            role: 'system',
            content: 'You are an expert sales email analyzer. Analyze email replies to determine sentiment and intent.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        maxTokens: 300,
        jsonMode: true,
      });
    } catch (aiErr: any) {
      console.error('AI sentiment analysis error:', aiErr.message);
      return;
    }

    const analysis = JSON.parse(aiResult.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());

    // Update reply with sentiment analysis
    const reply = await kv.get(`reply:${replyId}`) as EmailReply;
    if (reply) {
      reply.sentiment = analysis.sentiment;
      reply.sentimentScore = analysis.score;
      reply.isInterested = analysis.isInterested;
      reply.tags = analysis.tags;
      await kv.set(`reply:${replyId}`, reply);

      console.log(`Sentiment analysis complete for ${replyId}:`, analysis);

      // Update lead status based on tags
      if (analysis.tags && analysis.tags.length > 0) {
        let newStatus = 'replied';
        if (analysis.tags.includes('Interested')) {
          newStatus = 'interested';
        } else if (analysis.tags.includes('Not interested')) {
          newStatus = 'not_interested';
        } else if (analysis.tags.includes('Not now')) {
          newStatus = 'not_now';
        }
        
        if (newStatus !== 'replied') {
          await updateLeadStatus(reply.leadId, newStatus);
        }
      }
    }
  } catch (error) {
    console.error('Error analyzing sentiment:', error);
  }
}

/**
 * Auto-pause campaign for lead when they reply
 */
async function autoPauseCampaignForLead(leadId: string, campaignId: string): Promise<void> {
  try {
    // Get lead data
    const lead = await kv.get(`lead:${leadId}`);
    if (!lead) return;

    const leadData = lead as any;

    // Pause campaign for this lead
    leadData.campaignStatus = leadData.campaignStatus || {};
    leadData.campaignStatus[campaignId] = 'paused';
    leadData.lastReplyAt = new Date().toISOString();

    await kv.set(`lead:${leadId}`, leadData);

    console.log(`Campaign ${campaignId} paused for lead ${leadId} due to reply`);
  } catch (error) {
    console.error('Error pausing campaign:', error);
  }
}

/**
 * Update lead status when they reply
 */
async function updateLeadStatus(leadId: string, status: string): Promise<void> {
  try {
    // Update KV
    const lead = await kv.get(`lead:${leadId}`);
    if (lead) {
      const leadData = lead as any;
      leadData.status = status;
      leadData.lastActivityAt = new Date().toISOString();
      await kv.set(`lead:${leadId}`, leadData);
    }

    // Update Postgres
    await supabase.from('leads').update({ status }).eq('id', leadId);
    
  } catch (error) {
    console.error('Error updating lead status:', error);
  }
}

/**
 * Get all conversations/threads for inbox
 */
export async function getConversations(filters?: {
  sentiment?: string;
  unreadOnly?: boolean;
  campaignId?: string;
  brand?: string;
  limit?: number;
  userId?: string;
  force?: boolean; // bypass cache
}): Promise<ConversationThread[]> {
  try {
    // SECURITY: userId is required — if not provided, return empty to prevent data leaks
    if (!filters?.userId) {
      console.error('[INBOX] getConversations called without userId — returning empty for safety');
      return [];
    }

    // ── KV cache (55 s TTL, per user + filter combo) ──────────────────
    const INBOX_CACHE_TTL_MS = 55_000;
    const filterHash = `${filters?.sentiment || ''}:${filters?.unreadOnly || false}:${filters?.brand || ''}:${filters?.campaignId || ''}`;
    const cacheKey = `inbox:cache:v3:${filters.userId}:${filterHash}`;

    if (!filters?.force) {
      try {
        const cached = await kv.get(cacheKey) as any;
        if (cached && cached._expiresAt && cached._expiresAt > Date.now()) {
          console.log('[INBOX] Serving threads from KV cache');
          return cached.threads as ConversationThread[];
        }
      } catch {
        // cache miss — proceed with fresh fetch
      }
    }

    // Fetch emails directly from Postgres instead of KV
    // OPTIMIZATION: Limit to most recent 300 emails to prevent slow load times (reduced from 500)
    // Try with join first, fall back to no-join on timeout (code 57014)
    let emails: any[] = [];
    let usedFallback = false;

    const buildQuery = (withJoin: boolean) => {
      const selectStr = withJoin
        ? `*, lead:leads (id, business_name, contact_name, email, phone, category, linkedin_url, person_linkedin_url, linkedin), campaign:campaigns (id, brand)`
        : `*`;
      let q = supabase
        .from('emails')
        .select(selectStr)
        .eq('user_id', filters.userId) // ALWAYS filter by user_id — never return unscoped data
        .order('created_at', { ascending: false })
        .limit(300); // Optimization: Limit to 300 most recent emails for inbox view
      if (filters?.campaignId) {
        q = q.eq('campaign_id', filters.campaignId);
      }
      return q;
    };

    const { data: joinedEmails, error: joinError } = await buildQuery(true);

    if (joinError) {
      const errorCode = (joinError as any)?.code;
      if (errorCode === '57014' || joinError.message?.includes('timeout') || joinError.message?.includes('statement canceled')) {
        console.log('[INBOX] Join query timed out (57014), retrying without join...');
        const { data: plainEmails, error: plainError } = await buildQuery(false);
        if (plainError) {
          console.error('Error fetching emails from DB (fallback):', plainError);
          return [];
        }
        emails = plainEmails || [];
        usedFallback = true;

        // Batch-fetch lead data for the unique lead_ids
        const leadIds = [...new Set(emails.map((e: any) => e.lead_id).filter(Boolean))];
        if (leadIds.length > 0) {
          const leadMap = new Map<string, any>();
          // Fetch in batches of 100
          for (let i = 0; i < leadIds.length; i += 100) {
            const batch = leadIds.slice(i, i + 100);
            const { data: leads } = await supabase
              .from('leads')
              .select('id, business_name, contact_name, email, phone, category, linkedin_url, person_linkedin_url, linkedin')
              .in('id', batch);
            if (leads) {
              for (const l of leads) leadMap.set(l.id, l);
            }
          }
          // Attach lead data back to emails
          for (const email of emails) {
            if (email.lead_id && leadMap.has(email.lead_id)) {
              email.lead = leadMap.get(email.lead_id);
            }
          }
        }

        // Batch-fetch campaign brands
        const campaignIds = [...new Set(emails.map((e: any) => e.campaign_id).filter(Boolean))];
        if (campaignIds.length > 0) {
          const { data: campaigns } = await supabase
            .from('campaigns')
            .select('id, brand')
            .in('id', campaignIds);
          const campMap = new Map<string, any>();
          if (campaigns) {
            for (const c of campaigns) campMap.set(c.id, c);
          }
          for (const email of emails) {
            if (email.campaign_id && campMap.has(email.campaign_id)) {
              email.campaign = campMap.get(email.campaign_id);
            }
          }
        }

        console.log(`[INBOX] Fallback query succeeded: ${emails.length} emails, ${leadIds.length} leads`);
      } else {
        console.error('Error fetching emails from DB:', joinError);
        return [];
      }
    } else {
      emails = joinedEmails || [];
    }

    // Group by lead_id first to handle thread merging intelligently
    const leadsMap = new Map<string, any[]>();
    
    for (const email of emails) {
      if (!email.lead_id) continue;
      if (!leadsMap.has(email.lead_id)) {
        leadsMap.set(email.lead_id, []);
      }
      leadsMap.get(email.lead_id)!.push(email);
    }
    
    let threads: ConversationThread[] = [];

    // Process each lead's emails
    for (const [leadId, leadEmails] of leadsMap.entries()) {
        // Sort emails by date (oldest to newest) to trace conversation flow
        leadEmails.sort((a, b) => {
            const dateA = new Date(a.received_at || a.sent_at || a.created_at).getTime();
            const dateB = new Date(b.received_at || b.sent_at || b.created_at).getTime();
            return dateA - dateB;
        });

        // We want to separate conversations by Campaign, but incorrectly attributed replies 
        // (missing campaign_id) should be attached to the active conversation.
        
        const campaignsMap = new Map<string, any[]>();
        let lastActiveCampaignId = 'general'; // Default bucket

        for (const email of leadEmails) {
            let campaignId = email.campaign_id;
            
            // If this email has a campaign ID, it belongs to that campaign's thread.
            // It also becomes the "active" campaign for subsequent replies that might miss an ID.
            if (campaignId) {
                lastActiveCampaignId = campaignId;
            } else {
                // If missing campaign ID, assume it belongs to the last active campaign context
                campaignId = lastActiveCampaignId;
            }
            
            if (!campaignsMap.has(campaignId)) {
                campaignsMap.set(campaignId, []);
            }
            campaignsMap.get(campaignId)!.push(email);
        }

        // Now create threads from these buckets
        for (const [campaignId, campaignEmails] of campaignsMap.entries()) {
            // Get lead details from the first email that has them (should be all of them due to join)
            const leadEmailData = campaignEmails[0];
            const lead = leadEmailData.lead;
            if (!lead) continue;

            // Determine brand from any email in the chain that has it
            let brand = '';
            let realCampaignId = campaignId;
            
            for (const e of campaignEmails) {
                if (e.campaign?.brand) {
                    brand = e.campaign.brand;
                }
                if (e.campaign_id && e.campaign_id !== 'general') {
                    realCampaignId = e.campaign_id;
                }
            }
            
            // Construct the thread object
            const threadId = `${leadId}_${realCampaignId}`;
            
            const messages: EmailMessage[] = campaignEmails.map((e: any) => {
                 const isInbound = e.direction === 'inbound' || e.status === 'replied';
                 return {
                    id: e.id,
                    direction: isInbound ? 'received' : 'sent',
                    from: isInbound ? lead.email : 'Me',
                    to: isInbound ? 'Me' : lead.email,
                    subject: e.subject,
                    body: e.text_body || e.body || stripHtml(e.html_body || ''),
                    htmlBody: e.html_body,
                    sentAt: e.received_at || e.sent_at || e.created_at,
                    read: true,
                    status: e.status || 'sent',
                    openedAt: e.opened_at || null,
                    clickedAt: e.clicked_at || null,
                    deliveredAt: e.delivered_at || null,
                 };
            });

            // Calculate metadata
            const lastMsg = messages[messages.length - 1];
            
            threads.push({
                threadId,
                leadId,
                campaignId: realCampaignId,
                brand, // Will be filled later if empty
                leadName: (() => { const n = (lead.contact_name || '').trim(); return (['Visitor','Unknown','Anonymous Visitor','Anonymous'].includes(n) ? '' : n) || lead.business_name || 'Unknown'; })(),
                leadEmail: lead.email,
                leadLinkedinUrl: lead.person_linkedin_url || lead.linkedin_url || lead.linkedin || null,
                leadPhone: lead.phone,
                leadCompany: lead.business_name,
                lastMessageAt: lastMsg.sentAt,
                messageCount: messages.length,
                unreadCount: 0, 
                sentiment: 'neutral',
                status: 'active',
                tags: [],
                messages
            });
        }
    }
    
    // Convert threads list to Map for easy lookup during KV merge
    // We use the threadId we generated: leadId_campaignId
    const threadsMap = new Map<string, ConversationThread>();
    threads.forEach(t => threadsMap.set(t.threadId, t));
    
    // MERGE LEGACY KV REPLIES
    // This ensures replies received before the Postgres migration are still visible.
    //
    // PERFORMANCE: `kv.getByPrefix('reply:')` previously scanned the ENTIRE
    // reply key range across all users on every inbox load (~300ms p50,
    // 2-5s p99 once a tenant grew). Now we:
    //  1. Build a set of THIS user's lead IDs from the emails we already
    //     loaded above (free — already in memory).
    //  2. Use the bounded `getByPrefixLimited` variant so a runaway DB
    //     can't take down the request.
    //  3. Filter the merged replies by lead-membership client-side so
    //     other tenants' replies are never merged into this user's threads.
    try {
      const userLeadIds = new Set<string>();
      for (const arr of leadsMap.values()) {
        for (const em of arr) {
          if (em.lead_id) userLeadIds.add(em.lead_id);
        }
      }

      // PRIMARY scan: per-user prefix (`reply:<userId>:`). Constant-time
      // relative to total reply count in the system — only walks this
      // user's replies. New replies always land here.
      const perUserRaw = await kv
        .getByPrefixLimited(`reply:${filters.userId}:`, 2000, 0)
        .catch(() => []);
      const perUserReplies = (perUserRaw as EmailReply[]).filter(
        (r) => r?.leadId && userLeadIds.has(r.leadId),
      );

      // LEGACY scan: bare `reply:<id>` keys from before the migration to
      // per-user keying. We still need to merge these for backward
      // compatibility, but cap aggressively and skip entirely if the
      // per-user scan already returned plenty of data — most tenants
      // won't have legacy keys and shouldn't pay the cost.
      let legacyReplies: EmailReply[] = [];
      if (perUserReplies.length < 50) {
        const legacyRaw = await kv
          .getByPrefixLimited('reply:', 500, 0)
          .catch(() => []);
        legacyReplies = (legacyRaw as EmailReply[])
          // Skip the per-user keys we already read (key format starts with `reply:<uuid>:`).
          // We can't filter by key directly here without restructuring; instead dedupe by reply.id below.
          .filter((r) => r?.leadId && userLeadIds.has(r.leadId));
      }

      // Dedupe by reply id (per-user scan wins over legacy)
      const seenIds = new Set<string>();
      const kvReplies: EmailReply[] = [];
      for (const r of [...perUserReplies, ...legacyReplies]) {
        if (r?.id && !seenIds.has(r.id)) {
          seenIds.add(r.id);
          kvReplies.push(r);
        }
      }

      for (const replyData of kvReplies) {
        const reply = replyData as EmailReply;
        
        // Determine the best thread to attach this reply to
        let targetThreadKey = '';
        
        // 1. Try exact match if we have campaignId
        if (reply.campaignId) {
           targetThreadKey = `${reply.leadId}_${reply.campaignId}`;
        }
        
        // 2. If exact match thread doesn't exist (or we don't have campaignId), 
        // try to find ANY existing thread for this lead to avoid splitting the conversation.
        if (!targetThreadKey || !threadsMap.has(targetThreadKey)) {
            // Find all active threads for this lead
            // We use the keys since we constructed them as leadId_campaignId
            const candidateKeys: string[] = [];
            for (const k of threadsMap.keys()) {
              if (k.startsWith(`${reply.leadId}_`)) {
                candidateKeys.push(k);
              }
            }
            
            if (candidateKeys.length === 1) {
                // Perfect: Lead has exactly one active thread. Attach reply here regardless of campaignId mismatch.
                targetThreadKey = candidateKeys[0];
            } else if (candidateKeys.length > 1) {
                // Ambiguous: Lead has multiple threads (multiple campaigns).
                // Heuristic: Attach to the most recently active thread
                let newestKey = candidateKeys[0];
                let newestTime = 0;
                
                for (const k of candidateKeys) {
                   const t = threadsMap.get(k);
                   if (t) {
                      const time = new Date(t.lastMessageAt).getTime();
                      if (time > newestTime) {
                         newestTime = time;
                         newestKey = k;
                      }
                   }
                }
                targetThreadKey = newestKey;
            } else {
                // No existing threads for this lead.
                // Must create a new orphan thread.
                const campaignId = reply.campaignId || 'general';
                targetThreadKey = `${reply.leadId}_${campaignId}`;
            }
        }
        
        // Only add to existing threads (which implies user ownership via the Sent email)
        // If the thread doesn't exist, we skip (or we'd need to fetch lead info to create it)
        if (threadsMap.has(targetThreadKey)) {
          const thread = threadsMap.get(targetThreadKey)!;
          
          // Check for duplicates (Postgres vs KV)
          // New system writes to both, so we must deduplicate
          // We allow a 60 second window for timestamp differences due to processing delays
          const isDuplicate = thread.messages.some(m => 
            m.direction === 'received' && 
            Math.abs(new Date(m.sentAt).getTime() - new Date(reply.receivedAt).getTime()) < 60000
          );
          
          if (!isDuplicate) {
            thread.messages.push({
              id: reply.id,
              direction: 'received',
              from: reply.from,
              to: reply.to,
              subject: reply.subject,
              body: reply.body,
              htmlBody: reply.htmlBody,
              sentAt: reply.receivedAt,
              read: reply.read
            });
            
            // Update thread metadata
            const msgDate = new Date(reply.receivedAt).getTime();
            if (msgDate > new Date(thread.lastMessageAt).getTime()) {
              thread.lastMessageAt = reply.receivedAt;
            }
            thread.messageCount++;
            
            // Use KV sentiment if available and thread is neutral
            if (reply.sentiment && reply.sentiment !== 'neutral' && reply.sentiment !== 'pending') {
               thread.sentiment = reply.sentiment;
            }
          }
        } else {
          // ORPHAN REPLY HANDLING
          // If the thread doesn't exist in Postgres (e.g. sent email only in KV), 
          // we create a new thread for this reply so it isn't lost.
          
          // We check if we already created a thread for this orphan in this loop
          if (!threadsMap.has(targetThreadKey)) {
             // We need to fetch lead info. Since we are inside a loop, this could be N+1.
             // But for now, we assume orphans are rare enough.
             
             // Let's try to fetch lead from DB
             let leadQuery = supabase
               .from('leads')
               .select('business_name, contact_name, email, phone, linkedin_url, person_linkedin_url, linkedin')
               .eq('id', reply.leadId);

             // IMPORTANT: Always enforce tenant isolation (userId is required by early guard)
             leadQuery = leadQuery.eq('user_id', filters!.userId);

             const { data: lead } = await leadQuery.maybeSingle();

             if (lead) {
               threadsMap.set(targetThreadKey, {
                  threadId: targetThreadKey,
                  leadId: reply.leadId,
                  campaignId: reply.campaignId || 'general',
                  brand: 'Unknown', 
                  leadName: (() => { const n = (lead.contact_name || '').trim(); return (['Visitor','Unknown','Anonymous Visitor','Anonymous'].includes(n) ? '' : n) || lead.business_name || 'Unknown'; })(),
                  leadEmail: lead.email,
                  leadLinkedinUrl: lead.person_linkedin_url || lead.linkedin_url || lead.linkedin || null,
                  leadPhone: lead.phone,
                  leadCompany: lead.business_name,
                  lastMessageAt: reply.receivedAt,
                  messageCount: 1,
                  unreadCount: 1, 
                  sentiment: reply.sentiment as any || 'neutral',
                  status: 'active',
                  tags: reply.tags || [],
                  messages: [{
                    id: reply.id,
                    direction: 'received',
                    from: reply.from,
                    to: reply.to,
                    subject: reply.subject,
                    body: reply.body,
                    htmlBody: reply.htmlBody,
                    sentAt: reply.receivedAt,
                    read: reply.read
                  }]
               });
             }
          } else {
             // Thread was created by a previous orphan reply in this loop
             const thread = threadsMap.get(targetThreadKey)!;
             thread.messages.push({
                id: reply.id,
                direction: 'received',
                from: reply.from,
                to: reply.to,
                subject: reply.subject,
                body: reply.body,
                htmlBody: reply.htmlBody,
                sentAt: reply.receivedAt,
                read: reply.read
             });
             
             const msgDate = new Date(reply.receivedAt).getTime();
             if (msgDate > new Date(thread.lastMessageAt).getTime()) {
               thread.lastMessageAt = reply.receivedAt;
             }
             thread.messageCount++;
          }
        }
      }
    } catch (kvError) {
      console.error('Error merging KV replies:', kvError);
    }

    // Convert threads Map back to array
    threads = Array.from(threadsMap.values());
    
    // Sort messages within threads
    threads.forEach(t => {
      t.messages.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
    });
    
    // Apply defaults and clean up
    threads.forEach(t => {
      if (!t.brand) t.brand = 'Roadr'; // Default fallback
    });
    
    // Sort threads by last message
    threads.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    
    // Filter by brand (if not handled by query)
    if (filters?.brand && filters.brand !== 'all') {
      threads = threads.filter(t => t.brand.toLowerCase() === filters.brand?.toLowerCase());
    }

    if (filters?.limit) {
      threads = threads.slice(0, filters.limit);
    }

    threads = await attachCachedAvatars(
      threads,
      (thread: any) => thread.leadEmail,
      (thread: any) => thread.leadLinkedinUrl,
    );

    // ── Cache the result (always — fallback data is still valid) ─────
    try {
      const cacheData = {
        threads,
        _expiresAt: Date.now() + INBOX_CACHE_TTL_MS
      };
      await kv.set(cacheKey, cacheData);
      console.log(`[INBOX] Cached ${threads.length} threads for user ${filters.userId}`);
    } catch (cacheErr) {
      // Non-fatal — continue without caching
      console.warn('[INBOX] Failed to write KV cache:', cacheErr);
    }

    return threads;
    
  } catch (error) {
    console.error('Error in getConversations:', error);
    return [];
  }
}
/**
 * Mark conversation as read
 */
export async function markConversationAsRead(threadId: string): Promise<void> {
  try {
    // In the new DB-based system, threadId is the leadId.
    // We would update the 'read' status of inbound emails here.
    // For now, assume this is handled or no-op until schema confirms 'read' column.
    console.log(`Marking thread ${threadId} as read`);
  } catch (error) {
    console.error('Error marking conversation as read:', error);
  }
}

/**
 * Add reply to thread
 */
async function addReplyToThread(threadId: string, reply: EmailReply): Promise<void> {
  try {
    const threadKey = `thread:${threadId}`;
    let thread = await kv.get(threadKey) as any;
    
    if (!thread) {
      thread = {
        id: threadId,
        leadId: reply.leadId,
        campaignId: reply.campaignId,
        createdAt: new Date().toISOString(),
        replies: [],
      };
    }

    thread.replies.push(reply.id);
    thread.lastReplyAt = reply.receivedAt;
    
    await kv.set(threadKey, thread);
  } catch (error) {
    console.error('Error adding reply to thread:', error);
  }
}

/**
 * Utility functions
 */
function extractEmail(fromField: string): string {
  const match = fromField.match(/<(.+?)>/);
  return match ? match[1] : fromField;
}

function generateThreadId(leadEmail: string, campaignId: string): string {
  return `thread_${campaignId}_${leadEmail.replace(/[^a-z0-9]/gi, '_')}`;
}

function stripHtml(html: string): string {
  if (!html) return '';
  
  // First, strip HTML tags and get text content
  let text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')  // Convert <br> to newlines
    .replace(/<\/p>/gi, '\n\n')     // Convert </p> to double newlines
    .replace(/<\/div>/gi, '\n')     // Convert </div> to newlines
    .replace(/<\/h[1-6]>/gi, '\n\n') // Convert heading closing tags to double newlines
    .replace(/<\/li>/gi, '\n')      // Convert </li> to newlines
    .replace(/<\/tr>/gi, '\n')      // Convert </tr> to newlines
    .replace(/<\/blockquote>/gi, '\n\n') // Convert </blockquote> to double newlines
    .replace(/<\/dd>/gi, '\n')      // Convert </dd> to newlines
    .replace(/<\/dt>/gi, '\n')      // Convert </dt> to newlines
    .replace(/<hr\s*\/?>/gi, '\n---\n') // Convert <hr> to separator
    .replace(/<[^>]*>/g, ' ');      // Remove all other HTML tags
  
  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&ldquo;/gi, '"')
    .replace(/&rdquo;/gi, '"')
    .replace(/&lsquo;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&hellip;/gi, '…')
    .replace(/&copy;/gi, '©')
    .replace(/&reg;/gi, '®')
    .replace(/&trade;/gi, '™');
  
  // Decode numeric HTML entities (&#xxx; and &#xXX;)
  text = text.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)));
  text = text.replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  
  // Clean up whitespace
  text = text
    .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
    .replace(/[ \t]+/g, ' ')      // Collapse multiple spaces/tabs
    .replace(/\n /g, '\n')        // Remove spaces after newlines
    .replace(/ \n/g, '\n')        // Remove spaces before newlines
    .trim();
  
  return text;
}

/**
 * Get inbox statistics
 */
export async function getInboxStats(userId: string): Promise<{
  totalConversations: number;
  unreadCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  interestedCount: number;
}> {
  try {
    // SECURITY: userId is required — reject calls without it
    if (!userId) {
      console.error('[INBOX] getInboxStats called without userId — returning zeros for safety');
      return { totalConversations: 0, unreadCount: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0, interestedCount: 0 };
    }

    // OPTIMIZATION: Run both count queries in parallel (2× faster)
    const [{ count: unreadCount }, { count: totalConversations }] = await Promise.all([
      // 1. Unread Count (Replied emails that are not read)
      supabase
        .from('emails')
        .select('*', { count: 'estimated', head: true })
        .eq('status', 'replied')
        .eq('direction', 'inbound')
        .eq('user_id', userId),
      // 2. Total Conversations (Total inbound emails as proxy for speed)
      supabase
        .from('emails')
        .select('*', { count: 'estimated', head: true })
        .eq('direction', 'inbound')
        .eq('user_id', userId),
    ]);

    return {
      totalConversations: totalConversations || 0,
      unreadCount: unreadCount || 0,
      positiveCount: 0,
      neutralCount: 0,
      negativeCount: 0,
      interestedCount: 0
    };
    
  } catch (error) {
    console.error('Error in getInboxStats:', error);
    return {
      totalConversations: 0,
      unreadCount: 0,
      positiveCount: 0,
      neutralCount: 0,
      negativeCount: 0,
      interestedCount: 0
    };
  }
}

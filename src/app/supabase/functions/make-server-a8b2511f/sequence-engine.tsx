/**
 * SEQUENCE ENGINE — Multi-Step Drip Campaign Orchestrator
 *
 * Manages automated email sequences with:
 *  - Configurable steps (delay days, AI-generated or template emails)
 *  - Per-lead step tracking (which step each lead is on)
 *  - Auto-stop on reply detection
 *  - Integration with sender rotation & compliance checks
 *
 * KV Schema:
 *   sequence:{userId}:{sequenceId}           → SequenceConfig
 *   sequence_enrollment:{userId}:{seqId}     → { [leadId]: LeadSequenceState }
 *   sequence_list:{userId}                   → string[] (sequence IDs)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import * as kv from "./kv-retry.tsx";
import { sendEmail, getSenderEmail } from "./email-sender.tsx";
import { injectAllTracking, textToHtml, getEmailProvider } from "./email-tracking.tsx";
import { getKnowledgeBaseContext, getKBWritingOverrides } from "./knowledge-base.tsx";
import { isBlacklisted, isUnsubscribed, injectUnsubscribeLink } from "./compliance.tsx";
import { generateAI } from "./ai-provider.tsx";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// ─── Types ───────────────────────────────────────────────────────────

export interface SequenceStep {
  id: string;
  stepNumber: number;
  /** Days to wait after the previous step (0 for step 1 = send immediately) */
  delayDays: number;
  /** 'ai' = generate with AI, 'template' = use provided subject/body */
  type: 'ai' | 'template';
  /** Channel: email (default), linkedin_connect, linkedin_message */
  channel?: 'email' | 'linkedin_connect' | 'linkedin_message';
  subject?: string;
  body?: string;
  /** AI instructions for this step */
  aiInstructions?: string;
  /** e.g. "initial", "follow_up_1", "breakup", "linkedin_connect" */
  stepLabel: string;
  /** LinkedIn connection request note (max 300 chars) */
  linkedinNote?: string;
  /** LinkedIn message body */
  linkedinMessage?: string;
}

export interface SequenceConfig {
  id: string;
  userId: string;
  name: string;
  campaignId?: string;
  brand?: string;
  product?: string;
  tone?: string;
  fromEmail?: string;
  senderName?: string;
  senderTitle?: string;
  landingUrl?: string;
  priceSummary?: string;
  campaignKnowledge?: string;
  steps: SequenceStep[];
  /** Global settings */
  stopOnReply: boolean;
  stopOnClick: boolean;
  stopOnMeeting: boolean;
  /** Max emails per day across this sequence */
  dailyLimit: number;
  /** Send window (e.g., 9-17 means 9am-5pm in user's TZ) */
  sendWindowStart: number;
  sendWindowEnd: number;
  timezone: string;
  status: 'active' | 'paused' | 'completed' | 'draft';
  createdAt: string;
  updatedAt: string;
  /** Use sender rotation */
  useSenderRotation: boolean;
}

export interface LeadSequenceState {
  leadId: string;
  currentStep: number;
  status: 'active' | 'completed' | 'replied' | 'unsubscribed' | 'bounced' | 'opted_out' | 'blacklisted' | 'paused';
  lastSentAt: string | null;
  nextSendAt: string | null;
  stoppedReason?: string;
  sentSteps: number[];
  enrolledAt: string;
}

// ─── KV Keys ─────────────────────────────────────────────────────────

function seqKey(userId: string, seqId: string) { return `sequence:${userId}:${seqId}`; }
function enrollKey(userId: string, seqId: string) { return `sequence_enrollment:${userId}:${seqId}`; }
function seqListKey(userId: string) { return `sequence_list:${userId}`; }
function seqDailySentKey(userId: string, seqId: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `sequence_daily_sent:${userId}:${seqId}:${today}`;
}

// ─── Sequence CRUD ───────────────────────────────────────────────────

export async function createSequence(userId: string, config: Partial<SequenceConfig>): Promise<SequenceConfig> {
  const id = crypto.randomUUID();
  const seq: SequenceConfig = {
    id,
    userId,
    name: config.name || 'Untitled Sequence',
    campaignId: config.campaignId,
    brand: config.brand,
    product: config.product,
    tone: config.tone || 'professional',
    fromEmail: config.fromEmail,
    senderName: config.senderName,
    senderTitle: config.senderTitle,
    landingUrl: config.landingUrl,
    priceSummary: config.priceSummary,
    campaignKnowledge: config.campaignKnowledge,
    steps: config.steps || [
      { id: crypto.randomUUID(), stepNumber: 1, delayDays: 0, type: 'ai', stepLabel: 'initial', aiInstructions: 'Write an engaging initial cold outreach email.' },
      { id: crypto.randomUUID(), stepNumber: 2, delayDays: 3, type: 'ai', stepLabel: 'follow_up_1', aiInstructions: 'First follow-up. Brief, add value, acknowledge previous email might have been missed.' },
      { id: crypto.randomUUID(), stepNumber: 3, delayDays: 5, type: 'ai', stepLabel: 'follow_up_2', aiInstructions: 'Second follow-up. Offer something specific like a case study or demo.' },
      { id: crypto.randomUUID(), stepNumber: 4, delayDays: 7, type: 'ai', stepLabel: 'breakup', aiInstructions: 'Final breakup email. Mention this is your last email, leave the door open.' },
    ],
    stopOnReply: true,
    stopOnClick: false,
    stopOnMeeting: true,
    dailyLimit: config.dailyLimit || 50,
    sendWindowStart: config.sendWindowStart ?? 9,
    sendWindowEnd: config.sendWindowEnd ?? 17,
    timezone: config.timezone || 'America/New_York',
    status: 'draft',
    useSenderRotation: config.useSenderRotation ?? false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await kv.set(seqKey(userId, id), seq);

  // Add to list
  const list: string[] = (await kv.get(seqListKey(userId))) || [];
  if (!list.includes(id)) {
    list.push(id);
    await kv.set(seqListKey(userId), list);
  }

  console.log(`[SEQUENCE] Created sequence "${seq.name}" (${id}) for user ${userId} with ${seq.steps.length} steps`);
  return seq;
}

export async function getSequence(userId: string, seqId: string): Promise<SequenceConfig | null> {
  return await kv.get(seqKey(userId, seqId));
}

export async function updateSequence(userId: string, seqId: string, updates: Partial<SequenceConfig>): Promise<SequenceConfig | null> {
  const seq = await kv.get(seqKey(userId, seqId));
  if (!seq) return null;
  Object.assign(seq, updates, { updatedAt: new Date().toISOString() });
  await kv.set(seqKey(userId, seqId), seq);
  return seq;
}

export async function deleteSequence(userId: string, seqId: string): Promise<boolean> {
  await kv.del(seqKey(userId, seqId));
  await kv.del(enrollKey(userId, seqId));

  const list: string[] = (await kv.get(seqListKey(userId))) || [];
  const filtered = list.filter(id => id !== seqId);
  await kv.set(seqListKey(userId), filtered);

  console.log(`[SEQUENCE] Deleted sequence ${seqId}`);
  return true;
}

export async function listSequences(userId: string): Promise<SequenceConfig[]> {
  const list: string[] = (await kv.get(seqListKey(userId))) || [];
  const sequences: SequenceConfig[] = [];
  for (const id of list) {
    const seq = await kv.get(seqKey(userId, id));
    if (seq) sequences.push(seq);
  }
  return sequences.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ─── Lead Enrollment ─────────────────────────────────────────────────

export async function enrollLeads(userId: string, seqId: string, leadIds: string[]): Promise<{ enrolled: number; skipped: number }> {
  const seq = await getSequence(userId, seqId);
  if (!seq) throw new Error('Sequence not found');

  const enrollment: Record<string, LeadSequenceState> = (await kv.get(enrollKey(userId, seqId))) || {};
  let enrolled = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const leadId of leadIds) {
    // Skip if already enrolled and active
    if (enrollment[leadId] && enrollment[leadId].status === 'active') {
      skipped++;
      continue;
    }

    // Check blacklist/unsubscribe
    const lead = await getLeadEmail(userId, leadId);
    if (lead?.email) {
      if (await isBlacklisted(userId, lead.email)) { skipped++; continue; }
      if (await isUnsubscribed(userId, lead.email)) { skipped++; continue; }
    }

    enrollment[leadId] = {
      leadId,
      currentStep: 1,
      status: 'active',
      lastSentAt: null,
      nextSendAt: now, // Step 1 sends immediately (or at next processing window)
      sentSteps: [],
      enrolledAt: now,
    };
    enrolled++;
  }

  await kv.set(enrollKey(userId, seqId), enrollment);
  console.log(`[SEQUENCE] Enrolled ${enrolled} leads in sequence ${seqId} (${skipped} skipped)`);
  return { enrolled, skipped };
}

export async function getEnrollment(userId: string, seqId: string): Promise<Record<string, LeadSequenceState>> {
  return (await kv.get(enrollKey(userId, seqId))) || {};
}

async function getLeadEmail(userId: string, leadId: string): Promise<{ email: string; first_name?: string; contact_name?: string; business_name?: string } | null> {
  try {
    const { data } = await supabase.from('leads').select('email, first_name, contact_name, business_name').eq('id', leadId).single();
    return data;
  } catch { return null; }
}

// ─── Auto-Stop on Reply ──────────────────────────────────────────────

/**
 * Called when a reply is detected for a lead. Stops all active sequences
 * for that lead across all of the user's sequences.
 */
export async function handleReplyDetected(userId: string, leadEmail: string, leadId?: string): Promise<number> {
  const list: string[] = (await kv.get(seqListKey(userId))) || [];
  let stopped = 0;

  for (const seqId of list) {
    const enrollment: Record<string, LeadSequenceState> = (await kv.get(enrollKey(userId, seqId))) || {};

    // Find by leadId or by email
    for (const [lid, state] of Object.entries(enrollment)) {
      if (state.status !== 'active') continue;

      let matches = false;
      if (leadId && lid === leadId) matches = true;
      if (!matches && leadEmail) {
        const lead = await getLeadEmail(userId, lid);
        if (lead?.email?.toLowerCase() === leadEmail.toLowerCase()) matches = true;
      }

      if (matches) {
        const seq = await getSequence(userId, seqId);
        if (seq?.stopOnReply) {
          enrollment[lid].status = 'replied';
          enrollment[lid].stoppedReason = 'Reply detected';
          enrollment[lid].nextSendAt = null;
          stopped++;
          console.log(`[SEQUENCE] Auto-stopped lead ${lid} in sequence ${seqId}: reply detected`);
        }
      }
    }

    await kv.set(enrollKey(userId, seqId), enrollment);
  }

  return stopped;
}

/**
 * Called when a click is detected for a lead.
 */
export async function handleClickDetected(userId: string, leadId: string): Promise<void> {
  const list: string[] = (await kv.get(seqListKey(userId))) || [];

  for (const seqId of list) {
    const seq = await getSequence(userId, seqId);
    if (!seq?.stopOnClick) continue;

    const enrollment: Record<string, LeadSequenceState> = (await kv.get(enrollKey(userId, seqId))) || {};
    if (enrollment[leadId] && enrollment[leadId].status === 'active') {
      enrollment[leadId].status = 'completed';
      enrollment[leadId].stoppedReason = 'Link clicked';
      enrollment[leadId].nextSendAt = null;
      await kv.set(enrollKey(userId, seqId), enrollment);
      console.log(`[SEQUENCE] Auto-stopped lead ${leadId} in sequence ${seqId}: click detected`);
    }
  }
}

// ─── Sequence Processor ──────────────────────────────────────────────

/**
 * Process all due sequence steps for a user. Called by cron or manually.
 * Returns the number of emails sent this cycle.
 */
export async function processSequences(userId: string): Promise<{
  totalSent: number;
  totalSkipped: number;
  totalErrors: number;
  details: Array<{ sequenceId: string; sequenceName: string; sent: number; errors: number }>;
}> {
  const list: string[] = (await kv.get(seqListKey(userId))) || [];
  let totalSent = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const details: Array<{ sequenceId: string; sequenceName: string; sent: number; errors: number }> = [];

  for (const seqId of list) {
    const seq = await getSequence(userId, seqId);
    if (!seq || seq.status !== 'active') continue;

    const result = await processOneSequence(userId, seq);
    totalSent += result.sent;
    totalSkipped += result.skipped;
    totalErrors += result.errors;
    details.push({ sequenceId: seqId, sequenceName: seq.name, sent: result.sent, errors: result.errors });
  }

  return { totalSent, totalSkipped, totalErrors, details };
}

async function processOneSequence(userId: string, seq: SequenceConfig): Promise<{ sent: number; skipped: number; errors: number }> {
  const enrollment: Record<string, LeadSequenceState> = (await kv.get(enrollKey(userId, seq.id))) || {};
  const now = new Date();
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  // Check daily limit
  const dailySentCount: number = (await kv.get(seqDailySentKey(userId, seq.id))) || 0;
  if (dailySentCount >= seq.dailyLimit) {
    console.log(`[SEQUENCE] Daily limit reached for sequence ${seq.id} (${dailySentCount}/${seq.dailyLimit})`);
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const remaining = seq.dailyLimit - dailySentCount;

  // Get user signature
  let sigSettings: any = null;
  try {
    const sigRaw = await kv.get(`signature:${userId}`);
    sigSettings = sigRaw ? JSON.parse(sigRaw) : null;
  } catch { /* ignore */ }

  // Load knowledge base context once
  let knowledgeContext = '';
  try {
    knowledgeContext = await getKnowledgeBaseContext(userId, seq.brand || 'all', seq.campaignKnowledge) || '';
  } catch { /* ignore */ }

  // Pick sender account (rotation or default)
  const fromEmail = seq.fromEmail || await getSenderEmail(userId, seq.brand || '');

  let processed = 0;
  for (const [leadId, state] of Object.entries(enrollment)) {
    if (processed >= remaining) break;
    if (state.status !== 'active') continue;
    if (!state.nextSendAt || new Date(state.nextSendAt) > now) continue;

    const step = seq.steps.find(s => s.stepNumber === state.currentStep);
    if (!step) {
      // No more steps — mark completed
      enrollment[leadId].status = 'completed';
      enrollment[leadId].nextSendAt = null;
      continue;
    }

    // Get lead data
    const lead = await getLeadEmail(userId, leadId);
    if (!lead?.email) { skipped++; continue; }

    // Final compliance check before sending
    if (await isBlacklisted(userId, lead.email) || await isUnsubscribed(userId, lead.email)) {
      enrollment[leadId].status = 'opted_out';
      enrollment[leadId].stoppedReason = 'Blacklisted or unsubscribed';
      enrollment[leadId].nextSendAt = null;
      skipped++;
      continue;
    }

    // ─── LinkedIn steps → create manual task, advance enrollment ───
    const stepChannel = step.channel || 'email';
    if (stepChannel === 'linkedin_connect' || stepChannel === 'linkedin_message') {
      try {
        // Resolve template variables in note/message
        const firstName = lead.first_name || (lead.contact_name ? lead.contact_name.split(' ')[0] : '') || '';
        const resolveVars = (text: string) =>
          text
            .replace(/\{\{first_name\}\}/gi, firstName)
            .replace(/\{\{company\}\}/gi, lead.business_name || '')
            .replace(/\{\{title\}\}/gi, '');

        const taskId = crypto.randomUUID();
        const task = {
          id: taskId,
          userId,
          sequenceId: seq.id,
          sequenceName: seq.name,
          stepNumber: step.stepNumber,
          channel: stepChannel,
          leadId,
          leadEmail: lead.email,
          leadName: lead.contact_name || lead.first_name || lead.email,
          leadCompany: lead.business_name || '',
          message: stepChannel === 'linkedin_connect'
            ? resolveVars(step.linkedinNote || '')
            : resolveVars(step.linkedinMessage || ''),
          status: 'pending',
          createdAt: now.toISOString(),
        };
        await kv.set(`linkedin_task:${userId}:${taskId}`, task);

        // Also add to user's task list for fast listing
        const taskListKey = `linkedin_tasks:${userId}`;
        const taskList: string[] = (await kv.get(taskListKey)) || [];
        taskList.push(taskId);
        await kv.set(taskListKey, taskList);

        console.log(`[SEQUENCE] Created LinkedIn ${stepChannel} task for lead ${leadId} (step ${step.stepNumber})`);

        // Advance to next step
        enrollment[leadId].lastSentAt = now.toISOString();
        enrollment[leadId].sentSteps.push(step.stepNumber);
        const nextStep = seq.steps.find(s => s.stepNumber === state.currentStep + 1);
        if (nextStep) {
          const nextDate = new Date(now);
          nextDate.setDate(nextDate.getDate() + nextStep.delayDays);
          enrollment[leadId].currentStep = nextStep.stepNumber;
          enrollment[leadId].nextSendAt = nextDate.toISOString();
        } else {
          enrollment[leadId].status = 'completed';
          enrollment[leadId].nextSendAt = null;
        }
        sent++;
        processed++;
      } catch (err: any) {
        console.error(`[SEQUENCE] Error creating LinkedIn task for lead ${leadId}:`, err);
        errors++;
      }
      continue;
    }

    // ─── Email steps (existing logic) ─────────────────────────────
    try {
      // Generate or use template email
      let subject = step.subject || '';
      let body = step.body || '';

      if (step.type === 'ai') {
        const generated = await generateStepEmail(seq, step, lead, knowledgeContext, sigSettings);
        subject = generated.subject;
        body = generated.body;
      }

      // Inject unsubscribe link
      body = await injectUnsubscribeLink(userId, lead.email, body);

      // Inject tracking
      const trackingId = crypto.randomUUID();
      const trackedHtml = injectAllTracking(body.includes('<') ? body : textToHtml(body), trackingId, lead.email);

      // Store tracking data
      await kv.set(`tracking:${trackingId}`, {
        userId,
        leadId,
        email: lead.email,
        campaignId: seq.campaignId || seq.id,
        sequenceId: seq.id,
        stepNumber: step.stepNumber,
        sentAt: now.toISOString(),
        subject,
      });

      // Send email
      const result = await sendEmail(userId, {
        from: fromEmail,
        to: lead.email,
        subject,
        html: trackedHtml,
        replyTo: fromEmail,
      });

      if (result.success) {
        enrollment[leadId].lastSentAt = now.toISOString();
        enrollment[leadId].sentSteps.push(step.stepNumber);

        // Calculate next step
        const nextStep = seq.steps.find(s => s.stepNumber === state.currentStep + 1);
        if (nextStep) {
          const nextDate = new Date(now);
          nextDate.setDate(nextDate.getDate() + nextStep.delayDays);
          enrollment[leadId].currentStep = nextStep.stepNumber;
          enrollment[leadId].nextSendAt = nextDate.toISOString();
        } else {
          enrollment[leadId].status = 'completed';
          enrollment[leadId].nextSendAt = null;
        }

        sent++;
        processed++;
      } else {
        console.error(`[SEQUENCE] Failed to send step ${step.stepNumber} to ${lead.email}: ${result.error}`);
        if (result.error?.includes('bounced') || result.error?.includes('invalid')) {
          enrollment[leadId].status = 'bounced';
          enrollment[leadId].stoppedReason = result.error;
          enrollment[leadId].nextSendAt = null;
        }
        errors++;
      }
    } catch (err: any) {
      console.error(`[SEQUENCE] Error processing lead ${leadId} step ${step.stepNumber}:`, err);
      errors++;
    }
  }

  // Save enrollment and daily count
  await kv.set(enrollKey(userId, seq.id), enrollment);
  await kv.set(seqDailySentKey(userId, seq.id), dailySentCount + sent);

  // Check if sequence is fully complete
  const allDone = Object.values(enrollment).every(s => s.status !== 'active');
  if (allDone && Object.keys(enrollment).length > 0) {
    await updateSequence(userId, seq.id, { status: 'completed' });
    console.log(`[SEQUENCE] Sequence ${seq.id} completed — all leads processed`);
  }

  return { sent, skipped, errors };
}

// ─── AI Email Generation for Steps ──────────────────────────────────

async function generateStepEmail(
  seq: SequenceConfig,
  step: SequenceStep,
  lead: { email: string; first_name?: string; contact_name?: string; business_name?: string },
  knowledgeContext: string,
  sigSettings: any,
): Promise<{ subject: string; body: string }> {
  const firstName = lead.first_name || (lead.contact_name ? lead.contact_name.split(' ')[0] : '') || 'there';
  const businessName = lead.business_name || '';

  let stepContext = '';
  if (step.stepLabel === 'initial') {
    stepContext = 'This is the FIRST email in the sequence. Make it engaging, personalized, and value-driven.';
  } else if (step.stepLabel === 'follow_up_1') {
    stepContext = 'This is the FIRST follow-up. Keep it brief. Acknowledge the previous email may have been missed. Add new value.';
  } else if (step.stepLabel === 'follow_up_2') {
    stepContext = 'This is the SECOND follow-up. Offer something specific — a case study, demo, or free trial.';
  } else if (step.stepLabel === 'breakup') {
    stepContext = 'This is the FINAL breakup email. Mention this is your last outreach. Leave the door open.';
  }

  if (step.aiInstructions) {
    stepContext += `\n\nAdditional instructions: ${step.aiInstructions}`;
  }

  const closingLine = sigSettings?.closing_line || 'Best Regards';
  const signatureBlock = sigSettings?.custom_html || '';

  // Generate via AI provider (OpenAI)
  const aiResult = await generateAI({
    messages: [
      {
        role: 'system',
        content: `You write high-converting cold outreach emails. You MUST respond with valid JSON only:
{"subject": "...", "body": "..."}

The body should be HTML-formatted with <p> tags for paragraphs. Keep emails under 100 words.
${seq.senderName ? `Sender: ${seq.senderName}${seq.senderTitle ? `, ${seq.senderTitle}` : ''}` : ''}
${seq.product ? `Product/Service: ${seq.product}` : ''}
${seq.tone ? `Tone: ${seq.tone}` : ''}
${knowledgeContext ? `\nKnowledge base context:\n${knowledgeContext}` : ''}`,
      },
      {
        role: 'user',
        content: `Write a cold outreach email (step ${step.stepNumber} of ${seq.steps.length}).

Lead: ${firstName}${businessName ? ` at ${businessName}` : ''}
Email: ${lead.email}
${seq.landingUrl ? `Landing URL: ${seq.landingUrl}` : ''}
${seq.priceSummary ? `Offer: ${seq.priceSummary}` : ''}

${stepContext}

RULES:
1. Start with "Hi ${firstName},"
2. Keep it under 100 words
3. No hyphens or em-dashes
4. STOP after the CTA. Do NOT include a sign-off — the system will append the signature.
5. ${step.stepNumber > 1 ? 'Reference the previous email naturally, do NOT include the previous email text.' : 'Make the first impression count.'}`,
      },
    ],
    temperature: 0.7,
    maxTokens: 500,
    jsonMode: true,
  });
  console.log(`[SEQUENCE-ENGINE] Email generated via ${aiResult.provider}`);

  const content = aiResult.text || '';

  try {
    const parsed = JSON.parse(content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());

    let finalBody = parsed.body || '';
    // Append signature
    if (signatureBlock) {
      finalBody += `<br/>${signatureBlock}`;
    } else if (seq.senderName) {
      finalBody += `<br/><p>${closingLine},<br/>${seq.senderName}${seq.senderTitle ? `<br/><span style="color:#666">${seq.senderTitle}</span>` : ''}</p>`;
    }

    return { subject: parsed.subject || 'Quick question', body: finalBody };
  } catch {
    // Fallback parsing
    const subjectMatch = content.match(/Subject:\s*(.+)/i);
    const bodyMatch = content.match(/Body:\s*([\s\S]+)/i);
    return {
      subject: subjectMatch?.[1]?.trim() || 'Quick question',
      body: bodyMatch?.[1]?.trim() || content,
    };
  }
}

// ─── Sequence Stats ──────────────────────────────────────────────────

export async function getSequenceStats(userId: string, seqId: string): Promise<{
  totalEnrolled: number;
  active: number;
  completed: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  byStep: Record<number, number>;
}> {
  const enrollment = await getEnrollment(userId, seqId);
  const states = Object.values(enrollment);

  const byStep: Record<number, number> = {};
  for (const s of states) {
    if (s.status === 'active') {
      byStep[s.currentStep] = (byStep[s.currentStep] || 0) + 1;
    }
  }

  return {
    totalEnrolled: states.length,
    active: states.filter(s => s.status === 'active').length,
    completed: states.filter(s => s.status === 'completed').length,
    replied: states.filter(s => s.status === 'replied').length,
    bounced: states.filter(s => s.status === 'bounced').length,
    unsubscribed: states.filter(s => s.status === 'unsubscribed' || s.status === 'opted_out').length,
    byStep,
  };
}

// ─── Process All Users (called by cron) ──────────────────────────────

export async function processAllSequences(): Promise<{ usersProcessed: number; totalSent: number }> {
  // Get all users who have sequences by scanning KV
  const allSeqLists = await kv.getByPrefix('sequence_list:');
  let usersProcessed = 0;
  let totalSent = 0;

  for (const entry of (allSeqLists || [])) {
    const userId = entry.key?.replace('sequence_list:', '');
    if (!userId || !Array.isArray(entry.value) || entry.value.length === 0) continue;

    try {
      const result = await processSequences(userId);
      if (result.totalSent > 0 || result.totalErrors > 0) {
        console.log(`[SEQUENCE-CRON] User ${userId}: sent=${result.totalSent}, errors=${result.totalErrors}`);
        usersProcessed++;
        totalSent += result.totalSent;
      }
    } catch (err) {
      console.error(`[SEQUENCE-CRON] Error processing user ${userId}:`, err);
    }
  }

  return { usersProcessed, totalSent };
}
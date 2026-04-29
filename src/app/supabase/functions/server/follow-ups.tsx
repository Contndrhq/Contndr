import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail, getSenderEmail } from "./email-sender.tsx";
import * as kv from "./kv-retry.tsx";
import { injectAllTracking, textToHtml, getEmailProvider } from "./email-tracking.tsx";
import { generateAI, generateAIWithRetries } from "./ai-provider.tsx";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

interface FollowUpConfig {
  enabled: boolean;
  maxAttempts: number;
  daysBetween: number;
}

interface EmailStatus {
  leadId: string;
  campaignId: string;
  attemptNumber: number;
  lastSentAt: string | null;
  nextScheduledAt: string | null;
  status: 'no_response' | 'replied' | 'interested' | 'not_interested' | 'closed' | 'unsubscribed' | 'max_attempts';
}

/**
 * Check if a lead needs a follow-up email
 */
export function shouldSendFollowUp(emailStatus: EmailStatus, config: FollowUpConfig): boolean {
  if (!config.enabled) return false;
  
  // Don't send if max attempts reached
  if (emailStatus.attemptNumber >= config.maxAttempts) return false;
  
  // Don't send if lead has responded or unsubscribed
  const stopStatuses = ['replied', 'interested', 'closed', 'unsubscribed', 'max_attempts'];
  if (stopStatuses.includes(emailStatus.status)) return false;
  
  // Check if enough time has passed since last email
  if (emailStatus.lastSentAt) {
    const lastSent = new Date(emailStatus.lastSentAt);
    const now = new Date();
    const daysSinceLastSent = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysSinceLastSent < config.daysBetween) return false;
  }
  
  return true;
}

/**
 * Calculate next follow-up date
 */
export function calculateNextFollowUpDate(daysBetween: number): Date {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + daysBetween);
  return nextDate;
}

/**
 * Analyze email reply using AI to determine lead intent
 */
export async function analyzeEmailReply(replyText: string): Promise<{
  status: 'interested' | 'not_interested' | 'neutral';
  confidence: number;
  reason: string;
}> {
  try {
    const aiResult = await generateAI({
      messages: [
        {
          role: 'system',
          content: `You are an AI assistant that analyzes email replies to determine if a lead is interested, not interested, or neutral. Respond with JSON only in this format:
{
  "status": "interested" | "not_interested" | "neutral",
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}

Interested signals: requesting more info, asking questions, scheduling meetings, positive tone
Not interested signals: "not interested", "remove me", "unsubscribe", "stop emailing", negative tone
Neutral: out of office, "I'll think about it", forwarding to someone else`,
        },
        {
          role: 'user',
          content: `Analyze this email reply:\n\n${replyText}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 200,
      jsonMode: true,
    });
    console.log(`[FOLLOW-UP] Reply analyzed via ${aiResult.provider}`);

    const content = aiResult.text;
    if (!content) {
      return { status: 'neutral', confidence: 0, reason: 'No response' };
    }

    const result = JSON.parse(content);
    return result;
  } catch (error) {
    console.error('Error analyzing email reply:', error);
    return { status: 'neutral', confidence: 0, reason: 'Analysis error' };
  }
}

/**
 * Generate follow-up email using AI
 */
export async function generateFollowUpEmail(params: {
  lead: any;
  campaign: any;
  attemptNumber: number;
  previousSubject?: string;
  previousBody?: string;
  userId?: string;
}): Promise<{ subject: string; body: string; preview: string }> {
  const { lead, campaign, attemptNumber, previousSubject, previousBody, userId } = params;
  
  try {
    const firstName = lead.first_name || (lead.contact_name ? lead.contact_name.split(' ')[0] : '') || 'there';

    const fromEmail = campaign.from_email || 'sales@contndr.com';

    let product = campaign.product || 'Contndr';
    const originalProduct = product;

    // Map internal product codes to display names and migrate to Contndr brand
    const productMap: Record<string, string> = {
      'sourcr_web': 'Contndr Premium Website',
      'sourcr_web_starter': 'Contndr Starter Website',
      'sourcr_app': 'Contndr Mobile App',
      'sourcr_investor': 'Contndr Investor Relations',
      'roadr_provider': 'Contndr Provider Subscription',
      'roadr_investor': 'Contndr Investor Relations'
    };

    if (productMap[product]) {
      product = productMap[product];
    } else if (product === 'sourcr' || product === 'roadr') {
      product = 'Contndr';
    }
    
    // Determine brand context
    // We use originalProduct to ensure we detect the brand correctly even if the display name is mapped to Contndr
    const isSourcr = (originalProduct.toLowerCase().includes('sourcr')) || campaign.brand?.toLowerCase() === 'sourcr' || fromEmail.includes('sourcr');
    const isCovera = originalProduct.toLowerCase().includes('covera') || campaign.brand?.toLowerCase() === 'covera' || fromEmail.includes('covera');
    const isRoadr = (originalProduct.toLowerCase().includes('roadr')) || campaign.brand?.toLowerCase() === 'roadr' || fromEmail.includes('roadr');
    const isContndr = !isSourcr && !isCovera && !isRoadr;
    const isActualContndr = isContndr && campaign.brand?.toLowerCase() === 'contndr';
    
    // Determine sender name — only default to Contndr Team for actual Contndr brand campaigns
    let senderName = campaign.sender_name || (isActualContndr ? 'Contndr Team' : '');
    const senderTitle = campaign.sender_title || (isActualContndr ? 'Growth Team' : '');

    const isInvestorCampaign = product.toLowerCase().includes('investor') || campaign.brand?.toLowerCase().includes('investor');

    let followUpContext = '';
    if (attemptNumber === 2) {
      if (isCovera) {
        followUpContext = 'This is the first follow-up. Emphasize the free trial and fast 10-minute setup. Keep it urgent but helpful.';
      } else {
        followUpContext = 'This is the first follow-up. Keep it brief and add value. Acknowledge the previous email might have been missed.';
      }
    } else if (attemptNumber === 3) {
      if (isCovera) {
        followUpContext = 'This is the second follow-up. Highlight how quick and easy it is to get started (10 min walkthrough). Offer to help them start their free trial today.';
      } else {
        followUpContext = 'This is the second follow-up. Offer something specific (case study, demo, free trial).';
      }
    } else if (attemptNumber >= 4) {
      if (isCovera) {
        followUpContext = 'This is the final follow-up. Breakup email approach - last chance to try the free trial with no commitment. Make it personal and founder-led.';
      } else {
        followUpContext = 'This is the final follow-up. Use a breakup email approach - mention this is your last email.';
      }
    }

    // Determine correct signature and tone based on brand - MATCHING INITIAL EMAIL LOGIC EXACTLY
    let signature = '';
    let toneInstructions = '';
    const isGenericUser = !isRoadr && !isCovera && !isSourcr && !isActualContndr;

    // Load user's configured signature from KV for generic users
    let fuSigSettings: any = null;
    if (isGenericUser && userId) {
      try {
        const sigRaw = await kv.get(`signature:${userId}`);
        fuSigSettings = sigRaw ? JSON.parse(sigRaw) : null;
      } catch (e) {
        console.warn('[FOLLOW-UP] Failed to load user signature settings:', e);
      }
    }
    const fuClosingLine = fuSigSettings?.closing_line || 'Best Regards';
    
    // If generic user has a custom_html signature, use it directly as the complete signature
    if (isGenericUser && fuSigSettings?.custom_html) {
        signature = fuSigSettings.custom_html;
        toneInstructions = 'Tone: Professional, clean, direct.';
    } else {
        // Resolve team-style sender names to the correct brand (logic mirrored from index.tsx)
        const isTeamSender = senderName === 'Roadr Team' || senderName === 'Contndr Team' || senderName === 'Sourcr Team' || senderName === 'Covera Team';

        // Special case: For Sourcr campaigns sent from or@sourcr.net, always use Otiniel Ribeiro
        if (isSourcr && fromEmail.includes('or@sourcr.net')) {
             signature = `Best Regards,\nOtiniel Ribeiro | CEO`;
        } else if (isTeamSender && isRoadr) {
            signature = `Best Regards,\nRoadr Team`;
        } else if (isTeamSender && isSourcr) {
            signature = `Best Regards,\nSourcr Team`;
        } else if (isTeamSender && isCovera) {
            signature = `Best Regards,\nCovera Team`;
        } else if (isTeamSender && isActualContndr) {
            signature = `Best Regards,\nContndr Team`;
        } else if (senderName) {
            // Use closing line from user's signature settings for generic users
            const closing = isGenericUser ? fuClosingLine : 'Best Regards';
            signature = `${closing},\n${senderName}${senderTitle ? ` | ${senderTitle}` : ''}`;
        } else {
            signature = '';
        }
        
        if (isSourcr) {
          signature += `\nE: ${fromEmail || 'or@sourcr.net'}\nW: sourcr.net\nP: +1 (305) 602-0230`;
          toneInstructions = 'Tone: Professional, premium, confident.';
        } else if (isCovera) {
          signature += `\nE: or@covera.co\nW: covera.co\nP: 323-333-9600`;
          toneInstructions = 'Tone: Founder-led, personal, urgent but helpful. Emphasize quick setup (10 min walkthrough) and free trial with no commitment.';
          // Enforce correct pricing and free trial info for Covera
          campaign.price_summary = 'Covera Essentials $166/mo, Covera Core $333/mo';
          campaign.landing_url = 'https://covera.co';
        } else if (isRoadr) {
          if (isInvestorCampaign) {
            signature += `\nE: ${fromEmail || 'or@roadr.com'}\nW: roadr.com\nP: 323-333-9600`;
          } else {
            signature += `\nE: ${fromEmail || 'sales@roadr.com'}\nW: roadr.com`;
          }
          toneInstructions = 'Tone: Helpful, direct, problem-solving.';
        } else if (isActualContndr) {
          signature += `\nE: ${fromEmail || 'sales@contndr.com'}\nW: contndr.com`;
          toneInstructions = 'Tone: Professional, clean, stealth, direct.';
        } else {
          // Generic user campaign — use signature settings for full contact info
          if (fromEmail) signature += `\nE: ${fromEmail}`;
          if (fuSigSettings?.phone) signature += `\nP: ${fuSigSettings.phone}`;
          if (fuSigSettings?.website) {
            signature += `\nW: ${fuSigSettings.website.replace(/^https?:\/\//, '')}`;
          } else if (campaign.landing_url) {
            signature += `\nW: ${campaign.landing_url.replace(/^https?:\/\//, '')}`;
          }
          toneInstructions = 'Tone: Professional, clean, direct.';
        }
    }

    // ── User-controlled follow-up generation ──
    // If campaign has custom_instructions, the AI follows those instead of defaults
    const customInstructions = campaign.custom_instructions || '';
    const hasCustomInstructions = !!customInstructions.trim();
    const campaignKnowledge = campaign.campaign_knowledge || '';
    const wordLimit = Math.max(35, Math.round((campaign.max_words || 50) * 0.65));

    const toneMap: Record<string, string> = {
      'casual': 'casual and conversational',
      'professional': 'professional and polished',
      'enthusiastic': 'energetic and exciting',
      'direct': 'direct, no fluff',
      'friendly': 'warm and approachable',
      'formal': 'formal and business-appropriate',
      'witty': 'clever with personality',
      'empathetic': 'empathetic and understanding',
    };
    const toneDesc = toneMap[campaign.tone] || 'natural and human';

    let systemContent = '';
    if (hasCustomInstructions) {
      // User has full control — use their instructions for follow-ups too
      systemContent = `You are writing a follow-up email. The sender has specific writing instructions — follow them exactly.

WRITING INSTRUCTIONS (follow these EXACTLY):
${customInstructions}

${campaignKnowledge ? `BRAND & PRODUCT INFO:\n${campaignKnowledge}\n` : ''}
FOLLOW-UP RULES:
1. Start with "Hi ${firstName},".
2. Under ${wordLimit} words.
3. Reference the previous email casually.
4. ${followUpContext}
5. ${campaign.landing_url ? `Include "${campaign.landing_url}" in the CTA.` : 'End with a question inviting reply.'}
6. STOP after the CTA. No sign-off or name. Signature is added automatically.
7. Match the tone and style from the WRITING INSTRUCTIONS above.

${isCovera ? '- If mentioning a trial, just say "free trial". Do NOT specify a duration.\n- Refer to packages as "Covera Essentials" and "Covera Core".\n- Clarify we manage the RISK vendors introduce, not the vendors themselves.' : ''}

Previous Subject: ${previousSubject || 'None'}
Previous Body: "${previousBody ? previousBody.substring(0, 500) + '...' : 'Not available'}"

Respond with valid JSON only. No markdown formatting.
IMPORTANT: Escape all newlines within strings using \\n.
Example: {"subject": "subject", "preview": "preview", "body": "First.\\n\\nSecond."}`;
    } else {
      // No custom instructions — use defaults but respect tone selection
      systemContent = `You are writing a follow-up email for ${product}. Tone: ${toneDesc}. These should read like a real person checking in, not a sales rep.

RULES:
1. Start with "Hi ${firstName},".
2. Under ${wordLimit} words.
3. Reference the previous email casually.
4. Add one new angle or value point.
5. End with ${campaign.landing_url ? `the link "${campaign.landing_url}"` : 'a question inviting reply'}.
6. DO NOT list features or benefits.
${campaignKnowledge ? `\nBRAND & PRODUCT INFO:\n${campaignKnowledge}\n` : ''}
- ${toneInstructions}
${isCovera ? '- If mentioning a trial, just say "free trial". Do NOT specify a duration.\n- Refer to packages as "Covera Essentials" and "Covera Core".\n- Clarify we manage the RISK vendors introduce, not the vendors themselves.\n- Include a CTA to "Get started" at https://covera.co.\n- Emphasize fast 10-minute walkthrough.' : ''}
- STOP after the CTA. No sign-off or name.

${followUpContext}

Previous Subject: ${previousSubject || 'None'}
Previous Body: "${previousBody ? previousBody.substring(0, 500) + '...' : 'Not available'}"

Respond with valid JSON only. No markdown formatting.
IMPORTANT: Escape all newlines within strings using \\n.
Example: {"subject": "subject", "preview": "preview", "body": "First.\\n\\nSecond."}`;
    }

    // Generate follow-up via AI provider (OpenAI) with retries
    const fuAiResult = await generateAIWithRetries({
      messages: [
        { role: 'system', content: systemContent },
        {
          role: 'user',
          content: `Write follow-up #${attemptNumber} for:\nBusiness: ${lead.business_name}\nContact: ${lead.contact_name || lead.first_name || 'there'}\nCategory: ${lead.category || lead.industry || 'Business'}\nLocation: ${lead.city || 'your area'}\n\nProduct: ${product}\nPrice: ${campaign.price_summary || 'Custom'}\nLanding URL: ${campaign.landing_url || ''}\n\nSender: ${senderName}, ${senderTitle}\nSignature to use:\n${signature}`,
        },
      ],
      temperature: 0.7,
      maxTokens: 500,
      jsonMode: true,
    }, 3);
    console.log(`[FOLLOW-UP] Follow-up email generated via ${fuAiResult.provider}`);

    let content = fuAiResult.text;
    if (!content) {
      throw new Error('No content in AI response');
    }

    // Sanitize content to remove markdown code blocks which can cause parse errors
    content = content.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

    let result;
    try {
      result = JSON.parse(content);
    } catch (e) {
      console.error('JSON Parse Error:', e);
      console.error('Raw content that failed parsing:', content);
      throw new Error('Failed to parse AI response. The model generated invalid JSON.');
    }
    
    // Ensure signature is appended if the AI forgot it (sometimes happens with JSON output)
    if (!result.body.includes(senderName)) {
        result.body += `\n\n${signature}`;
    }
    
    return result;
  } catch (error) {
    console.error('Error generating follow-up email:', error);
    throw error;
  }
}

/**
 * Process follow-ups for a specific campaign
 */
export async function processFollowUpsForCampaign(campaignId: string, userId: string) {
  try {
    // Get campaign details
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .single();

    if (campaignError || !campaign) {
      console.error(`[FOLLOW-UP] Campaign not found: ${campaignId}`, campaignError);
      return { success: false, error: 'Campaign not found' };
    }

    console.log(`[FOLLOW-UP] Processing campaign: ${campaign.name} (${campaignId})`);

    // Enrich campaign with KV data (cc/bcc are stored in KV, not DB)
    try {
      const kvCampaign = await kv.get(`campaign:${userId}:${campaignId}`);
      if (kvCampaign) {
        if (kvCampaign.cc) campaign.cc = kvCampaign.cc;
        if (kvCampaign.bcc) campaign.bcc = kvCampaign.bcc;
      }
    } catch (_) { /* non-fatal */ }

    if (!campaign.follow_up_enabled) {
      console.log(`[FOLLOW-UP] Follow-ups not enabled for campaign: ${campaign.name}`);
      return { success: true, message: 'Follow-ups not enabled for this campaign' };
    }

    const config: FollowUpConfig = {
      enabled: campaign.follow_up_enabled,
      maxAttempts: campaign.follow_up_attempts || 3,
      daysBetween: campaign.days_between_follow_ups || 3,
    };

    console.log(`[FOLLOW-UP] Config: maxAttempts=${config.maxAttempts}, daysBetween=${config.daysBetween}`);

    // Get all emails for this campaign that might need follow-ups
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('user_id', userId) // Defense-in-depth: scope to user
      .in('status', ['sent', 'delivered', 'opened']);

    if (emailsError) {
      console.error('[FOLLOW-UP] Error fetching emails:', emailsError);
      return { success: false, error: 'Failed to fetch emails' };
    }

    console.log(`[FOLLOW-UP] Found ${emails?.length || 0} emails in sent/delivered/opened status`);

    // ── CRITICAL: Deduplicate by lead_id — keep only the LATEST email per lead ──
    // Without this, a lead with emails at sequence_numbers 1, 2, 3 (all 'opened')
    // would trigger 3 separate follow-up sends in a single run — the root cause of
    // the "11 emails to the same person" bug.
    const latestEmailPerLead = new Map<string, any>();
    for (const email of emails || []) {
      const leadId = email.lead_id;
      if (!leadId) continue;
      const existing = latestEmailPerLead.get(leadId);
      const existingSeq = existing?.sequence_number ?? 0;
      const thisSeq = email.sequence_number ?? 1;
      // Keep the email with the highest sequence_number (most recent follow-up)
      if (!existing || thisSeq > existingSeq) {
        latestEmailPerLead.set(leadId, email);
      }
    }
    const deduplicatedEmails = Array.from(latestEmailPerLead.values());
    console.log(`[FOLLOW-UP] After dedup: ${deduplicatedEmails.length} unique lead(s) to evaluate (was ${emails?.length || 0} email rows)`);

    let followUpsSent = 0;
    let emailsSkippedNoLead = 0;
    let emailsSkippedNotReady = 0;

    for (const email of deduplicatedEmails) {
      try {
        // Check if lead needs follow-up
        const emailStatus: EmailStatus = {
          leadId: email.lead_id,
          campaignId: email.campaign_id,
          attemptNumber: email.sequence_number || 1,
          lastSentAt: email.sent_at,
          nextScheduledAt: null,
          status: email.lead_status || 'no_response',
        };

        if (shouldSendFollowUp(emailStatus, config)) {
          console.log(`[FOLLOW-UP] Email ${email.id} qualifies for follow-up (attempt ${emailStatus.attemptNumber} -> ${emailStatus.attemptNumber + 1})`);

          // ── Pre-send guard: check if a follow-up at this sequence_number already
          //    exists for this lead+campaign (prevents races from concurrent cron triggers) ──
          const nextSeq = emailStatus.attemptNumber + 1;
          const { count: existingCount } = await supabase
            .from('emails')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', campaignId)
            .eq('lead_id', email.lead_id)
            .eq('user_id', userId)
            .eq('sequence_number', nextSeq)
            .in('status', ['queued', 'sent', 'delivered', 'opened']);

          if ((existingCount ?? 0) > 0) {
            console.log(`[FOLLOW-UP] ⏭️ Skipping lead ${email.lead_id} — follow-up seq #${nextSeq} already exists (concurrent send guard)`);
            emailsSkippedNotReady++;
            continue;
          }

          // Get lead details
          const { data: lead, error: leadError } = await supabase
            .from('leads')
            .select('*')
            .eq('id', email.lead_id)
            .eq('user_id', userId) // Defense-in-depth: scope to user
            .single();

          if (leadError || !lead) {
            console.error(`[FOLLOW-UP] ⚠️ ORPHANED EMAIL DETECTED: Email ${email.id} references lead_id ${email.lead_id} which no longer exists. Lead was likely deleted. Skipping.`, leadError);
            emailsSkippedNoLead++;
            // Mark orphaned email as 'failed' so it won't be picked up in future follow-up cycles
            try {
              await supabase
                .from('emails')
                .update({ status: 'failed', lead_status: 'orphaned' })
                .eq('id', email.id);
              console.log(`[FOLLOW-UP] Marked orphaned email ${email.id} as failed/orphaned — will not reprocess.`);
            } catch (markErr: any) {
              console.warn(`[FOLLOW-UP] Failed to mark orphaned email ${email.id}:`, markErr.message);
            }
            continue;
          }

          console.log(`[FOLLOW-UP] Found lead: ${lead.contact_name} (${lead.email})`);

          // ── Skip bounced leads — never follow up a bounced address ──
          if (lead.bounced || lead.status === 'bounced') {
            console.log(`[FOLLOW-UP] ⏭️ Skipping bounced lead ${lead.email} — will not send follow-up`);
            emailsSkippedNoLead++;
            continue;
          }

          // ── Skip unsubscribed leads ──
          if (lead.status === 'unsubscribed' || lead.unsubscribed) {
            console.log(`[FOLLOW-UP] ⏭️ Skipping unsubscribed lead ${lead.email}`);
            emailsSkippedNotReady++;
            continue;
          }

          // Generate follow-up email
          const followUpEmail = await generateFollowUpEmail({
            lead,
            campaign,
            attemptNumber: emailStatus.attemptNumber + 1,
            previousSubject: email.subject,
            userId,
          });

          // Determine sender email
          // Priority: Campaign specific sender -> Brand default -> Fallback
          let fromEmail = campaign.from_email;
          if (!fromEmail) {
            // @ts-ignore: brand type mismatch potential
            fromEmail = await getSenderEmail(userId, campaign.brand);
          }

          console.log(`[FOLLOW-UP] Sending follow-up to ${lead.email} from ${fromEmail} (Brand: ${campaign.brand})`);

          // Pre-insert email record as 'queued' to get a real UUID for tracking
          console.log(`[FOLLOW-UP] Pre-inserting email record for ${lead.email}`);
          const { data: preEmail, error: preInsertError } = await supabase
            .from('emails')
            .insert({
              campaign_id: campaignId,
              lead_id: lead.id,
              subject: followUpEmail.subject,
              text_body: followUpEmail.body,
              html_body: followUpEmail.body.replace(/\n/g, '<br>'),
              status: 'queued',
              sequence_number: emailStatus.attemptNumber + 1,
              user_id: userId,
            })
            .select('id')
            .single();

          if (preInsertError || !preEmail) {
            console.error('[FOLLOW-UP] Error pre-inserting follow-up email record:', preInsertError);
            continue;
          }
          console.log(`[FOLLOW-UP] Email record created with ID: ${preEmail.id}`);

          // Build tracked HTML: convert text to proper HTML, then inject open pixel + click tracking
          console.log(`[FOLLOW-UP] Building tracked HTML for ${lead.email}`);
          let htmlBody = textToHtml(followUpEmail.body);
          
          // Wrap in try-catch to handle KV store memory issues gracefully
          try {
            htmlBody = await injectAllTracking(htmlBody, preEmail.id, userId, lead.id);
          } catch (trackingErr: any) {
            console.warn(`[FOLLOW-UP] Tracking injection failed (${trackingErr.message}), continuing without tracking`);
            // Continue without tracking - better to send email than fail completely
          }

          // Send the email
          console.log(`[FOLLOW-UP] Calling sendEmail for ${lead.email}`);
          const sendResult = await sendEmail(userId, {
            from: fromEmail,
            to: lead.email,
            cc: campaign.cc || undefined,
            bcc: campaign.bcc || undefined,
            subject: followUpEmail.subject,
            html: htmlBody,
            text: followUpEmail.body,
          });
          console.log(`[FOLLOW-UP] sendEmail result for ${lead.email}: success=${sendResult.success}, error=${sendResult.error}`);

          // Determine provider — Gmail/Outlook API success = delivery confirmed
          let followUpStatus = sendResult.success ? 'sent' : 'failed';
          if (sendResult.success) {
            try {
              const fup = await getEmailProvider(preEmail.id);
              if (fup === 'gmail_oauth' || fup === 'outlook_oauth') followUpStatus = 'delivered';
            } catch (_) { /* keep 'sent' */ }
          }

          const fuTs = new Date().toISOString();

          // Update email record with result
          await supabase
            .from('emails')
            .update({
              html_body: htmlBody,
              status: followUpStatus,
              sent_at: sendResult.success ? fuTs : null,
              ...(followUpStatus === 'delivered' ? { delivered_at: fuTs } : {}),
              resend_id: sendResult.messageId || null,
            })
            .eq('id', preEmail.id);

          if (sendResult.success) {
            followUpsSent++;
            // Record sent (and delivered) events
            try {
              const fuEvents: any[] = [
                { email_id: preEmail.id, user_id: userId, event_type: 'sent', created_at: fuTs },
              ];
              if (followUpStatus === 'delivered') {
                fuEvents.push({ email_id: preEmail.id, user_id: userId, event_type: 'delivered', created_at: fuTs });
              }
              await supabase.from('email_events').insert(fuEvents);
            } catch (evtErr) {
              console.warn('[FOLLOW-UP] Failed to insert sent/delivered events:', evtErr);
            }
          } else {
            console.error(`[FOLLOW-UP] Failed to send follow-up to ${lead.email}: ${sendResult.error}`);
            
            // ── Rate-limit hit? Stop the batch to avoid wasting attempts ──
            if (sendResult.error && (
              sendResult.error.includes('Daily send limit') ||
              sendResult.error.includes('daily sending limit') ||
              sendResult.error.includes('Rate limit') ||
              sendResult.error.includes('Send rate too fast')
            )) {
              console.warn(`[FOLLOW-UP] ⚠️ Rate limit hit — stopping follow-up batch for campaign ${campaignId}. Remaining emails will be processed next cycle.`);
              break; // Exit the loop — don't keep trying
            }
          }
          
          // Throttle delay between sends — 3s for Gmail/Outlook safety, prevents rate-limit bounces
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          emailsSkippedNotReady++;
          console.log(`[FOLLOW-UP] Email ${email.id} does not qualify for follow-up yet (status: ${emailStatus.status}, attempt: ${emailStatus.attemptNumber}/${config.maxAttempts})`);
        }
      } catch (emailErr: any) {
        console.error(`[FOLLOW-UP] Error processing individual email ${email.id}:`, emailErr.message);
        // Continue to next email instead of failing entire batch
        continue;
      }
    }

    console.log(`[FOLLOW-UP] Summary for campaign ${campaign.name}:`);
    console.log(`  - Follow-ups sent: ${followUpsSent}`);
    console.log(`  - Emails skipped (orphaned/deleted lead): ${emailsSkippedNoLead}`);
    console.log(`  - Emails skipped (not ready yet): ${emailsSkippedNotReady}`);

    return {
      success: true,
      followUpsSent,
      emailsSkippedNoLead,
      emailsSkippedNotReady,
      message: `Processed ${followUpsSent} follow-up emails (${emailsSkippedNoLead} skipped due to deleted leads, ${emailsSkippedNotReady} not ready yet)`,
    };
  } catch (error) {
    console.error('[FOLLOW-UP] Error processing follow-ups:', error);
    return { success: false, error: error.message };
  }
}
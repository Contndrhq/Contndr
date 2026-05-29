// Automated Lead Discovery and Outreach System
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv-retry.tsx";
import { sendEmail as sharedSendEmail } from "./email-sender.tsx";
import { getSerpSearchKey, serpFetch } from "./serp-adapter.tsx";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

interface AutomationRule {
  id: string;
  user_id: string;
  name: string;
  search_query: string;
  location: string;
  leads_per_run: number;
  campaign_id: string;
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
}

/**
 * Discover leads using SerpAPI
 */
export async function discoverLeads(query: string, location: string, limit: number = 50) {
  const serpApiKey = getSerpSearchKey();
  if (!serpApiKey) {
    throw new Error('SERPER_API_KEY not configured');
  }

  const searchQuery = `${query} in ${location}`;
  const perPage = 20;
  const totalPages = Math.ceil(limit / perPage);
  
  console.log(`🔍 Searching SerpAPI: "${searchQuery}" (${limit} leads)...`);
  
  let allLeads: any[] = [];
  
  for (let page = 0; page < totalPages; page++) {
    const start = page * perPage;
    const currentLimit = Math.min(perPage, limit - allLeads.length);
    
    const params = new URLSearchParams({
      engine: 'google_maps',
      q: searchQuery,
      type: 'search',
      api_key: serpApiKey,
      num: currentLimit.toString(),
      start: start.toString(),
    });

    const response = await serpFetch(`https://serpapi.com/search?${params}`);
    
    if (!response.ok) {
      if (allLeads.length > 0) break;
      throw new Error(`SerpAPI error: ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      if (allLeads.length > 0) break;
      throw new Error(`SerpAPI error: ${data.error}`);
    }

    const pageResults = data.local_results || [];
    
    for (const result of pageResults) {
      let email = result.email;
      
      if (!email && result.website) {
        try {
          const url = new URL(result.website.startsWith('http') ? result.website : `https://${result.website}`);
          const domain = url.hostname.replace('www.', '');
          email = `info@${domain}`;
        } catch {
          email = null;
        }
      }
      
      // Extract city from address or location parameter
      let city = '';
      if (result.address) {
        // Try to parse city from address (format: "123 Main St, City, ST 12345")
        const addressParts = result.address.split(',');
        if (addressParts.length >= 2) {
          // Second-to-last part is usually the city
          city = addressParts[addressParts.length - 2]?.trim() || '';
        }
      }
      // Fallback: Only use location parameter if it's not coordinates
      if (!city && location && !location.startsWith('@')) {
        city = location.split(',')[0]?.trim() || '';
      }
      
      // Extract category from type or query
      let category = result.type || '';
      if (!category && query) {
        // Use the search query as category if type is missing
        category = query.trim();
      }
      
      const lead = {
        business_name: result.title,
        category: category || 'Uncategorized',
        city: city || 'Unknown',
        address: result.address,
        website: result.website,
        email: email,
        phone: result.phone,
        source: 'automation',
        rating: result.rating,
        reviews: result.reviews,
        place_id: result.place_id,
        lat: result.gps_coordinates?.latitude,
        lng: result.gps_coordinates?.longitude,
      };
      
      console.log(`📍 Lead: ${lead.business_name} | City: ${lead.city} | Category: ${lead.category}`);
      allLeads.push(lead);
    }
    
    if (pageResults.length < currentLimit || allLeads.length >= limit) {
      break;
    }
    
    if (page < totalPages - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`✓ Discovered ${allLeads.length} leads`);
  return allLeads;
}

/**
 * Check for duplicates and filter new leads
 */
export async function filterDuplicateLeads(leads: any[], userId: string) {
  if (leads.length === 0) return { newLeads: [], duplicates: 0 };
  
  const phones = leads.map(l => l.phone).filter(Boolean);
  const emails = leads.map(l => l.email).filter(Boolean);
  
  let existingLeads: any[] = [];
  
  if (phones.length > 0 || emails.length > 0) {
    const { data: existing } = await supabase
      .from('leads')
      .select('phone, email')
      .eq('user_id', userId)
      .or(`phone.in.(${phones.join(',')}),email.in.(${emails.join(',')})`);
    
    if (existing) {
      existingLeads = existing;
    }
  }
  
  const existingPhones = new Set(existingLeads.map(l => l.phone).filter(Boolean));
  const existingEmails = new Set(existingLeads.map(l => l.email).filter(Boolean));
  
  const newLeads = leads.filter(lead => {
    const isDuplicateByPhone = lead.phone && existingPhones.has(lead.phone);
    const isDuplicateByEmail = lead.email && existingEmails.has(lead.email);
    return !isDuplicateByPhone && !isDuplicateByEmail;
  });
  
  return {
    newLeads,
    duplicates: leads.length - newLeads.length
  };
}

/**
 * Import leads into database
 */
export async function importLeads(leads: any[], userId: string, orgId?: string) {
  if (leads.length === 0) return [];
  
  try {
    const leadsWithUser = leads.map(lead => {
      // Clean up the lead data to prevent database errors
      const cleaned: any = {
        ...lead,
        user_id: userId,
        org_id: orgId || null,
      };
      
      // Ensure email and phone are strings or null
      if (cleaned.email && typeof cleaned.email !== 'string') {
        cleaned.email = String(cleaned.email);
      }
      if (cleaned.phone && typeof cleaned.phone !== 'string') {
        cleaned.phone = String(cleaned.phone);
      }
      
      // Ensure business_name exists (required field)
      if (!cleaned.business_name || typeof cleaned.business_name !== 'string' || cleaned.business_name.trim() === '') {
        cleaned.business_name = cleaned.contact_name || cleaned.email || 'Unknown Business';
      }
      
      return cleaned;
    });

    const { data, error } = await supabase
      .from('leads')
      .insert(leadsWithUser)
      .select();

    if (error) {
      console.error('[IMPORT LEADS] Database error:', error);
      throw new Error(`Failed to import leads: ${error.message || error.code || 'Unknown database error'}`);
    }

    return data || [];
  } catch (err) {
    console.error('[IMPORT LEADS] Unexpected error:', err);
    throw err;
  }
}

/**
 * Generate personalized email using AI
 */
export async function generatePersonalizedEmail(lead: any, campaign: any, brand: string) {
  // Determine landing URL based on brand
  let landingUrl = campaign.landing_url || 'https://contndr.com';
  if (brand.toLowerCase().includes('covera')) {
    landingUrl = 'https://covera.co';
  } else if (brand.toLowerCase().includes('contndr')) {
    landingUrl = 'https://contndr.com';
  }

  // Build prompt based on whether campaign has custom instructions/knowledge
  const campaignKnowledge = campaign.campaign_knowledge || '';
  const customInstructions = campaign.custom_instructions || '';
  const maxWords = campaign.max_words || 75;
  const tone = campaign.tone || 'casual';
  const firstName = lead.contact_name ? lead.contact_name.split(' ')[0] : lead.business_name || 'there';

  const toneMap: Record<string, string> = {
    'casual': 'casual and conversational',
    'professional': 'professional and polished',
    'enthusiastic': 'energetic and exciting',
    'direct': 'direct and to the point',
    'friendly': 'warm and approachable',
    'formal': 'formal and business-appropriate',
  };
  const toneDesc = toneMap[tone] || 'natural and human';

  let prompt = '';

  if (customInstructions) {
    // User has full control — follow their instructions exactly
    prompt = `Write a cold email to "${lead.business_name}" (${lead.category || 'Business'}).

WRITING INSTRUCTIONS (follow these EXACTLY):
${customInstructions}

${campaignKnowledge ? `BRAND & PRODUCT INFO:\n${campaignKnowledge}\n` : ''}
FORMATTING:
- Start with "Hi ${firstName},".
- Under ${maxWords} words.
- ${landingUrl ? `Include "${landingUrl}" in the CTA.` : 'End with a question inviting reply.'}
- STOP after the CTA. No sign-off or name. Signature is added automatically.

Return only the email body, no subject line.`;
  } else if (campaignKnowledge) {
    // User has knowledge base — base email entirely on it
    prompt = `Write a cold email to "${lead.business_name}" (${lead.category || 'Business'}).

SENDER'S BRAND & PRODUCT INFO:
${campaignKnowledge}

RULES:
- Start with "Hi ${firstName},".
- Under ${maxWords} words.
- Tone: ${toneDesc}.
- Base the email entirely on the brand info above.
- ${landingUrl ? `End with a CTA that includes "${landingUrl}".` : 'End with a question inviting reply.'}
- STOP after the CTA. No sign-off or name. Signature is added automatically.
- Do NOT invent features or claims not in the brand info.

Return only the email body, no subject line.`;
  } else {
    // No instructions or knowledge — use a simple, non-prescriptive prompt
    prompt = `Write a short cold email for ${brand || 'our company'} to "${lead.business_name}" (${lead.category || 'Business'}).

RULES:
- Start with "Hi ${firstName},".
- Under ${maxWords} words.
- Tone: ${toneDesc}.
- Open with a relevant question about their industry.
- Briefly mention what we do (1 sentence).
- ${landingUrl ? `Soft CTA with "${landingUrl}".` : 'End with a question inviting reply.'}
- STOP after the CTA. No sign-off or name. Signature is added automatically.

Return only the email body, no subject line.`;
  }

  const { generateAI } = await import("./ai-provider.tsx");
  const aiResult = await generateAI({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    maxTokens: 300,
  });

  let emailBody = aiResult.text.trim();

  // Strip any AI-generated sign-offs (AI sometimes ignores instructions)
  const signOffPatterns = [
    /Best regards,[^\n]*$/i,
    /Best,[^\n]*$/i,
    /Thanks,[^\n]*$/i,
    /Cheers,[^\n]*$/i,
    /Warm regards,[^\n]*$/i,
    /Kind regards,[^\n]*$/i,
    /Sincerely,[^\n]*$/i,
    /Talk soon,[^\n]*$/i,
  ];
  for (const pattern of signOffPatterns) {
    emailBody = emailBody.replace(pattern, '').trim();
  }

  // Append brand-specific signature
  const signature = await buildBrandSignature(brand, campaign);
  if (signature) {
    emailBody += '\n\n' + signature;
  }

  return emailBody;
}

/**
 * Build a brand-appropriate email signature
 */
async function buildBrandSignature(brand: string, campaign: any): Promise<string> {
  const brandLower = (brand || '').toLowerCase();
  const fromEmail = campaign.from_email || '';
  
  // Try to load sender name from campaign or user signature settings
  let senderName = campaign.sender_name || '';
  let senderTitle = campaign.sender_title || '';
  // User-configured signature data — full_name, title, website, AND phone.
  // Previously the phone was loaded but never rendered, so users
  // who set a phone in Signature Settings saw it dropped on every
  // outbound. Now it's pulled into a local var and appended below.
  let userPhone = '';
  let userWebsite = '';
  let userClosingLine = 'Best Regards';
  if (campaign.user_id) {
    try {
      const sigRaw = await kv.get(`signature:${campaign.user_id}`);
      if (sigRaw) {
        const sig = JSON.parse(sigRaw);
        if (!senderName) senderName = sig.full_name || '';
        senderTitle = senderTitle || sig.title || '';
        userPhone = sig.phone || '';
        userWebsite = sig.website || '';
        if (sig.closing_line) userClosingLine = sig.closing_line;
      }
    } catch {
      // Non-fatal
    }
  }

  let sig = '';

  if (brandLower === 'covera' || brandLower.includes('covera')) {
    sig = `${userClosingLine},\n${senderName || 'Covera Team'}`;
    if (senderTitle) sig += ` | ${senderTitle}`;
    sig += `\nE: ${fromEmail || 'or@covera.co'}\nW: covera.co\nP: ${userPhone || '323-333-9600'}`;
  } else if (brandLower === 'roadr' || brandLower.includes('roadr')) {
    sig = `${userClosingLine},\n${senderName || 'Roadr Team'}`;
    if (senderTitle) sig += ` | ${senderTitle}`;
    sig += `\nE: ${fromEmail || 'or@roadr.com'}\nW: roadr.com`;
    if (userPhone) sig += `\nP: ${userPhone}`;
  } else if (brandLower === 'sourcr' || brandLower.includes('sourcr')) {
    sig = `${userClosingLine},\n${senderName || 'Sourcr Team'}`;
    if (senderTitle) sig += ` | ${senderTitle}`;
    sig += `\nE: ${fromEmail || 'or@sourcr.net'}\nW: sourcr.net\nP: ${userPhone || '+1 (305) 602-0230'}`;
  } else if (brandLower === 'contndr' || brandLower.includes('contndr')) {
    sig = `${userClosingLine},\n${senderName || 'Contndr Team'}`;
    if (senderTitle) sig += ` | ${senderTitle}`;
    sig += `\nE: ${fromEmail || 'sales@contndr.com'}`;
    sig += `\nW: contndr.com`;
    if (userPhone) sig += `\nP: ${userPhone}`;
  } else if (senderName) {
    // Generic / custom brand — external users see their own website, NEVER contndr.com
    sig = `${userClosingLine},\n${senderName}`;
    if (senderTitle) sig += ` | ${senderTitle}`;
    if (fromEmail) sig += `\nE: ${fromEmail}`;
    const website = userWebsite || campaign.landing_url;
    if (website) sig += `\nW: ${website.replace(/^https?:\/\//, '')}`;
    if (userPhone) sig += `\nP: ${userPhone}`;
  }

  return sig;
}

/**
 * Process automation rule - discover leads and send emails
 */
export async function processAutomationRule(ruleId: string) {
  // Get automation rule
  const { data: rule, error: ruleError } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('id', ruleId)
    .single();

  if (ruleError || !rule) {
    throw new Error(`Automation rule not found: ${ruleId}`);
  }

  if (!rule.enabled) {
    console.log(`⏭️  Automation rule "${rule.name}" is disabled, skipping`);
    return { skipped: true, reason: 'disabled' };
  }

  console.log(`🤖 Processing automation rule: "${rule.name}"`);

  // Get campaign
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', rule.campaign_id)
    .single();

  if (campaignError || !campaign) {
    throw new Error(`Campaign not found: ${rule.campaign_id}`);
  }

  // Step 1: Discover leads
  console.log(`1️⃣  Discovering ${rule.leads_per_run} leads...`);
  const discoveredLeads = await discoverLeads(
    rule.search_query,
    rule.location,
    rule.leads_per_run
  );

  if (discoveredLeads.length === 0) {
    console.log('⚠️  No leads discovered');
    return { success: true, discovered: 0, imported: 0, sent: 0 };
  }

  // Step 2: Filter duplicates
  console.log(`2️⃣  Filtering duplicates...`);
  const { newLeads, duplicates } = await filterDuplicateLeads(discoveredLeads, rule.user_id);
  
  console.log(`   Found ${newLeads.length} new leads (${duplicates} duplicates skipped)`);

  if (newLeads.length === 0) {
    console.log('⚠️  All leads were duplicates');
    return { success: true, discovered: discoveredLeads.length, imported: 0, sent: 0, duplicates };
  }

  // Step 3: Import new leads
  console.log(`3️⃣  Importing ${newLeads.length} new leads...`);
  const importedLeads = await importLeads(newLeads, rule.user_id);

  // Step 4: Generate and send emails
  console.log(`4️⃣  Generating and sending emails...`);
  let emailsSent = 0;
  const emailRecords = [];

  for (const lead of importedLeads) {
    if (!lead.email) {
      console.log(`   ⏭️  Skipping ${lead.business_name} (no email)`);
      continue;
    }

    try {
      // 🚨 CRITICAL: Resend rate limit is 2 requests per second
      // Wait 1000ms (1 second) BEFORE each send to stay safely under limit
      // This ensures even the first email respects the rate limit
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Generate personalized email
      const emailBody = await generatePersonalizedEmail(lead, campaign, campaign.brand);
      
      // Convert plain text to HTML (newlines to <br>, URLs to links)
      const htmlBody = emailBody
        .replace(/\n/g, '<br>')
        .replace(/(https?:\/\/[^\s<]+)/g, (url: string) => `<a href="${url}" style="color: #000000; text-decoration: underline;">${url}</a>`);

      // Send email via shared email-sender (has domain fallback logic)
      const sendResult = await sharedSendEmail(rule.user_id, {
        from: campaign.from_email,
        to: lead.email,
        subject: campaign.subject,
        html: htmlBody,
        cc: campaign.cc || undefined,
        bcc: campaign.bcc || undefined,
      });

      if (!sendResult.success) {
        throw new Error(sendResult.error || 'Email send failed');
      }

      const resendId = sendResult.messageId;

      // Record email in database
      const { data: emailRecord } = await supabase
        .from('emails')
        .insert({
          campaign_id: campaign.id,
          lead_id: lead.id,
          subject: campaign.subject,
          body: emailBody,
          status: 'sent',
          resend_id: resendId,
          user_id: rule.user_id,
          sequence_number: 1,
          lead_status: 'sent',
        })
        .select()
        .single();

      if (emailRecord) {
        emailRecords.push(emailRecord);
        emailsSent++;
      }

      console.log(`   ✓ Sent email to ${lead.business_name}`);

    } catch (error) {
      console.error(`   ✗ Failed to send to ${lead.business_name}:`, error.message);
    }
  }

  // Update automation rule last_run and next_run
  const now = new Date();
  let nextRun = new Date(now);
  
  switch (rule.frequency) {
    case 'daily':
      nextRun.setDate(nextRun.getDate() + 1);
      break;
    case 'weekly':
      nextRun.setDate(nextRun.getDate() + 7);
      break;
    case 'monthly':
      nextRun.setMonth(nextRun.getMonth() + 1);
      break;
  }

  await supabase
    .from('automation_rules')
    .update({
      last_run_at: now.toISOString(),
      next_run_at: nextRun.toISOString(),
    })
    .eq('id', ruleId);

  console.log(`✅ Automation complete: ${emailsSent} emails sent`);

  return {
    success: true,
    discovered: discoveredLeads.length,
    duplicates,
    imported: importedLeads.length,
    sent: emailsSent,
  };
}

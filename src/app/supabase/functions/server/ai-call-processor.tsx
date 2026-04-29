import { Hono } from 'npm:hono';
import * as kv from './kv-retry.tsx';
import { createClient } from 'npm:@supabase/supabase-js@2';

const app = new Hono();

// Global error handler for AI Call Processor routes
app.onError((err, c) => {
  console.error('❌ AI Call Processor route error:', err);
  return c.json({ 
    success: false,
    error: 'Internal server error', 
    details: err.message 
  }, 500);
});

// Telnyx API base URL
const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

// Helper to get Telnyx API key from environment
function getTelnyxApiKey(): string | null {
  return Deno.env.get('TELNYX_API_KEY') || null;
}

// Helper to make Telnyx API requests
async function telnyxRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = getTelnyxApiKey();
  
  if (!apiKey) {
    throw new Error('Telnyx API key not configured');
  }

  const url = `${TELNYX_API_BASE}${endpoint}`;
  
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${apiKey}`);
  headers.set('Content-Type', 'application/json');

  return fetch(url, {
    ...options,
    headers
  });
}

// Helper to normalize phone numbers to E.164 format
function normalizePhoneToE164(phone: string): string {
  if (!phone) return '';
  
  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');
  
  // If already starts with country code (11 digits for US), add +
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  }
  
  // If 10 digits (US number without country code), add +1
  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }
  
  // If already has correct length with country code
  if (digitsOnly.length > 10) {
    return `+${digitsOnly}`;
  }
  
  // Return original if we can't normalize
  console.warn(`⚠️ Could not normalize phone number: ${phone}`);
  return phone;
}

// Store to track which campaigns are actively being processed
const activeProcessors = new Set<string>();

// POST /ai-call-processor/start - Start processing an active campaign
app.post('/start/:campaignId', async (c) => {
  try {
    const campaignId = c.req.param('campaignId');
    
    // Get user_id from auth token
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );
    const { user, error: authError } = await (await import("./auth-helpers.tsx")).authGetUser(supabaseClient, accessToken || '', "AI-CALL");
    
    if (authError || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Get campaign details
    const key = `ai-call-campaign:${user.id}:${campaignId}`;
    const campaign = await kv.get(key);

    if (!campaign) {
      return c.json({ error: "Campaign not found" }, 404);
    }

    if (campaign.status !== 'active') {
      return c.json({ error: "Campaign is not active" }, 400);
    }

    // Start processing in background (don't await)
    processCampaign(campaignId, user.id, campaign).catch(error => {
      console.error(`❌ Error processing campaign ${campaignId}:`, error);
    });

    return c.json({ 
      success: true, 
      message: "Campaign processing started",
      campaignId 
    });

  } catch (error) {
    console.error('Error starting campaign processor:', error);
    return c.json({ error: "Failed to start campaign processor", details: error.message }, 500);
  }
});

// Main campaign processing function
async function processCampaign(campaignId: string, userId: string, campaign: any) {
  const processorKey = `${userId}:${campaignId}`;
  
  // Prevent multiple processors for the same campaign
  if (activeProcessors.has(processorKey)) {
    console.log(`⏭️  Campaign ${campaignId} is already being processed`);
    return;
  }

  activeProcessors.add(processorKey);
  console.log(`🚀 Starting campaign processor for ${campaign.name} (${campaignId})`);
  console.log(`📊 Campaign data:`, JSON.stringify(campaign, null, 2));

  try {
    const campaignKey = `ai-call-campaign:${userId}:${campaignId}`;
    
    // Get all phone numbers for the campaign brand
    const allNumbers = await kv.getByPrefix('telnyx:number:');
    console.log(`📱 All Telnyx numbers:`, JSON.stringify(allNumbers, null, 2));
    
    const availableNumbers = allNumbers.filter(num => 
      num.status === 'active' && 
      (num.brand === campaign.brand || num.brand === 'both')
    );
    console.log(`📱 Available numbers for brand ${campaign.brand}:`, JSON.stringify(availableNumbers, null, 2));

    if (availableNumbers.length === 0) {
      console.error(`❌ No phone numbers available for brand ${campaign.brand}`);
      console.error(`💡 Please configure phone numbers in Settings > Phone Numbers`);
      // Update campaign status to paused
      const updated = { ...campaign, status: 'paused', updated_at: new Date().toISOString() };
      await kv.set(campaignKey, updated);
      activeProcessors.delete(processorKey);
      return;
    }

    const fromNumber = availableNumbers[0].phone_number;
    console.log(`📞 Using phone number: ${fromNumber}`);

    // Get leads from campaign
    const leads = campaign.selected_leads || [];
    console.log(`📋 Campaign has ${leads.length} selected leads`);
    console.log(`📋 Leads data:`, JSON.stringify(leads, null, 2));

    if (leads.length === 0) {
      console.error(`❌ No leads in campaign ${campaignId}`);
      console.error(`💡 Campaign selected_leads is empty or undefined`);
      console.error(`💡 Please ensure leads are selected when creating the campaign`);
      
      // Mark campaign as completed since there's nothing to do
      const completedCampaign = {
        ...campaign,
        status: 'completed',
        updated_at: new Date().toISOString()
      };
      await kv.set(campaignKey, completedCampaign);
      
      activeProcessors.delete(processorKey);
      return;
    }

    // Validate Telnyx configuration — check env vars first, then KV store
    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY') || await kv.get('telnyx:api_key');
    const telnyxConnectionId = Deno.env.get('TELNYX_CONNECTION_ID') || await kv.get('telnyx:connection_id');
    
    console.log(`🔑 Telnyx API Key: ${telnyxApiKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`🔌 Telnyx Connection ID: ${telnyxConnectionId ? '✅ Configured' : '❌ Missing'}`);
    
    if (!telnyxApiKey || !telnyxConnectionId) {
      console.error(`❌ Telnyx is not properly configured`);
      console.error(`💡 Please complete the Telnyx setup in Settings > Integrations`);
      
      // Update campaign status to paused
      const updated = { ...campaign, status: 'paused', updated_at: new Date().toISOString() };
      await kv.set(campaignKey, updated);
      activeProcessors.delete(processorKey);
      return;
    }

    // Get existing call tracking
    const callTrackingKey = `ai-call-tracking:${userId}:${campaignId}`;
    let callTracking = await kv.get(callTrackingKey) || {
      campaignId,
      attemptedLeads: [],
      completedLeads: [],
      callsMade: 0
    };
    
    console.log(`📊 Call tracking:`, JSON.stringify(callTracking, null, 2));

    // Process leads one by one
    for (const lead of leads) {
      // Check if campaign is still active
      const currentCampaign = await kv.get(campaignKey);
      if (!currentCampaign || currentCampaign.status !== 'active') {
        console.log(`⏸️  Campaign ${campaignId} is no longer active, stopping processor`);
        break;
      }

      // Skip if already called
      if (callTracking.attemptedLeads.includes(lead.id)) {
        console.log(`⏭️  Skipping lead ${lead.business_name} - already called`);
        continue;
      }

      // Validate phone number
      if (!lead.phone) {
        console.log(`⚠️  Skipping lead ${lead.business_name} - no phone number`);
        callTracking.attemptedLeads.push(lead.id);
        await kv.set(callTrackingKey, callTracking);
        continue;
      }

      // ── Credit pre-flight check ──
      try {
        const { hasCredits } = await import('./ai-credits.tsx');
        const creditCheck = await hasCredits(userId, 1);
        if (!creditCheck.allowed) {
          console.warn(`📞 Campaign ${campaignId}: Credit check failed for user ${userId}: ${creditCheck.message}`);
          console.warn(`📞 Pausing campaign — insufficient credits (balance: ${creditCheck.balance})`);
          
          // Pause campaign due to insufficient credits
          const pausedCampaign = {
            ...currentCampaign,
            status: 'paused',
            pause_reason: 'insufficient_credits',
            updated_at: new Date().toISOString()
          };
          await kv.set(campaignKey, pausedCampaign);
          break;
        }
        console.log(`✅ Credit check passed for campaign call (balance: ${creditCheck.balance})`);
      } catch (creditErr) {
        console.error(`⚠️ Credit check error (proceeding anyway):`, creditErr);
      }

      // Normalize phone number to E.164 format
      const normalizedPhone = normalizePhoneToE164(lead.phone);
      if (normalizedPhone !== lead.phone) {
        console.log(`📞 Normalized phone number for ${lead.business_name}: ${lead.phone} -> ${normalizedPhone}`);
      }

      console.log(`📞 Calling ${lead.business_name} at ${normalizedPhone}...`);

      try {
        // Initiate the call
        try {
          const normalizedToNumber = normalizePhoneToE164(lead.phone);
          console.log(`📞 Normalized phone number for ${lead.business_name}: ${lead.phone} -> ${normalizedToNumber}`);
          
          console.log(`🚀 Initiating call to ${normalizedToNumber}...`);
          const callResponse = await telnyxRequest('/calls', {
            method: 'POST',
            body: JSON.stringify({
              connection_id: telnyxConnectionId,
              to: normalizedToNumber,
              from: fromNumber,
              webhook_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/make-server-a8b2511f/telnyx/webhooks/call-status`,
              webhook_url_method: 'POST',
              audio_url: undefined,
              // ⚠️ DO NOT enable answering_machine_detection — it conflicts with gather_using_audio
            })
          });

          const callResult = await callResponse.json();
          
          // Check for Telnyx errors
          if (callResult.errors && callResult.errors.length > 0) {
            const error = callResult.errors[0];
            console.error(`❌ Failed to initiate call to ${normalizedToNumber}:`, JSON.stringify(callResult, null, 2));
            
            // Handle specific error codes
            if (error.code === '10010' || error.detail?.includes('Unverified origination number')) {
              console.error(`\n⚠️  PHONE NUMBER VERIFICATION REQUIRED\n`);
              console.error(`Your Telnyx phone number (${fromNumber}) needs to be verified for outbound calling.\n`);
              console.error(`To fix this:`);
              console.error(`1. Go to https://portal.telnyx.com/#/app/numbers/my-numbers`);
              console.error(`2. Find your phone number: ${fromNumber}`);
              console.error(`3. Click on the number to edit settings`);
              console.error(`4. Under "Connection", make sure it's assigned to your Voice connection`);
              console.error(`5. Under "Outbound Voice Profile", enable outbound calling`);
              console.error(`6. Save and wait a few minutes for verification\n`);
              
              throw new Error(`Telnyx phone number ${fromNumber} is not verified for outbound calling. Please verify in Telnyx portal.`);
            }
            
            if (error.code === '10016') {
              throw new Error(`Invalid phone number format: ${normalizedToNumber}`);
            }
            
            throw new Error(error.detail || error.title || 'Unknown Telnyx error');
          }

          if (!callResult.data || !callResult.data.call_control_id) {
            console.error(`❌ Invalid call response:`, JSON.stringify(callResult, null, 2));
            throw new Error('Invalid response from Telnyx API');
          }

          const callControlId = callResult.data.call_control_id;
          console.log(`✅ Call initiated successfully! Call Control ID: ${callControlId}`);

          // Store call record
          const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const callRecord = {
            id: callId,
            telnyx_call_id: callControlId,
            campaign_id: campaignId,
            lead_id: lead.id,
            lead_name: lead.business_name,
            business_name: lead.business_name || 'Unknown Business',
            from_number: fromNumber,
            to_number: normalizedPhone,
            status: 'initiated',
            user_id: userId, // Track user for credit deduction on hangup
            brand: campaign.brand, // Add brand from campaign
            ai_name: campaign.ai_name, // Add AI name
            ai_config: {
              name: campaign.ai_name,
              role: campaign.ai_role,
              voice_id: campaign.voice_id,
              elevenlabs_agent_id: campaign.elevenlabs_agent_id || null,
              opening_line: campaign.opening_line,
              objective: campaign.objective,
              brand: campaign.brand || 'Contndr',
              business_name: campaign.business_name || campaign.brand || 'Contndr',
              instructions: campaign.instructions || '',
              knowledge_base: campaign.knowledge_base || '',
              transfer_rules: campaign.transfer_rules || [],
              qualification_questions: campaign.qualification_questions || [],
              max_turns: campaign.max_turns || 12,
              user_id: userId // Fallback for credit deduction lookup
            },
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          await kv.set(`call:${callId}`, callRecord);

          // Update tracking
          callTracking.attemptedLeads.push(lead.id);
          callTracking.callsMade++;
          await kv.set(callTrackingKey, callTracking);

          // Update campaign stats
          const updatedCampaign = {
            ...currentCampaign,
            calls_made: callTracking.callsMade,
            in_progress: callTracking.callsMade,
            updated_at: new Date().toISOString()
          };
          await kv.set(campaignKey, updatedCampaign);

          console.log(`✅ Call initiated: ${callId} (Telnyx: ${callControlId})`);

          // Delay between calls (3 seconds)
          await new Promise(resolve => setTimeout(resolve, 3000));

        } catch (error) {
          console.error(`❌ Error calling ${lead.business_name}:`, error);
          
          // Mark as attempted anyway
          callTracking.attemptedLeads.push(lead.id);
          await kv.set(callTrackingKey, callTracking);
        }
      } catch (error) {
        console.error(`❌ Error calling ${lead.business_name}:`, error);
        
        // Mark as attempted anyway
        callTracking.attemptedLeads.push(lead.id);
        await kv.set(callTrackingKey, callTracking);
      }
    }

    // Mark campaign as completed if all leads processed
    if (callTracking.attemptedLeads.length >= leads.length) {
      console.log(`✅ Campaign ${campaignId} completed - all leads processed`);
      const finalCampaign = await kv.get(campaignKey);
      if (finalCampaign) {
        const completedCampaign = {
          ...finalCampaign,
          status: 'completed',
          updated_at: new Date().toISOString()
        };
        await kv.set(campaignKey, completedCampaign);
      }
    }

  } catch (error) {
    console.error(`❌ Fatal error in campaign processor for ${campaignId}:`, error);
  } finally {
    activeProcessors.delete(processorKey);
    console.log(`🏁 Campaign processor stopped for ${campaignId}`);
  }
}

// GET /ai-call-processor/status/:campaignId - Get campaign processing status
app.get('/status/:campaignId', async (c) => {
  try {
    const campaignId = c.req.param('campaignId');
    
    // Get user_id from auth token
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const supabaseClient2 = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );
    const { user, error: authError } = await (await import("./auth-helpers.tsx")).authGetUser(supabaseClient2, accessToken || '', "AI-CALL");
    
    if (authError || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const processorKey = `${user.id}:${campaignId}`;
    const isProcessing = activeProcessors.has(processorKey);

    // Get tracking data
    const callTrackingKey = `ai-call-tracking:${user.id}:${campaignId}`;
    const tracking = await kv.get(callTrackingKey);

    return c.json({
      success: true,
      campaignId,
      isProcessing,
      tracking: tracking || { callsMade: 0, attemptedLeads: [], completedLeads: [] }
    });

  } catch (error) {
    console.error('Error getting processor status:', error);
    return c.json({ error: "Failed to get processor status", details: error.message }, 500);
  }
});

export default app;
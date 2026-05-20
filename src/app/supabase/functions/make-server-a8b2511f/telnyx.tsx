import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import * as kv from './kv-retry.tsx';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const app = new Hono();

// Enable CORS for all Telnyx routes
app.use('*', cors());

// Global error handler for Telnyx routes
app.onError((err, c) => {
  console.error('❌ Telnyx route error:', err);
  return c.json({ 
    success: false,
    error: 'Internal server error', 
    details: err.message 
  }, 500);
});

// Telnyx API base URL
const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

// ── In-memory set of call_control_ids known to have ended ──
// Prevents making futile Telnyx API calls on calls the callee already hung up.
// This is per-isolate; webhook events for a given call usually hit the same isolate.
const endedCallControlIds = new Set<string>();

// Sentinel return value: the call has ended, do NOT attempt fallback commands.
const CALL_ENDED = 'ended' as const;

// ── Per-call transcription state (streaming ASR) ──
// NOTE: aiResponding is NOT stored here — it lives in KV so it's shared across
// all Edge Function instances (prevents duplicate AI responses from concurrent workers).
const transcriptionState = new Map<string, {
  buffer: string;
  lastPartialAt: number;
  isSpeaking: boolean;
  silenceTimer: ReturnType<typeof setTimeout> | null;
}>();

/** KV-based AI responding lock — shared across all Edge Function instances.
 *  Returns true if lock was successfully acquired (caller should process).
 *  Returns false if another instance already holds the lock. */
async function acquireAILock(callControlId: string): Promise<boolean> {
  const lockKey = `ai_lock:${callControlId}`;
  const existing = await kv.get(lockKey);
  if (existing && (Date.now() - existing) < 30000) {
    return false; // Another instance holds the lock
  }
  await kv.set(lockKey, Date.now());
  return true;
}

async function releaseAILock(callControlId: string): Promise<void> {
  try { await kv.del(`ai_lock:${callControlId}`); } catch {}
}

/** Returns true if this exact transcript was already processed recently (dedup). */
async function isTranscriptDuplicate(callControlId: string, transcript: string): Promise<boolean> {
  const hash = transcript.toLowerCase().trim().substring(0, 60).replace(/\s+/g, '_');
  const dedupKey = `tx_dedup:${callControlId}:${hash}`;
  const seen = await kv.get(dedupKey);
  if (seen) return true;
  await kv.set(dedupKey, Date.now());
  return false;
}
type TelnyxResult = boolean | typeof CALL_ENDED;

/** Check 90018 / "Call has already ended" in an error response, mark in-memory */
function isCallEndedError(errorText: string, callControlId?: string): boolean {
  const ended = errorText.includes('"90018"') || errorText.includes('Call has already ended');
  if (ended && callControlId) endedCallControlIds.add(callControlId);
  return ended;
}

// Helper to get Telnyx API key from environment or KV
async function getTelnyxApiKey(): Promise<string | null> {
  const envKey = Deno.env.get('TELNYX_API_KEY');
  if (envKey) return envKey;

  // Fallback to KV store
  return await kv.get('telnyx:api_key');
}

/**
 * Send an SMS via Telnyx Messaging API.
 * Used for post-call booking-link delivery: when an AI call closes with a
 * meeting proposal, we text the prospect the user's Calendly link so they
 * can self-book the time they just agreed to.
 *
 * Pulls the from-number from the user's configured Telnyx numbers (any
 * active one in the brand bucket). The number must be SMS-enabled in
 * Telnyx portal (most US Telnyx numbers are by default).
 *
 * Exported so the ElevenLabs webhook handler can call it.
 */
export async function sendTelnyxSMS(opts: {
  userId: string;
  toNumber: string;
  text: string;
  brand?: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const apiKey = await getTelnyxApiKey();
    if (!apiKey) return { ok: false, error: 'Telnyx API key not configured' };

    // Find an SMS-capable from-number for this user. We reuse the same
    // Telnyx numbers configured for AI calling — most US numbers are
    // dual-capable (voice + SMS) by default.
    const allNumbers = await kv.getByPrefixLimited('telnyx:number:', 250, 0).catch(() => []);
    const activeNumbers = (allNumbers || []).filter((n: any) => n && n.status === 'active' && n.phone_number);
    const candidate = activeNumbers.find((n: any) =>
      opts.brand && (n.brand === opts.brand || n.brand === 'both' || n.brand === 'all')
    ) || activeNumbers[0];
    if (!candidate) return { ok: false, error: 'No active Telnyx number found for SMS sending' };

    const fromNumber = formatToE164(candidate.phone_number);
    const toNumber = formatToE164(opts.toNumber);

    const body: any = {
      from: fromNumber,
      to: toNumber,
      text: opts.text,
    };
    // Optional: use messaging_profile_id if configured (gets you better
    // deliverability + 10DLC compliance). Without it, Telnyx routes via
    // the number's default profile.
    const messagingProfileId = Deno.env.get('TELNYX_MESSAGING_PROFILE_ID')
      || await kv.get('telnyx:messaging_profile_id').catch(() => null);
    if (messagingProfileId) body.messaging_profile_id = messagingProfileId;

    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: `Telnyx SMS failed (${res.status}): ${txt.slice(0, 200)}` };
    }
    const json = await res.json();
    return { ok: true, messageId: json?.data?.id };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// Helper to get Telnyx Connection ID from environment or KV
async function getTelnyxConnectionId(): Promise<string | null> {
  const envId = Deno.env.get('TELNYX_CONNECTION_ID');
  if (envId) return envId;
  
  // Fallback to KV store (set via setup wizard)
  return await kv.get('telnyx:connection_id');
}

// Helper to format phone number to E.164 format
function formatToE164(phoneNumber: string): string {
  if (!phoneNumber) return '';
  
  // Remove all non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, '');
  
  // If it already starts with country code, just add +
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }
  
  // If it's 10 digits (US number without country code), add +1
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  
  // If it already has +, return as is
  if (phoneNumber.startsWith('+')) {
    return phoneNumber;
  }
  
  // Default: assume US number and add +1
  return `+1${cleaned}`;
}

// Helper to make Telnyx API requests
async function telnyxRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = await getTelnyxApiKey();
  
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

// GET /telnyx/config - Get Telnyx configuration status
app.get('/config', async (c) => {
  try {
    const apiKey = await getTelnyxApiKey();
    
    if (!apiKey) {
      return c.json({
        success: true,
        config: {
          api_key_configured: false,
          account_status: 'not_configured',
          phone_numbers_count: 0
        }
      });
    }

    // Try to verify the API key by fetching account info
    try {
      const accountRes = await telnyxRequest('/balance');
      
      if (accountRes.ok) {
        const accountData = await accountRes.json();
        
        // Get phone numbers count
        const numbersData = await kv.getByPrefixLimited('telnyx:number:', 250, 0);
        
        return c.json({
          success: true,
          config: {
            api_key_configured: true,
            account_status: 'active',
            balance: accountData.data?.balance ? parseFloat(accountData.data.balance) : 0,
            phone_numbers_count: numbersData.length,
            connection_id_configured: !!(await getTelnyxConnectionId())
          }
        });
      } else {
        return c.json({
          success: true,
          config: {
            api_key_configured: true,
            account_status: 'inactive',
            phone_numbers_count: 0,
            connection_id_configured: !!(await getTelnyxConnectionId())
          }
        });
      }
    } catch (error) {
      console.error('Error verifying Telnyx account:', error);
      return c.json({
        success: true,
        config: {
          api_key_configured: true,
          account_status: 'inactive',
          phone_numbers_count: 0,
          connection_id_configured: !!(await getTelnyxConnectionId())
        }
      });
    }
  } catch (error) {
    console.error('Error getting Telnyx config:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /telnyx/config - Save Telnyx API key and/or Connection ID
app.post('/config', async (c) => {
  try {
    const body = await c.req.json();
    const { api_key, connection_id } = body;

    if (!api_key && !connection_id) {
      return c.json({ success: false, error: 'api_key or connection_id is required' }, 400);
    }

    const saved: string[] = [];

    if (api_key) {
      await kv.set('telnyx:api_key', api_key);
      saved.push('API key');
    }

    if (connection_id) {
      await kv.set('telnyx:connection_id', connection_id);
      saved.push('Connection ID');
    }

    return c.json({
      success: true,
      message: `Telnyx ${saved.join(' and ')} saved successfully.`
    });
  } catch (error) {
    console.error('Error saving Telnyx config:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// DELETE /telnyx/config - Remove Telnyx API key and connection ID
app.delete('/config', async (c) => {
  try {
    await kv.mdel(['telnyx:api_key', 'telnyx:connection_id']);
    return c.json({ success: true, message: 'Telnyx configuration removed.' });
  } catch (error) {
    console.error('Error deleting Telnyx config:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// GET /telnyx/numbers - Get all phone numbers
app.get('/numbers', async (c) => {
  try {
    const numbers = await kv.getByPrefixLimited('telnyx:number:', 250, 0);
    
    console.log('📋 Raw KV results:', JSON.stringify(numbers, null, 2));
    console.log('📋 Number of items from KV:', numbers.length);
    
    // getByPrefix returns an array of values directly, not {key, value} objects
    const validNumbers = numbers.filter(n => n !== null && n !== undefined);
    
    console.log('📋 Valid numbers after filter:', JSON.stringify(validNumbers, null, 2));
    console.log('📋 Valid number count:', validNumbers.length);
    
    return c.json({
      success: true,
      numbers: validNumbers
    });
  } catch (error) {
    console.error('Error getting phone numbers:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /telnyx/numbers/sync - Sync phone numbers from Telnyx API
app.post('/numbers/sync', async (c) => {
  try {
    // Fetch all phone numbers from Telnyx API
    const response = await telnyxRequest('/phone_numbers');
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Telnyx API error:', errorData);
      throw new Error(errorData.errors?.[0]?.detail || 'Failed to fetch numbers from Telnyx');
    }

    const data = await response.json();
    const telnyxNumbers = data.data || [];

    console.log(`📞 Syncing ${telnyxNumbers.length} phone numbers from Telnyx...`);
    console.log('📋 Telnyx numbers data:', JSON.stringify(telnyxNumbers, null, 2));

    // Get existing numbers from our KV store
    const existingNumbers = await kv.getByPrefixLimited('telnyx:number:', 250, 0);
    console.log(`💾 Found ${existingNumbers.length} existing numbers in KV store`);
    
    // getByPrefix returns values directly, not {key, value} objects
    const existingTelnyxIds = new Set(
      existingNumbers
        .filter(n => n && n.telnyx_number_id)
        .map(n => n.telnyx_number_id)
    );
    
    console.log('🔑 Existing Telnyx IDs:', Array.from(existingTelnyxIds));

    let syncedCount = 0;

    // Sync each number
    for (const telnyxNumber of telnyxNumbers) {
      console.log(`🔄 Processing number: ${telnyxNumber.phone_number} (ID: ${telnyxNumber.id})`);
      
      // Skip if already exists
      if (existingTelnyxIds.has(telnyxNumber.id)) {
        console.log(`⏭️  Skipping ${telnyxNumber.phone_number} - already exists`);
        continue;
      }

      // Create new number record
      const numberId = `telnyx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const numberRecord = {
        id: numberId,
        phone_number: telnyxNumber.phone_number,
        friendly_name: telnyxNumber.phone_number,
        brand: 'both',
        direction: 'both',
        recording_enabled: true,
        telnyx_number_id: telnyxNumber.id,
        status: telnyxNumber.status === 'active' ? 'active' : 'inactive',
        created_at: telnyxNumber.created_at || new Date().toISOString()
      };

      console.log(`✅ Syncing new number:`, numberRecord);
      await kv.set(`telnyx:number:${numberId}`, numberRecord);
      syncedCount++;
    }

    console.log(`✅ Sync complete: ${syncedCount} new phone numbers added from Telnyx`);

    return c.json({
      success: true,
      message: `Synced ${syncedCount} phone numbers`,
      total: telnyxNumbers.length,
      synced: syncedCount,
      existing: existingNumbers.length
    });
  } catch (error) {
    console.error('❌ Error syncing phone numbers:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// GET /telnyx/search-numbers - Search available phone numbers
app.get('/search-numbers', async (c) => {
  try {
    const areaCode = c.req.query('area_code');
    
    if (!areaCode) {
      return c.json({ success: false, error: 'Area code is required' }, 400);
    }

    // Search for available phone numbers
    const response = await telnyxRequest(
      `/available_phone_numbers?filter[national_destination_code]=${areaCode}&filter[limit]=10`
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.errors?.[0]?.detail || 'Failed to search numbers');
    }

    const data = await response.json();
    
    return c.json({
      success: true,
      numbers: data.data || []
    });
  } catch (error) {
    console.error('Error searching phone numbers:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /telnyx/purchase-number - Purchase a phone number
app.post('/purchase-number', async (c) => {
  try {
    const body = await c.req.json();
    const { phone_number } = body;

    if (!phone_number) {
      return c.json({ success: false, error: 'Phone number is required' }, 400);
    }

    // Purchase the phone number from Telnyx
    const response = await telnyxRequest('/phone_numbers', {
      method: 'POST',
      body: JSON.stringify({
        phone_number: phone_number
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.errors?.[0]?.detail || 'Failed to purchase number');
    }

    const data = await response.json();
    const telnyxNumber = data.data;

    // Store in our database
    const numberId = `telnyx_${Date.now()}`;
    const numberRecord = {
      id: numberId,
      phone_number: phone_number,
      friendly_name: phone_number,
      brand: 'both',
      direction: 'both',
      recording_enabled: true,
      telnyx_number_id: telnyxNumber.id,
      status: 'active',
      created_at: new Date().toISOString()
    };

    await kv.set(`telnyx:number:${numberId}`, numberRecord);

    return c.json({
      success: true,
      number: numberRecord
    });
  } catch (error) {
    console.error('Error purchasing phone number:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /telnyx/numbers/add-existing - Manually add an existing Telnyx number
app.post('/numbers/add-existing', async (c) => {
  try {
    const body = await c.req.json();
    const { phone_number, brand = 'both', telnyx_number_id } = body;

    if (!phone_number) {
      return c.json({ success: false, error: 'Phone number is required' }, 400);
    }

    // Check if already exists
    const existingNumbers = await kv.getByPrefixLimited('telnyx:number:', 250, 0);
    const duplicate = existingNumbers.find((n: any) => n.phone_number === phone_number);
    
    if (duplicate) {
      return c.json({ success: false, error: 'This phone number already exists' }, 400);
    }

    // Create new number record
    const numberId = `telnyx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const numberRecord = {
      id: numberId,
      phone_number: phone_number,
      friendly_name: phone_number,
      brand: brand,
      direction: 'both',
      recording_enabled: true,
      telnyx_number_id: telnyx_number_id || null,
      status: 'active',
      created_at: new Date().toISOString()
    };

    console.log(`✅ Manually adding existing number:`, numberRecord);
    await kv.set(`telnyx:number:${numberId}`, numberRecord);

    return c.json({
      success: true,
      number: numberRecord,
      message: 'Phone number added successfully'
    });
  } catch (error) {
    console.error('Error adding existing phone number:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// PUT /telnyx/numbers/:id - Update phone number settings
app.put('/numbers/:id', async (c) => {
  try {
    const numberId = c.req.param('id');
    const body = await c.req.json();

    const existingNumber = await kv.get(`telnyx:number:${numberId}`);
    
    if (!existingNumber) {
      return c.json({ success: false, error: 'Phone number not found' }, 404);
    }

    const updatedNumber = {
      ...existingNumber,
      ...body,
      id: numberId // Ensure ID doesn't change
    };

    await kv.set(`telnyx:number:${numberId}`, updatedNumber);

    return c.json({
      success: true,
      number: updatedNumber
    });
  } catch (error) {
    console.error('Error updating phone number:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// DELETE /telnyx/numbers/:id - Delete phone number
app.delete('/numbers/:id', async (c) => {
  try {
    const numberId = c.req.param('id');

    const existingNumber = await kv.get(`telnyx:number:${numberId}`);
    
    if (!existingNumber) {
      return c.json({ success: false, error: 'Phone number not found' }, 404);
    }

    // Optionally release the number from Telnyx
    if (existingNumber.telnyx_number_id) {
      try {
        await telnyxRequest(`/phone_numbers/${existingNumber.telnyx_number_id}`, {
          method: 'DELETE'
        });
      } catch (error) {
        console.error('Error releasing Telnyx number:', error);
        // Continue with local deletion even if Telnyx fails
      }
    }

    await kv.del(`telnyx:number:${numberId}`);

    return c.json({
      success: true,
      message: 'Phone number deleted'
    });
  } catch (error) {
    console.error('Error deleting phone number:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /telnyx/calls/initiate - Initiate an AI call
app.post('/calls/initiate', async (c) => {
  try {
    const body = await c.req.json();
    const { 
      from_number, 
      to_number, 
      campaign_id,
      lead_id,
      lead_name,
      business_name,
      ai_config 
    } = body;

    if (!from_number || !to_number) {
      return c.json({ 
        success: false, 
        error: 'from_number and to_number are required' 
      }, 400);
    }

    // Format phone numbers to E.164
    const formattedFrom = formatToE164(from_number);
    const formattedTo = formatToE164(to_number);

    console.log(`📞 Initiating AI call: ${formattedFrom} → ${formattedTo}, ai_config:`, ai_config ? 'yes' : 'no');

    // ── Enrich ai_config with the user's Knowledge Base ──
    // Mirrors the AI call processor — gives the agent access to the same KB
    // the email composer uses so it can answer pricing/product/scheduling
    // questions on the call. Existing ai_config.knowledge_base is treated as
    // a campaign-level override and merged in by getKnowledgeBaseContext.
    if (ai_config && body.user_id) {
      try {
        const { getKnowledgeBaseContext } = await import('./knowledge-base.tsx');
        const kbContext = await getKnowledgeBaseContext(
          body.user_id,
          ai_config.brand || 'all',
          ai_config.knowledge_base || ''
        );
        if (kbContext && kbContext.trim()) {
          ai_config.knowledge_base = kbContext;
          console.log(`📚 Loaded KB for manual AI call — ${kbContext.length} chars`);
        }
      } catch (kbErr: any) {
        console.warn('📚 KB load failed (non-fatal):', kbErr?.message || kbErr);
      }

      // ── Load the user's sales playbook ──
      // Drives the stage machine (qualify → present → close) and supplies
      // qualifying questions, value props, meeting options, and a library
      // of objection counters that the AI agent uses on every turn.
      try {
        const userPlaybook = await kv.get(`ai_call_playbook:${body.user_id}`);
        if (userPlaybook) {
          ai_config.playbook = { ...userPlaybook, ...(ai_config.playbook || {}) };
          console.log(`🎯 Loaded sales playbook for manual AI call (user=${body.user_id})`);
        }
      } catch (pbErr: any) {
        console.warn('🎯 Playbook load failed (non-fatal):', pbErr?.message || pbErr);
      }
    }

    // ── Credit pre-flight check ──
    const callerUserId = body.user_id;
    if (callerUserId) {
      try {
        const { hasCredits } = await import('./ai-credits.tsx');
        const creditCheck = await hasCredits(callerUserId, 1);
        if (!creditCheck.allowed) {
          console.warn(`📞 Credit check failed for ${callerUserId}: ${creditCheck.message}`);
          return c.json({
            success: false,
            error: 'insufficient_credits',
            message: creditCheck.message || 'You have run out of AI call credits. Purchase more to continue.',
            balance: creditCheck.balance,
          }, 402);
        }
        console.log(`📞 Credit check passed for ${callerUserId}: ${creditCheck.balance} credits available`);
      } catch (creditErr) {
        console.error('📞 Credit check error (non-blocking):', creditErr);
        // Don't block calls if credit system is down — just log
      }
    }

    // Resolve connection ID from env or KV
    const resolvedConnectionId = await getTelnyxConnectionId();
    if (!resolvedConnectionId) {
      throw new Error('Telnyx Connection ID not configured. Please complete Telnyx setup in Settings.');
    }

    // Initiate the call via Telnyx
    const response = await telnyxRequest('/calls', {
      method: 'POST',
      body: JSON.stringify({
        connection_id: resolvedConnectionId,
        to: formattedTo,
        from: formattedFrom,
        webhook_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/make-server-a8b2511f/telnyx/webhooks/call-status`,
        webhook_url_method: 'POST',
        audio_url: undefined,
        // AMD now enabled — earlier conflict was with gather_using_audio
        // which has been replaced by transcription_start. Handler at
        // call.machine.detection.ended hangs up automatically on voicemail.
        answering_machine_detection: 'premium',
        answering_machine_detection_config: {
          total_analysis_time_millis: 3000,
          after_greeting_silence_millis: 800,
          between_words_silence_millis: 400,
          greeting_duration_millis: 3500,
          initial_silence_millis: 3500,
          maximum_number_of_words: 5,
          maximum_word_length_millis: 3500,
          silence_threshold: 256,
        },
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('📞 Telnyx call initiation failed:', JSON.stringify(errorData));
      throw new Error(errorData.errors?.[0]?.detail || 'Failed to initiate call');
    }

    const callData = await response.json();
    const telnyxCall = callData.data;

    console.log(`📞 Telnyx call created, control_id: ${telnyxCall.call_control_id}`);

    // Store call record with lead context for webhook to use
    const callId = `call_${Date.now()}`;

    // ── Pre-build the opening line so it's baked into the call record ──
    // This avoids regenerating it in the webhook handler (which must respond fast).
    let preBuiltOpening = ai_config?.opening_line || '';
    if (!preBuiltOpening && ai_config?.greeting) {
      preBuiltOpening = ai_config.greeting
        .replace(/\{name\}/g, ai_config?.name || 'Alex')
        .replace(/\{business_name\}/g, ai_config?.business_name || ai_config?.brand || 'our team')
        .replace(/\{role\}/g, ai_config?.role || 'assistant');
    }
    if (!preBuiltOpening) {
      const name = ai_config?.name || 'Alex';
      const brand = ai_config?.brand || 'Contndr';
      const openers = [
        `Hey there! This is ${name} over at ${brand}. I was hoping to catch you for just a sec — is now an okay time?`,
        `Hi! ${name} here from ${brand}. I know you're probably busy, but I was hoping for just a quick minute — is that cool?`,
        `Hey! This is ${name} with ${brand}. I'd love to chat real quick if you have a minute?`,
      ];
      preBuiltOpening = openers[Math.floor(Math.random() * openers.length)];
    }

    // Pre-generate TTS audio in background — stored in KV so the webhook can use it immediately
    const voiceNameForPreGen = ai_config?.voice_id || ai_config?.voice || DEFAULT_VOICE;
    const preGenKey = `call_audio_pre:${callId}`;
    elevenLabsTTS(preBuiltOpening, voiceNameForPreGen).then(async (url) => {
      if (url) {
        await kv.set(preGenKey, { url, generated_at: new Date().toISOString() });
        console.log(`🎙️ Pre-generated opening audio for call ${callId}`);
      } else {
        console.warn(`⚠️ Pre-gen TTS returned null for call ${callId} — will generate on-demand`);
      }
    }).catch(err => console.error('Pre-gen TTS error (non-fatal):', err));

    const callRecord = {
      id: callId,
      telnyx_call_id: telnyxCall.call_control_id,
      campaign_id,
      lead_id,
      lead_name: lead_name || ai_config?.lead_name || '',
      business_name: business_name || ai_config?.business_name || '',
      from_number: formattedFrom,
      to_number: formattedTo,
      status: 'initiated',
      user_id: callerUserId || null,
      // Embed the pre-built opening so webhook handler never needs to regenerate it
      ai_config: { ...ai_config, _opening_line: preBuiltOpening },
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await kv.set(`call:${callId}`, callRecord);
    // Reverse index: O(1) lookup in webhook handler by Telnyx call_control_id
    await kv.set(`call_by_telnyx:${telnyxCall.call_control_id}`, callId);

    return c.json({
      success: true,
      call: callRecord
    });
  } catch (error) {
    console.error('Error initiating call:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─── AI Conversation helpers ────────────────────────────────────────────────

// ElevenLabs voice IDs — warm, natural-sounding voices
const ELEVENLABS_VOICES: Record<string, string> = {
  rachel: '21m00Tcm4TlvDq8ikWAM',   // Rachel — calm, professional female
  bella: 'EXAVITQu4vr4xnSDxMaL',    // Bella — warm, engaging female
  josh: 'TxGEqnHWrfWFTfGW9XjX',      // Josh — deep, confident male
  adam: 'pNInz6obpgDQGcFmaJgB',       // Adam — deep, warm male
  sarah: 'SAz9YHcvj6GT2YYXdXww',     // Sarah — friendly, natural female
  zara: 'SAz9YHcvj6GT2YYXdXww',      // Alias for Sarah
};
const DEFAULT_VOICE = 'rachel';

// Supabase client for Storage (service role to manage buckets)
const supabaseVoice = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
const VOICE_BUCKET = 'make-a8b2511f-ai-voice';

// Idempotently ensure the voice audio bucket exists AS A PUBLIC bucket.
// Public means Telnyx can fetch the audio URL without any Supabase apikey
// header — which is necessary because Supabase's Edge Function gateway
// 401s anonymous requests even when the function is deployed with
// --no-verify-jwt. Storage public URLs bypass that gateway entirely.
let bucketReady = false;
async function ensureVoiceBucket() {
  if (bucketReady) return;
  try {
    const { data: buckets } = await supabaseVoice.storage.listBuckets();
    const existing = buckets?.find((b: any) => b.name === VOICE_BUCKET);
    if (!existing) {
      await supabaseVoice.storage.createBucket(VOICE_BUCKET, { public: true });
      console.log(`✅ Created PUBLIC storage bucket: ${VOICE_BUCKET}`);
    } else if (existing.public === false) {
      // Upgrade existing private bucket to public so Telnyx can fetch
      await supabaseVoice.storage.updateBucket(VOICE_BUCKET, { public: true });
      console.log(`✅ Upgraded bucket to public: ${VOICE_BUCKET}`);
    }
    bucketReady = true;
  } catch (err) {
    console.error('⚠️ Bucket check error (non-fatal):', err);
    bucketReady = true; // Don't block calls if bucket already exists
  }
}

/** Generate TTS via ElevenLabs, upload to public Storage, return public URL.
 *
 *  WHY NOT STREAMING: Supabase's Edge Function gateway requires a valid
 *  apikey/JWT on every request — even for functions deployed with
 *  --no-verify-jwt. Telnyx fetches audio_url anonymously (no headers, no
 *  query-param trick works for Functions), so any URL pointing at our
 *  function 401s and the call plays silence.
 *
 *  Storage public-bucket URLs go through a different code path that
 *  doesn't enforce the gateway check, so Telnyx can fetch them. The
 *  tradeoff is ~500-1000ms latency added vs streaming (gen + upload),
 *  but a working call beats a fast silent one. */
// Brand / acronym normalization for TTS.
// ElevenLabs reads "contndr" letter-by-letter because there are no vowels —
// it sounds like "C-T-N-D-R" instead of the intended "contender." Same
// problem for any consonant-cluster brand name or domain. We rewrite the
// text right before sending it to TTS so the AI's responses sound natural,
// while the underlying LLM context still uses the real brand spelling.
function normalizeForTTS(text: string): string {
  if (!text) return '';
  let out = text;
  // Brand pronunciation map. Add more here as you discover them.
  const replacements: Array<[RegExp, string]> = [
    // "contndr" → "Contender". Case-insensitive, word-boundary safe so we
    // don't mangle "contndrhq" etc. (those become "ContenderHQ").
    [/\bcontndr\b/gi, 'Contender'],
    [/\bcontndrhq\b/gi, 'Contender HQ'],
    [/\bcontndr\.com\b/gi, 'Contender dot com'],
    // Common URL/email reading tweaks
    [/(?<=\w)\.com\b/gi, ' dot com'],
    [/(?<=\w)@(?=\w)/g, ' at '],
  ];
  for (const [re, sub] of replacements) out = out.replace(re, sub);
  // Collapse repeated spaces from the replacements above
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out;
}

async function elevenLabsTTS(text: string, voiceName?: string, opts?: { highQuality?: boolean }): Promise<string | null> {
  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  if (!apiKey) {
    console.error('❌ ELEVENLABS_API_KEY not set');
    return null;
  }
  const voice = (voiceName || DEFAULT_VOICE).toLowerCase();
  const voiceId = voice.length > 15 ? voice : (ELEVENLABS_VOICES[voice] || ELEVENLABS_VOICES[DEFAULT_VOICE]);

  // Rewrite brand/acronym text for natural pronunciation
  const speakText = normalizeForTTS(text);

  // Model selection:
  //  • opening line → eleven_multilingual_v2 (best quality, first impression)
  //  • response turns → eleven_flash_v2_5 (lowest latency, ~150ms TTFB,
  //    still solid quality on phone-grade audio)
  const modelId = opts?.highQuality ? 'eleven_multilingual_v2' : 'eleven_flash_v2_5';

  console.log(`🎙️ ElevenLabs TTS gen (${modelId}): "${speakText.substring(0, 60)}..." voice=${voice}`);
  const t0 = Date.now();

  try {
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: speakText,
        model_id: modelId,
        voice_settings: {
          // Lower stability + higher style = smoother, less choppy reading
          // with more natural intonation between words. Range 0-1.
          stability: 0.3,
          similarity_boost: 0.9,
          style: 0.5,
          use_speaker_boost: true,
        },
        output_format: 'mp3_44100_128',
      }),
    });
    if (!ttsRes.ok) {
      const body = await ttsRes.text().catch(() => '');
      console.error(`❌ ElevenLabs TTS failed (${ttsRes.status}): ${body.slice(0, 200)}`);
      return null;
    }
    const audioBytes = new Uint8Array(await ttsRes.arrayBuffer());
    await ensureVoiceBucket();
    const fileName = `tts/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.mp3`;
    const { error: upErr } = await supabaseVoice.storage
      .from(VOICE_BUCKET)
      .upload(fileName, audioBytes, { contentType: 'audio/mpeg', upsert: false });
    if (upErr) {
      console.error('❌ TTS audio upload failed:', upErr.message || upErr);
      return null;
    }
    const { data: pub } = supabaseVoice.storage.from(VOICE_BUCKET).getPublicUrl(fileName);
    let url = pub?.publicUrl || null;
    if (!url) {
      console.error('❌ No public URL returned for uploaded audio');
      return null;
    }

    // Verify the public URL is actually publicly fetchable. If the bucket
    // wasn't successfully upgraded to public, Telnyx will 401 it and the
    // call goes silent — fail loudly here instead. If public fetch fails,
    // fall back to a 1-hour signed URL (always public regardless of bucket).
    try {
      const probe = await fetch(url, { method: 'HEAD' });
      if (!probe.ok) {
        console.warn(`⚠️ Public URL not accessible (${probe.status}) — falling back to signed URL`);
        const { data: signed } = await supabaseVoice.storage
          .from(VOICE_BUCKET)
          .createSignedUrl(fileName, 3600);
        if (signed?.signedUrl) {
          url = signed.signedUrl;
          console.log(`🔐 Using signed URL fallback`);
        } else {
          console.error('❌ Both public and signed URL paths failed');
          return null;
        }
      }
    } catch (probeErr: any) {
      console.warn('⚠️ Public URL probe error (proceeding with public URL anyway):', probeErr?.message || probeErr);
    }

    console.log(`✅ TTS ready in ${Date.now() - t0}ms — ${url.split('/').pop()?.split('?')[0]}`);
    return url;
  } catch (err: any) {
    console.error('❌ elevenLabsTTS error:', err?.message || err);
    return null;
  }
}

// ─── Sales Playbook Layer ───────────────────────────────────────────────────
// Layered on top of the agent's voice + KB. Drives the conversation through
// an explicit qualify → present → close state machine, handles common
// objections with a library of pre-written one-liners, and detects buying
// signals to fast-forward toward asking for the meeting. This is what turns
// a "natural-sounding chatbot" into "an actual closer."

type CallStage = 'qualify' | 'present' | 'close' | 'objection' | 'wrap';

const BUYING_SIGNAL_PATTERNS = [
  /how (does|do) (it|this|that|you|your)/i,
  /how much|what.{0,15}(cost|price|pricing)|pricing/i,
  /send me (info|details|something|over|a link)/i,
  /(can|could) you (send|share|email)/i,
  /(when|how soon) can (we|i) (start|get started|see|try)/i,
  /sounds (good|great|interesting|cool)/i,
  /(book|schedule|set up|jump on) (a|the)? ?(call|meeting|demo|chat)/i,
  /(love|like) to (see|learn|hear) more/i,
  /show me|walk me through/i,
  /(what|how) (are|is) the next step/i,
];

const STALL_PATTERNS = [
  /(send|shoot|email) (me|over).{0,30}(info|details|something|deck|link)/i,
  /let me think|need to think/i,
  /circle back|follow up|reach back/i,
  /not (a|the) right time|busy right now/i,
  /talk to (my|the) (team|boss|partner|cofounder)/i,
];

// Default objection library — picked up by keyword. Each entry is "if the
// prospect says X-ish, the AI's next reply should steer toward Y." We feed
// these as guidance into the system prompt, not as canned scripts, so the
// agent still sounds natural.
const DEFAULT_OBJECTIONS: Array<{ trigger: RegExp; label: string; response: string }> = [
  {
    trigger: /(already (have|use|using)|we use|we have|got (a|one)|current(ly)? use)/i,
    label: 'already_have_solution',
    response: `Totally fair — most teams I talk to already have something. Quick question: what's the one thing your current setup doesn't do well that you wish it did?`,
  },
  {
    trigger: /(too )?expensive|cost too much|out of budget|no budget|can't afford|pricey/i,
    label: 'price',
    response: `Yeah, budget's always a factor — but the folks getting real value here usually pay it back in the first month from one extra deal. Mind if I show you the math in 10 min?`,
  },
  {
    trigger: /(send|shoot|email) (me|over).{0,30}(info|details|something|deck|link)/i,
    label: 'send_info',
    response: `Happy to — but honestly, a 10-min screen-share will land way better than a deck. How's tomorrow at this same time?`,
  },
  {
    trigger: /(not (a|the) right time|busy right now|bad time|catch me later)/i,
    label: 'bad_timing',
    response: `Got it — won't keep you. Want me to grab 10 min on the calendar later this week instead of going back and forth?`,
  },
  {
    trigger: /(talk to|run.{0,10}by|check with) (my|the) (team|boss|partner|cofounder|wife|husband)/i,
    label: 'not_decision_maker',
    response: `Makes sense — best path is usually I show you both at once. Want to grab 15 min with the two of you this week?`,
  },
  {
    trigger: /(need to think|let me think|think about it|gotta sleep on)/i,
    label: 'thinking',
    response: `Totally — what's the main thing on your mind? I'd rather answer it now than have you stuck on it later.`,
  },
  {
    trigger: /(don't|do not) (need|want)|not interested in this/i,
    label: 'not_interested_soft',
    response: `Fair enough — quick one before I let you go: what would have to be true for this to be a fit? If the answer's nothing, no worries.`,
  },
  {
    trigger: /(call back|callback|circle back).{0,20}(later|tomorrow|next week|month)/i,
    label: 'callback_later',
    response: `Sure — what works better for you, Thursday afternoon or Friday morning? I'll put it on the calendar so we actually connect.`,
  },
];

function detectStage(turnCount: number, prospectSaid: string, lastStage?: CallStage): CallStage {
  const t = (prospectSaid || '').toLowerCase();
  // Buying signal → jump straight to close, regardless of turn count
  if (BUYING_SIGNAL_PATTERNS.some(r => r.test(t))) return 'close';
  // Objection / stall → objection-handling stage
  if (STALL_PATTERNS.some(r => r.test(t))) return 'objection';
  // Otherwise progress by turn count
  if (turnCount <= 2) return 'qualify';
  if (turnCount <= 5) return 'present';
  if (turnCount <= 8) return 'close';
  return 'wrap';
}

function matchObjection(prospectSaid: string, customObjections: Array<{ trigger: string; response: string; label?: string }> | undefined) {
  const t = (prospectSaid || '').toLowerCase();
  // User-defined objections take priority (they know their market better than us)
  if (Array.isArray(customObjections)) {
    for (const o of customObjections) {
      const trig = (o.trigger || '').toLowerCase().trim();
      if (!trig) continue;
      // Simple substring match for user-friendly authoring (no regex required)
      if (t.includes(trig)) return { label: o.label || trig, response: o.response };
    }
  }
  for (const o of DEFAULT_OBJECTIONS) {
    if (o.trigger.test(t)) return { label: o.label, response: o.response };
  }
  return null;
}

interface Playbook {
  qualifying_questions?: string[];
  value_props?: string[];
  meeting_options?: string;   // e.g. "Thursday at 2pm or Friday at 10am ET"
  booking_link?: string;      // optional Calendly / cal.com URL
  objections?: Array<{ trigger: string; response: string; label?: string }>;
  close_style?: 'soft' | 'direct';
}

function buildPlaybookBlock(playbook: Playbook | undefined, stage: CallStage, matchedObjection: ReturnType<typeof matchObjection>): string {
  const pb = playbook || {};
  let block = `\n━━━ SALES PLAYBOOK (stage: ${stage.toUpperCase()}) ━━━\n`;

  if (stage === 'qualify') {
    block += `You are in DISCOVERY mode. Goal of this turn: learn one piece of pain or context. Ask ONE open question — never two. Don't pitch yet.\n`;
    if (pb.qualifying_questions && pb.qualifying_questions.length) {
      block += `Pick ONE you haven't asked yet from this list (rephrase casually, don't read verbatim):\n`;
      pb.qualifying_questions.slice(0, 5).forEach((q, i) => { block += `  ${i + 1}. ${q}\n`; });
    } else {
      block += `Default move: ask how they currently handle [the problem your product solves]. Keep it concrete.\n`;
    }
  } else if (stage === 'present') {
    block += `You are in PITCH mode. They've shared some context. Now connect ONE value prop to what they just said. Don't list features — name the outcome.\n`;
    if (pb.value_props && pb.value_props.length) {
      block += `Available value props (pick the ONE that matches what they just told you):\n`;
      pb.value_props.slice(0, 5).forEach((v, i) => { block += `  ${i + 1}. ${v}\n`; });
    }
    block += `Then end with a soft question that tees up the close (e.g., "Would something like that move the needle?")\n`;
  } else if (stage === 'close') {
    block += `You are in CLOSE mode. They've shown interest. STOP discovering. ASK FOR THE MEETING this turn — specific times, not "when works for you."\n`;
    const opts = pb.meeting_options || 'Thursday at 2pm or Friday at 10am';
    block += `Use this exact pattern: "I'd love to grab 15 min — does ${opts} work better?"\n`;
    if (pb.booking_link) {
      block += `If they want to self-serve, you can offer: ${pb.booking_link}\n`;
    }
    block += `If they say yes, confirm the time clearly and tell them you'll send a calendar invite.\n`;
  } else if (stage === 'objection') {
    block += `They just raised an objection. DO NOT plow forward — address it first. Acknowledge → reframe → ask one question.\n`;
    if (matchedObjection) {
      block += `Suggested move for this objection (${matchedObjection.label}): "${matchedObjection.response}"\n`;
      block += `You can use that response verbatim OR adapt it to feel natural — but cover the same point.\n`;
    }
  } else if (stage === 'wrap') {
    block += `Call has gone long. WRAP IT UP this turn. Either lock in a meeting time or get permission to follow up via email. No more discovery.\n`;
    const opts = pb.meeting_options || 'tomorrow afternoon';
    block += `Try: "Hey, don't wanna take up more of your time — can we lock in ${opts} for a proper 15 min?"\n`;
  }

  block += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  return block;
}

/** Build system prompt for the AI sales agent */
function buildSystemPrompt(aiConfig: any, leadContext: any, runtime?: { stage?: CallStage; prospectSaid?: string; matchedObjection?: ReturnType<typeof matchObjection> }): string {
  const agentName = aiConfig?.name || 'Alex';
  const role = aiConfig?.role || 'Sales Specialist';
  const brand = aiConfig?.brand || 'Contndr';
  const objective = aiConfig?.objective || 'book_call';
  const playbook: Playbook | undefined = aiConfig?.playbook;
  const stage: CallStage = runtime?.stage || 'qualify';
  const matchedObjection = runtime?.matchedObjection || null;
  const playbookBlock = buildPlaybookBlock(playbook, stage, matchedObjection);

  // ── Agent Profile mode — user-defined instructions take priority ──
  if (aiConfig?.instructions && aiConfig.instructions.trim()) {
    let prompt = `You are ${agentName}, a ${role} at ${aiConfig.business_name || brand}.\n\n`;
    prompt += `CORE INSTRUCTIONS (follow these EXACTLY):\n${aiConfig.instructions}\n\n`;

    if (aiConfig.knowledge_base && aiConfig.knowledge_base.trim()) {
      prompt += `KNOWLEDGE BASE — Use this information to answer questions accurately:\n${aiConfig.knowledge_base}\n\n`;
    }

    if (aiConfig.transfer_rules && aiConfig.transfer_rules.length > 0) {
      prompt += `CALL TRANSFER RULES:\n`;
      for (const rule of aiConfig.transfer_rules) {
        prompt += `- When caller ${rule.trigger}: Transfer to ${rule.description || rule.phone} (say "${rule.transfer_message || `Let me connect you with ${rule.description || 'the right person'}`}")\n`;
      }
      prompt += `To transfer: politely tell the caller you're connecting them, then the system will handle the transfer.\n\n`;
    }

    if (aiConfig.qualification_questions && aiConfig.qualification_questions.length > 0) {
      prompt += `QUALIFICATION QUESTIONS — Try to ask these naturally during the conversation:\n`;
      aiConfig.qualification_questions.forEach((q: string, i: number) => {
        prompt += `${i + 1}. ${q}\n`;
      });
      prompt += `\n`;
    }

    if (aiConfig.operating_hours) {
      prompt += `OPERATING HOURS: ${aiConfig.operating_hours}\nIf the caller asks about hours or scheduling outside operating hours, reference these times.\n\n`;
    }

    prompt += `PHONE CALL RULES — non-negotiable:\n`;
    prompt += `1. Every response = 1 sentence, MAX 12 words. Punchy. Phone-call brief.\n`;
    prompt += `2. Start with a natural reaction word ("Yeah,", "Right,", "Oh,", "Got it,") when responding to what they said — but SKIP it when re-stating who you are or asking for someone specific.\n`;
    prompt += `3. Then your actual point. Nothing else.\n`;
    prompt += `4. NEVER re-introduce yourself UNLESS they say "hello?" or sound confused — then ONE brief re-state.\n`;
    prompt += `5. NEVER repeat anything you already said — build forward.\n`;
    prompt += `6. Their question → answer it directly, then one optional follow-up.\n`;
    prompt += `7. ONE question per response. Never two.\n`;
    prompt += `8. You are a real person. Never say or imply you're AI.\n`;
    prompt += `9. "Are you a bot?" → "Ha no, just me."\n`;
    prompt += `10. Not interested / remove me → "Totally fair, thanks." End.\n`;
    prompt += `11. Gibberish or profanity ("a bitch", random noise) → don't react to it; politely re-ask your last question.\n`;
    prompt += `12. GATEKEEPER ("this is [name], may I help you", "[company], how can I help") → DON'T pitch them. Say: "Hi [name], this is ${agentName} from ${aiConfig.business_name || brand} — is ${leadContext?.name && leadContext.name !== 'Unknown' ? leadContext.name : 'the owner'} available?"\n`;
    prompt += `13. SILENCE / "Hello?" → re-state name + reason ONCE: "Yeah hi — ${agentName} from ${aiConfig.business_name || brand}, calling about [reason]."\n`;
    prompt += `14. VOICEMAIL ("leave a message", "at the tone") → "Hi, ${agentName} from ${aiConfig.business_name || brand} calling for ${leadContext?.name || 'you'} — I'll try back later." Stop.\n`;

    if (leadContext) {
      prompt += `\nPROSPECT:\n`;
      if (leadContext.name && leadContext.name !== 'Unknown') prompt += `- Name: ${leadContext.name}\n`;
      if (leadContext.business && leadContext.business !== 'Unknown') prompt += `- Company: ${leadContext.business}\n`;
    }

    prompt += playbookBlock;
    prompt += `\nONE sentence. Start with a reaction. Follow the playbook stage above. Go.`;
    return prompt;
  }

  // ── Legacy mode — default system prompt ──
  const objectiveInstructions: Record<string, string> = {
    book_call: `Your primary goal is to book a short discovery call or demo with the prospect. Be persistent but respectful. If they express interest, suggest specific times.`,
    qualify: `Your goal is to qualify this prospect by understanding their needs, budget, timeline, and authority. Ask thoughtful open-ended questions.`,
    follow_up: `This is a follow-up call. Reference their previous interaction with ${brand} and gauge continued interest.`,
    intake: `Your goal is to collect intake information from the caller. Be thorough but efficient. Guide them through the intake process step by step.`,
    appointment: `Your goal is to schedule an appointment for the caller. Check availability and confirm the booking details.`,
    support: `Your goal is to help the caller with their question or issue. Be empathetic, patient, and solutions-oriented.`,
  };

  return `You are ${agentName}, a ${role} at ${brand}. You are on a live phone call right now.

HARD RULES — follow exactly:
1. Every response = 1 sentence, MAX 12 words. Punchy. Phone-call brief.
2. Start with a natural reaction word ("Yeah,", "Right,", "Oh,", "Got it,") when responding to what they said. SKIP the reaction word when re-stating who you are or asking for someone specific (rules 12-13 below).
3. Then your actual point. That's it.
4. NEVER re-introduce yourself after your first message UNLESS they say "hello?" or seem confused — then ONE brief re-state.
5. NEVER repeat anything you already said — build forward
6. Direct question from them → answer it first, then (optionally) one follow-up
7. Exactly ONE question per response. Never stack two
8. You are a human, not AI. Never break this.
9. "Are you a bot?" → laugh it off: "Ha, no — just me, I promise."
10. Not interested / remove me → "Totally fair, thanks for your time." Say nothing else.
11. If their reply is gibberish, profanity, or unclear ("a bitch", random noise) → DON'T react to it. Politely re-ask your last question: "Sorry, didn't catch that — ${leadContext?.name ? `is ${leadContext.name} around?` : `is now an okay time?`}"
12. GATEKEEPER / RECEPTIONIST (they say "this is [name], may I help you" or "[company], how can I help") → DO NOT pitch them. Say: "Hi [their name], this is ${agentName} from ${brand} — is ${leadContext?.name && leadContext.name !== 'Unknown' ? leadContext.name : 'the owner'} available?"
13. SILENCE / "Hello?" / "Are you there?" → re-state name + reason ONCE: "Yeah hi — ${agentName} from ${brand}, calling about [reason]." Then your original question again.
14. VOICEMAIL signal ("leave a message", "at the tone") → say "Hi, ${agentName} from ${brand} calling for ${leadContext?.name || 'you'} — I'll try back later." Then stop.
15. RECORDING DISCLOSURE — If on FIRST exchange the prospect asks "is this being recorded?" or "is this a recorded line?", answer truthfully: "Yes, this call may be recorded for quality." Don't volunteer unless asked.
16. ESCALATE — If they ask for a manager / supervisor / "talk to someone in charge", OR if they ask a complex technical/legal/billing question you're not certain about → say "Totally fair, let me connect you with someone who handles that." (System will route to the configured transfer number.)
17. CALLBACK REQUEST — If they say "call me back at [time]" or "I'm busy now, try later" → confirm: "Got it, I'll have us follow up [restate their time]. Talk then!" then end.

GOAL: ${objectiveInstructions[objective] || objectiveInstructions.book_call}

${leadContext?.name && leadContext.name !== 'Unknown' ? `Prospect: ${leadContext.name}${leadContext.business && leadContext.business !== 'Unknown' ? ` at ${leadContext.business}` : ''}` : ''}
${playbookBlock}
ONE sentence. Start with a reaction. Follow the playbook stage above. Go.`;
}

/** Call OpenAI to generate the AI agent's next response */
async function getAIResponse(
  systemPrompt: string,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<string> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set');
    return "Oh sorry, I spaced out for a second there. What were you saying?";
  }
  try {
    const turnCount = conversationHistory.filter(m => m.role === 'user').length;

    // Inject the turn reminder directly into the system prompt (avoids an extra message round-trip)
    const turnReminder = turnCount >= 1
      ? `\n\n[Turn ${turnCount + 1}. You already introduced yourself. DO NOT repeat your pitch. React to what they just said. ONE sentence, 15 words max.]`
      : `\n\n[Turn 1. Your opening was already spoken. You are now responding to their reaction. Keep it SHORT.]`;

    const contextMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt + turnReminder },
      ...conversationHistory,
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: contextMessages,
        // Aggressively tightened to 35 tokens (~10-12 words). Phone-call
        // sales reps are punchy. Shorter response = faster GPT, faster
        // TTS gen, faster playback, less dead air per turn.
        max_tokens: 35,
        temperature: 0.8,
        frequency_penalty: 0.8,
        presence_penalty: 0.3,
      }),
    });
    if (!response.ok) {
      console.error('OpenAI API error:', await response.text());
      return "Sorry, I lost my train of thought for a sec. What were you saying?";
    }
    const d = await response.json();
    let reply = d.choices?.[0]?.message?.content?.trim() || "Sorry, could you say that again?";
    // Strip any accidental AI meta-commentary or stage directions
    reply = reply.replace(/\[.*?\]/g, '').replace(/\(.*?internal.*?\)/gi, '').trim();
    // If reply ends mid-sentence (cut off by max_tokens), add a natural trailing acknowledgement
    if (reply && !reply.match(/[.!?]$/)) reply += '.';
    return reply;
  } catch (err) {
    console.error('OpenAI fetch error:', err);
    return "Hey sorry, the connection got a little fuzzy. Could you repeat that?";
  }
}

/** Play ElevenLabs audio on call via Telnyx playback_start, fallback to Telnyx TTS */
async function telnyxSpeak(callControlId: string, text: string, voiceName?: string, opts?: { highQuality?: boolean }): Promise<TelnyxResult> {
  // ── Fast-exit if we already know this call ended ──
  if (endedCallControlIds.has(callControlId)) {
    console.log(`ℹ️ [telnyxSpeak] Skipping — call ${callControlId} already ended (in-memory).`);
    return CALL_ENDED;
  }
  // Try ElevenLabs first for natural voice quality
  const audioUrl = await elevenLabsTTS(text, voiceName, opts);
  if (audioUrl) {
    try {
      console.log(`🔊 Playing ElevenLabs audio on ${callControlId}. URL: ${audioUrl.substring(0, 50)}...`);
      const r = await telnyxRequest(`/calls/${callControlId}/actions/playback_start`, {
        method: 'POST',
        body: JSON.stringify({
          audio_url: audioUrl,
          client_state: btoa(JSON.stringify({ action: 'ai_speak' })),
        }),
      });
      if (r.ok) return true;
      const errorText = await r.text();
      if (isCallEndedError(errorText, callControlId)) {
        console.log(`ℹ️ Call ${callControlId} ended before playback_start could execute.`);
        return CALL_ENDED;
      }
      console.error('Telnyx playback_start failed:', errorText);
    } catch (err) { console.error('Telnyx playback error:', err); }
  }
  // ── No fallback to Telnyx's built-in TTS ──
  // Telnyx's built-in TTS uses old Amazon Polly voices that sound
  // unmistakably robotic. Falling back to it makes the AI sound worse
  // than not speaking at all and obscures the real failure (ElevenLabs
  // not playing). If we get here, ElevenLabs gen or upload failed —
  // logs above will pinpoint why. Better to drop one response than to
  // train the user that "the AI sounds like a bot."
  console.error(`❌ [telnyxSpeak] ElevenLabs path failed for ${callControlId} — dropping this utterance. Check ❌ logs above for cause.`);
  return false;
}

/** Telnyx gather (listen for speech) via gather_using_speak with a silent prompt.
 *  The bare `gather` action does not activate ASR on Telnyx connections — only
 *  gather_using_speak / gather_using_audio have proven speech recognition support.
 *  We pass a single space as the payload so Telnyx speaks nothing audible, then
 *  immediately opens the ASR window.  client_state 'ai_listen' prevents the
 *  call.speak.ended handler from re-triggering another gather. */
async function telnyxGather(callControlId: string): Promise<TelnyxResult> {
  if (endedCallControlIds.has(callControlId)) {
    console.log(`ℹ️ [telnyxGather] Skipping — call ${callControlId} already ended (in-memory).`);
    return CALL_ENDED;
  }
  try {
    const gatherConfig = {
      payload: 'go ahead',
      voice: 'female',
      language: 'en-US',
      type: 'speech',
      speech_language: 'en-US',
      timeout_millis: 30000,
      end_silence_timeout_millis: 1500,
      client_state: btoa(JSON.stringify({ action: 'ai_listen' })),
    };
    console.log(`👂 [telnyxGather] Starting gather_using_speak (ASR) on ${callControlId}`);

    const r = await telnyxRequest(`/calls/${callControlId}/actions/gather_using_speak`, {
      method: 'POST',
      body: JSON.stringify(gatherConfig),
    });

    if (!r.ok) {
      const errorText = await r.text();
      if (isCallEndedError(errorText, callControlId)) {
        console.log(`ℹ️ Call ${callControlId} ended before gather_using_speak could execute.`);
        return CALL_ENDED;
      }
      console.error(`❌ [telnyxGather] gather_using_speak FAILED for ${callControlId}:`, errorText);
      return false;
    }

    const responseData = await r.json();
    console.log(`✅ [telnyxGather] gather_using_speak SUCCESS for ${callControlId}. Response:`, JSON.stringify(responseData));
    return true;
  } catch (err) {
    console.error(`❌ [telnyxGather] EXCEPTION for ${callControlId}:`, err);
    return false;
  }
}

/** Play ElevenLabs audio + gather speech via Telnyx gather_using_audio, fallback chain */
async function telnyxGatherUsingSpeak(callControlId: string, text: string, voiceName?: string): Promise<TelnyxResult> {
  // ── Fast-exit if we already know this call ended ──
  if (endedCallControlIds.has(callControlId)) {
    console.log(`ℹ️ [telnyxGatherUsingSpeak] Skipping — call ${callControlId} already ended (in-memory).`);
    return CALL_ENDED;
  }
  // Try ElevenLabs audio + gather_using_audio
  const audioUrl = await elevenLabsTTS(text, voiceName);
  if (audioUrl) {
    try {
      console.log(`🔊👂 ElevenLabs audio ready for gather on ${callControlId}. URL: ${audioUrl.substring(0, 50)}...`);
      const r = await telnyxRequest(`/calls/${callControlId}/actions/gather_using_audio`, {
        method: 'POST',
        body: JSON.stringify({
          audio_url: audioUrl,
          type: 'speech',
          speech_language: 'en-US',
          timeout_millis: 30000,
          end_silence_timeout_millis: 1500,
          client_state: btoa(JSON.stringify({ action: 'ai_speak_and_listen' })),
        }),
      });
      if (r.ok) return true;
      const errorText = await r.text();
      if (isCallEndedError(errorText, callControlId)) {
        console.log(`ℹ️ Call ${callControlId} ended before gather_using_audio could execute.`);
        return CALL_ENDED;
      }
      console.error('Telnyx gather_using_audio failed:', errorText);
    } catch (err) { console.error('Telnyx gather_using_audio error:', err); }
  }
  // ── Re-check before fallback (call might have ended during TTS generation) ──
  if (endedCallControlIds.has(callControlId)) {
    console.log(`ℹ️ [telnyxGatherUsingSpeak] Skipping fallback — call ${callControlId} ended during TTS.`);
    return CALL_ENDED;
  }
  // Fallback: Telnyx built-in TTS + gather_using_speak
  console.log(`⚠️ Falling back to Telnyx TTS gather_using_speak for ${callControlId}`);
  try {
    const r = await telnyxRequest(`/calls/${callControlId}/actions/gather_using_speak`, {
      method: 'POST',
      body: JSON.stringify({
        payload: text, voice: 'female', language: 'en-US',
        type: 'speech', speech_language: 'en-US',
        timeout_millis: 30000, end_silence_timeout_millis: 1500,
        client_state: btoa(JSON.stringify({ action: 'ai_speak_and_listen' })),
      }),
    });
    if (!r.ok) { 
      const errorText = await r.text();
      if (isCallEndedError(errorText, callControlId)) {
        console.log(`ℹ️ Call ${callControlId} ended before gather_using_speak could execute.`);
        return CALL_ENDED;
      }
      console.error('Telnyx gather_using_speak fallback failed:', errorText); 
      return false; 
    }
    return true;
  } catch (err) { console.error('Telnyx gather_using_speak fallback error:', err); return false; }
}

/** Start real-time streaming transcription on a call.
 *  Unlike gather-based ASR, this runs CONTINUOUSLY and fires call.transcription
 *  webhook events with partial/final transcripts. Much more reliable than gather. */
async function telnyxTranscriptionStart(callControlId: string): Promise<TelnyxResult> {
  if (endedCallControlIds.has(callControlId)) {
    return CALL_ENDED;
  }
  try {
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/make-server-a8b2511f/telnyx/webhooks/call-status`;
    console.log(`🎙️ [TRANSCRIPTION] Starting streaming transcription for ${callControlId}`);
    console.log(`🎙️ [TRANSCRIPTION] Webhook URL: ${webhookUrl}`);
    const txConfig = {
      language: 'en',
      interim_results: false,
      transcription_engine: 'B',
      // CRITICAL: 'inbound' only. Previously was 'both' which made Telnyx
      // transcribe the AI's own outgoing speech and route it back as user
      // input — the AI would hear its own questions and respond to itself.
      // Even with the echo filter, partial AI utterances slipped through
      // and corrupted the conversation. Only the prospect side gets
      // transcribed now.
      transcription_tracks: 'inbound',
      command_id: `tx_${Date.now()}`,
    };
    console.log(`🎙️ [TRANSCRIPTION] Config:`, JSON.stringify(txConfig));
    const r = await telnyxRequest(`/calls/${callControlId}/actions/transcription_start`, {
      method: 'POST',
      body: JSON.stringify(txConfig),
    });
    if (r.ok) {
      const responseData = await r.json();
      console.log(`✅ [TRANSCRIPTION] Started — response:`, JSON.stringify(responseData));
      return true;
    }
    const errorText = await r.text();
    if (isCallEndedError(errorText, callControlId)) {
      return CALL_ENDED;
    }
    console.error(`❌ [TRANSCRIPTION] Start failed:`, errorText);
    return false;
  } catch (err) {
    console.error(`❌ [TRANSCRIPTION] Start error:`, err);
    return false;
  }
}

// POST /telnyx/webhooks/call-status - Handle call status webhooks
app.post('/webhooks/call-status', async (c) => {
  try {
    const body = await c.req.json();
    const { data } = body;

    const eventType = data?.event_type;
    const callControlId = data?.payload?.call_control_id;

    // ── SYNC log (visible in Supabase Dashboard even with waitUntil) ──
    console.log(`📞 [WEBHOOK RECV] ${eventType} | cid=${callControlId}`);

    // ── Early mark: register hangup in in-memory set ASAP ──
    // This ensures any concurrent background tasks for the same call skip fast.
    if ((eventType === 'call.hangup' || eventType === 'call.hangup.completed') && callControlId) {
      endedCallControlIds.add(callControlId);
    }

    // ── PROCESS ASYNC using EdgeRuntime.waitUntil to prevent Telnyx timeouts ──
    EdgeRuntime.waitUntil((async () => {
      try {
        console.log('📞 ========================================');
        console.log('📞 Telnyx webhook BACKGROUND processing:', eventType, callControlId);
        if (eventType === 'call.playback.ended' || eventType === 'call.speak.ended' || eventType === 'call.gather.ended' || eventType === 'call.transcription') {
          console.log('📞 🔍 CRITICAL EVENT - Full event data:', JSON.stringify(data, null, 2));
        }
        console.log('📞 ========================================');

        // ── Listener call handling (supervisor mode) ──
    if (eventType === 'call.answered' && callControlId) {
      const listenerRecord = await kv.get(`listener:${callControlId}`);
      if (listenerRecord && listenerRecord.status === 'dialing') {
        console.log(`🎧 Listener answered! Adding to conference ${listenerRecord.conference_name}`);
        // Small delay to let the call fully establish before joining conference
        await new Promise(r => setTimeout(r, 800));
        try {
          // Use 'barge' role with mute=true so listener can hear both sides but can't speak
          const cr = await telnyxRequest(`/calls/${callControlId}/actions/join_conference`, {
            method: 'POST',
            body: JSON.stringify({
              name: listenerRecord.conference_name,
              beep_enabled: 'never', start_conference_on_enter: false,
              end_conference_on_exit: false, supervisor_role: 'barge',
              mute: true, hold: false
            })
          });
          if (cr.ok) {
            console.log(`✅ Listener successfully joined conference ${listenerRecord.conference_name}`);
            await kv.set(`listener:${callControlId}`, { ...listenerRecord, status: 'monitoring', joined_at: new Date().toISOString() });
          } else {
            const errText = await cr.text();
            if (isCallEndedError(errText, callControlId)) {
              console.log(`ℹ️ Listener call ${callControlId} ended before joining conference.`);
              return;
            }
            console.error('Failed to add listener to conference:', errText);
            // Fallback: try without supervisor_role, just muted participant
            const cr2 = await telnyxRequest(`/calls/${callControlId}/actions/join_conference`, {
              method: 'POST',
              body: JSON.stringify({
                name: listenerRecord.conference_name,
                beep_enabled: 'never', start_conference_on_enter: false,
                end_conference_on_exit: false, mute: true
              })
            });
            if (cr2.ok) {
              console.log(`✅ Listener joined conference (fallback, no supervisor_role)`);
              await kv.set(`listener:${callControlId}`, { ...listenerRecord, status: 'monitoring', joined_at: new Date().toISOString() });
            } else {
              const errText2 = await cr2.text();
              if (!errText2.includes('"90018"') && !errText2.includes('Call has already ended')) {
                console.error('Fallback conference join also failed:', errText2);
              }
            }
          }
        } catch (err) { console.error('Listener conference error:', err); }
      }
    }

    // ── Find matching call record — fast O(1) reverse-index lookup ──
    let call: any = null;
    if (callControlId) {
      const directCallId = await kv.get(`call_by_telnyx:${callControlId}`);
      if (directCallId) {
        call = await kv.get(`call:${directCallId}`);
      }
      if (!call) {
        // Fallback: linear scan (handles calls created before the reverse index was added)
        const calls = await kv.getByPrefixLimited('call:', 1000, 0);
        call = calls.find((c: any) => c.telnyx_call_id === callControlId);
      }
    }

    if (call) {
      // ── Map event to status ──
      let mappedStatus = call.status;
      switch (eventType) {
        case 'call.initiated': mappedStatus = 'initiated'; break;
        case 'call.ringing': mappedStatus = 'ringing'; break;
        case 'call.answered': mappedStatus = 'answered'; break;
        case 'call.bridged': mappedStatus = 'answered'; break;
        case 'call.speak.started': mappedStatus = 'speaking'; break;
        case 'call.speak.ended': mappedStatus = 'listening'; break;
        case 'call.playback.started': mappedStatus = 'speaking'; break;
        case 'call.playback.ended': mappedStatus = 'listening'; break;
        case 'call.gather.ended': mappedStatus = 'processing'; break;
        case 'call.transcription': break; // no status change — transcription events are continuous
        case 'call.hangup':
        case 'call.hangup.completed': {
          // If the call hung up without ever being answered, it's a no-answer
          // (busy, rejected, ring-timeout, etc.). Telnyx's hangup_cause field
          // is reliable for this — see https://developers.telnyx.com/docs/voice/programmable-voice/call-control-events
          const hangupCause = String(data.payload?.hangup_cause || data.payload?.hangup_source || '').toLowerCase();
          const wasAnswered = !!call.answered_at || ['answered','speaking','listening','processing','voicemail'].includes(call.status);
          if (!wasAnswered) {
            if (hangupCause.includes('busy')) mappedStatus = 'busy';
            else mappedStatus = 'no-answer';
          } else {
            mappedStatus = 'ended';
          }
          break;
        }
        case 'call.machine.detection.ended':
          mappedStatus = data.payload?.result === 'machine' ? 'voicemail' : 'answered'; break;
        case 'call.machine.greeting.ended': mappedStatus = 'voicemail'; break;
        default:
          console.log(`⚠️ Unknown event: ${eventType}, keeping: ${call.status}`);
          mappedStatus = call.status;
      }

      const updatedCall: any = { ...call, status: mappedStatus, last_event: eventType, updated_at: new Date().toISOString() };
      if (mappedStatus === 'ended' || mappedStatus === 'completed') updatedCall.ended_at = new Date().toISOString();
      // Mark the moment the prospect picked up so the dashboard can count
      // "connected" calls reliably (status flips through many intermediate
      // values — speaking/listening/processing/ended — so a single boolean
      // here is the simplest source of truth).
      if (eventType === 'call.answered' || eventType === 'call.bridged') {
        if (!call.answered_at) updatedCall.answered_at = new Date().toISOString();
      }
      await kv.set(`call:${call.id}`, updatedCall);
      console.log(`✅ Call ${call.id}: ${eventType} → ${mappedStatus}`);

      // ── Deduct AI credits when call ends ──
      if ((mappedStatus === 'ended' || mappedStatus === 'completed') && call.started_at) {
        try {
          const durationMs = new Date(updatedCall.ended_at || Date.now()).getTime() - new Date(call.started_at).getTime();
          const durationMin = durationMs / 60000;
          // Only deduct if call was at least 5 seconds (avoids charging for failed/instant hangups)
          if (durationMin >= 0.08) {
            // Determine user from campaign or call context
            const callUserId = call.user_id || call.ai_config?.user_id;
            if (callUserId) {
              const { deductCredits } = await import('./ai-credits.tsx');
              await deductCredits(callUserId, durationMin, {
                call_id: call.id,
                campaign_id: call.campaign_id,
                lead_name: call.lead_name,
              });
              console.log(`💳 Deducted ${Math.ceil(durationMin)} credit(s) for call ${call.id} (${durationMin.toFixed(1)} min)`);
            }
          }
        } catch (creditErr) {
          console.error('💳 Credit deduction error (non-fatal):', creditErr);
        }
      }

      // ══════════════════════════════════════════════════════════════════
      //  AI CONVERSATION FLOW — only for calls with ai_config
      // ══════════════════════════════════════════════════════════════════
      if (call.ai_config && callControlId) {
        console.log(`🤖 [AI FLOW] Processing ${eventType} for AI-enabled call ${call.id}`);
        const convKey = `ai_conv:${call.id}`;

        // ── Resolve ElevenLabs Agent config (Pro plan) ──
        if (call.ai_config.elevenlabs_agent_id && !call.ai_config._agent_resolved) {
          try {
            const elApiKey = Deno.env.get('ELEVENLABS_API_KEY');
            if (elApiKey) {
              const agentRes = await fetch(
                `https://api.elevenlabs.io/v1/convai/agents/${call.ai_config.elevenlabs_agent_id}`,
                { headers: { 'xi-api-key': elApiKey } }
              );
              if (agentRes.ok) {
                const agent = await agentRes.json();
                const agentPrompt = agent.conversation_config?.agent?.prompt?.prompt;
                const agentFirstMsg = agent.conversation_config?.agent?.first_message;
                const agentVoiceId = agent.conversation_config?.tts?.voice_id;
                if (agentPrompt) call.ai_config.instructions = agentPrompt;
                if (agentFirstMsg) call.ai_config.opening_line = agentFirstMsg;
                if (agentVoiceId) call.ai_config.voice_id = agentVoiceId;
                call.ai_config._agent_resolved = true;
                await kv.set(`call:${call.id}`, { ...call, ai_config: call.ai_config });
                console.log(`🤖 Resolved ElevenLabs agent "${agent.name}" for call ${call.id}`);
              } else {
                console.warn(`⚠️ Could not fetch ElevenLabs agent ${call.ai_config.elevenlabs_agent_id}: ${agentRes.status}`);
              }
            }
          } catch (agentErr) {
            console.error('⚠️ Agent resolution error (non-fatal):', agentErr);
          }
        }

        // Resolve voice: prefer voice_id (raw ElevenLabs ID) → voice (named key) → default
        const voiceName = call.ai_config.voice_id || call.ai_config.voice || DEFAULT_VOICE;

        // Opening line: use pre-baked value from call record (set at initiation time)
        const resolvedOpening = call.ai_config.opening_line || call.ai_config._opening_line || (() => {
          const name = call.ai_config.name || 'Alex';
          const brand = call.ai_config.brand || 'Contndr';
          return `Hey there! This is ${name} over at ${brand}. I was hoping to catch you for just a sec — is now an okay time?`;
        })();

        // ── Shared helper: speak opening line + start streaming transcription ──
        // Uses telnyxSpeak for audio, then starts transcription_start for continuous ASR.
        // The transcription runs for the entire call and fires call.transcription events.
        const speakOpeningLine = async () => {
          console.log(`🤖 Speaking opening line for ${call.id} (voice: ${voiceName}): "${resolvedOpening.substring(0, 60)}..."`);
          await kv.set(convKey, { history: [{ role: 'assistant', content: resolvedOpening }], turn_count: 0, created_at: new Date().toISOString() });

          await new Promise(r => setTimeout(r, 800));

          // Start streaming transcription FIRST so it's ready when user speaks
          const txResult = await telnyxTranscriptionStart(callControlId);
          console.log(`🎙️ Transcription start result for ${call.id}: ${txResult}`);

          // Initialize transcription state for this call
          transcriptionState.set(callControlId, {
            buffer: '',
            lastPartialAt: Date.now(),
            isSpeaking: false,
            silenceTimer: null,
          });

          // Opening line uses the high-quality multilingual_v2 model — first
          // impressions matter most. Subsequent turns drop to turbo_v2_5 for
          // faster response time.
          const speakResult = await telnyxSpeak(callControlId, resolvedOpening, voiceName, { highQuality: true });
          if (speakResult === CALL_ENDED) {
            console.log(`ℹ️ Call ${call.id} ended before opening line could be spoken.`);
          } else if (!speakResult) {
            console.error(`❌ Failed to speak opening line for ${call.id} — all TTS paths failed`);
          } else {
            console.log(`✅ Opening line speaking + transcription active for ${call.id}`);
          }
        };

        // ① CALL ANSWERED → speak opening line immediately
        if (eventType === 'call.answered') {
          await speakOpeningLine();
        }

        // ① (AMD safety net) HUMAN CONFIRMED → speak opening if not already spoken
        // This fires when answering_machine_detection was enabled on the call.
        // Current calls don't use AMD, but this handles legacy/manual AMD cases.
        if (eventType === 'call.machine.detection.ended') {
          const amdResult = data.payload?.result;
          console.log(`🤖 AMD result for ${call.id}: ${amdResult}`);
          if (amdResult === 'human' || amdResult === 'not_sure') {
            const existingConv = await kv.get(convKey);
            if (!existingConv) {
              // call.answered fired but opening wasn't spoken (AMD conflict) — speak now
              await speakOpeningLine();
            }
          } else if (amdResult === 'machine_end' || amdResult === 'machine') {
            console.log(`🤖 Voicemail detected for ${call.id}, hanging up`);
            try { await telnyxRequest(`/calls/${callControlId}/actions/hangup`, { method: 'POST', body: '{}' }); } catch {}
          }
        }

        // ② SPEAK / PLAYBACK ENDED → release KV lock so transcription handler knows AI is done
        if (eventType === 'call.speak.ended' || eventType === 'call.playback.ended') {
          console.log(`🤖 ${eventType} for ${call.id} — releasing AI lock, ready to hear user`);
          await releaseAILock(callControlId);
        }

        // ③ TRANSCRIPTION → process real-time speech from streaming transcription
        if (eventType === 'call.transcription') {
          const transcriptionData = data.payload?.transcription_data;
          const isFinal = transcriptionData?.is_final ?? data.payload?.is_final ?? false;
          // Telnyx actually puts the track name in `transcription_track`, not
          // `track`. Reading the wrong field meant our outbound-filter
          // never fired and the AI's own speech got fed back as input.
          const track = transcriptionData?.transcription_track
            || transcriptionData?.track
            || data.payload?.transcription_track
            || data.payload?.track
            || 'unknown';
          const confidence = transcriptionData?.confidence ?? -1;
          const transcript = (
            transcriptionData?.transcript
            || data.payload?.transcript
            || data.payload?.transcription
            || ''
          ).toString().trim();

          console.log(`🎙️ [TX] ${isFinal ? 'FINAL' : 'partial'} track=${track} conf=${confidence} "${transcript}" | ${call.id}`);

          // Defensive: drop outbound-track transcripts (= AI's own audio
          // being transcribed). Belt-and-suspenders on top of the
          // transcription_tracks: 'inbound' config above.
          if (track === 'outbound') {
            console.log(`🎙️ [TX] Dropping outbound-track transcript (AI's own audio): "${transcript.substring(0, 40)}"`);
            return;
          }

          if (!transcript) {
            // skip empty
          } else if (!isFinal) {
            // skip partial
          } else {
            // ── Check dedup + lock in parallel (NOT conv — read conv fresh after lock) ──
            const txHash = transcript.toLowerCase().trim().substring(0, 60).replace(/\s+/g, '_');
            const dedupKey = `tx_dedup:${callControlId}:${txHash}`;
            const lockKey = `ai_lock:${callControlId}`;

            const [dedupVal, lockVal] = await Promise.all([
              kv.get(dedupKey),
              kv.get(lockKey),
            ]);

            if (dedupVal) {
              console.log(`🎙️ [TX] Duplicate, skipping: "${transcript.substring(0, 40)}"`);
              return;
            }

            // ── Barge-in support ──
            // Previous behaviour: if the AI was speaking, we DROPPED the user's
            // transcript entirely. That made the AI feel deaf to anything the
            // user said over its own audio — including short answers like
            // "yes" or "I don't have one" to a yes/no question, which is the
            // most natural way humans reply on a phone call.
            //
            // New behaviour: if the user speaks during AI playback, stop the
            // AI's playback mid-sentence (Telnyx playback_stop), release the
            // lock, then process the user's input as their turn. This is
            // what humans do — pause and listen when someone interrupts.
            //
            // We only barge-in on utterances that look like real speech
            // (>=2 chars after trimming). Single-syllable bleed ("uh", "a")
            // shouldn't kill an AI sentence.
            if (lockVal && (Date.now() - lockVal) < 30000) {
              const meaningful = transcript.replace(/[^a-z0-9 ]/gi, '').trim();
              if (meaningful.length >= 2) {
                console.log(`🎙️ [TX] User barge-in (lock=${Date.now() - lockVal}ms) — stopping AI playback to listen: "${transcript.substring(0, 40)}"`);
                // Fire-and-forget playback_stop; even if it fails, releasing
                // the lock + processing the turn is the right move.
                try {
                  await telnyxRequest(`/calls/${callControlId}/actions/playback_stop`, {
                    method: 'POST',
                    body: JSON.stringify({}),
                  });
                } catch (stopErr) {
                  console.warn('[TX] playback_stop failed (non-fatal):', stopErr);
                }
                await releaseAILock(callControlId);
                // fall through into normal processing below
              } else {
                console.log(`🎙️ [TX] Ignoring sub-2-char utterance during AI speech: "${transcript}"`);
                return;
              }
            }

            // Acquire lock + mark dedup (parallel writes)
            await Promise.all([
              kv.set(dedupKey, Date.now()),
              kv.set(lockKey, Date.now()),
            ]);

            try {
              const prospectSaid = transcript;
              console.log(`🤖 [TX] "${prospectSaid}"`);

              // Read conv FRESH after lock acquisition — prevents stale data from concurrent instances
              const conv = await kv.get(convKey) || { history: [], turn_count: 0 };
              const turnCount = (conv.turn_count || 0) + 1;

              // ── Echo filter: skip if transcript matches what AI just said ──
              const recentAI = (conv.history || []).filter((h: any) => h.role === 'assistant').slice(-2).map((h: any) => h.content as string);
              const normalizedTranscript = prospectSaid.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
              const isEcho = recentAI.some(aiMsg => {
                const normalizedAI = aiMsg.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
                // If transcript is 80%+ overlap with AI utterance, it's echo
                return normalizedAI.includes(normalizedTranscript) ||
                  (normalizedTranscript.length > 10 && normalizedAI.startsWith(normalizedTranscript.substring(0, 20)));
              });
              if (isEcho) {
                console.log(`🎙️ [TX] Echo detected (matches AI utterance), skipping: "${prospectSaid.substring(0, 40)}"`);
                await releaseAILock(callControlId);
                return;
              }

              // ── IVR / voicemail / hold-message filter ──
              // Phone systems and voicemails get transcribed as if the lead
              // were speaking. Detect them so the AI doesn't pitch a robot
              // for 15 turns (real bug observed in production).
              const IVR_PHRASES = [
                // Hold / transfer
                'please hold', 'thank you for holding', 'thank you for calling',
                'your call is important', 'all of our representatives',
                'all our representatives', 'one moment please', 'please stay on the line',
                'direct your call', 'transferring your call', 'connecting you',
                'please listen carefully', 'our menu options', 'in the order',
                // Voicemail prompts
                'leave a message after', 'at the tone', 'after the beep',
                'please leave your', "we'll get back to you",
                'we are sorry', 'we’re sorry', "we're sorry",
                'no one available', 'no one is available', 'unable to take your call',
                'unable to come to', 'cannot come to', "can't come to the phone",
                'record your message', 'press star', 'press the pound',
                'press 1 to', 'press 2 to', 'press 3 to', 'press # to', 'press * to',
                'press any digit', 'press any key',
                // Voicemail end states
                'message saved', 'your message has been', 'mailbox is full',
                'thank you, goodbye', 'recording complete',
              ];
              const lowerProspect = prospectSaid.toLowerCase().trim();
              const looksLikeIVR = IVR_PHRASES.some(p => lowerProspect.includes(p));

              // Pure transcription noise: very short utterance with no real
              // content. "Beep", "Beep beep beep.", "Born.", etc. — these
              // are usually ASR picking up audio artifacts from a voicemail
              // line. We treat them like IVR (silent skip + count toward
              // hangup heuristic below).
              const NOISE_TOKENS = ['beep', 'ring', 'click', 'dial tone', 'hum', 'static', 'born'];
              const wordCount = lowerProspect.split(/\s+/).filter(Boolean).length;
              const allWordsAreNoise = wordCount > 0 && lowerProspect
                .replace(/[^a-z\s]/g, '')
                .split(/\s+/)
                .filter(Boolean)
                .every(w => NOISE_TOKENS.includes(w));
              const tooShortToBeReal = wordCount <= 1 && lowerProspect.length < 5;
              const looksLikeNoise = allWordsAreNoise || tooShortToBeReal;

              if (looksLikeIVR || looksLikeNoise) {
                // Track consecutive IVR/noise turns. If we see 2+ in a row
                // we're almost certainly on a voicemail loop — leave a one-
                // line message and hang up instead of continuing to pitch.
                conv._ivr_streak = (conv._ivr_streak || 0) + 1;
                await kv.set(convKey, conv);
                console.log(`🎙️ [TX] IVR/noise detected (streak=${conv._ivr_streak}), staying silent: "${prospectSaid.substring(0, 60)}"`);

                if (conv._ivr_streak >= 2) {
                  // Voicemail loop confirmed — leave message + hangup
                  console.log(`🎙️ [TX] Voicemail loop detected (${conv._ivr_streak} consecutive IVR turns). Leaving message and hanging up.`);
                  try {
                    const agentName = call.ai_config?.name || 'Alex';
                    const brand = call.ai_config?.business_name || call.ai_config?.brand || 'Contndr';
                    const leadName = call.lead_name || call.ai_config?.lead_name || '';
                    const vmMsg = leadName
                      ? `Hi ${leadName}, this is ${agentName} from ${brand}, I'll try you back later. Thanks.`
                      : `Hi, this is ${agentName} from ${brand}, I'll try back later. Thanks.`;
                    await telnyxSpeak(callControlId, vmMsg);
                    conv.history.push({ role: 'assistant', content: vmMsg });
                    conv.outcome = 'voicemail';
                    await kv.set(convKey, conv);
                    // Hang up shortly after the message finishes
                    setTimeout(() => {
                      telnyxRequest(`/calls/${callControlId}/actions/hangup`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
                    }, 4000);
                  } catch (e) {
                    console.warn('[TX] voicemail-hangup error:', (e as any)?.message);
                  }
                }

                await releaseAILock(callControlId);
                return;
              }

              // Real speech — reset the IVR streak counter
              if (conv._ivr_streak) {
                conv._ivr_streak = 0;
              }

              conv.history.push({ role: 'user', content: prospectSaid });

              // End signals — split into HARD (auto-hangup) vs SOFT (let the LLM handle).
              //
              // Old behavior auto-hung-up on "not interested" / "no thanks" — which
              // killed calls where the prospect was just venting, frustrated, or
              // testing the AI. The prospect would then say "actually yes" but
              // the hangup timer had already fired and the call was gone.
              //
              // Now: only hang up on explicit removal requests. Casual no's get a
              // graceful soft response but the call stays open in case they
              // change their mind.
              const lower = prospectSaid.toLowerCase();
              const HARD_END_PHRASES = ['take me off', "don't call", 'stop calling', 'remove me', 'hang up', 'leave me alone'];
              const isHardEnd = HARD_END_PHRASES.some(s => lower.includes(s));
              if (isHardEnd) {
                const bye = "No worries — I'll take you off the list. Have a great day!";
                conv.history.push({ role: 'assistant', content: bye });
                await kv.set(convKey, { ...conv, turn_count: turnCount, ended_reason: 'hard_end' });
                await telnyxSpeak(callControlId, bye, voiceName);
                setTimeout(async () => { try { await telnyxRequest(`/calls/${callControlId}/actions/hangup`, { method: 'POST', body: '{}' }); } catch {} }, 5000);
                return;
              }
              // For SOFT no's, just let the playbook flow into the objection-handler
              // stage and the LLM will respond with a follow-up question or
              // graceful close. No auto-hangup.

              // Max turns
              const maxTurns = call.ai_config?.max_turns || 12;
              if (turnCount >= maxTurns) {
                const wrap = "Hey listen, I don't wanna take up too much more of your time. Let me send over a quick email with the details and we can go from there. Sound good?";
                conv.history.push({ role: 'assistant', content: wrap });
                await kv.set(convKey, { ...conv, turn_count: turnCount, ended_reason: 'max_turns' });
                await telnyxSpeak(callControlId, wrap, voiceName);
                setTimeout(async () => { try { await telnyxRequest(`/calls/${callControlId}/actions/hangup`, { method: 'POST', body: '{}' }); } catch {} }, 10000);
                return;
              }

              // Note: we experimented with a parallel "backchannel" sound
              // ("Mhm,"/"Got it,") played while the LLM generated the real
              // response. It caused a stacked-acknowledgement effect because
              // the LLM is already prompted to start every response with a
              // reaction word — the user heard "Got it, ... Hmm, understood!"
              // which felt like the AI was talking to itself. Removed.
              // Lower latency is now handled purely by faster model + tighter
              // tokens; the LLM's first word IS the acknowledgement.

              // ── Sales playbook: detect current stage + matching objection ──
              // The playbook drives WHAT the AI should say this turn (qualify
              // vs pitch vs close vs handle-objection) on top of the agent's
              // voice/persona prompt. Buying signals fast-forward to the
              // close stage; objection keywords pull a pre-written counter.
              const stage = detectStage(turnCount, prospectSaid, conv.stage);
              const matchedObjection = stage === 'objection'
                ? matchObjection(prospectSaid, call.ai_config?.playbook?.objections)
                : null;
              console.log(`🎯 [PLAYBOOK] turn=${turnCount} stage=${stage}${matchedObjection ? ` objection=${matchedObjection.label}` : ''}`);

              // Generate AI response
              console.log(`🤖 Generating AI response for ${call.id}, turn ${turnCount}, prospect said: "${prospectSaid}"`);
              const systemPrompt = buildSystemPrompt(call.ai_config, {
                name: call.lead_name || call.ai_config?.lead_name,
                business: call.business_name || call.ai_config?.business_name,
              }, { stage, prospectSaid, matchedObjection });
              const aiResponse = await getAIResponse(systemPrompt, conv.history);
              conv.history.push({ role: 'assistant', content: aiResponse });
              await kv.set(convKey, { ...conv, turn_count: turnCount, stage });
              console.log(`🤖 AI turn ${turnCount}: "${aiResponse}"`);

              // ── Check if AI wants to trigger a transfer ──
              const transferRules = call.ai_config?.transfer_rules || [];
              let shouldTransfer = false;
              let transferTarget: any = null;

              if (transferRules.length > 0) {
                const lowerResponse = aiResponse.toLowerCase();
                for (const rule of transferRules) {
                  const triggerLower = (rule.trigger || '').toLowerCase();
                  if (triggerLower && (lower.includes(triggerLower) || lowerResponse.includes('transfer') || lowerResponse.includes('connect you'))) {
                    shouldTransfer = true;
                    transferTarget = rule;
                    break;
                  }
                }
              }

              if (shouldTransfer && transferTarget?.phone) {
                const transferMsg = transferTarget.transfer_message || aiResponse;
                await telnyxSpeak(callControlId, transferMsg, voiceName);
                setTimeout(async () => {
                  let transferOk = false;
                  try {
                    console.log(`🔀 Transferring call ${call.id} to ${transferTarget.phone}`);
                    await telnyxRequest(`/calls/${callControlId}/actions/transfer`, {
                      method: 'POST',
                      body: JSON.stringify({ to: formatToE164(transferTarget.phone) }),
                    });
                    conv.history.push({ role: 'system', content: `[Call transferred to ${transferTarget.description || transferTarget.phone}]` });
                    await kv.set(convKey, { ...conv, turn_count: turnCount, transferred_to: transferTarget.phone });
                    transferOk = true;

                    // Stamp the transfer onto the call record itself so
                    // the admin AI Calls panel and per-call timeline can
                    // surface it. Stays on the same row that already
                    // tracks duration, outcome, etc.
                    try {
                      const callRecord: any = await kv.get(`call:${call.id}`);
                      if (callRecord) {
                        callRecord.transfer = {
                          to: transferTarget.phone,
                          label: transferTarget.description || transferTarget.phone,
                          transferred_at: new Date().toISOString(),
                          trigger: transferTarget.trigger || null,
                        };
                        callRecord.updated_at = new Date().toISOString();
                        await kv.set(`call:${call.id}`, callRecord);
                      }
                    } catch { /* best-effort */ }
                  } catch (transferErr) {
                    console.error('Transfer failed:', transferErr);
                  }

                  // Audit-log the event regardless of outcome — both
                  // successful and failed transfer attempts are useful
                  // signal for "did the AI route my caller correctly".
                  try {
                    const { recordAuditEvent } = await import('./audit-log.tsx');
                    await recordAuditEvent({
                      // Hono context not in scope here — synthesize minimal
                      // shape the helper actually reads (get + req.header).
                      get: (k: string) => k === 'userId'
                        ? (call.user_id || call.ai_config?.user_id)
                        : null,
                      req: { header: () => null },
                    } as any, {
                      action: transferOk ? 'ai_call.transfer' : 'ai_call.transfer_failed',
                      resource: 'ai_call',
                      resourceId: call.id,
                      metadata: {
                        to: transferTarget.phone,
                        label: transferTarget.description || null,
                        trigger: transferTarget.trigger || null,
                        lead_phone: call.to_number || null,
                      },
                    });
                  } catch (auditErr) {
                    console.warn('[AUDIT] transfer audit log failed:', auditErr);
                  }
                }, 6000);
                return;
              }

              // Speak AI response — lock is held until call.speak.ended / call.playback.ended
              console.log(`🤖 Speaking response for ${call.id}: "${aiResponse.substring(0, 80)}..." (voice: ${voiceName})`);
              const speakResult = await telnyxSpeak(callControlId, aiResponse, voiceName);
              if (speakResult === CALL_ENDED) {
                console.log(`ℹ️ Call ${call.id} ended — not speaking response.`);
                await releaseAILock(callControlId);
              } else if (!speakResult) {
                console.error(`❌ TTS failed for ${call.id} — releasing lock`);
                await releaseAILock(callControlId);
              }
              // If speak succeeded, lock is released by call.speak.ended / call.playback.ended
            } catch (txErr) {
              console.error(`❌ Error processing transcript for ${call.id}:`, txErr);
              await releaseAILock(callControlId);
            }
          }
        }

        // ③b GATHER ENDED → fallback handler (kept for any legacy gather calls)
        if (eventType === 'call.gather.ended') {
          console.log(`🤖 [GATHER FALLBACK] Gather ended for ${call.id} — transcription flow is primary`);
          console.log(`🤖 [GATHER FALLBACK] Full payload:`, JSON.stringify(data.payload));
        }

        // ④ CALL ENDED → finalize conversation log + mark in-memory + cleanup
        if (eventType === 'call.hangup' || eventType === 'call.hangup.completed') {
          endedCallControlIds.add(callControlId);
          transcriptionState.delete(callControlId);
          // Release KV locks (best-effort, may already be cleared)
          releaseAILock(callControlId).catch(() => {});
          const conv = await kv.get(convKey);
          if (conv) {
            console.log(`🤖 AI call ${call.id} ended. ${conv.history?.length || 0} messages.`);
            await kv.set(convKey, { ...conv, completed_at: new Date().toISOString() });

            // Intelligent transcript-based outcome classification.
            // Fire-and-forget so hangup webhook stays fast — the result
            // lands on the call record + drives the campaign-row chip.
            classifyCallOutcome(call, conv.history || []).catch((e) => {
              console.warn(`[CLASSIFY] failed for ${call.id}:`, e?.message);
            });
          }

          // Native push fanout — let the user know the call wrapped.
          // Best-effort; web notifications are still primary via realtime.
          const ownerId = call.user_id || call.ai_config?.user_id;
          if (ownerId) {
            const leadLabel = call.lead_name || call.business_name || call.to_number || 'a lead';
            const outcome = call.outcome || (call.transfer ? 'transferred' : 'ended');
            (async () => {
              try {
                const { sendNativePush } = await import('./native-push.tsx');
                await sendNativePush(ownerId, {
                  title: '📞 AI call completed',
                  body: `${leadLabel} — ${outcome}`,
                  data: { type: 'ai_call_completed', call_id: call.id, lead_id: call.lead_id || null },
                });
              } catch (err) {
                console.warn('[NATIVE-PUSH] call-end fanout failed:', (err as any)?.message);
              }
            })();
            (async () => {
              try {
                const { broadcastRealtime } = await import('./realtime-broadcast.tsx');
                await broadcastRealtime({
                  channel: `contndr:${ownerId}`,
                  type: 'call:completed',
                  payload: { userId: ownerId, leadName: leadLabel, outcome, callId: call.id, leadId: call.lead_id || null },
                });
              } catch (err) {
                console.warn('[REALTIME] call-end broadcast failed:', (err as any)?.message);
              }
            })();
          }
        }
      } else if (call) {
        // Call exists but doesn't have ai_config - this is expected for non-AI calls
        console.log(`ℹ️ Call ${call.id} does not have ai_config - skipping AI conversation flow for ${eventType}`);
      }
    } else {
      console.log(`⚠️ No call record found for call_control_id: ${callControlId}`);
    }

        console.log(`✅ Telnyx webhook background processing complete for ${eventType}`);
      } catch (bgErr: any) {
        console.error('❌ Background webhook processing error:', bgErr?.message || bgErr);
      }
    })());

    // ── Return 200 IMMEDIATELY ──
    return c.json({ success: true });
  } catch (err: any) {
    console.error('❌ Webhook parsing error:', err?.message || err);
    // Always return 200 to Telnyx even on error
    return c.json({ success: true, error: err?.message });
  }
});

// GET /telnyx/tts-stream — Streaming ElevenLabs proxy for Telnyx playback_start.
// Eliminates upload-to-storage + signed-URL overhead (~700ms savings per turn).
// Telnyx calls this URL and starts playing audio as ElevenLabs streams it.
app.get('/tts-stream', async (c) => {
  const text = c.req.query('text');
  const voice = c.req.query('voice') || DEFAULT_VOICE;
  const token = c.req.query('t');
  const expectedToken = Deno.env.get('TTS_STREAM_TOKEN');

  if (!text) return c.json({ error: 'Missing text' }, 400);
  // Token check (skip if env var not set, for backwards compat during rollout)
  if (expectedToken && token !== expectedToken) return c.json({ error: 'Unauthorized' }, 401);

  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  if (!apiKey) return c.json({ error: 'ElevenLabs not configured' }, 500);

  let voiceId: string;
  if (voice.length > 15) {
    voiceId = voice;
  } else {
    voiceId = ELEVENLABS_VOICES[voice.toLowerCase()] || ELEVENLABS_VOICES[DEFAULT_VOICE];
  }

  try {
    const elevenResp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify({
          text: decodeURIComponent(text),
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.45, similarity_boost: 0.78, style: 0.08, use_speaker_boost: false },
          output_format: 'mp3_44100_32',
        }),
      }
    );

    if (!elevenResp.ok || !elevenResp.body) {
      return c.json({ error: 'ElevenLabs TTS failed' }, 502);
    }

    // Stream audio bytes directly to Telnyx — no storage upload needed
    return new Response(elevenResp.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('TTS stream error:', err);
    return c.json({ error: 'TTS stream failed' }, 500);
  }
});

// GET /telnyx/active-calls - Get currently active calls (scoped to the requesting user)
app.get('/active-calls', async (c) => {
  try {
    console.log('📞 [Active Calls] Starting request...');

    // ── Authenticate + scope to this user ──
    // Previously this endpoint returned every call in the KV store across all
    // tenants — both a privacy leak (one user's lead names visible to others)
    // and a correctness bug (stats showed someone else's totals or zero when
    // the scan limit skipped the caller's calls).
    const accessToken = c.req.header('Authorization')?.split(' ')[1] || '';
    const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { user, error: authError } = await (await import('./auth-helpers.tsx')).authGetUser(supabaseAuth, accessToken, 'TELNYX-ACTIVE-CALLS');
    if (authError || !user) {
      return c.json({ success: false, error: 'Unauthorized', calls: [], stats: { activeNow:0, totalToday:0, connected:0, voicemail:0, noAnswer:0, booked:0, avgDuration:0 } }, 401);
    }
    const userId = user.id;

    // Get all calls from KV — then filter to this user. We scan up to 5000
    // recent call records; older entries don't affect today's stats anyway.
    const allCallsRaw = await kv.getByPrefixLimited('call:', 5000, 0);
    const allCalls = allCallsRaw.filter((c: any) => c && typeof c === 'object' && (c.user_id === userId || c.ai_config?.user_id === userId));
    // getByPrefix returns values directly
    const now = Date.now();

    // ── Stale-call cleanup ──
    // Calls can get stuck "live" in KV if the call.hangup webhook never
    // fires (network drop, ElevenLabs Convai calls that bypass our
    // webhook, abandoned dev calls, etc.). Any call older than 10 min
    // still showing as in-progress is almost certainly dead. Mark it
    // ended in KV AND exclude it from the active list. Best-effort
    // writes — we don't await them so the dashboard response stays fast.
    const STALE_LIVE_AGE_MS = 10 * 60 * 1000;
    const IN_PROGRESS_STATUSES = ['initiated', 'ringing', 'answered', 'active', 'speaking', 'listening', 'processing'];
    for (const c of allCalls) {
      if (!c || typeof c !== 'object') continue;
      if (!IN_PROGRESS_STATUSES.includes(c.status)) continue;
      const startedMs = c.started_at ? new Date(c.started_at).getTime() : 0;
      if (!startedMs || (now - startedMs) <= STALE_LIVE_AGE_MS) continue;
      console.log(`📞 [Active Calls] Cleaning up stale ${c.status} call ${c.id} (age: ${Math.round((now - startedMs) / 60000)}min)`);
      c.status = 'ended';
      if (!c.ended_at) c.ended_at = new Date(startedMs + STALE_LIVE_AGE_MS).toISOString();
      c.cleanup_reason = 'stale_no_hangup_webhook';
      kv.set(`call:${c.id}`, c).catch(() => {});
    }

    // Helper used by both the live-calls list and the stats below to keep
    // test traffic out of the dashboard. Defined here (before the stats
    // block uses it) so we can reference it in both places.
    //
    // NOTE: agent-hot- campaigns are REAL production traffic (Agent Mode
    // auto-creates them when a hot visitor lands on the marketing site).
    // They used to be excluded here which made Today/Connected/Voicemail/
    // No Answer/Booked all show zero even when hot calls fired — leaving
    // admins confused about whether anything was actually happening.
    // Only exclude calls explicitly marked _test_call:true or test-call-
    // campaign IDs.
    const isTestCallEntry = (c: any) => {
      if (!c) return false;
      if (c._test_call === true) return true;
      const cid = String(c.campaign_id || '');
      return cid.startsWith('test-call-');
    };

    const activeCalls = allCalls
      .filter(c => {
        if (!c || typeof c !== 'object') return false;
        if (isTestCallEntry(c)) return false; // hide test calls from the live list too
        return ['initiated', 'ringing', 'answered', 'active', 'speaking', 'listening'].includes(c.status);
      })
      .map(c => {
        try {
          // Calculate duration in seconds
          const startTime = c.started_at ? new Date(c.started_at).getTime() : now;
          const duration = Math.floor((now - startTime) / 1000);
          
          return {
            id: c.id,
            leadName: c.lead_name || 'Unknown',
            businessName: c.business_name || c.lead_name || 'Unknown Business',
            phone: c.to_number || '',
            status: c.call_status || 'active',
            duration: duration >= 0 ? duration : 0,
            aiName: c.ai_name || c.ai_config?.name || 'AI Assistant',
            brand: c.brand || 'roadr',
            startedAt: c.started_at || new Date().toISOString()
          };
        } catch (mapError) {
          console.error(`❌ [Active Calls] Error mapping call ${c.id}:`, mapError);
          return null;
        }
      })
      .filter(Boolean); // Remove any nulls from mapping errors

    console.log(`📞 [Active Calls] Active calls after filtering: ${activeCalls.length}`);

    // Calculate "today" stats — use a rolling 24-hour window instead of
    // since-UTC-midnight. UTC midnight cuts off real activity for users
    // east of UTC (e.g. Eastern Time: 8 PM EDT = UTC midnight, so a call
    // made at 2 PM gets booted to "yesterday" 6 hours later). Rolling 24h
    // matches the way users actually think about "today's calls".
    const todayTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Exclude test/auto-generated calls from the dashboard stats (same
    // helper used above for the live-calls list). Testing the AI caller
    // shouldn't pollute production counters.
    const todayCalls = allCalls.filter(c =>
      c && c.started_at && c.started_at >= todayTimestamp && !isTestCallEntry(c)
    );

    // ── Connected = the prospect actually picked up at any point ──
    // We use `answered_at` (set by the webhook on call.answered) as the
    // authoritative signal because `status` flips through many values
    // (speaking/listening/processing/ended) during the call lifecycle and
    // ends at 'ended' rather than 'connected'. Falling back to status
    // checks keeps legacy records that predate the answered_at field.
    const isConnected = (c: any) => !!c.answered_at
      || ['answered', 'speaking', 'listening', 'processing', 'completed', 'ended', 'voicemail'].includes(c.status);

    // Avg duration over completed calls today (in seconds)
    const completedToday = todayCalls.filter(c => c.ended_at && c.started_at);
    const totalDurationSec = completedToday.reduce((sum: number, c: any) => {
      const d = (new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()) / 1000;
      return sum + Math.max(0, d);
    }, 0);
    const avgDuration = completedToday.length > 0 ? Math.round(totalDurationSec / completedToday.length) : 0;

    const stats = {
      activeNow: activeCalls.length,
      totalToday: todayCalls.length,
      connected: todayCalls.filter(isConnected).length,
      voicemail: todayCalls.filter(c => c.status === 'voicemail').length,
      noAnswer: todayCalls.filter(c => c.status === 'no-answer' || c.status === 'busy').length,
      booked: todayCalls.filter(c => c.outcome === 'booked' || c.booked === true).length,
      avgDuration,
    };

    console.log('📞 [Active Calls] Stats calculated:', stats);
    console.log('📞 [Active Calls] Done');

    return c.json({
      success: true,
      calls: activeCalls,
      stats
    });
  } catch (error) {
    console.error('❌ [Active Calls] ERROR:', error);
    console.error('❌ [Active Calls] Error message:', error?.message);
    console.error('❌ [Active Calls] Error stack:', error?.stack);
    
    // Return a valid error response
    return c.json({ 
      success: false, 
      error: error?.message || 'Unknown error occurred',
      calls: [],
      stats: {
        activeNow: 0,
        totalToday: 0,
        connected: 0,
        voicemail: 0,
        noAnswer: 0,
        booked: 0,
        avgDuration: 0
      }
    }, 500);
  }
});

// POST /telnyx/numbers/cleanup-duplicates - Remove duplicate phone numbers
app.post('/numbers/cleanup-duplicates', async (c) => {
  try {
    // Get all numbers from KV store with their keys
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );
    
    const { data: allEntries, error } = await supabase
      .from('kv_store_a8b2511f')
      .select('key, value')
      .like('key', 'telnyx:number:%');
    
    if (error) {
      throw new Error(error.message);
    }

    console.log(`🔍 Found ${allEntries.length} total number entries`);

    // Group by telnyx_number_id to find duplicates
    const numbersByTelnyxId = new Map();
    
    for (const entry of allEntries) {
      const telnyxId = entry.value.telnyx_number_id;
      if (!telnyxId) continue;
      
      if (!numbersByTelnyxId.has(telnyxId)) {
        numbersByTelnyxId.set(telnyxId, []);
      }
      numbersByTelnyxId.get(telnyxId).push({
        key: entry.key,
        value: entry.value
      });
    }

    // Find and remove duplicates (keep the oldest one)
    let deletedCount = 0;
    const keysToDelete = [];

    for (const [telnyxId, entries] of numbersByTelnyxId) {
      if (entries.length > 1) {
        console.log(`🔄 Found ${entries.length} duplicates for Telnyx ID ${telnyxId}`);
        
        // Sort by created_at to keep the oldest
        entries.sort((a, b) => 
          new Date(a.value.created_at).getTime() - new Date(b.value.created_at).getTime()
        );
        
        // Keep the first (oldest), delete the rest
        const toDelete = entries.slice(1);
        console.log(`🗑️  Keeping ${entries[0].key}, deleting ${toDelete.length} duplicates`);
        
        for (const dup of toDelete) {
          keysToDelete.push(dup.key);
          deletedCount++;
        }
      }
    }

    // Delete all duplicates
    if (keysToDelete.length > 0) {
      await kv.mdel(keysToDelete);
      console.log(`✅ Deleted ${deletedCount} duplicate phone numbers`);
    } else {
      console.log(`✅ No duplicates found`);
    }

    return c.json({
      success: true,
      message: `Cleaned up ${deletedCount} duplicates`,
      deleted: deletedCount,
      remaining: allEntries.length - deletedCount
    });
  } catch (error) {
    console.error('Error cleaning up duplicates:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /telnyx/calls/:callId/hangup - End an active call
app.post('/calls/:callId/hangup', async (c) => {
  try {
    const callId = c.req.param('callId');
    
    // Get the call record to find the Telnyx call_control_id
    const call = await kv.get(`call:${callId}`);
    
    if (!call) {
      return c.json({ success: false, error: 'Call not found' }, 404);
    }
    
    if (!call.telnyx_call_id) {
      return c.json({ success: false, error: 'Call does not have a Telnyx call control ID' }, 400);
    }
    
    console.log(`📞 Hanging up call ${callId} (Telnyx ID: ${call.telnyx_call_id})`);
    
    // Send hangup command to Telnyx
    const response = await telnyxRequest(`/calls/${call.telnyx_call_id}/actions/hangup`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    
    // Update call status in database regardless of Telnyx response
    // (The call might have already ended, which is fine)
    const updatedCall = {
      ...call,
      status: 'ended',
      ended_at: new Date().toISOString()
    };
    await kv.set(`call:${callId}`, updatedCall);
    
    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = errorData.errors?.[0]?.detail || errorData.errors?.[0]?.title || 'Failed to hang up call';
      
      // If the call is already ended on Telnyx side, that's actually fine
      if (errorMessage.includes('no longer active') || errorMessage.includes('not found')) {
        console.log(`✅ Call ${callId} was already ended on Telnyx side, updated local status`);
        return c.json({
          success: true,
          message: 'Call was already ended',
          already_ended: true
        });
      }
      
      console.error('❌ Telnyx hangup error:', errorMessage);
      throw new Error(errorMessage);
    }
    
    console.log(`✅ Call ${callId} ended successfully`);
    
    return c.json({
      success: true,
      message: 'Call ended successfully'
    });
  } catch (error) {
    console.error('Error hanging up call:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /telnyx/calls/:callId/transfer - Transfer call to human
app.post('/calls/:callId/transfer', async (c) => {
  try {
    const callId = c.req.param('callId');
    const { transfer_number } = await c.req.json();
    
    if (!transfer_number) {
      return c.json({ success: false, error: 'transfer_number is required' }, 400);
    }
    
    // Get the call record
    const call = await kv.get(`call:${callId}`);
    
    if (!call) {
      return c.json({ success: false, error: 'Call not found' }, 404);
    }
    
    if (!call.telnyx_call_id) {
      return c.json({ success: false, error: 'Call does not have a Telnyx call control ID' }, 400);
    }
    
    console.log(`📞 Transferring call ${callId} to ${transfer_number}`);
    
    // Send transfer command to Telnyx
    const response = await telnyxRequest(`/calls/${call.telnyx_call_id}/actions/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        to: transfer_number
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.errors?.[0]?.detail || 'Failed to transfer call');
    }
    
    // Update call status
    const updatedCall = {
      ...call,
      status: 'transferred',
      transferred_to: transfer_number,
      transferred_at: new Date().toISOString()
    };
    await kv.set(`call:${callId}`, updatedCall);
    
    console.log(`✅ Call ${callId} transferred successfully to ${transfer_number}`);
    
    return c.json({
      success: true,
      message: 'Call transferred successfully',
      transferred_to: transfer_number
    });
  } catch (error) {
    console.error('Error transferring call:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /telnyx/calls/:callId/listen - Join call as silent listener (supervisor mode)
app.post('/calls/:callId/listen', async (c) => {
  try {
    const callId = c.req.param('callId');
    const { listen_number } = await c.req.json();
    
    if (!listen_number) {
      return c.json({ success: false, error: 'listen_number (your phone number) is required' }, 400);
    }
    
    // Get the call record
    const call = await kv.get(`call:${callId}`);
    
    if (!call) {
      return c.json({ success: false, error: 'Call not found' }, 404);
    }
    
    if (!call.telnyx_call_id) {
      return c.json({ success: false, error: 'Call does not have a Telnyx call control ID' }, 400);
    }
    
    // Check if call is still active in our system
    if (call.status === 'completed' || call.status === 'ended') {
      return c.json({ 
        success: false, 
        error: 'Call has already ended. The AI call completed before you could join.',
        call_ended: true 
      }, 400);
    }
    
    console.log(`👂 Setting up conference bridge for call ${callId}`);
    console.log(`📞 Call status: ${call.status}, Telnyx ID: ${call.telnyx_call_id}`);
    console.log(`📞 Listener number: ${listen_number}`);
    
    // Create a unique conference name for this call
    const conferenceName = `monitor-${callId}`;
    
    // Step 1: Verify the call still exists on Telnyx by trying to retrieve it
    console.log(`🔍 Verifying call ${call.telnyx_call_id} still exists on Telnyx...`);
    const callCheckResponse = await telnyxRequest(`/calls/${call.telnyx_call_id}`);
    
    if (!callCheckResponse.ok) {
      const errorData = await callCheckResponse.json();
      const errorDetail = errorData.errors?.[0]?.detail || '';
      const errorCode = errorData.errors?.[0]?.code || '';
      
      console.error(`❌ Call verification failed:`, errorData);
      
      if (errorDetail.includes('not found') || errorDetail.includes('could not be found') || errorCode === '90015') {
        // Update our local call status
        await kv.set(`call:${callId}`, {
          ...call,
          status: 'ended',
          ended_at: new Date().toISOString()
        });
        
        return c.json({ 
          success: false, 
          error: 'Call has already ended. The AI call completed too quickly.',
          call_ended: true 
        }, 400);
      }
      
      throw new Error(errorDetail || 'Failed to verify call status');
    }
    
    const callData = await callCheckResponse.json();
    console.log(`🔍 Telnyx call data:`, JSON.stringify(callData, null, 2));
    
    // Telnyx API returns call state, not status
    const callState = callData.data?.state || callData.data?.status;
    
    console.log(`✅ Call verified on Telnyx. State: ${callState}`);
    
    // If we can't determine the state, but the call exists and our status says it's active, proceed
    if (!callState) {
      console.log(`⚠️ Could not determine call state from Telnyx, but call exists. Proceeding based on our status: ${call.status}`);
      // Just proceed - if the call doesn't exist, the conference join will fail with a clear error
    } else {
      // Check if the call is in a state that can be conferenced
      // Telnyx call states: 'answered', 'ringing', 'parked', 'bridging', etc.
      const activeStates = ['answered', 'active', 'bridging', 'parked'];
      if (!activeStates.includes(callState)) {
        return c.json({ 
          success: false, 
          error: `Call is in "${callState}" state and cannot be joined yet. Try again in a moment.`,
          call_ended: callState === 'hangup' || callState === 'completed'
        }, 400);
      }
    }
    
    // Step 2: Join the active call to a conference using the proper conference API
    console.log(`📞 Step 1: Joining active call ${call.telnyx_call_id} to conference ${conferenceName}`);
    const conferenceResponse = await telnyxRequest(`/calls/${call.telnyx_call_id}/actions/join_conference`, {
      method: 'POST',
      body: JSON.stringify({
        name: conferenceName,
        beep_enabled: 'never',
        start_conference_on_enter: true,
        end_conference_on_exit: false
      })
    });
    
    if (!conferenceResponse.ok) {
      const errorData = await conferenceResponse.json();
      console.error('Failed to join conference:', errorData);
      
      // Check if the call has already ended - this is a race condition that's okay
      const errorDetail = errorData.errors?.[0]?.detail || '';
      const errorCode = errorData.errors?.[0]?.code || '';
      
      const callEndedOnTelnyx =
        errorDetail.includes('no longer active') ||
        errorDetail.includes('already ended') ||
        errorDetail.includes('not found') ||
        errorDetail.includes('could not be found') ||
        errorCode === '90018' ||
        errorCode === '90015';

      if (callEndedOnTelnyx) {
        console.log(`⚠️ Call ${callId} ended before we could set up listening - this is normal`);
        return c.json({
          success: false,
          error: 'Call has already ended. The AI call completed before you could join.',
          call_ended: true
        }, 400);
      }

      throw new Error(errorDetail || 'Failed to join conference');
    }
    
    console.log(`�� Active call joined conference ${conferenceName}`);
    
    // Step 3: Dial the listener's phone number  
    const formattedListenNumber = formatToE164(listen_number);
    const formattedFromNumber = formatToE164(call.from_number || Deno.env.get('TELNYX_DEFAULT_NUMBER') || '+18445511596');
    
    console.log(`📞 Step 2: Dialing listener at ${formattedListenNumber} from ${formattedFromNumber}`);
    const listenConnectionId = await getTelnyxConnectionId();
    const dialResponse = await telnyxRequest('/calls', {
      method: 'POST',
      body: JSON.stringify({
        connection_id: listenConnectionId || Deno.env.get('TELNYX_CONNECTION_ID'),
        to: formattedListenNumber,
        from: formattedFromNumber,
        webhook_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/make-server-a8b2511f/telnyx/webhooks/call-status`,
        webhook_url_method: 'POST'
      })
    });
    
    if (!dialResponse.ok) {
      const errorData = await dialResponse.json();
      console.error('Failed to dial listener:', errorData);
      throw new Error(errorData.errors?.[0]?.detail || 'Failed to dial listener');
    }
    
    const dialData = await dialResponse.json();
    const listenerCallId = dialData.data.call_control_id;
    
    console.log(`✅ Dialing listener, call control ID: ${listenerCallId}`);
    
    // Step 4: Store the listener call info so we can add them to conference when they answer
    const listenerRecord = {
      call_id: callId,
      listener_call_id: listenerCallId,
      listener_number: listen_number,
      conference_name: conferenceName,
      created_at: new Date().toISOString(),
      status: 'dialing'
    };
    
    await kv.set(`listener:${listenerCallId}`, listenerRecord);
    
    // Update the original call record
    const updatedCall = {
      ...call,
      conference_name: conferenceName,
      monitoring: true,
      monitor_number: listen_number,
      monitor_started_at: new Date().toISOString()
    };
    await kv.set(`call:${callId}`, updatedCall);
    
    console.log(`✅ Conference bridge setup complete. Waiting for listener to answer...`);
    
    return c.json({
      success: true,
      message: `We're calling ${listen_number} now. Answer to join the live call.`,
      conference_name: conferenceName,
      listener_call_id: listenerCallId,
      instructions: 'You will be connected as a silent listener. The lead and AI cannot hear you.'
    });
  } catch (error) {
    console.error('Error setting up call listening:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Intelligent call outcome classifier.
 *
 * Reads the prospect's actual words from the conversation history and
 * uses an LLM to bucket the call into one of:
 *   booked      — explicit "let's schedule", "send me a calendar invite"
 *   positive    — clearly interested, asked qualifying questions
 *   engaged     — neutral but conversational, multiple exchanges
 *   answered    — picked up but minimal engagement (1-2 short replies)
 *   no_interest — explicit decline, "not interested", "remove me"
 *   voicemail   — only voicemail/IVR text, no human speech
 *   no_answer   — call wasn't picked up at all
 *
 * Stores the verdict on the call record at:
 *   call.transcript_outcome
 *   call.transcript_outcome_score   (0-100, confidence)
 *   call.transcript_outcome_reason  (one-line human-readable rationale)
 *
 * The /ai-call-campaigns enrichment prefers this field over the raw
 * status/outcome heuristic when present.
 */
export async function classifyCallOutcome(call: any, history: any[]): Promise<void> {
  if (!call?.id) return;

  const userTurns: string[] = (history || [])
    .filter((t: any) => t?.role === 'user' && t?.content)
    .map((t: any) => String(t.content).trim())
    .filter(Boolean);

  // Heuristic shortcuts so we don't spend OpenAI tokens on obvious cases.
  if (call.status === 'no-answer' || call.status === 'busy') {
    await persistOutcome(call, { outcome: 'no_answer', score: 100, reason: 'Call did not connect.' });
    return;
  }
  if (call.outcome === 'voicemail' || userTurns.length === 0) {
    await persistOutcome(call, { outcome: 'voicemail', score: 95, reason: userTurns.length === 0 ? 'No prospect speech captured.' : 'Marked voicemail.' });
    return;
  }

  const transcript = (history || [])
    .filter((t: any) => t?.role !== 'system')
    .map((t: any) => `${t.role === 'assistant' ? 'AI' : 'Lead'}: ${String(t.content).trim()}`)
    .join('\n')
    .slice(0, 5000);

  try {
    const { generateAI } = await import('./ai-provider.tsx');
    const sysPrompt = `You are an expert SDR call analyst. Read this outbound AI call transcript and return one JSON object with EXACTLY these fields:

  outcome        — one of: booked, positive, engaged, answered, no_interest, voicemail
  score          — 0-100 confidence in the outcome label
  reason         — ONE short sentence justifying the outcome
  summary        — ONE sentence describing what happened on the call (for the user reading at a glance)
  next_action    — ONE concrete action the rep should take ("Send pricing PDF and Calendly link", "Call back Tuesday 2pm", "Mark do-not-call", etc.)
  budget         — extracted budget if mentioned (e.g. "$50k/mo", "tight budget"), or null
  timeline       — extracted timeline if mentioned (e.g. "Q3", "this quarter", "evaluating now"), or null
  decision_maker — who decides if mentioned (e.g. "her partner", "CFO", "she decides"), or null
  objections     — array of objections raised (e.g. ["price", "already using competitor"]), or []
  callback_request — ISO datetime if prospect requested a callback ("call me at 3pm Tuesday"), else null
  quality_score  — 0-100 how well the AI agent performed (asked qualifying questions, sounded natural, didn't push too hard)
  quality_notes  — ONE sentence on what the AI did well / poorly

Return STRICT JSON only. No prose, no markdown fences.`;

    const ai = await generateAI({
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: `Transcript:\n${transcript}` },
      ],
      temperature: 0.2,
      maxTokens: 500,
      jsonMode: true,
    });

    const raw = (ai.text || '').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);
    const outcome = String(parsed.outcome || 'answered').toLowerCase();
    const valid = ['booked', 'positive', 'engaged', 'answered', 'no_interest', 'voicemail'];
    const safe = valid.includes(outcome) ? outcome : 'answered';

    await persistOutcome(call, {
      outcome: safe,
      score: Math.max(0, Math.min(100, Number(parsed.score) || 50)),
      reason: String(parsed.reason || '').slice(0, 200),
      summary: String(parsed.summary || '').slice(0, 300),
      next_action: String(parsed.next_action || '').slice(0, 200),
      budget: parsed.budget || null,
      timeline: parsed.timeline || null,
      decision_maker: parsed.decision_maker || null,
      objections: Array.isArray(parsed.objections) ? parsed.objections.slice(0, 6) : [],
      callback_request: parsed.callback_request || null,
      quality_score: Math.max(0, Math.min(100, Number(parsed.quality_score) || 50)),
      quality_notes: String(parsed.quality_notes || '').slice(0, 200),
    });

    // CRM write-back: stamp extracted fields onto the lead record
    if (call.lead_id) {
      await writeAnalysisToLead(call.lead_id, {
        budget: parsed.budget,
        timeline: parsed.timeline,
        decision_maker: parsed.decision_maker,
        objections: parsed.objections,
        callback_request: parsed.callback_request,
        last_call_summary: String(parsed.summary || '').slice(0, 300),
      }).catch((e) => console.warn('[CLASSIFY] lead write-back failed:', e?.message));
    }

    // Auto follow-up email for hot outcomes (booked / positive / engaged)
    if (['booked', 'positive', 'engaged'].includes(safe)) {
      const ownerId = call.user_id || call.ai_config?.user_id;
      if (ownerId) {
        sendCallFollowupEmail(ownerId, call, {
          summary: String(parsed.summary || ''),
          next_action: String(parsed.next_action || ''),
          outcome: safe,
        }).catch((e) => console.warn('[CLASSIFY] follow-up email failed:', e?.message));
      }
    }
  } catch (e: any) {
    console.warn(`[CLASSIFY] LLM failed for ${call.id}, defaulting to heuristic:`, e?.message);
    const guess = userTurns.length >= 4 ? 'engaged' : 'answered';
    await persistOutcome(call, { outcome: guess, score: 40, reason: 'LLM unavailable — heuristic from turn count.' });
  }
}

async function persistOutcome(call: any, fields: Record<string, any>): Promise<void> {
  try {
    const fresh = (await kv.get(`call:${call.id}`)) || call;
    fresh.transcript_outcome = fields.outcome;
    fresh.transcript_outcome_score = fields.score;
    fresh.transcript_outcome_reason = fields.reason;
    if (fields.summary !== undefined)        fresh.transcript_summary        = fields.summary;
    if (fields.next_action !== undefined)    fresh.transcript_next_action    = fields.next_action;
    if (fields.budget !== undefined)         fresh.extracted_budget          = fields.budget;
    if (fields.timeline !== undefined)       fresh.extracted_timeline        = fields.timeline;
    if (fields.decision_maker !== undefined) fresh.extracted_decision_maker  = fields.decision_maker;
    if (fields.objections !== undefined)     fresh.extracted_objections      = fields.objections;
    if (fields.callback_request !== undefined) fresh.extracted_callback_at   = fields.callback_request;
    if (fields.quality_score !== undefined)  fresh.ai_quality_score          = fields.quality_score;
    if (fields.quality_notes !== undefined)  fresh.ai_quality_notes          = fields.quality_notes;
    fresh.transcript_classified_at = new Date().toISOString();
    await kv.set(`call:${call.id}`, fresh);
    console.log(`🎯 [CLASSIFY] ${call.id} → ${fields.outcome} (${fields.score})${fields.next_action ? ` · next: ${fields.next_action}` : ''}`);
  } catch (e: any) {
    console.warn(`[CLASSIFY] persist failed for ${call.id}:`, e?.message);
  }
}

/**
 * Write extracted CRM fields back to the lead record.
 * Updates both Postgres `leads` table and the KV `lead:<id>` cache so
 * the CRM UI reflects new info from the call immediately.
 */
async function writeAnalysisToLead(leadId: string, fields: Record<string, any>): Promise<void> {
  try {
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const updates: Record<string, any> = { last_activity_at: new Date().toISOString() };
    // These columns may not all exist; we update what does via best-effort.
    if (fields.budget)         updates.budget         = String(fields.budget).slice(0, 100);
    if (fields.timeline)       updates.timeline       = String(fields.timeline).slice(0, 100);
    if (fields.decision_maker) updates.decision_maker = String(fields.decision_maker).slice(0, 200);
    if (fields.last_call_summary) updates.last_call_summary = fields.last_call_summary;
    await supabase.from('leads').update(updates).eq('id', leadId);

    // Update KV cache too
    const lead: any = await kv.get(`lead:${leadId}`);
    if (lead) {
      Object.assign(lead, updates);
      if (fields.objections) lead.objections = fields.objections;
      if (fields.callback_request) lead.callback_request_at = fields.callback_request;
      await kv.set(`lead:${leadId}`, lead);
    }
    console.log(`📝 [CLASSIFY] lead ${leadId} enriched with call data`);
  } catch (e: any) {
    console.warn(`[CLASSIFY] writeAnalysisToLead error:`, e?.message);
  }
}

/**
 * Auto follow-up email after positive/engaged/booked call. Best-effort;
 * silently no-ops if the user has no email provider configured or no
 * lead email on file. Includes a one-paragraph recap + next-step CTA.
 */
async function sendCallFollowupEmail(userId: string, call: any, analysis: { summary: string; next_action: string; outcome: string }): Promise<void> {
  try {
    const leadId = call.lead_id;
    if (!leadId) return;
    const lead: any = await kv.get(`lead:${leadId}`);
    const toEmail = lead?.email;
    if (!toEmail) {
      console.log(`[FOLLOWUP] No email on lead ${leadId}, skipping`);
      return;
    }
    // Skip if a follow-up was sent in the last 24h for this lead+call
    const dedupKey = `followup_sent:${userId}:${leadId}:${call.id}`;
    if (await kv.get(dedupKey)) return;

    const { sendEmail } = await import('./email-sender.tsx');
    const fromName = call.ai_config?.name || 'Alex';
    const brand = call.ai_config?.business_name || call.ai_config?.brand || 'Contndr';
    const leadName = (lead.contact_name || lead.name || '').split(' ')[0] || 'there';
    const calendlyUrl = (await kv.get(`pipeline:${userId}:calendly_config`) as any)?.url || '';

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#222">
        <p>Hi ${leadName},</p>
        <p>Thanks for the chat just now — quick recap:</p>
        <p style="background:#f5f5f5;padding:12px;border-radius:8px;margin:16px 0;line-height:1.5">${escapeHtml(analysis.summary)}</p>
        ${analysis.next_action ? `<p>Next step: ${escapeHtml(analysis.next_action)}</p>` : ''}
        ${calendlyUrl ? `<p style="margin:20px 0"><a href="${calendlyUrl}" style="display:inline-block;padding:10px 18px;background:#1ED4A7;color:#000;text-decoration:none;border-radius:8px;font-weight:600">Book a time</a></p>` : ''}
        <p>Talk soon,<br>${fromName} · ${brand}</p>
      </div>
    `;
    const text = `Hi ${leadName},\n\nThanks for the chat. Quick recap:\n\n${analysis.summary}\n\n${analysis.next_action ? `Next step: ${analysis.next_action}\n\n` : ''}${calendlyUrl ? `Book a time: ${calendlyUrl}\n\n` : ''}Talk soon,\n${fromName} · ${brand}`;

    await sendEmail(userId, {
      to: toEmail,
      from: `${fromName} <noreply@contndr.com>`,
      subject: `Quick recap from our call`,
      html,
      text,
    });
    await kv.set(dedupKey, { sent_at: new Date().toISOString() });
    console.log(`📧 [FOLLOWUP] Sent recap to ${toEmail} for call ${call.id}`);
  } catch (e: any) {
    console.warn(`[FOLLOWUP] sendCallFollowupEmail error:`, e?.message);
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

export default app;

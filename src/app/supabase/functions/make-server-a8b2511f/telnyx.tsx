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
        // ⚠️ DO NOT enable answering_machine_detection — it starts Telnyx's own internal
        // gather that conflicts with our gather_using_audio/gather_using_speak commands,
        // causing Telnyx to silently reject our audio actions and the call to be completely
        // silent. The AI agent handles silence/timeouts naturally via its own gather loop.
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

// Idempotently ensure the voice audio bucket exists
let bucketReady = false;
async function ensureVoiceBucket() {
  if (bucketReady) return;
  try {
    const { data: buckets } = await supabaseVoice.storage.listBuckets();
    const exists = buckets?.some((b: any) => b.name === VOICE_BUCKET);
    if (!exists) {
      await supabaseVoice.storage.createBucket(VOICE_BUCKET, { public: false });
      console.log(`✅ Created storage bucket: ${VOICE_BUCKET}`);
    }
    bucketReady = true;
  } catch (err) {
    console.error('⚠️ Bucket check error (non-fatal):', err);
    bucketReady = true; // Don't block calls if bucket already exists
  }
}

/** Generate speech audio via ElevenLabs and return a signed URL */
async function elevenLabsTTS(text: string, voiceName?: string): Promise<string | null> {
  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  if (!apiKey) {
    console.error('❌ ELEVENLABS_API_KEY not set');
    return null;
  }

  // Resolve voice ID: accept raw ElevenLabs IDs, named keys, or fallback
  let voiceId: string;
  if (voiceName && voiceName.length > 15) {
    // Looks like a raw ElevenLabs voice ID (e.g. "SAz9YHcvj6GT2YYXdXww")
    voiceId = voiceName;
  } else {
    voiceId = ELEVENLABS_VOICES[(voiceName || DEFAULT_VOICE).toLowerCase()] || ELEVENLABS_VOICES[DEFAULT_VOICE];
  }

  try {
    console.log(`🎙️ ElevenLabs TTS: "${text.substring(0, 80)}..." (voice: ${voiceName || DEFAULT_VOICE}, id: ${voiceId})`);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5', // Low-latency, available on all paid plans
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.82,
            style: 0.4,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ ElevenLabs API error (${response.status}):`, errText);
      return null;
    }

    const audioBuffer = await response.arrayBuffer();
    const audioBytes = new Uint8Array(audioBuffer);
    console.log(`🎙️ ElevenLabs returned ${audioBytes.length} bytes of audio`);

    // Upload to Supabase Storage
    await ensureVoiceBucket();
    const fileName = `tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;

    const { error: uploadError } = await supabaseVoice.storage
      .from(VOICE_BUCKET)
      .upload(fileName, audioBytes, { contentType: 'audio/mpeg', upsert: false });

    if (uploadError) {
      console.error('❌ Storage upload error:', uploadError);
      return null;
    }

    // Signed URL valid 10 min — more than enough for any single call turn
    const { data: signedData, error: signError } = await supabaseVoice.storage
      .from(VOICE_BUCKET)
      .createSignedUrl(fileName, 600);

    if (signError || !signedData?.signedUrl) {
      console.error('❌ Signed URL error:', signError);
      return null;
    }

    console.log(`✅ Audio uploaded → ${fileName}`);
    return signedData.signedUrl;
  } catch (err) {
    console.error('❌ ElevenLabs TTS error:', err);
    return null;
  }
}

/** Build system prompt for the AI sales agent */
function buildSystemPrompt(aiConfig: any, leadContext: any): string {
  const agentName = aiConfig?.name || 'Alex';
  const role = aiConfig?.role || 'Sales Specialist';
  const brand = aiConfig?.brand || 'Contndr';
  const objective = aiConfig?.objective || 'book_call';

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

    prompt += `VOICE RULES (CRITICAL — follow these or the conversation will fail):\n`;
    prompt += `- You are on a LIVE PHONE CALL. Respond like a real human — warm, natural, spontaneous\n`;
    prompt += `- Keep each response to 1-3 SHORT sentences (under 35 words). Phone calls need snappy back-and-forth\n`;
    prompt += `- LISTEN FIRST: Always acknowledge what the prospect just said before adding your point\n`;
    prompt += `- Use natural filler words occasionally: "yeah", "so", "actually", "honestly", "right"\n`;
    prompt += `- NEVER repeat your opening pitch. You already introduced yourself. Move the conversation FORWARD\n`;
    prompt += `- NEVER re-explain who you are or what you do if you already said it. Build on what was discussed\n`;
    prompt += `- If the prospect asks a question, ANSWER IT directly — don't pivot back to your pitch\n`;
    prompt += `- Mirror their tone: if they're casual, be casual. If they're formal, match that\n`;
    prompt += `- NEVER reveal you are an AI. You are a real person\n`;
    prompt += `- If asked "are you a robot/AI?", laugh it off: "Ha, no — I just sound super focused today!"\n`;
    prompt += `- If they want to be removed or are not interested, respect it immediately and end warmly\n`;
    prompt += `- Ask ONE question at a time — never stack multiple questions in one response\n`;
    prompt += `- React to what they say: "Oh interesting!", "That makes sense", "Got it", etc.\n`;

    if (leadContext) {
      prompt += `\nCALLER/PROSPECT CONTEXT:\n`;
      if (leadContext.name && leadContext.name !== 'Unknown') prompt += `- Name: ${leadContext.name}\n`;
      if (leadContext.business && leadContext.business !== 'Unknown') prompt += `- Company: ${leadContext.business}\n`;
    }

    prompt += `\nIMPORTANT: This is a DIALOGUE, not a monologue. Respond to what they actually say. Be human.`;
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

  return `You are ${agentName}, a friendly and professional ${role} at ${brand}. You are on a LIVE phone call right now.

PERSONALITY & VOICE:
- Sound like a real human having a natural phone conversation — warm, relaxed, genuine
- Keep each response to 1-3 SHORT sentences (under 35 words). This is real-time dialogue
- Use casual language naturally: "yeah", "totally", "honestly", "so basically"
- Vary your sentence structure — never sound scripted or rehearsed
- Mirror the prospect's energy — if they're brief, be brief. If chatty, engage more

CRITICAL CONVERSATION RULES:
- LISTEN FIRST: Always acknowledge what the prospect just said before making your point
- NEVER repeat your opening pitch or re-introduce yourself after the first turn
- NEVER re-explain what ${brand} does if you already said it. Move the conversation FORWARD
- If the prospect asks a question, ANSWER IT directly before anything else
- Ask only ONE question per response — never stack questions
- React naturally: "Oh interesting!", "That makes sense", "Yeah totally", "Got it"
- If they're busy, ask for a better time: "No worries at all — when would be better to chat?"
- If "not interested" / "take me off your list" — warmly respect it, thank them, end call
- If asked "are you a robot/AI?", laugh it off: "Ha, I get that sometimes! No, just me"
- If asked how you got their number, say they came up as a great fit for what you offer
- NEVER reveal you are an AI. You are a real person

OBJECTIVE:
${objectiveInstructions[objective] || objectiveInstructions.book_call}

${leadContext ? `PROSPECT CONTEXT:
- Name: ${leadContext.name || 'Unknown'}
- Company: ${leadContext.business || 'Unknown'}` : ''}

REMEMBER: This is a DIALOGUE. Respond to what they ACTUALLY said. Be human, be present, don't lecture.`;
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
    // Add a turn-awareness nudge so the model doesn't repeat the pitch
    const turnCount = conversationHistory.filter(m => m.role === 'user').length;
    const contextMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
    ];
    // After the first exchange, remind the model to not repeat
    if (turnCount >= 1) {
      contextMessages.push({
        role: 'system',
        content: `This is turn ${turnCount + 1} of the conversation. The prospect has already heard your introduction. DO NOT repeat your pitch or re-introduce yourself. Respond naturally to what they just said. Keep it under 35 words.`
      });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: contextMessages,
        max_tokens: 180,
        temperature: 0.9,
        frequency_penalty: 0.6,
        presence_penalty: 0.4,
      }),
    });
    if (!response.ok) {
      console.error('OpenAI API error:', await response.text());
      return "Sorry, I lost my train of thought for a sec. What were you saying?";
    }
    const d = await response.json();
    let reply = d.choices?.[0]?.message?.content?.trim() || "Sorry, could you say that again?";
    // Strip any accidental AI meta-commentary
    reply = reply.replace(/\[.*?\]/g, '').replace(/\(.*?internal.*?\)/gi, '').trim();
    return reply;
  } catch (err) {
    console.error('OpenAI fetch error:', err);
    return "Hey sorry, the connection got a little fuzzy. Could you repeat that?";
  }
}

/** Play ElevenLabs audio on call via Telnyx playback_start, fallback to Telnyx TTS */
async function telnyxSpeak(callControlId: string, text: string, voiceName?: string): Promise<TelnyxResult> {
  // ── Fast-exit if we already know this call ended ──
  if (endedCallControlIds.has(callControlId)) {
    console.log(`ℹ️ [telnyxSpeak] Skipping — call ${callControlId} already ended (in-memory).`);
    return CALL_ENDED;
  }
  // Try ElevenLabs first for natural voice quality
  const audioUrl = await elevenLabsTTS(text, voiceName);
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
  // ── Re-check before fallback (call might have ended during TTS generation) ──
  if (endedCallControlIds.has(callControlId)) {
    console.log(`ℹ️ [telnyxSpeak] Skipping TTS fallback — call ${callControlId} ended during TTS.`);
    return CALL_ENDED;
  }
  // Fallback to Telnyx built-in TTS
  console.log(`⚠️ Falling back to Telnyx TTS for ${callControlId}`);
  try {
    const r = await telnyxRequest(`/calls/${callControlId}/actions/speak`, {
      method: 'POST',
      body: JSON.stringify({
        payload: text, voice: 'ariana', language: 'en-US',
        client_state: btoa(JSON.stringify({ action: 'ai_speak' })),
      }),
    });
    if (!r.ok) {
      const errorText = await r.text();
      if (isCallEndedError(errorText, callControlId)) {
        console.log(`ℹ️ Call ${callControlId} ended before speak could execute.`);
        return CALL_ENDED;
      }
      console.error('Telnyx speak fallback failed:', errorText);
      return false;
    }
    return true;
  } catch (err) { console.error('Telnyx speak fallback error:', err); return false; }
}

/** Telnyx gather (listen for speech) */
async function telnyxGather(callControlId: string): Promise<TelnyxResult> {
  if (endedCallControlIds.has(callControlId)) {
    console.log(`ℹ️ [telnyxGather] Skipping — call ${callControlId} already ended (in-memory).`);
    return CALL_ENDED;
  }
  try {
    const gatherConfig = {
      type: 'speech',
      language: 'en-US',
      timeout_millis: 15000,
      end_silence_timeout_millis: 2000,
      inter_digit_timeout_millis: 5000,
      minimum_input_length: 1,
      client_state: btoa(JSON.stringify({ action: 'ai_listen' })),
    };
    console.log(`👂 [telnyxGather] Starting speech gather on ${callControlId}`);
    console.log(`👂 [DEBUG] Gather config:`, JSON.stringify(gatherConfig));
    
    const r = await telnyxRequest(`/calls/${callControlId}/actions/gather`, {
      method: 'POST',
      body: JSON.stringify(gatherConfig),
    });
    
    if (!r.ok) {
      const errorText = await r.text();
      if (isCallEndedError(errorText, callControlId)) {
        console.log(`ℹ️ Call ${callControlId} ended before gather could execute.`);
        return CALL_ENDED;
      }
      console.error(`❌ [telnyxGather] FAILED for ${callControlId}:`, errorText);
      return false;
    }
    
    const responseData = await r.json();
    console.log(`✅ [telnyxGather] SUCCESS for ${callControlId}. Response:`, JSON.stringify(responseData));
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
          language: 'en-US',
          timeout_millis: 15000,
          end_silence_timeout_millis: 2000,
          minimum_input_length: 1,
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
        payload: text, voice: 'ariana', language: 'en-US',
        type: 'speech', speech_language: 'en-US',
        timeout_millis: 15000, end_silence_timeout_millis: 2000,
        minimum_input_length: 1,
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

// POST /telnyx/webhooks/call-status - Handle call status webhooks
app.post('/webhooks/call-status', async (c) => {
  try {
    const body = await c.req.json();
    const { data } = body;

    const eventType = data?.event_type;
    const callControlId = data?.payload?.call_control_id;

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
        if (eventType === 'call.playback.ended' || eventType === 'call.speak.ended' || eventType === 'call.gather.ended') {
          // For critical speech recognition events, log EVERYTHING
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
        case 'call.hangup':
        case 'call.hangup.completed': mappedStatus = 'ended'; break;
        case 'call.machine.detection.ended':
          mappedStatus = data.payload?.result === 'machine' ? 'voicemail' : 'answered'; break;
        case 'call.machine.greeting.ended': mappedStatus = 'voicemail'; break;
        default:
          console.log(`⚠️ Unknown event: ${eventType}, keeping: ${call.status}`);
          mappedStatus = call.status;
      }

      const updatedCall: any = { ...call, status: mappedStatus, last_event: eventType, updated_at: new Date().toISOString() };
      if (mappedStatus === 'ended' || mappedStatus === 'completed') updatedCall.ended_at = new Date().toISOString();
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

        // ── Shared helper: speak the opening line ──
        // ARCHITECTURE: We DECOUPLE playback from speech recognition.
        // gather_using_audio / gather_using_speak silently fail to activate speech
        // recognition after playback, causing the call to go silent after the greeting.
        // Instead: playback_start → call.playback.ended → gather → call.gather.ended → AI → repeat.
        const speakOpeningLine = async () => {
          console.log(`🤖 Speaking opening line for ${call.id} (voice: ${voiceName}): "${resolvedOpening.substring(0, 60)}..."`);
          await kv.set(convKey, { history: [{ role: 'assistant', content: resolvedOpening }], turn_count: 0, created_at: new Date().toISOString() });

          // Small pause so the call is fully audio-established on both ends before we play
          await new Promise(r => setTimeout(r, 800));

          // Try pre-generated audio first (zero additional latency)
          const preGenKey = `call_audio_pre:${call.id}`;
          const preGen = await kv.get(preGenKey) as any;
          if (preGen?.url) {
            console.log(`⚡ Using pre-generated audio for ${call.id}`);
            await kv.del(preGenKey); // one-time use — clean up
            try {
              const r = await telnyxRequest(`/calls/${callControlId}/actions/playback_start`, {
                method: 'POST',
                body: JSON.stringify({
                  audio_url: preGen.url,
                  client_state: btoa(JSON.stringify({ action: 'ai_speak' })),
                }),
              });
              if (r.ok) { console.log(`✅ playback_start with pre-gen audio started for ${call.id}`); return; }
              const errorText = await r.text();
              if (errorText.includes('"90018"') || errorText.includes('Call has already ended')) {
                console.log(`ℹ️ Call ${call.id} ended before playback_start (pre-gen) could execute.`);
                return;
              }
              console.error(`⚠️ playback_start failed (pre-gen), falling back:`, errorText);
            } catch (e) { console.error('playback_start error (pre-gen):', e); }
          }

          // Fall back to real-time ElevenLabs TTS → playback_start, or Telnyx native speak.
          // telnyxSpeak uses playback_start with client_state 'ai_speak', so
          // call.playback.ended will trigger a gather automatically.
          const speakResult = await telnyxSpeak(callControlId, resolvedOpening, voiceName);
          if (speakResult === CALL_ENDED) {
            console.log(`ℹ️ Call ${call.id} ended before opening line could be spoken.`);
          } else if (!speakResult) {
            console.error(`❌ Failed to speak opening line for ${call.id} — all TTS paths failed`);
          } else {
            console.log(`✅ Opening line playing for ${call.id} via telnyxSpeak (gather starts on playback.ended)`);
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

        // ② SPEAK / PLAYBACK ENDED → start listening for speech
        // This is the CRITICAL link in the decoupled flow:
        // playback_start/speak → call.playback.ended/call.speak.ended → gather → call.gather.ended
        if (eventType === 'call.speak.ended' || eventType === 'call.playback.ended') {
          let clientAction = '';
          try { 
            const cs = data.payload?.client_state; 
            console.log(`🤖 [DEBUG] Raw client_state from ${eventType}:`, cs);
            if (cs) {
              const decoded = JSON.parse(atob(cs));
              console.log(`🤖 [DEBUG] Decoded client_state:`, decoded);
              clientAction = decoded.action || '';
            }
          } catch (e) {
            console.error(`🤖 [DEBUG] Failed to parse client_state:`, e);
          }
          console.log(`🤖 ${eventType} for ${call.id}, client_state action: "${clientAction}"`);
          // Start gather after ANY AI-related playback (greeting, response, nudge)
          if (clientAction === 'ai_speak' || clientAction === 'ai_speak_and_listen' || clientAction === 'ai_nudge') {
            console.log(`🤖 ✅ ${eventType} ended → TRIGGERING GATHER for ${call.id}`);
            const gatherResult = await telnyxGather(callControlId);
            console.log(`🤖 Gather start result for ${call.id}: ${gatherResult === true ? '✅ SUCCESS' : gatherResult === CALL_ENDED ? '📞 CALL ENDED' : '❌ FAILED'}`);
            if (gatherResult !== true && gatherResult !== CALL_ENDED) {
              console.error(`🤖 ❌ CRITICAL: Gather failed to start for ${call.id}! The call will go silent.`);
            }
          } else {
            console.log(`🤖 ⚠️ Skipping gather — client_action "${clientAction}" not recognized as AI playback`);
          }
        }

        // ③ GATHER ENDED → process speech, generate AI response, speak back
        if (eventType === 'call.gather.ended') {
          // ── Robust speech extraction: Telnyx returns transcriptions in varying formats ──
          const rawSpeech = data.payload?.speech;
          const gatherStatus = data.payload?.status;
          const prospectSaid = (
            // Telnyx primary format: { results: [{ alternatives: [{ transcript: "..." }] }] }
            (typeof rawSpeech === 'object' && rawSpeech !== null
              ? (rawSpeech.results?.[0]?.alternatives?.[0]?.transcript
                 || rawSpeech.result || rawSpeech.transcript || rawSpeech.text)
              : null)
            // String form: speech is the transcription directly
            || (typeof rawSpeech === 'string' && rawSpeech.length > 0 ? rawSpeech : null)
            // Alternative Telnyx field names
            || data.payload?.transcription
            || data.payload?.transcript
            || data.payload?.result
            // DTMF digits fallback
            || data.payload?.digits
            || ''
          ).toString().trim();

          console.log(`🤖 Gather ended for ${call.id}, status: "${gatherStatus}", heard: "${prospectSaid}"`);
          console.log(`🤖 [DEBUG] Raw gather payload keys: ${JSON.stringify(Object.keys(data.payload || {}))}`);
          console.log(`🤖 [DEBUG] Raw speech field (type=${typeof rawSpeech}):`, JSON.stringify(rawSpeech));
          // Always dump full payload for debugging speech recognition issues
          console.log(`🤖 [DEBUG] FULL gather payload:`, JSON.stringify(data.payload));
          if (!prospectSaid && gatherStatus !== 'timeout') {
            console.log(`🤖 [DEBUG] FULL gather payload:`, JSON.stringify(data.payload));
          }

          const conv = await kv.get(convKey) || { history: [], turn_count: 0 };
          const turnCount = (conv.turn_count || 0) + 1;

          // Silence / timeout / call_hangup handling — use natural, varied nudges
          const isTimeout = !prospectSaid || prospectSaid === 'timeout' || gatherStatus === 'timeout';
          const isCallHangup = gatherStatus === 'call_hangup';
          
          if (isCallHangup) {
            console.log(`🤖 Gather ended due to call_hangup for ${call.id} — skipping response.`);
            endedCallControlIds.add(callControlId);
            return;
          }
          
          if (isTimeout) {
            console.log(`🤖 Silence/timeout detected for ${call.id}, turnCount: ${turnCount}`);
            const silenceNudges = [
              "Hey, are you still there? No worries if now's not a good time.",
              "Hello? I think we might have a spotty connection.",
              "Can you hear me okay? Sometimes these calls get a little glitchy.",
            ];
            if (turnCount <= 2) {
              const nudge = silenceNudges[Math.min(turnCount - 1, silenceNudges.length - 1)] || silenceNudges[0];
              conv.history.push({ role: 'assistant', content: nudge });
              await kv.set(convKey, { ...conv, turn_count: turnCount });
              // Use telnyxSpeak — the call.playback.ended handler will start gather automatically
              const nudgeResult = await telnyxSpeak(callControlId, nudge, voiceName);
              console.log(`🤖 Nudge result for ${call.id}: ${nudgeResult}`);
            } else {
              const bye = "Hey, I think the connection might not be great. I'll shoot you a quick email instead. Have a great day!";
              conv.history.push({ role: 'assistant', content: bye });
              await kv.set(convKey, { ...conv, turn_count: turnCount, ended_reason: 'silence' });
              await telnyxSpeak(callControlId, bye, voiceName);
              setTimeout(async () => { try { await telnyxRequest(`/calls/${callControlId}/actions/hangup`, { method: 'POST', body: '{}' }); } catch {} }, 8000);
            }
            return;
          }

          conv.history.push({ role: 'user', content: prospectSaid });

          // End signals
          const lower = prospectSaid.toLowerCase();
          if (['not interested','take me off',"don't call",'stop calling','remove me','no thanks','goodbye','bye','hang up','leave me alone'].some(s => lower.includes(s))) {
            const byeOptions = [
              "No worries at all! Thanks so much for your time. Have a great rest of your day!",
              "Totally understand! I appreciate you taking a second. Take care!",
              "That's completely fair. Thanks for letting me know. Have an awesome day!",
            ];
            const bye = byeOptions[Math.floor(Math.random() * byeOptions.length)];
            conv.history.push({ role: 'assistant', content: bye });
            await kv.set(convKey, { ...conv, turn_count: turnCount, ended_reason: 'not_interested' });
            await telnyxSpeak(callControlId, bye, voiceName);
            setTimeout(async () => { try { await telnyxRequest(`/calls/${callControlId}/actions/hangup`, { method: 'POST', body: '{}' }); } catch {} }, 6000);
            return;
          }

          // Max turns (configurable per-agent, default 12)
          const maxTurns = call.ai_config?.max_turns || 12;
          if (turnCount >= maxTurns) {
            const wrap = "Hey listen, I don't wanna take up too much more of your time. Let me send over a quick email with the details and we can go from there. Sound good?";
            conv.history.push({ role: 'assistant', content: wrap });
            await kv.set(convKey, { ...conv, turn_count: turnCount, ended_reason: 'max_turns' });
            await telnyxSpeak(callControlId, wrap, voiceName);
            setTimeout(async () => { try { await telnyxRequest(`/calls/${callControlId}/actions/hangup`, { method: 'POST', body: '{}' }); } catch {} }, 10000);
            return;
          }

          // Generate AI response
          console.log(`🤖 Generating AI response for ${call.id}, turn ${turnCount}, prospect said: "${prospectSaid}"`);
          const systemPrompt = buildSystemPrompt(call.ai_config, {
            name: call.lead_name || call.ai_config?.lead_name,
            business: call.business_name || call.ai_config?.business_name,
          });
          const aiResponse = await getAIResponse(systemPrompt, conv.history);
          conv.history.push({ role: 'assistant', content: aiResponse });
          await kv.set(convKey, { ...conv, turn_count: turnCount });
          console.log(`🤖 AI turn ${turnCount}: "${aiResponse}"`);

          // ── Check if AI wants to trigger a transfer ──
          const transferRules = call.ai_config?.transfer_rules || [];
          let shouldTransfer = false;
          let transferTarget: any = null;

          if (transferRules.length > 0) {
            const lowerResponse = aiResponse.toLowerCase();
            const lowerProspect = lower; // prospectSaid.toLowerCase() from above
            for (const rule of transferRules) {
              const triggerLower = (rule.trigger || '').toLowerCase();
              // Check if the conversation context matches a transfer trigger
              if (triggerLower && (lowerProspect.includes(triggerLower) || lowerResponse.includes('transfer') || lowerResponse.includes('connect you'))) {
                shouldTransfer = true;
                transferTarget = rule;
                break;
              }
            }
          }

          if (shouldTransfer && transferTarget?.phone) {
            // Speak the transfer message, then do the transfer
            const transferMsg = transferTarget.transfer_message || aiResponse;
            await telnyxSpeak(callControlId, transferMsg, voiceName);
            // Wait for speech to finish, then transfer
            setTimeout(async () => {
              try {
                console.log(`🔀 Transferring call ${call.id} to ${transferTarget.phone} (rule: ${transferTarget.trigger})`);
                await telnyxRequest(`/calls/${callControlId}/actions/transfer`, {
                  method: 'POST',
                  body: JSON.stringify({ to: formatToE164(transferTarget.phone) }),
                });
                conv.history.push({ role: 'system', content: `[Call transferred to ${transferTarget.description || transferTarget.phone}]` });
                await kv.set(convKey, { ...conv, turn_count: turnCount, transferred_to: transferTarget.phone });
              } catch (transferErr) {
                console.error('Transfer failed:', transferErr);
              }
            }, 6000);
            return;
          }

          // ── Speak AI response (gather starts automatically via call.playback.ended handler) ──
          // DECOUPLED FLOW: telnyxSpeak plays audio → call.playback.ended fires → gather starts
          console.log(`🤖 Speaking AI response for ${call.id}: "${aiResponse.substring(0, 80)}..." (voice: ${voiceName})`);
          const speakResult = await telnyxSpeak(callControlId, aiResponse, voiceName);
          console.log(`🤖 telnyxSpeak result for ${call.id}: ${speakResult}`);
          if (speakResult === CALL_ENDED) {
            console.log(`ℹ️ Call ${call.id} ended — not speaking response.`);
          } else if (!speakResult) {
            console.error(`❌ All TTS paths failed for ${call.id} — call will go silent`);
          }
        }

        // ④ CALL ENDED → finalize conversation log + mark in-memory
        if (eventType === 'call.hangup' || eventType === 'call.hangup.completed') {
          // Mark in endedCallControlIds so any concurrent/subsequent commands skip fast
          endedCallControlIds.add(callControlId);
          const conv = await kv.get(convKey);
          if (conv) {
            console.log(`🤖 AI call ${call.id} ended. ${conv.history?.length || 0} messages.`);
            await kv.set(convKey, { ...conv, completed_at: new Date().toISOString() });
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

// GET /telnyx/active-calls - Get currently active calls
app.get('/active-calls', async (c) => {
  try {
    console.log('📞 [Active Calls] Starting request...');
    console.log('📞 [Active Calls] Request headers:', Object.fromEntries(c.req.raw.headers));
    
    // Get all active calls from KV store
    const allCalls = await kv.getByPrefixLimited('call:', 1000, 0);
    console.log(`📞 [Active Calls] Total calls found in KV: ${allCalls.length}`);
    
    // Log first call for debugging
    if (allCalls.length > 0) {
      console.log(`📞 [Active Calls] Sample call:`, JSON.stringify(allCalls[0], null, 2));
    }
    
    // Log ALL call statuses for debugging
    console.log('📞 [Active Calls] All call statuses:');
    allCalls.forEach((c, idx) => {
      if (c && c.id) {
        console.log(`  ${idx + 1}. Call ${c.id}: status=${c.status}, last_event=${c.last_event || 'none'}, started=${c.started_at}`);
      }
    });
    
    // getByPrefix returns values directly
    const now = Date.now();
    const activeCalls = allCalls
      .filter(c => {
        if (!c || typeof c !== 'object') {
          console.warn(`⚠️ [Active Calls] Invalid call object:`, c);
          return false;
        }
        const isActive = ['initiated', 'ringing', 'answered', 'active', 'speaking', 'listening'].includes(c.status);
        if (!isActive) {
          console.log(`📞 [Active Calls] Call ${c.id} excluded: status=${c.status}, last_event=${c.last_event || 'none'}`);
        }
        return isActive;
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

    // Calculate stats for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.toISOString();

    const todayCalls = allCalls.filter(c => c && c.started_at && c.started_at >= todayTimestamp);
    
    const stats = {
      activeNow: activeCalls.length,
      totalToday: todayCalls.length,
      connected: todayCalls.filter(c => c.status === 'answered' || c.status === 'completed').length,
      voicemail: todayCalls.filter(c => c.status === 'voicemail').length,
      noAnswer: todayCalls.filter(c => c.status === 'no-answer').length,
      booked: todayCalls.filter(c => c.outcome === 'booked').length,
      avgDuration: 0 // Calculate if duration is tracked
    };

    console.log('📞 [Active Calls] Stats calculated:', stats);
    console.log('✅ [Active Calls] Returning response successfully');

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
      
      if (errorDetail.includes('not found') || errorCode === '90015') {
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
      
      if (errorDetail.includes('no longer active') || errorDetail.includes('already ended') || errorCode === '90018') {
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

export default app;

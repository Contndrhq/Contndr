/**
 * ElevenLabs Voice & Conversational AI Agents Integration
 * Pro Plan — handles voices, TTS previews, and agent CRUD
 * Updated: 2026-03-13 — Pro plan models + Conversational AI agents
 */

import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';

const app = new Hono();

// Enable CORS for all ElevenLabs routes
app.use('*', cors());

// Global error handler for ElevenLabs routes
app.onError((err, c) => {
  console.error('❌ ElevenLabs route error:', err);
  return c.json({ 
    success: false,
    error: 'Internal server error', 
    details: err.message 
  }, 500);
});

const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';
const ELEVENLABS_V2_URL = 'https://api.elevenlabs.io/v2'; // v2 endpoints for agents

// Pro plan models — ordered by quality / speed tradeoff
const PRO_MODELS = {
  conversational: 'eleven_flash_v2_5',     // Best for real-time conversation (low latency)
  multilingual: 'eleven_multilingual_v2',   // Best quality, supports 29 languages
  turbo: 'eleven_turbo_v2_5',              // Fast, English-optimized
  flash: 'eleven_flash_v2_5',             // Ultra-low latency
};

// Default model for previews & TTS
const DEFAULT_TTS_MODEL = PRO_MODELS.multilingual;
const DEFAULT_CONV_MODEL = PRO_MODELS.conversational;

// Sample preview texts for different brands
const PREVIEW_TEXTS = {
  sourcr: "Hi, this is calling from Sourcr. We create premium websites and mobile apps that help businesses grow. Do you have a quick minute?",
  roadr: "Hi, this is calling from Roadr. We help auto repair shops get more customers through our subscription service. Do you have a quick minute?",
  contndr: "Hey there! This is calling from Contndr. We help businesses scale their outreach with AI-powered tools. Got a sec?"
};

// Helper for authenticated ElevenLabs API requests
async function elFetch(endpoint: string, options: RequestInit = {}, version: 'v1' | 'v2' = 'v1'): Promise<Response> {
  if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');
  const base = version === 'v2' ? ELEVENLABS_V2_URL : ELEVENLABS_API_URL;
  const headers = new Headers(options.headers || {});
  headers.set('xi-api-key', ELEVENLABS_API_KEY);
  if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${base}${endpoint}`, { ...options, headers });
}

// ═══════════════════════════════════════════════════════════════════
//  SUBSCRIPTION INFO — expose Pro plan details
// ═══════════════════════════════════════════════════════════════════

app.get('/subscription', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      console.error('[ElevenLabs] ELEVENLABS_API_KEY not set');
      return c.json({ 
        success: false, 
        error: 'API key not configured',
        subscription: null 
      }, 200); // Return 200 with null so frontend doesn't crash
    }
    const r = await elFetch('/user/subscription');
    if (!r.ok) {
      const errBody = await r.text().catch(() => 'unknown');
      console.error(`[ElevenLabs] Subscription API returned ${r.status}: ${errBody}`);
      // Try to extract detail message for better frontend UX
      let detailMsg = `ElevenLabs API error (${r.status})`;
      try {
        const parsed = JSON.parse(errBody);
        if (parsed?.detail?.message) detailMsg = parsed.detail.message;
        if (parsed?.detail?.status === 'missing_permissions') {
          detailMsg = `missing_permissions: ${parsed.detail.message}`;
        }
      } catch {}
      return c.json({ 
        success: false, 
        error: detailMsg,
        details: detailMsg,
        subscription: null 
      }, 200); // Return 200 with null so frontend panel shows graceful fallback
    }
    const sub = await r.json();
    return c.json({
      success: true,
      subscription: {
        tier: sub.tier || 'unknown',
        character_count: sub.character_count || 0,
        character_limit: sub.character_limit || 0,
        can_use_agents: sub.tier === 'pro' || sub.tier === 'scale' || sub.tier === 'enterprise',
        available_models: Object.entries(PRO_MODELS).map(([k, v]) => ({ key: k, model_id: v })),
        next_invoice: sub.next_character_count_reset_unix || null,
      }
    });
  } catch (error) {
    console.error('[ElevenLabs] Error fetching subscription:', error);
    return c.json({ success: false, error: 'Failed to fetch subscription info', subscription: null }, 200);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  VOICES
// ═══════════════════════════════════════════════════════════════════

/**
 * Get all available voices from ElevenLabs
 */
app.get('/voices', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return c.json({ 
        error: 'ElevenLabs API key not configured. Please add ELEVENLABS_API_KEY to environment variables.' 
      }, 500);
    }

    const response = await elFetch('/voices?show_legacy=false');

    if (!response.ok) {
      const error = await response.text();
      console.error('ElevenLabs API error:', error);
      return c.json({ error: 'Failed to fetch voices from ElevenLabs' }, response.status);
    }

    const data = await response.json();
    
    // Filter and format voices — Pro plan unlocks all voices
    const voices = data.voices.map((voice: any) => ({
      id: voice.voice_id,
      name: voice.name,
      category: voice.category || 'generated',
      labels: voice.labels || {},
      previewUrl: voice.preview_url,
      description: voice.description || '',
      isPremium: voice.category === 'premade' || voice.category === 'professional',
      isCloned: voice.category === 'cloned',
      gender: voice.labels?.gender || 'unknown',
      age: voice.labels?.age || 'unknown',
      accent: voice.labels?.accent || 'american',
      useCase: voice.labels?.['use case'] || 'general',
      highQuality: voice.high_quality_base_model_ids?.includes('eleven_multilingual_v2'),
    }));

    // Sort: professional first, then premade, then cloned, then generated
    const categoryOrder: Record<string, number> = { professional: 0, premade: 1, cloned: 2, generated: 3 };
    voices.sort((a: any, b: any) => {
      const oa = categoryOrder[a.category] ?? 4;
      const ob = categoryOrder[b.category] ?? 4;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });

    return c.json({ voices });
  } catch (error) {
    console.error('Error fetching ElevenLabs voices:', error);
    return c.json({ error: 'Internal server error fetching voices' }, 500);
  }
});

/**
 * Get recommended voices for sales calls
 * Pro plan — returns more voices with quality metadata
 */
app.get('/voices/recommended', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return c.json({ error: 'ElevenLabs API key not configured.' }, 500);
    }

    const response = await elFetch('/voices?show_legacy=false');

    if (!response.ok) {
      const error = await response.text();
      console.error('ElevenLabs API error:', error);
      return c.json({ error: 'Failed to fetch voices from ElevenLabs' }, response.status);
    }

    const data = await response.json();
    
    // Pro plan: curate best voices for sales calls — expanded list
    const recommendedVoices = data.voices
      .filter((voice: any) => {
        const labels = voice.labels || {};
        const useCase = labels['use case']?.toLowerCase() || '';
        const description = voice.description?.toLowerCase() || '';
        const category = voice.category || '';
        
        const isPremium = category === 'premade' || category === 'professional';
        const isCloned = category === 'cloned'; // Include user's cloned voices
        
        const suitableUseCase = 
          useCase.includes('narration') || 
          useCase.includes('conversational') ||
          useCase.includes('audiobook') ||
          useCase.includes('social media') ||
          description.includes('clear') ||
          description.includes('professional') ||
          description.includes('warm') ||
          description.includes('trustworthy') ||
          description.includes('confident') ||
          description.includes('friendly');
        
        return isPremium || isCloned || suitableUseCase;
      })
      .map((voice: any) => ({
        id: voice.voice_id,
        name: voice.name,
        category: voice.category || 'generated',
        labels: voice.labels || {},
        previewUrl: voice.preview_url,
        description: voice.description || '',
        gender: voice.labels?.gender || 'unknown',
        age: voice.labels?.age || 'unknown',
        accent: voice.labels?.accent || 'american',
        isCloned: voice.category === 'cloned',
        highQuality: voice.high_quality_base_model_ids?.includes('eleven_multilingual_v2'),
      }))
      .slice(0, 20); // Pro plan: return top 20 recommended

    return c.json({ voices: recommendedVoices });
  } catch (error) {
    console.error('Error fetching recommended voices:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Generate a preview audio for a specific voice with custom text
 * Pro plan: uses eleven_multilingual_v2 for highest quality
 */
app.post('/preview', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return c.json({ error: 'ElevenLabs API key not configured.' }, 500);
    }

    const body = await c.req.json();
    const { voiceId, text, brand = 'contndr', model } = body;

    if (!voiceId) {
      return c.json({ error: 'Voice ID is required' }, 400);
    }

    const previewText = text || PREVIEW_TEXTS[brand as keyof typeof PREVIEW_TEXTS] || PREVIEW_TEXTS.contndr;
    const selectedModel = model || DEFAULT_TTS_MODEL;

    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: previewText,
          model_id: selectedModel,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0.35,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('ElevenLabs TTS error:', error);
      return c.json({ error: 'Failed to generate preview' }, response.status);
    }

    const audioBuffer = await response.arrayBuffer();
    
    const base64Audio = btoa(
      new Uint8Array(audioBuffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ''
      )
    );

    return c.json({ 
      success: true,
      audio: base64Audio,
      contentType: 'audio/mpeg',
      model: selectedModel,
    });
  } catch (error) {
    console.error('Error generating preview:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Get voice details by ID
 */
app.get('/voice/:voiceId', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return c.json({ error: 'ElevenLabs API key not configured.' }, 500);
    }

    const voiceId = c.req.param('voiceId');
    const response = await elFetch(`/voices/${voiceId}`);

    if (!response.ok) {
      const error = await response.text();
      console.error('ElevenLabs API error:', error);
      return c.json({ error: 'Failed to fetch voice details' }, response.status);
    }

    const voice = await response.json();

    return c.json({
      id: voice.voice_id,
      name: voice.name,
      category: voice.category || 'generated',
      labels: voice.labels || {},
      previewUrl: voice.preview_url,
      description: voice.description || '',
      samples: voice.samples || [],
      highQualityModels: voice.high_quality_base_model_ids || [],
    });
  } catch (error) {
    console.error('Error fetching voice details:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  CONVERSATIONAL AI AGENTS (Pro plan feature)
// ═══════════════════════════════════════════════════════════════════

/**
 * List all conversational AI agents
 */
app.get('/agents', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) return c.json({ error: 'API key not configured' }, 500);

    const response = await elFetch('/convai/agents', {}, 'v1');
    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs agents list error:', err);
      return c.json({ error: 'Failed to fetch agents', details: err }, response.status);
    }

    const data = await response.json();
    const agents = (data.agents || []).map((a: any) => ({
      agent_id: a.agent_id,
      name: a.name,
      conversation_config: a.conversation_config,
      metadata: a.metadata,
      created_at: a.created_at_unix_secs,
    }));

    return c.json({ success: true, agents });
  } catch (error) {
    console.error('Error listing agents:', error);
    return c.json({ error: 'Failed to list agents' }, 500);
  }
});

/**
 * Get a single agent by ID
 */
app.get('/agents/:agentId', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) return c.json({ error: 'API key not configured' }, 500);

    const agentId = c.req.param('agentId');
    const response = await elFetch(`/convai/agents/${agentId}`, {}, 'v1');
    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs agent get error:', err);
      return c.json({ error: 'Failed to fetch agent', details: err }, response.status);
    }

    const agent = await response.json();
    return c.json({ success: true, agent });
  } catch (error) {
    console.error('Error getting agent:', error);
    return c.json({ error: 'Failed to get agent' }, 500);
  }
});

/**
 * Create a new conversational AI agent
 * Maps Contndr campaign config to ElevenLabs agent format
 */
app.post('/agents', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) return c.json({ error: 'API key not configured' }, 500);

    const body = await c.req.json();
    const {
      name,
      voice_id,
      system_prompt,
      first_message,
      language = 'en',
      max_duration_seconds = 300,
      // Contndr-specific fields
      ai_name,
      ai_role,
      brand,
      brand_tone,
      objective,
      knowledge_base,
      transfer_rules,
      qualification_questions,
    } = body;

    if (!name) return c.json({ error: 'Agent name is required' }, 400);

    // Build system prompt from Contndr config if not provided directly
    let finalPrompt = system_prompt || '';
    if (!finalPrompt && ai_name) {
      finalPrompt = buildAgentSystemPrompt({
        name: ai_name,
        role: ai_role || 'Sales Specialist',
        brand: brand || 'Contndr',
        brand_tone: brand_tone || 'professional',
        objective: objective || 'book_call',
        knowledge_base,
        transfer_rules,
        qualification_questions,
      });
    }

    const agentPayload: any = {
      name,
      conversation_config: {
        agent: {
          prompt: {
            prompt: finalPrompt || `You are ${ai_name || 'Alex'}, a helpful assistant.`,
          },
          first_message: first_message || `Hey there! This is ${ai_name || 'Alex'} from ${brand || 'Contndr'}. Do you have a quick minute?`,
          language,
        },
        tts: {
          voice_id: voice_id || undefined,
          model_id: DEFAULT_CONV_MODEL,
          agent_output_audio_format: 'pcm_16000',
          optimize_streaming_latency: 3,
        },
        stt: {
          model: 'nova-2-general',
        },
        turn: {
          turn_timeout: 15,
          mode: {
            type: 'server_vad',
            silence_duration_ms: 1500,
            threshold: 0.5,
            prefix_padding_ms: 300,
          },
        },
        conversation: {
          max_duration_seconds,
        },
      },
      metadata: {
        contndr_brand: brand,
        contndr_objective: objective,
        contndr_ai_name: ai_name,
        contndr_ai_role: ai_role,
      },
    };

    console.log('🤖 Creating ElevenLabs agent:', name);
    const response = await elFetch('/convai/agents/create', {
      method: 'POST',
      body: JSON.stringify(agentPayload),
    }, 'v1');

    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs agent create error:', err);
      return c.json({ error: 'Failed to create agent', details: err }, response.status);
    }

    const agent = await response.json();
    console.log('✅ Agent created:', agent.agent_id);

    return c.json({ success: true, agent });
  } catch (error) {
    console.error('Error creating agent:', error);
    return c.json({ error: 'Failed to create agent' }, 500);
  }
});

/**
 * Update an existing agent
 */
app.patch('/agents/:agentId', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) return c.json({ error: 'API key not configured' }, 500);

    const agentId = c.req.param('agentId');
    const body = await c.req.json();

    console.log(`🔄 Updating ElevenLabs agent ${agentId}`);
    const response = await elFetch(`/convai/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }, 'v1');

    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs agent update error:', err);
      return c.json({ error: 'Failed to update agent', details: err }, response.status);
    }

    const agent = await response.json();
    console.log('✅ Agent updated:', agentId);

    return c.json({ success: true, agent });
  } catch (error) {
    console.error('Error updating agent:', error);
    return c.json({ error: 'Failed to update agent' }, 500);
  }
});

/**
 * Delete an agent
 */
app.delete('/agents/:agentId', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) return c.json({ error: 'API key not configured' }, 500);

    const agentId = c.req.param('agentId');
    console.log(`🗑️ Deleting ElevenLabs agent ${agentId}`);

    const response = await elFetch(`/convai/agents/${agentId}`, {
      method: 'DELETE',
    }, 'v1');

    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs agent delete error:', err);
      return c.json({ error: 'Failed to delete agent', details: err }, response.status);
    }

    console.log('✅ Agent deleted:', agentId);
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting agent:', error);
    return c.json({ error: 'Failed to delete agent' }, 500);
  }
});

/**
 * Get a signed URL for starting a conversation with an agent
 * Used by the frontend to establish a WebSocket connection
 */
app.get('/agents/:agentId/signed-url', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) return c.json({ error: 'API key not configured' }, 500);

    const agentId = c.req.param('agentId');

    const response = await elFetch('/convai/conversation/get_signed_url', {
      method: 'GET',
    }, 'v1');

    // The API expects agent_id as query param
    const signedResponse = await fetch(
      `${ELEVENLABS_API_URL}/convai/conversation/get_signed_url?agent_id=${agentId}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );

    if (!signedResponse.ok) {
      const err = await signedResponse.text();
      console.error('ElevenLabs signed URL error:', err);
      return c.json({ error: 'Failed to get signed URL', details: err }, signedResponse.status);
    }

    const data = await signedResponse.json();
    return c.json({ success: true, signed_url: data.signed_url });
  } catch (error) {
    console.error('Error getting signed URL:', error);
    return c.json({ error: 'Failed to get signed URL' }, 500);
  }
});

/**
 * Get conversation history for an agent
 */
app.get('/agents/:agentId/conversations', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) return c.json({ error: 'API key not configured' }, 500);

    const agentId = c.req.param('agentId');
    const response = await elFetch(`/convai/conversations?agent_id=${agentId}`, {}, 'v1');

    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs conversations error:', err);
      return c.json({ error: 'Failed to fetch conversations', details: err }, response.status);
    }

    const data = await response.json();
    return c.json({ success: true, conversations: data.conversations || [] });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return c.json({ error: 'Failed to fetch conversations' }, 500);
  }
});

/**
 * Get a specific conversation transcript
 */
app.get('/conversations/:conversationId', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) return c.json({ error: 'API key not configured' }, 500);

    const conversationId = c.req.param('conversationId');
    const response = await elFetch(`/convai/conversations/${conversationId}`, {}, 'v1');

    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs conversation error:', err);
      return c.json({ error: 'Failed to fetch conversation', details: err }, response.status);
    }

    const data = await response.json();
    return c.json({ success: true, conversation: data });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    return c.json({ error: 'Failed to fetch conversation' }, 500);
  }
});

/**
 * Get available Pro plan models
 */
app.get('/models', async (c) => {
  try {
    if (!ELEVENLABS_API_KEY) return c.json({ error: 'API key not configured' }, 500);

    const response = await elFetch('/models');
    if (!response.ok) {
      return c.json({
        success: true,
        models: Object.entries(PRO_MODELS).map(([key, id]) => ({
          key,
          model_id: id,
          description: key === 'multilingual' ? 'Highest quality, 29 languages' :
                       key === 'conversational' ? 'Optimized for real-time conversation' :
                       key === 'turbo' ? 'Fast, English-optimized' :
                       'Ultra-low latency',
        })),
      });
    }

    const data = await response.json();
    return c.json({
      success: true,
      models: data.map((m: any) => ({
        model_id: m.model_id,
        name: m.name,
        description: m.description,
        languages: m.languages?.map((l: any) => l.language_id) || [],
        can_do_tts: m.can_do_text_to_speech,
        can_do_voice_conversion: m.can_do_voice_conversion,
      })),
    });
  } catch (error) {
    console.error('Error fetching models:', error);
    return c.json({ error: 'Failed to fetch models' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  HELPER: Build system prompt for Contndr agent config
// ═══════════════════════════════════════════════════════════════════

function buildAgentSystemPrompt(config: {
  name: string;
  role: string;
  brand: string;
  brand_tone: string;
  objective: string;
  knowledge_base?: string;
  transfer_rules?: any[];
  qualification_questions?: string[];
}): string {
  const toneMap: Record<string, string> = {
    friendly: 'warm, approachable, and conversational',
    professional: 'polished, clear, and business-appropriate',
    confident: 'assertive, knowledgeable, and persuasive',
    direct: 'concise, no-nonsense, and straight-to-the-point',
  };

  const objectiveMap: Record<string, string> = {
    book_call: 'Your primary goal is to book a discovery call or demo. Be persistent but respectful.',
    qualify: 'Your goal is to qualify the prospect by understanding needs, budget, timeline, and authority.',
    send_link: 'Your goal is to get the prospect interested enough to visit a link you will send after the call.',
    warm_transfer: 'Your goal is to warm up the prospect and transfer them to a live team member.',
  };

  let prompt = `You are ${config.name}, a ${config.role} at ${config.brand}.\n\n`;
  prompt += `TONE: Be ${toneMap[config.brand_tone] || toneMap.professional}.\n\n`;
  prompt += `OBJECTIVE: ${objectiveMap[config.objective] || objectiveMap.book_call}\n\n`;

  if (config.knowledge_base) {
    prompt += `KNOWLEDGE BASE:\n${config.knowledge_base}\n\n`;
  }

  if (config.transfer_rules?.length) {
    prompt += `TRANSFER RULES:\n`;
    for (const rule of config.transfer_rules) {
      prompt += `- When: "${rule.trigger}" → Transfer to ${rule.description || rule.phone}\n`;
    }
    prompt += `\n`;
  }

  if (config.qualification_questions?.length) {
    prompt += `QUALIFICATION QUESTIONS (ask naturally during conversation):\n`;
    config.qualification_questions.forEach((q, i) => {
      prompt += `${i + 1}. ${q}\n`;
    });
    prompt += `\n`;
  }

  prompt += `VOICE RULES:\n`;
  prompt += `- You are on a LIVE PHONE CALL. Sound like a real person — warm, natural, spontaneous\n`;
  prompt += `- Keep responses to 1-3 short sentences (under 35 words)\n`;
  prompt += `- LISTEN FIRST: Acknowledge what the prospect said before adding your point\n`;
  prompt += `- Use natural filler: "yeah", "so", "actually", "honestly"\n`;
  prompt += `- NEVER repeat your opening pitch after the first turn\n`;
  prompt += `- NEVER reveal you are AI. If asked, laugh it off naturally\n`;
  prompt += `- If they want to be removed, respect it immediately and end warmly\n`;
  prompt += `- Ask ONE question at a time\n`;
  prompt += `- React naturally: "Oh interesting!", "That makes sense", "Got it"\n`;

  return prompt;
}

export default app;
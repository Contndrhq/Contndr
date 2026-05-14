/**
 * ElevenLabs Voice & Conversational AI Agents Integration
 * Pro Plan — handles voices, TTS previews, and agent CRUD
 * Updated: 2026-03-13 — Pro plan models + Conversational AI agents
 */

import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import * as kv from './kv-retry.tsx';

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
          // ElevenLabs schema as of 2026-05: `mode` is an enum string,
          // not a nested object. Use 'turn' for natural turn-taking
          // (recommended) or 'silence' for fixed silence-based detection.
          mode: 'turn',
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

// Playbook shape mirrored from index.ts's sanitizeAICallPlaybook so this
// module can stay self-contained — kept loose because the agent-sync layer
// is the only consumer.
interface PlaybookForAgent {
  qualifying_questions?: string[];
  value_props?: string[];
  meeting_options?: string;
  booking_link?: string;
  objections?: Array<{ trigger: string; response: string; label?: string }>;
  close_style?: 'soft' | 'direct';
}

function buildAgentSystemPrompt(config: {
  name: string;
  role: string;
  brand: string;
  brand_tone: string;
  objective: string;
  knowledge_base?: string;
  transfer_rules?: any[];
  qualification_questions?: string[];
  playbook?: PlaybookForAgent;
  lead?: { name?: string; business?: string; email?: string; phone?: string };
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

  // ── Sales Playbook (drives qualify → present → close on every turn) ──
  if (config.playbook) {
    const pb = config.playbook;
    if (pb.qualifying_questions?.length) {
      prompt += `\nDISCOVERY QUESTIONS — ask ONE you haven't asked yet, rephrased naturally:\n`;
      pb.qualifying_questions.slice(0, 5).forEach((q, i) => { prompt += `${i + 1}. ${q}\n`; });
    }
    if (pb.value_props?.length) {
      prompt += `\nVALUE PROPS — pick the ONE that matches what the prospect just said. Frame as outcomes, never feature lists:\n`;
      pb.value_props.slice(0, 5).forEach((v, i) => { prompt += `${i + 1}. ${v}\n`; });
    }
    if (pb.meeting_options || pb.booking_link) {
      prompt += `\nCLOSE MECHANICS:\n`;
      if (pb.meeting_options) {
        prompt += `- Once they show interest, ask for the meeting with SPECIFIC TIMES: "${pb.meeting_options}"\n`;
        prompt += `- Never ask "when works for you?" — always propose 2 concrete options\n`;
      }
      if (pb.booking_link) {
        prompt += `- If they prefer self-serve, share: ${pb.booking_link}\n`;
      }
      if (pb.close_style === 'direct') {
        prompt += `- Use a direct close. Don't soften it.\n`;
      } else {
        prompt += `- Soft close: tee it up gently ("would something like that be helpful?")\n`;
      }
    }
    if (pb.objections?.length) {
      prompt += `\nOBJECTION HANDLERS — when their words match a trigger below, steer toward the response (adapt to sound natural, don't read verbatim):\n`;
      pb.objections.slice(0, 12).forEach(o => {
        prompt += `- Trigger: "${o.trigger}" → Response: "${o.response}"\n`;
      });
    }
  }

  // ── Lead context — so the AI knows who it's talking to ──
  if (config.lead) {
    const l = config.lead;
    const bits: string[] = [];
    if (l.name && l.name !== 'Unknown') bits.push(`Name: ${l.name}`);
    if (l.business && l.business !== 'Unknown') bits.push(`Company: ${l.business}`);
    if (bits.length) prompt += `\nPROSPECT:\n${bits.join('\n')}\n`;
  }

  prompt += `\nVOICE RULES:\n`;
  prompt += `- You are on a LIVE PHONE CALL. Sound like a real person — warm, natural, spontaneous\n`;
  prompt += `- Keep responses SHORT: 1 sentence, max 12 words. Punchy. Phone-call brief.\n`;
  prompt += `- LISTEN FIRST: Acknowledge what the prospect said before adding your point\n`;
  prompt += `- Use natural filler: "yeah", "so", "actually", "honestly"\n`;
  prompt += `- NEVER repeat your opening pitch after the first turn\n`;
  prompt += `- NEVER reveal you are AI. If asked, laugh it off naturally\n`;
  prompt += `- If they want to be removed, respect it immediately and end warmly\n`;
  prompt += `- Ask ONE question at a time\n`;
  prompt += `- React naturally: "Oh interesting!", "That makes sense", "Got it"\n`;

  // ── Pronunciation guide ──
  // ElevenLabs reads brand spellings literally. "Contndr" has no vowels so
  // it gets said as "C-T-N-D-R". Tell the agent to use the phonetic form
  // in its own generated output AND to read these words a certain way.
  prompt += `\nPRONUNCIATION (critical — sounds robotic otherwise):\n`;
  prompt += `- When referring to our company, ALWAYS say "Contender" (kuhn-TEN-der). Never spell out "Contndr" letter-by-letter.\n`;
  prompt += `- Even if your context shows "Contndr" written, you must SAY "Contender" out loud.\n`;
  prompt += `- For URLs say "dot com" (not "."), "at" (not "@"), and pronounce each word naturally.\n`;

  return prompt;
}

// ═══════════════════════════════════════════════════════════════════
//  PER-USER AGENT PROVISIONING + PROMPT SYNC (Layer A)
// ═══════════════════════════════════════════════════════════════════
// Each Contndr user gets a single dedicated ElevenLabs agent that we keep
// in sync with their current playbook, KB, and (optionally) the specific
// lead being called. The agent_id is persisted in KV so we don't pay the
// roundtrip on every call.

const AGENT_KV_PREFIX = 'el_agent:';
const PLAYBOOK_KV_PREFIX = 'ai_call_playbook:';

interface UserAgentRecord {
  agent_id: string;
  user_id: string;
  user_email?: string;
  created_at: string;
  last_synced_at?: string;
  voice_id?: string;
}

/**
 * Idempotent — returns the user's existing agent_id or creates a new one
 * with sane defaults. New agents start with a generic prompt; the real
 * prompt is pushed by syncAgentForCall before each call.
 */
export async function getOrCreateUserAgent(opts: {
  userId: string;
  userEmail?: string;
  defaultVoiceId?: string;
  defaultAiName?: string;
  defaultBrand?: string;
}): Promise<{ agent_id: string; created: boolean; record: UserAgentRecord }> {
  if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');

  const existing = await kv.get(`${AGENT_KV_PREFIX}${opts.userId}`) as UserAgentRecord | null;
  if (existing?.agent_id) {
    // Verify the agent still exists on ElevenLabs' side (someone could delete
    // it from the portal). If it 404s, we recreate. Cheap GET.
    const verify = await elFetch(`/convai/agents/${existing.agent_id}`, {}, 'v1');
    if (verify.ok) return { agent_id: existing.agent_id, created: false, record: existing };
    console.warn(`[ConvAI] Agent ${existing.agent_id} not found on ElevenLabs side — recreating`);
  }

  const name = `Contndr · ${(opts.userEmail || opts.userId).slice(0, 32)}`;
  const aiName = opts.defaultAiName || 'Alex';
  const brand = opts.defaultBrand || 'Contndr';
  const voiceId = opts.defaultVoiceId || '21m00Tcm4TlvDq8ikWAM'; // Rachel default

  const agentPayload = {
    name,
    conversation_config: {
      agent: {
        prompt: {
          prompt: `You are ${aiName}, a Sales Specialist at ${brand}. (Prompt will be refreshed before each call.)`,
          // Low-latency LLM config. gpt-4o-mini is the fastest production
          // model with decent quality. max_tokens 60 keeps responses
          // short (~15 words) so TTS playback starts faster.
          llm: 'gpt-4o-mini',
          temperature: 0.7,
          max_tokens: 60,
        },
        first_message: `Hey there! This is ${aiName} from ${brand}. Do you have a quick minute?`,
        language: 'en',
      },
      tts: {
        voice_id: voiceId,
        // ElevenLabs constraint as of 2026-05: English-language agents must
        // use turbo_v2 or flash_v2 (NOT the v2_5 variants). flash_v2 is the
        // lowest-latency option, ~75ms time-to-first-byte.
        model_id: 'eleven_flash_v2',
        agent_output_audio_format: 'pcm_16000',
        // 4 = max latency optimization (some quality tradeoff, but on a
        // phone call the quality drop is imperceptible)
        optimize_streaming_latency: 4,
      },
      stt: { model: 'nova-2-general' },
      turn: {
        // turn_timeout 10s (was 15) — fires AI response sooner after user
        // stops talking. Default is too patient for snappy phone calls.
        turn_timeout: 10,
        mode: 'turn',
      },
      conversation: { max_duration_seconds: 600 },
    },
    metadata: {
      contndr_user_id: opts.userId,
      contndr_user_email: opts.userEmail || '',
    },
  };

  const res = await elFetch('/convai/agents/create', {
    method: 'POST',
    body: JSON.stringify(agentPayload),
  }, 'v1');

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs agent create failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const agent = await res.json();
  const record: UserAgentRecord = {
    agent_id: agent.agent_id,
    user_id: opts.userId,
    user_email: opts.userEmail,
    created_at: new Date().toISOString(),
    voice_id: voiceId,
  };
  await kv.set(`${AGENT_KV_PREFIX}${opts.userId}`, record);
  console.log(`[ConvAI] Created agent ${agent.agent_id} for user ${opts.userId}`);
  return { agent_id: agent.agent_id, created: true, record };
}

/**
 * Patches the user's agent with a fresh prompt + first message right before
 * a call. Pulls the playbook from KV, merges in ai_config (brand, ai_name,
 * etc.) and the specific lead, then PATCHes the agent.
 *
 * Called from the call-initiation paths in telnyx.tsx and ai-call-processor.tsx
 * (wiring up the call routing itself is Layer B).
 */
export async function syncAgentForCall(opts: {
  userId: string;
  userEmail?: string;
  ai_config: any;
  lead?: { name?: string; business?: string; email?: string; phone?: string };
}): Promise<{ agent_id: string; synced: boolean; error?: string }> {
  try {
    const { agent_id } = await getOrCreateUserAgent({
      userId: opts.userId,
      userEmail: opts.userEmail,
      defaultVoiceId: opts.ai_config?.voice_id,
      defaultAiName: opts.ai_config?.name || opts.ai_config?.ai_name,
      defaultBrand: opts.ai_config?.brand,
    });

    const playbook = await kv.get(`${PLAYBOOK_KV_PREFIX}${opts.userId}`) as PlaybookForAgent | null;

    const finalPrompt = buildAgentSystemPrompt({
      name: opts.ai_config?.name || opts.ai_config?.ai_name || 'Alex',
      role: opts.ai_config?.role || 'Sales Specialist',
      brand: opts.ai_config?.brand || 'Contndr',
      brand_tone: opts.ai_config?.brand_tone || 'professional',
      objective: opts.ai_config?.objective || 'book_call',
      knowledge_base: opts.ai_config?.knowledge_base || '',
      transfer_rules: opts.ai_config?.transfer_rules || [],
      qualification_questions: opts.ai_config?.qualification_questions || [],
      playbook: playbook || undefined,
      lead: opts.lead,
    });

    const firstMessage = opts.ai_config?.opening_line
      || `Hey ${opts.lead?.name && opts.lead.name !== 'Unknown' ? opts.lead.name.split(' ')[0] + '! ' : 'there! '}This is ${opts.ai_config?.name || 'Alex'} from ${opts.ai_config?.brand || 'Contndr'}. Do you have a quick minute?`;

    const patch = {
      conversation_config: {
        agent: {
          prompt: {
            prompt: finalPrompt,
            // Re-apply low-latency LLM settings on every sync so existing
            // agents (provisioned before we added these) get the upgrade.
            llm: 'gpt-4o-mini',
            temperature: 0.7,
            max_tokens: 60,
          },
          first_message: firstMessage,
        },
        tts: {
          ...(opts.ai_config?.voice_id ? { voice_id: opts.ai_config.voice_id } : {}),
          model_id: 'eleven_flash_v2',
          optimize_streaming_latency: 4,
        },
        turn: {
          turn_timeout: 10,
          mode: 'turn',
        },
      },
    };

    const res = await elFetch(`/convai/agents/${agent_id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }, 'v1');

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Agent PATCH failed (${res.status}): ${body.slice(0, 200)}`);
    }

    // Update last_synced_at marker
    const rec = await kv.get(`${AGENT_KV_PREFIX}${opts.userId}`) as UserAgentRecord | null;
    if (rec) {
      await kv.set(`${AGENT_KV_PREFIX}${opts.userId}`, { ...rec, last_synced_at: new Date().toISOString() });
    }
    console.log(`[ConvAI] Synced agent ${agent_id} for user ${opts.userId} (prompt: ${finalPrompt.length} chars)`);
    return { agent_id, synced: true };
  } catch (err: any) {
    console.error('[ConvAI] syncAgentForCall failed:', err?.message || err);
    return { agent_id: '', synced: false, error: err?.message || String(err) };
  }
}

// ─── User-facing endpoints ─────────────────────────────────────────

/**
 * GET /elevenlabs/my-agent
 * Returns the calling user's agent record. Creates an agent if missing.
 */
app.get('/my-agent', async (c) => {
  try {
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = c.req.header('Authorization')?.split(' ')[1] || '';
    const { user, error } = await (await import('./auth-helpers.tsx')).authGetUser(sb, token, 'CONVAI-MY-AGENT');
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

    const { agent_id, created, record } = await getOrCreateUserAgent({
      userId: user.id,
      userEmail: user.email || undefined,
    });
    return c.json({ success: true, agent_id, created, record });
  } catch (err: any) {
    console.error('[ConvAI] /my-agent error:', err);
    return c.json({ error: err?.message || 'Failed' }, 500);
  }
});

/**
 * POST /elevenlabs/my-agent/sync
 * Pushes the current playbook + KB into the user's agent. Used by the UI's
 * "Sync now" button for testing without making a real call.
 */
app.post('/my-agent/sync', async (c) => {
  try {
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = c.req.header('Authorization')?.split(' ')[1] || '';
    const { user, error } = await (await import('./auth-helpers.tsx')).authGetUser(sb, token, 'CONVAI-AGENT-SYNC');
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json().catch(() => ({}));
    const result = await syncAgentForCall({
      userId: user.id,
      userEmail: user.email || undefined,
      ai_config: body?.ai_config || { name: 'Alex', brand: 'Contndr', objective: 'book_call', brand_tone: 'friendly' },
      lead: body?.lead,
    });
    if (!result.synced) return c.json({ success: false, error: result.error }, 502);
    return c.json({ success: true, agent_id: result.agent_id });
  } catch (err: any) {
    console.error('[ConvAI] /my-agent/sync error:', err);
    return c.json({ error: err?.message || 'Failed' }, 500);
  }
});

/**
 * POST /elevenlabs/webhooks/conversation  (Layer C)
 *
 * ElevenLabs posts here after a Conversational AI call completes. We use
 * the conversation_id to find the call:* record we wrote when initiating
 * the outbound call, then enrich it with transcript, duration, and
 * outcome so the AI Calls dashboard reflects the completed call.
 *
 * REGISTER THIS WEBHOOK in ElevenLabs portal:
 *   Settings → Webhooks → "Post-call" event
 *   URL: https://zylftkvcasvznhkmyzfj.supabase.co/functions/v1/make-server-a8b2511f/elevenlabs/webhooks/conversation
 *   Events: post_call_transcription (and any related call events)
 *
 * ElevenLabs payload shape (post_call_transcription):
 *   {
 *     type: 'post_call_transcription',
 *     event_timestamp: 1234567890,
 *     data: {
 *       conversation_id, agent_id, status,
 *       transcript: [{ role, message, time_in_call_secs, ... }],
 *       metadata: { call_duration_secs, start_time_unix_secs, ... },
 *       analysis: { call_successful, transcript_summary, ... },
 *     }
 *   }
 */
app.post('/webhooks/conversation', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    // ElevenLabs nests everything under `data` for the post_call events,
    // but earlier event types use the top level — handle both.
    const data = body?.data || body;
    const conversationId = data?.conversation_id || body?.conversation_id;
    const agentId = data?.agent_id || body?.agent_id;
    const eventType = body?.type || data?.type || 'unknown';
    const status = data?.status || null;
    const transcript = Array.isArray(data?.transcript) ? data.transcript : [];
    const duration = data?.metadata?.call_duration_secs
      || data?.call_duration_secs
      || body?.call_duration_secs
      || 0;
    const summary = data?.analysis?.transcript_summary || null;
    const callSuccessful = data?.analysis?.call_successful || null;

    console.log(`[ConvAI WEBHOOK] type=${eventType} conversation=${conversationId} agent=${agentId} duration=${duration}s status=${status}`);

    if (!conversationId) {
      console.warn('[ConvAI WEBHOOK] No conversation_id in payload — saving raw event for inspection.');
      await kv.set(`convai_event:unmatched:${Date.now()}`, body).catch(() => {});
      return c.json({ success: true });
    }

    // Find the call:* record by conversation_id via the reverse index we
    // wrote at call initiation in index.ts (call_by_convai:CONV_ID → call_id).
    const callId = await kv.get(`call_by_convai:${conversationId}`);
    if (!callId) {
      console.warn(`[ConvAI WEBHOOK] No call:* record found for conversation=${conversationId}. Storing raw event.`);
      await kv.set(`convai_event:${conversationId}`, {
        received_at: new Date().toISOString(),
        agent_id: agentId,
        event: eventType,
        duration,
        summary,
        transcript: transcript.slice(0, 50), // cap to keep KV value small
        payload: body,
      }).catch(() => {});
      return c.json({ success: true });
    }

    const callRecord = await kv.get(`call:${callId}`);
    if (!callRecord) {
      console.warn(`[ConvAI WEBHOOK] call_by_convai pointed at missing call:${callId}`);
      return c.json({ success: true });
    }

    // Determine final status. Post-call events always mean the call has
    // ended. Mark as 'ended' so the dashboard counts it as completed.
    const ended_at = new Date().toISOString();
    const startedMs = callRecord.started_at ? new Date(callRecord.started_at).getTime() : Date.now() - duration * 1000;
    const durationMs = Math.max(0, Date.now() - startedMs);
    const outcome = callSuccessful === 'success'
      ? 'booked'
      : callSuccessful === 'failure'
        ? 'no_outcome'
        : (callRecord.outcome || null);

    const updated = {
      ...callRecord,
      status: 'ended',
      ended_at,
      duration_secs: duration || Math.round(durationMs / 1000),
      convai_transcript: transcript.slice(0, 100).map((t: any) => ({
        role: t.role,
        text: t.message || t.text || '',
        at: t.time_in_call_secs,
      })),
      convai_summary: summary,
      convai_call_successful: callSuccessful,
      outcome,
      updated_at: ended_at,
    };
    await kv.set(`call:${callId}`, updated);
    console.log(`[ConvAI WEBHOOK] ✅ Attributed conversation=${conversationId} → call:${callId} (duration=${duration}s, outcome=${outcome})`);
    return c.json({ success: true });
  } catch (err: any) {
    console.error('[ConvAI WEBHOOK] error:', err?.message || err);
    return c.json({ success: true }); // Always 200 so ElevenLabs doesn't retry
  }
});

export default app;
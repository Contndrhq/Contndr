// AI Provider — OpenAI GPT-4o-mini (fast, reliable, cost-effective)
// Centralized provider: ALL server files route AI calls through here.
// Switched from Gemini due to persistent model deprecation / 404 issues.

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIRequestOptions {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface AIResponse {
  text: string;
  provider: 'openai';
  model: string;
  latency_ms?: number;
  finish_reason?: string;
}

const MODEL = 'gpt-4o-mini';

// ── OpenAI Chat Completions via REST API ─────────────────────
async function callOpenAI(opts: AIRequestOptions): Promise<AIResponse> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const t0 = Date.now();

  // OpenAI natively supports system/user/assistant roles — pass through directly
  const messages = opts.messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  const body: any = {
    model: MODEL,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: Math.max(opts.maxTokens ?? 1024, 256),
  };

  // JSON mode
  if (opts.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const url = 'https://api.openai.com/v1/chat/completions';

  // Abort after 55 seconds (edge functions have 60s limit)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (fetchErr: any) {
    clearTimeout(timeout);
    if (fetchErr.name === 'AbortError') {
      throw new Error(`OpenAI API request timed out after 55s (model: ${MODEL})`);
    }
    throw fetchErr;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errBody = await response.text();
    console.error(`[AI-PROVIDER] OpenAI HTTP ${response.status}: ${errBody.slice(0, 500)}`);
    throw new Error(`OpenAI API error ${response.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await response.json();

  const choice = data.choices?.[0];
  if (!choice) {
    console.error('[AI-PROVIDER] No choices. Full response:', JSON.stringify(data).slice(0, 500));
    throw new Error('[AI-PROVIDER] OpenAI returned no choices');
  }

  let text = choice.message?.content || '';
  const finishReason = choice.finish_reason || 'unknown';

  // Handle truncated JSON when finish_reason is 'length' (output hit max_tokens)
  if (finishReason === 'length' && text && opts.jsonMode) {
    console.warn(`[AI-PROVIDER] Response truncated (finish_reason: length). Attempting JSON repair...`);
    // Try to close any open JSON structures
    text = repairTruncatedJSON(text);
  }

  if (!text) {
    console.error('[AI-PROVIDER] Empty response. Finish reason:', finishReason);
    throw new Error(`OpenAI returned empty response (finish_reason: ${finishReason})`);
  }

  const latency = Date.now() - t0;
  console.log(`[AI-PROVIDER] ${MODEL} response: ${text.length} chars in ${latency}ms (finish_reason: ${finishReason})`);

  return { text, provider: 'openai', model: MODEL, latency_ms: latency, finish_reason: finishReason };
}

// ── Repair truncated JSON ──────────────────────────────────────
function repairTruncatedJSON(text: string): string {
  // First try: maybe it's already valid
  try { JSON.parse(text); return text; } catch {}

  // Try to extract just the "message" field if present
  const msgMatch = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (msgMatch) {
    const msgValue = msgMatch[1];
    // Check if there's an actions array started
    const actionsMatch = text.match(/"actions"\s*:\s*\[([\s\S]*)/);
    let actions: any[] = [];
    if (actionsMatch) {
      // Try to parse complete action objects from the partial array
      const partialArr = actionsMatch[1];
      const objRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
      let m;
      while ((m = objRegex.exec(partialArr)) !== null) {
        try { actions.push(JSON.parse(m[0])); } catch {}
      }
    }
    const repaired = JSON.stringify({ message: msgValue.replace(/\\n/g, '\n').replace(/\\"/g, '"'), actions });
    console.log(`[AI-PROVIDER] Repaired truncated JSON: extracted message (${msgValue.length} chars) + ${actions.length} actions`);
    return repaired;
  }

  // Last resort: close open braces/brackets
  let repaired = text;
  let openBraces = 0, openBrackets = 0, inStr = false, esc = false;
  for (const ch of repaired) {
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (!inStr) {
      if (ch === '{') openBraces++;
      if (ch === '}') openBraces--;
      if (ch === '[') openBrackets++;
      if (ch === ']') openBrackets--;
    }
  }
  // If we're inside a string, close it
  if (inStr) repaired += '"';
  // Close brackets and braces
  while (openBrackets > 0) { repaired += ']'; openBrackets--; }
  while (openBraces > 0) { repaired += '}'; openBraces--; }

  try { JSON.parse(repaired); return repaired; } catch {}
  return text; // give up, return as-is
}

// ── Main entry point ────────────────────────────────────────────
export async function generateAI(opts: AIRequestOptions): Promise<AIResponse> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');

  if (!openaiKey) {
    throw new Error('[AI-PROVIDER] OPENAI_API_KEY not configured — add it in Supabase dashboard > Edge Functions > Secrets');
  }

  return await callOpenAI(opts);
}

// ── Convenience: generate with retries ──────────────────────────
export async function generateAIWithRetries(
  opts: AIRequestOptions,
  maxRetries = 3,
): Promise<AIResponse> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await generateAI(opts);
    } catch (err) {
      lastError = err as Error;
      console.log(`[AI-PROVIDER] Attempt ${attempt}/${maxRetries} failed: ${lastError.message?.slice(0, 200)}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw lastError || new Error('[AI-PROVIDER] All retries exhausted');
}
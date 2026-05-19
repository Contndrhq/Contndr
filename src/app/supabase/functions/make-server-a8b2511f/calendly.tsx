/**
 * Calendly Integration
 * Handles event type fetching, booking link generation, and webhook processing
 */

import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as kv from './kv-retry.tsx';

const app = new Hono();

// Enable CORS for all Calendly routes
app.use('*', cors());

// Global error handler for Calendly routes
app.onError((err, c) => {
  console.error('❌ Calendly route error:', err);
  return c.json({ 
    success: false,
    error: 'Internal server error', 
    details: err.message 
  }, 500);
});

const CALENDLY_API_URL = 'https://api.calendly.com';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

// Helper to get authenticated user from request
async function getUser(c: any) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    throw new Error('No Authorization header');
  }

  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { data: { user }, error } = await supabaseAuth.auth.getUser();
      if (error) throw error;
      if (!user) throw new Error('No user returned');
      return user;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const isTransient = msg.includes('connection reset') || msg.includes('error sending request')
        || msg.includes('ECONNRESET') || msg.includes('broken pipe')
        || msg.includes('network error') || msg.includes('client error')
        || msg.includes('SendRequest') || msg.includes('ConnectionAborted')
        || msg.includes('connection closed before message completed')
        || msg.includes('schema cache') || msg.includes('PGRST002')
        || msg.includes('Database error') || msg.includes('Unexpected failure')
        || msg.includes('fetch failed') || msg.includes('Failed to fetch')
        || msg.includes('timeout') || msg.includes('connection unexpectedly');
      if (isTransient && attempt < MAX_RETRIES - 1) {
        const delay = 300 * Math.pow(2, attempt);
        console.log(`[CALENDLY] Auth retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms: ${msg}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error('Unauthorized');
    }
  }
  throw new Error('Unauthorized');
}

// Helper to get Calendly API Key for the user
async function getApiKey(user: any) {
  // Legacy support for admin
  if (user.email === 'admin@contndr.com') {
    const envKey = Deno.env.get('CALENDLY_API_KEY');
    if (envKey) return envKey;
  }

  // Get from user config
  const config = await kv.get(`calendly:config:${user.id}`);
  return config?.apiKey || null;
}

/**
 * Save Calendly Configuration
 */
app.post('/config', async (c) => {
  try {
    const user = await getUser(c);
    const { apiKey } = await c.req.json();

    if (!apiKey) {
      return c.json({ error: 'API Key is required' }, 400);
    }

    // Validate the key by making a test request
    const response = await fetch(`${CALENDLY_API_URL}/users/me`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return c.json({ error: 'Invalid API Key' }, 400);
    }

    // Save to KV
    await kv.set(`calendly:config:${user.id}`, { 
      apiKey,
      updatedAt: new Date().toISOString() 
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('Error saving Calendly config:', error);
    if (error.message === 'Unauthorized') {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Get current user information from Calendly
 */
app.get('/user', async (c) => {
  try {
    const user = await getUser(c);
    const apiKey = await getApiKey(user);

    if (!apiKey) {
      // Return 404 to indicate not configured (so frontend can show connect screen)
      return c.json({ error: 'Not configured' }, 404);
    }

    const response = await fetch(`${CALENDLY_API_URL}/users/me`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Calendly API error:', error);
      
      // If unauthorized, maybe key expired?
      if (response.status === 401) {
        return c.json({ error: 'Invalid API Key' }, 401);
      }
      
      return c.json({ error: 'Failed to fetch user info from Calendly' }, response.status);
    }

    const data = await response.json();
    
    return c.json({
      uri: data.resource.uri,
      name: data.resource.name,
      email: data.resource.email,
      schedulingUrl: data.resource.scheduling_url,
      timezone: data.resource.timezone,
      avatarUrl: data.resource.avatar_url,
    });
  } catch (error) {
    console.error('Error fetching Calendly user:', error);
    if (error.message === 'Unauthorized') {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Get all event types (meeting types) for the user
 */
app.get('/event-types', async (c) => {
  try {
    const user = await getUser(c);
    const apiKey = await getApiKey(user);

    if (!apiKey) {
      return c.json({ error: 'Not configured' }, 404);
    }

    // First get the user URI
    const userResponse = await fetch(`${CALENDLY_API_URL}/users/me`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!userResponse.ok) {
      return c.json({ error: 'Failed to fetch user info' }, userResponse.status);
    }

    const userData = await userResponse.json();
    const userUri = userData.resource.uri;

    // Get event types for this user
    const response = await fetch(
      `${CALENDLY_API_URL}/event_types?user=${userUri}&active=true`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Calendly API error:', error);
      return c.json({ error: 'Failed to fetch event types' }, response.status);
    }

    const data = await response.json();
    
    const eventTypes = (data.collection || []).map((et: any) => ({
      uri: et.uri,
      name: et.name,
      slug: et.slug,
      duration: et.duration,
      schedulingUrl: et.scheduling_url,
      description: et.description_plain || et.description_html || '',
      color: et.color,
      active: et.active,
      kind: et.kind,
      type: et.type,
    }));

    return c.json({ eventTypes });
  } catch (error) {
    console.error('Error fetching event types:', error);
    if (error.message === 'Unauthorized') {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Generate a personalized scheduling link for a lead
 * Includes UTM parameters and prefilled data
 */
app.post('/scheduling-link', async (c) => {
  try {
    const user = await getUser(c);
    const apiKey = await getApiKey(user);
    
    if (!apiKey) {
      return c.json({ error: 'Calendly not connected' }, 400);
    }

    const body = await c.req.json();
    const { eventTypeUri, leadId, leadEmail, leadName, campaignId, brand } = body;

    if (!eventTypeUri) {
      return c.json({ error: 'Event type URI is required' }, 400);
    }

    // Get the event type details to get the base scheduling URL
    const response = await fetch(`${CALENDLY_API_URL}/event_types/${eventTypeUri.split('/').pop()}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return c.json({ error: 'Failed to fetch event type' }, response.status);
    }

    const data = await response.json();
    const baseUrl = data.resource.scheduling_url;

    // Build personalized URL with UTM parameters and prefilled data
    const params = new URLSearchParams();
    
    // Add prefilled guest information
    if (leadEmail) {
      params.append('email', leadEmail);
    }
    if (leadName) {
      params.append('name', leadName);
    }
    
    // Add tracking parameters
    if (campaignId) {
      params.append('utm_campaign', campaignId);
    }
    if (brand) {
      params.append('utm_source', brand);
    }
    if (leadId) {
      params.append('utm_content', leadId);
    }
    params.append('utm_medium', 'sales_automation');

    const schedulingLink = `${baseUrl}?${params.toString()}`;

    // Store the link generation in KV for tracking
    const linkRecord = {
      leadId,
      leadEmail,
      leadName,
      eventTypeUri,
      schedulingLink,
      campaignId,
      brand,
      userId: user.id,
      createdAt: new Date().toISOString(),
    };

    await kv.set(`calendly:link:${user.id}:${leadId}`, linkRecord);

    return c.json({ 
      success: true,
      schedulingLink,
      eventType: {
        name: data.resource.name,
        duration: data.resource.duration,
      }
    });
  } catch (error) {
    console.error('Error generating scheduling link:', error);
    if (error.message === 'Unauthorized') {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Get scheduled events (meetings that have been booked)
 */
app.get('/scheduled-events', async (c) => {
  try {
    const user = await getUser(c);
    
    // Add timeout for KV lookup
    const apiKeyTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('API key lookup timeout')), 4000)
    );
    
    const apiKey = await Promise.race([
      getApiKey(user),
      apiKeyTimeout
    ]).catch(() => null);

    if (!apiKey) {
      // Return 200 with empty payload — 404 spams the browser console even when caught in JS
      return c.json({ collection: [], events: [], pagination: { count: 0 }, configured: false }, 200);
    }

    // Get user URI
    const userResponse = await fetch(`${CALENDLY_API_URL}/users/me`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!userResponse.ok) {
      return c.json({ error: 'Failed to fetch user info' }, userResponse.status);
    }

    const userData = await userResponse.json();
    const userUri = userData.resource.uri;

    // Build query parameters
    const params = new URLSearchParams({
      user: userUri,
      status: 'active',
      sort: 'start_time:desc',
    });

    // Optional filters from query string
    const minStartTime = c.req.query('min_start_time');
    const maxStartTime = c.req.query('max_start_time');
    const count = c.req.query('count') || '100';

    if (minStartTime) params.append('min_start_time', minStartTime);
    if (maxStartTime) params.append('max_start_time', maxStartTime);
    params.append('count', count);

    // Fetch scheduled events
    const response = await fetch(
      `${CALENDLY_API_URL}/scheduled_events?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[CALENDLY] Failed to fetch meetings:', {
        status: response.status,
        statusText: response.statusText
      });
      console.error('[CALENDLY] Error details:', errorText);
      
      if (response.status === 401) {
        return c.json({ 
          error: 'Calendly API authentication failed. Please check your API Key.',
          details: 'The API key may be expired or invalid.',
        }, 401);
      }
      
      return c.json({ 
        error: 'Failed to fetch scheduled events',
        details: errorText 
      }, response.status);
    }

    const data = await response.json();

    // Fetch invitee details for each event
    const eventsWithDetails = await Promise.all(
      (data.collection || []).map(async (event: any) => {
        try {
          // Get invitees for this event
          const inviteesResponse = await fetch(
            `${CALENDLY_API_URL}/scheduled_events/${event.uri.split('/').pop()}/invitees`,
            {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
            }
          );

          let invitees = [];
          if (inviteesResponse.ok) {
            const inviteesData = await inviteesResponse.json();
            invitees = (inviteesData.collection || []).map((inv: any) => ({
              email: inv.email,
              name: inv.name,
              status: inv.status,
              createdAt: inv.created_at,
              canceledAt: inv.canceled_at,
              rescheduled: inv.rescheduled,
            }));
          }

          return {
            uri: event.uri,
            name: event.name,
            status: event.status,
            startTime: event.start_time,
            endTime: event.end_time,
            eventType: event.event_type,
            location: event.location,
            inviteesCounter: event.invitees_counter,
            createdAt: event.created_at,
            updatedAt: event.updated_at,
            invitees,
          };
        } catch (error) {
          console.error('Error fetching invitees:', error);
          return {
            uri: event.uri,
            name: event.name,
            status: event.status,
            startTime: event.start_time,
            endTime: event.end_time,
            eventType: event.event_type,
            location: event.location,
            inviteesCounter: event.invitees_counter,
            createdAt: event.created_at,
            updatedAt: event.updated_at,
            invitees: [],
          };
        }
      })
    );

    return c.json({ 
      events: eventsWithDetails,
      pagination: data.pagination,
    });
  } catch (error) {
    console.error('Error fetching scheduled events:', error);
    if (error.message === 'Unauthorized') {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Webhook handler for Calendly events
 * Handles: invitee.created, invitee.canceled
 */
app.post('/webhook', async (c) => {
  try {
    // ── Signature verification ──
    // Calendly sends a `Calendly-Webhook-Signature` header with format
    //   t=<unix_ts>,v1=<hex_hmac_sha256>
    // signed over `t.<raw_body>` using CALENDLY_WEBHOOK_SIGNING_KEY.
    // We read the raw body here (before JSON parse) so the HMAC matches.
    const signingKey = Deno.env.get('CALENDLY_WEBHOOK_SIGNING_KEY');
    const sigHeader = c.req.header('Calendly-Webhook-Signature') || c.req.header('calendly-webhook-signature') || '';
    const rawBody = await c.req.text();

    if (signingKey) {
      const ok = await verifyCalendlySignature(sigHeader, rawBody, signingKey);
      if (!ok) {
        console.warn('[CALENDLY] ❌ Invalid webhook signature — rejecting');
        return c.json({ error: 'invalid signature' }, 401);
      }
    } else {
      // Soft warning: still process, but log so we notice.
      console.warn('[CALENDLY] ⚠️ CALENDLY_WEBHOOK_SIGNING_KEY not set — webhook is unauthenticated. Set this secret in production.');
    }

    const payload = JSON.parse(rawBody);
    console.log('📅 Calendly webhook received:', payload.event);

    const event = payload.event;

    // Note: Webhooks are global for now, but we process them based on UTM content
    // which allows us to find the correct lead in the DB.

    // Handle different webhook events
    switch (event) {
      case 'invitee.created': {
        // New meeting booked
        const invitee = payload.payload;
        const eventUri = invitee.event;

        console.log(`✅ New meeting booked: ${invitee.name} (${invitee.email})`);

        // Try to find the associated lead from UTM parameters
        const utmContent = invitee.tracking?.utm_content;

        let leadUserId: string | undefined;

        if (utmContent) {
          // Update lead status in Supabase + grab the owner for push fanout
          const { data: updated, error } = await supabase
            .from('leads')
            .update({
              status: 'meeting_scheduled',
              calendly_event_uri: eventUri,
              meeting_scheduled_at: invitee.created_at,
            })
            .eq('id', utmContent)
            .select('user_id')
            .single();

          if (!error) {
            console.log(`✓ Updated lead ${utmContent} status to meeting_scheduled`);
            leadUserId = updated?.user_id;
          }
        }

        // Native push: phone buzz on meeting book
        if (leadUserId) {
          (async () => {
            try {
              const { sendNativePush } = await import('./native-push.tsx');
              const when = (invitee.scheduled_event?.start_time || invitee.event_start_time || '').toString();
              const whenLabel = when ? new Date(when).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
              await sendNativePush(leadUserId, {
                title: '📅 Meeting booked',
                body: whenLabel ? `${invitee.name} — ${whenLabel}` : `${invitee.name} just booked a meeting`,
                data: { type: 'meeting_booked', lead_id: utmContent || '', event_uri: eventUri },
              });
            } catch (e) {
              console.warn('[CALENDLY] meeting-push failed:', (e as any)?.message);
            }
          })();
        }

        // Store webhook event in KV for tracking
        await kv.set(`calendly:webhook:${Date.now()}`, {
          type: 'invitee.created',
          invitee,
          timestamp: new Date().toISOString(),
        });

        break;
      }

      case 'invitee.canceled': {
        // Meeting canceled
        const invitee = payload.payload;
        console.log(`❌ Meeting canceled: ${invitee.name} (${invitee.email})`);

        const utmContent = invitee.tracking?.utm_content;
        
        if (utmContent) {
          // Update lead status back to contacted or follow_up
          const { error } = await supabase
            .from('leads')
            .update({ 
              status: 'follow_up',
              calendly_event_uri: null,
              meeting_canceled_at: invitee.canceled_at,
            })
            .eq('id', utmContent);

          if (!error) {
            console.log(`✓ Updated lead ${utmContent} status to follow_up (meeting canceled)`);
          }
        }

        await kv.set(`calendly:webhook:${Date.now()}`, {
          type: 'invitee.canceled',
          invitee,
          timestamp: new Date().toISOString(),
        });

        break;
      }

      default:
        console.log(`ℹ️ Unhandled Calendly webhook event: ${event}`);
    }

    return c.json({ received: true });
  } catch (error) {
    console.error('Error processing Calendly webhook:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Get meetings associated with a specific lead
 */
app.get('/lead/:leadId/meetings', async (c) => {
  try {
    const user = await getUser(c);
    const leadId = c.req.param('leadId');

    // Get lead from database
    const { data: lead, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .eq('user_id', user.id)
      .single();

    if (error || !lead) {
      return c.json({ error: 'Lead not found' }, 404);
    }

    // Get scheduling link if exists
    const linkRecord = await kv.get(`calendly:link:${user.id}:${leadId}`);

    return c.json({
      lead: {
        id: lead.id,
        business_name: lead.business_name,
        email: lead.email,
        status: lead.status,
      },
      calendlyEventUri: lead.calendly_event_uri,
      meetingScheduledAt: lead.meeting_scheduled_at,
      meetingCanceledAt: lead.meeting_canceled_at,
      schedulingLink: linkRecord?.schedulingLink,
    });
  } catch (error) {
    console.error('Error fetching lead meetings:', error);
    if (error.message === 'Unauthorized') {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Calendly webhook HMAC verification.
 *
 * Header shape: `Calendly-Webhook-Signature: t=<ts>,v1=<hex>`
 * Signed payload: `<ts>.<raw_body>` with HMAC-SHA256(signing_key).
 * Reference: https://developer.calendly.com/api-docs/ZG9jOjE2OTYz-webhook-signatures
 *
 * Also enforces a ±5min replay window — if `t` is older than 5 minutes
 * we reject, so an attacker can't replay a captured webhook indefinitely.
 */
async function verifyCalendlySignature(header: string, body: string, key: string): Promise<boolean> {
  try {
    if (!header) return false;
    const parts = Object.fromEntries(header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })) as Record<string, string>;
    const ts = parts['t'];
    const sig = parts['v1'];
    if (!ts || !sig) return false;
    const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(ts, 10));
    if (!Number.isFinite(age) || age > 300) {
      console.warn('[CALENDLY] webhook timestamp out of window:', age, 's');
      return false;
    }
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sigBytes = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(`${ts}.${body}`));
    const hex = Array.from(new Uint8Array(sigBytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
    // constant-time compare
    if (hex.length !== sig.length) return false;
    let mismatch = 0;
    for (let i = 0; i < hex.length; i++) mismatch |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
    return mismatch === 0;
  } catch (e) {
    console.warn('[CALENDLY] signature verify error:', (e as any)?.message);
    return false;
  }
}

export default app;
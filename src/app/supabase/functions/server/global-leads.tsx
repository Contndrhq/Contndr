/**
 * Shared Leads — backend module
 *
 * Makes leads imported by or@roadr.com visible to ALL users,
 * with sensitive fields (email, phone) gated behind a reveal system
 * that respects subscription-tier limits.
 *
 * Data lives in the existing Supabase `leads` table; reveals and
 * monthly counters are tracked in KV:
 *
 *   gl_reveal:{userId}:{leadId}            – reveal record
 *   gl_reveals_month:{userId}:{YYYY-MM}    – { count: N }
 */

import * as kv from './kv-retry.tsx';
import { getUserSubscriptionStatus } from './contndr-billing.tsx';
import { createClient } from "npm:@supabase/supabase-js@2";

// ─── Helpers ────────────────────────────────────────────────────────

/** Service-role client that bypasses RLS */
let _adminClient: any = null;
function adminClient() {
  if (!_adminClient) {
    _adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        }
      }
    );
  }
  return _adminClient;
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Tier config ────────────────────────────────────────────────────

export interface UserEntitlements {
  user_id: string;
  plan_tier: 'free' | 'starter' | 'professional' | 'growth';
  monthly_reveal_limit: number | null; // null = unlimited
  monthly_reveals_used: number;
  can_export: boolean;
  can_view_phone: boolean;
  can_view_email: boolean;
}

const TIER_CONFIG: Record<string, Omit<UserEntitlements, 'user_id' | 'monthly_reveals_used'>> = {
  free: {
    plan_tier: 'free',
    monthly_reveal_limit: 5,
    can_export: false,
    can_view_phone: false,
    can_view_email: true,
  },
  starter: {
    plan_tier: 'starter',
    monthly_reveal_limit: 50,
    can_export: false,
    can_view_phone: false,
    can_view_email: true,
  },
  professional: {
    plan_tier: 'professional',
    monthly_reveal_limit: 200,
    can_export: true,
    can_view_phone: true,
    can_view_email: true,
  },
  growth: {
    plan_tier: 'growth',
    monthly_reveal_limit: null,
    can_export: true,
    can_view_phone: true,
    can_view_email: true,
  },
};

// ─── Admin email(s) whose leads become global ───────────────────────

const GLOBAL_SOURCE_EMAILS = ['or@roadr.com', 'admin@contndr.com', 'or@contndr.com'];

/** Look up user ids for the global source emails (with retry for transient errors) */
async function getGlobalSourceUserIds(): Promise<string[]> {
  const sb = adminClient();
  const ids: string[] = [];
  const MAX_ATTEMPTS = 3;
  try {
    let users: any[] | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
        if (error) {
          const msg = error?.message ?? String(error);
          const isTransient = msg.includes('connection reset') || msg.includes('fetch failed')
            || msg.includes('error sending request') || msg.includes('tls handshake')
            || msg.includes('client error') || msg.includes('timeout') || msg.includes('ECONNRESET')
            || msg.includes('AuthRetryableFetchError') || (error as any)?.name === 'AuthRetryableFetchError';
          if (isTransient && attempt < MAX_ATTEMPTS - 1) {
            console.log(`[SHARED LEADS] listUsers transient error (attempt ${attempt + 1}/${MAX_ATTEMPTS}), retrying: ${msg.slice(0, 120)}`);
            await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt)));
            continue;
          }
          console.error('[SHARED LEADS] listUsers error:', error);
          return [];
        }
        users = data?.users || [];
        break;
      } catch (innerErr: any) {
        const msg = innerErr?.message ?? String(innerErr);
        const isTransient = msg.includes('connection reset') || msg.includes('fetch failed')
          || msg.includes('error sending request') || msg.includes('tls handshake')
          || msg.includes('client error') || msg.includes('timeout') || msg.includes('ECONNRESET')
          || innerErr?.name === 'AuthRetryableFetchError';
        if (isTransient && attempt < MAX_ATTEMPTS - 1) {
          console.log(`[SHARED LEADS] listUsers transient exception (attempt ${attempt + 1}/${MAX_ATTEMPTS}), retrying: ${msg.slice(0, 120)}`);
          await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt)));
          continue;
        }
        throw innerErr;
      }
    }
    if (!users) return [];
    for (const email of GLOBAL_SOURCE_EMAILS) {
      const found = users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
      if (found) ids.push(found.id);
    }
  } catch (err: any) {
    console.error('[SHARED LEADS] getGlobalSourceUserIds exception:', err?.message || err);
    return [];
  }
  return [...new Set(ids)];
}

// Cache source user IDs for 10 minutes to avoid repeated auth lookups
let _cachedSourceIds: string[] | null = null;
let _cachedSourceIdsAt = 0;

export async function getCachedSourceUserIds(): Promise<string[]> {
  if (_cachedSourceIds && Date.now() - _cachedSourceIdsAt < 10 * 60 * 1000) {
    return _cachedSourceIds;
  }
  _cachedSourceIds = await getGlobalSourceUserIds();
  _cachedSourceIdsAt = Date.now();
  console.log(`[SHARED LEADS] Resolved global source user IDs:`, _cachedSourceIds);
  return _cachedSourceIds;
}

// ─── Core functions ────────────────────────────────────────────────

export async function getUserEntitlements(user: any): Promise<UserEntitlements> {
  const sub = await getUserSubscriptionStatus(user);
  const planName = sub.plan || 'none';

  let tier = 'free';
  if (sub.status === 'active') {
    if (planName === 'growth') tier = 'growth';
    else if (planName === 'professional') tier = 'professional';
    else if (planName === 'starter') tier = 'starter';
    else tier = 'starter';
  } else if (sub.isWhitelisted) {
    tier = 'growth';
  }

  const config = TIER_CONFIG[tier] || TIER_CONFIG.free;

  const monthKey = `gl_reveals_month:${user.id}:${getCurrentMonth()}`;
  const monthData = await kv.get(monthKey);

  return {
    user_id: user.id,
    ...config,
    monthly_reveals_used: monthData?.count || 0,
  };
}

/**
 * Fetch shared leads from the actual `leads` table.
 * Uses service role to bypass RLS.
 * Returns ALL leads in the database (excluding the caller's own),
 * with sensitive fields stripped for unrevealed leads.
 * This lets non-admin users see the full database with blur.
 */
export async function listSharedLeads(options: {
  search?: string;
  page?: number;
  per_page?: number;
  user_id: string; // caller — to check reveals
  user_email?: string; // caller email — to check if admin
  skip_reveals?: boolean; // Skip KV reveal lookup for faster listing
}): Promise<{
  leads: any[];
  total: number;
  page: number;
  per_page: number;
  revealed_ids: string[];
}> {
  const { search = '', page = 1, per_page = 50, user_id, user_email = '', skip_reveals = false } = options;
  const sb = adminClient();

  // Check if user is admin
  const ADMIN_UIDS = ['004b2df9-3e3f-48ec-acfd-5374ab55b09f'];
  const isAdmin = user_email.toLowerCase() === 'or@roadr.com' || user_email.toLowerCase() === 'admin@contndr.com' || user_email.toLowerCase() === 'or@contndr.com' || ADMIN_UIDS.includes(user_id);
  
  console.log(`[SHARED LEADS] Fetching leads for user ${user_id} (${user_email}), isAdmin=${isAdmin}, skip_reveals=${skip_reveals}`);

  // 2. Build query — Fetch ALL leads (excluding the caller's own)
  // For admin users, we also exclude their own leads to prevent duplicates
  // since they are already loaded in the main CRM view.
  //
  // IMPORTANT: This query can timeout on large datasets. We use estimated count
  // and rely on proper pagination to keep query times low.
  
  let query = sb
    .from('leads')
    .select(
      'id, created_at, business_name, contact_name, job_title, city, state, country, email, phone, linkedin, website, industry, keywords, status, user_id, employees, address, category', 
      { count: 'estimated' } // Use estimated count instead of exact to avoid slow COUNT(*)
    )
    .order('created_at', { ascending: false });

  // Always exclude own leads (for both admins and regular users)
  if (isAdmin) {
    // Admins shouldn't see OTHER admins' leads as "shared" since they see them as "My Leads"
    // So exclude ALL admin IDs
    const adminIds = await getCachedSourceUserIds();
    // Also include self just in case getCachedSourceUserIds missed it (though it shouldn't)
    const excludeIds = Array.from(new Set([...adminIds, user_id]));
    query = query.not('user_id', 'in', `(${excludeIds.join(',')})`);
  } else {
    query = query.neq('user_id', user_id);
  }

  if (search) {
    // Supabase text search across multiple columns using or()
    query = query.or(
      `business_name.ilike.%${search}%,contact_name.ilike.%${search}%,email.ilike.%${search}%,category.ilike.%${search}%,city.ilike.%${search}%,address.ilike.%${search}%`
    );
  }

  // Paginate
  const start = (page - 1) * per_page;
  query = query.range(start, start + per_page - 1);

  let data: any[] | null = null;
  let count: number | null = null;
  let queryError: any = null;

  // Use a client-side 7s timeout — don't wait for the DB's own statement_timeout (57014).
  // On timeout: return empty data gracefully so the UI shows nothing rather than an error.
  // On PGRST002 / schema cache: retry once after a longer warm-up delay.
  const CLIENT_TIMEOUT_MS = 7000;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: any;
    try {
      res = await Promise.race([
        query,
        new Promise<{ data: null; count: null; error: { code: string; message: string } }>((resolve) =>
          setTimeout(() => resolve({ data: null, count: null, error: { code: 'CLIENT_TIMEOUT', message: 'Query timed out on client' } }), CLIENT_TIMEOUT_MS)
        ),
      ]);
    } catch (raceErr: any) {
      console.warn('[SHARED LEADS] Query race error:', raceErr?.message);
      res = { data: null, count: null, error: { code: 'RACE_ERROR', message: raceErr?.message } };
    }

    if (!res.error) {
      data = res.data;
      count = res.count;
      queryError = null;
      break;
    }

    const code = res.error.code || '';
    const msg = res.error.message || '';
    const isTimeout = code === '57014' || code === 'CLIENT_TIMEOUT' || msg.includes('timeout') || msg.includes('timed out');
    const isSchemaCache = code === 'PGRST002' || msg.includes('schema cache');
    const isSharedMemory = msg.includes('shared memory');

    if (isTimeout) {
      // Return empty gracefully — retrying a timed-out query just adds DB load
      console.warn(`[SHARED LEADS] Query timed out (attempt ${attempt + 1}), returning empty`);
      data = null;
      count = 0;
      queryError = null;
      break;
    }

    queryError = res.error;
    if ((isSchemaCache || isSharedMemory) && attempt === 0) {
      console.warn(`[SHARED LEADS] Transient DB error (${code}), retrying in 1.5s...`);
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    break;
  }
  if (queryError) {
    console.error('[SHARED LEADS] Query error:', queryError);
    throw queryError;
  }

  const rawLeads = data || [];
  const total = count || 0;

  // 3. Get user's reveals - with timeout protection
  // Skip when skip_reveals=true for fast initial listing
  let revealedMap = new Map<string, any>();
  let revealed_ids: string[] = [];
  
  if (!skip_reveals) {
    try {
      // Set a 5-second timeout for reveals lookup
      const revealPromise = kv.getByPrefix(`gl_reveal:${user_id}:`);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Reveal lookup timeout')), 5000)
      );
      
      const revealData = await Promise.race([revealPromise, timeoutPromise]) as any[];
      
      for (const r of revealData) {
        if (r && r.lead_id) revealedMap.set(r.lead_id, r);
      }
      revealed_ids = Array.from(revealedMap.keys());
    } catch (err) {
      console.warn(`[SHARED LEADS] Reveal lookup failed/timeout for user ${user_id}:`, err);
      // Continue without reveals - will just show all as unrevealed
    }
  }

  // 4. Strip sensitive fields for unrevealed leads
  // Exception: admin users viewing their OWN leads should see full data
  const leads = rawLeads.map((lead: any) => {
    const isOwnLead = lead.user_id === user_id;
    const isRevealed = revealedMap.has(lead.id);
    const shouldReveal = isRevealed || (isAdmin && isOwnLead);
    
    return {
      ...lead,
      // Always include these booleans so the UI knows there's data to reveal
      has_email: !!lead.email,
      has_phone: !!lead.phone,
      // If not revealed (and not admin viewing own lead), blank out sensitive fields
      email: shouldReveal ? lead.email : null,
      phone: shouldReveal ? lead.phone : null,
      // Flag
      is_shared: true,
      is_revealed: shouldReveal,
    };
  });

  console.log(`[SHARED LEADS] Returning ${leads.length} of ${total} (page ${page}), ${revealed_ids.length} revealed`);
  return { leads, total, page, per_page, revealed_ids };
}

/**
 * Reveal a shared lead's sensitive fields.
 */
export async function revealSharedLead(options: {
  user: any;
  lead_id: string;
}): Promise<{
  success: boolean;
  data?: { email?: string; phone?: string };
  error?: string;
  error_code?: 'LIMIT_REACHED' | 'PLAN_NO_PHONE' | 'LEAD_NOT_FOUND' | 'NO_DATA';
  already_revealed?: boolean;
}> {
  const { user, lead_id } = options;
  const userId = user.id;

  // 1. Check if already revealed
  const existing = await kv.get(`gl_reveal:${userId}:${lead_id}`);
  if (existing) {
    // Fetch and return
    const sb = adminClient();
    const { data: lead } = await sb.from('leads').select('email, phone').eq('id', lead_id).maybeSingle();
    if (!lead) return { success: false, error: 'Lead not found', error_code: 'LEAD_NOT_FOUND' };
    return { success: true, data: { email: lead.email, phone: lead.phone }, already_revealed: true };
  }

  // 2. Entitlements
  const ent = await getUserEntitlements(user);

  if (!ent.can_view_email) {
    return { success: false, error: 'Upgrade to reveal contacts.', error_code: 'LIMIT_REACHED' };
  }

  if (ent.monthly_reveal_limit !== null && ent.monthly_reveals_used >= ent.monthly_reveal_limit) {
    return {
      success: false,
      error: `Monthly reveal limit reached (${ent.monthly_reveal_limit}). Upgrade for more.`,
      error_code: 'LIMIT_REACHED',
    };
  }

  // 3. Fetch lead
  const sb = adminClient();
  const { data: lead } = await sb.from('leads').select('email, phone').eq('id', lead_id).maybeSingle();
  if (!lead) return { success: false, error: 'Lead not found', error_code: 'LEAD_NOT_FOUND' };

  if (!lead.email && !lead.phone) {
    return { success: false, error: 'No contact data for this lead', error_code: 'NO_DATA' };
  }

  // 4. Record reveal
  await kv.set(`gl_reveal:${userId}:${lead_id}`, {
    user_id: userId,
    lead_id,
    revealed_at: new Date().toISOString(),
    credits_used: 1,
  });

  // 5. Increment monthly counter
  const monthKey = `gl_reveals_month:${userId}:${getCurrentMonth()}`;
  const monthData = await kv.get(monthKey);
  await kv.set(monthKey, { count: (monthData?.count || 0) + 1 });

  console.log(`[SHARED LEADS] Revealed lead ${lead_id} for user ${userId}`);

  return {
    success: true,
    data: { email: lead.email, phone: lead.phone },
  };
}
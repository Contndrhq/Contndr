/**
 * Audit log helper. Records sensitive / destructive / privileged actions
 * to the `audit_log` table. Append-only, service-role-only writes.
 *
 * Use sparingly — this is the SOC2 audit trail, not a generic activity feed.
 * Only record actions that are: destructive, admin-privileged, integration-
 * changing, or financial. Day-to-day reads / writes do NOT belong here.
 *
 * Failures to write are logged but never thrown — an audit-log outage must
 * not block the user-facing action it's documenting.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

let _admin: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!_admin) {
    _admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
  }
  return _admin;
}

export interface AuditEvent {
  /** Stable, machine-readable action name. e.g. "lead.bulk_delete", "campaign.delete", "account.delete", "admin.user.plan_change", "oauth.disconnect". */
  action: string;
  /** Resource type (table or domain object). e.g. "lead", "campaign", "user", "oauth_provider". */
  resource?: string;
  /** Resource ID (or comma-separated if bulk). Truncated to 256 chars. */
  resourceId?: string;
  /** Optional structured details. Keep small — this is logged, not analytics. */
  metadata?: Record<string, any>;
}

/**
 * Record an audit event. The `c` arg is the Hono Context — we use it to
 * extract the actor identity, request ID, IP, and user agent automatically.
 *
 * Always returns void — never throws. If the audit write fails, the calling
 * action still completes. The failure is logged so we can investigate.
 */
export async function recordAuditEvent(c: any, event: AuditEvent): Promise<void> {
  try {
    // Best-effort actor resolution. If the route requires auth, getAuthenticatedUser
    // has already populated this on the context; we read it without re-validating
    // to keep this fast.
    const actorId = c.get?.('userId') || null;
    const actorEmail = c.get?.('userEmail') || null;
    const requestId = c.get?.('requestId') || null;

    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('cf-connecting-ip')
      || null;
    const userAgent = (c.req.header('user-agent') || '').slice(0, 256);

    const row = {
      actor_id: actorId,
      actor_email: actorEmail,
      action: event.action.slice(0, 128),
      resource: event.resource?.slice(0, 64) ?? null,
      resource_id: event.resourceId?.slice(0, 256) ?? null,
      metadata: event.metadata ?? null,
      ip: ip?.slice(0, 64) ?? null,
      user_agent: userAgent || null,
      request_id: requestId,
    };

    const { error } = await admin().from('audit_log').insert(row);
    if (error) {
      console.warn('[AUDIT] Failed to record event:', event.action, error.message);
    }
  } catch (e: any) {
    console.warn('[AUDIT] Failed to record event (exception):', event.action, e?.message);
  }
}

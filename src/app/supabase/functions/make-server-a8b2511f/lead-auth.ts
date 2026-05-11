/**
 * Authorization helpers for lead deletion
 * Regular users can only delete leads they personally added
 * Shared leads (from other users) cannot be deleted by regular users
 * Only admins can delete any lead
 *
 * Admin list is read from the ADMIN_EMAILS environment variable
 * (comma-separated). The hardcoded fallback exists so existing deployments
 * keep working until the env var is set, but the env var should be the
 * source of truth — it lets you revoke admin access without redeploying.
 */

const FALLBACK_ADMIN_EMAILS = ['or@roadr.com', 'admin@contndr.com', 'or@contndr.com'];

function loadAdminEmails(): string[] {
  try {
    const env = (globalThis as any).Deno?.env?.get?.('ADMIN_EMAILS');
    if (env && typeof env === 'string') {
      const parsed = env.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
      if (parsed.length > 0) return parsed;
    }
  } catch { /* fall through */ }
  return FALLBACK_ADMIN_EMAILS;
}

export const ADMIN_EMAILS = loadAdminEmails();

export function isAdmin(email: string | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * Filters lead IDs to only those the user is authorized to delete
 * @param leads - Array of leads with id and user_id
 * @param currentUserId - The ID of the user attempting deletion
 * @param userEmail - The email of the user (to check admin status)
 * @returns Array of lead IDs the user can delete
 */
export function filterDeletableLeads(
  leads: Array<{ id: string; user_id: string }>,
  currentUserId: string,
  userEmail: string | undefined
): string[] {
  const admin = isAdmin(userEmail);
  
  return leads
    .filter(lead => {
      // Admins can delete any lead
      if (admin) return true;
      // Regular users can only delete their own leads
      return lead.user_id === currentUserId;
    })
    .map(lead => lead.id);
}
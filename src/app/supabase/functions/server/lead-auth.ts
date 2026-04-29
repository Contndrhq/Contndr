/**
 * Authorization helpers for lead deletion
 * Regular users can only delete leads they personally added
 * Shared leads (from other users) cannot be deleted by regular users  
 * Only admins can delete any lead
 */

export const ADMIN_EMAILS = ['or@roadr.com', 'admin@contndr.com', 'or@contndr.com'];

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
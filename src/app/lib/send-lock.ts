/**
 * Global send-lock — prevents concurrent send-batch calls for the same campaign.
 *
 * Without this, BroadcastContext, CampaignsView, and checkAndResumeCampaigns
 * can all fire send-batch at the same time. The server picks up the same
 * campaign_lead record twice before either request marks it sent → duplicate email.
 *
 * Usage:
 *   if (!acquireSendLock(campaignId)) return; // already sending
 *   try { ... } finally { releaseSendLock(campaignId); }
 */

const activeCampaignSends = new Set<string>();

/** Returns true if the lock was acquired (safe to send), false if already locked. */
export function acquireSendLock(campaignId: string): boolean {
  if (activeCampaignSends.has(campaignId)) return false;
  activeCampaignSends.add(campaignId);
  return true;
}

/** Release the lock so the next caller can proceed. */
export function releaseSendLock(campaignId: string): void {
  activeCampaignSends.delete(campaignId);
}

/** Check (without acquiring) whether a campaign is currently being sent. */
export function isSendLocked(campaignId: string): boolean {
  return activeCampaignSends.has(campaignId);
}

/**
 * Shared email status sync utility — deduplicates concurrent calls from
 * Dashboard, CampaignsView, and EmailDiagnostics so only one Resend API
 * polling batch runs at a time. Subsequent callers share the in-flight
 * promise instead of firing a second request.
 */

import { projectId, publicAnonKey } from './supabase/info';

// Module-level lock: holds the in-flight promise (if any)
let inflightSync: Promise<SyncResult> | null = null;

export interface SyncResult {
  success: boolean;
  message?: string;
  synced?: number;
  checked?: number;
  total?: number;
  rate_limited?: boolean;
  error?: string;
  skipped?: boolean; // true when we couldn't even fire the request
}

interface SyncOptions {
  getAuthHeaders: () => Promise<Record<string, string>>;
  forceAll?: boolean;
}

/**
 * Call this from any component. If a sync is already in progress the same
 * promise is returned so no duplicate Resend polling occurs.
 */
export async function syncEmailStatuses(opts: SyncOptions): Promise<SyncResult> {
  // If a sync is already in flight, piggyback on it
  if (inflightSync) {
    return inflightSync;
  }

  inflightSync = _doSync(opts);

  try {
    return await inflightSync;
  } finally {
    inflightSync = null;
  }
}

async function _doSync({ getAuthHeaders, forceAll }: SyncOptions): Promise<SyncResult> {
  try {
    if (!projectId) {
      return { success: false, skipped: true, error: 'projectId not available' };
    }

    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      return { success: false, skipped: true, error: 'Not authenticated' };
    }

    const response = await fetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/sync-statuses`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(forceAll ? { force_all: true } : {}),
      }
    );

    if (response.ok) {
      const data = await response.json();
      return { success: true, ...data };
    }

    if (response.status === 401) {
      return { success: false, skipped: true, error: 'Unauthorized' };
    }

    const errBody = await response.json().catch(() => ({}));
    return {
      success: false,
      error: errBody?.error || `HTTP ${response.status}`,
    };
  } catch (error: any) {
    return { success: false, error: error.message || 'Network error' };
  }
}

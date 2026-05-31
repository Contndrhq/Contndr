import { supabase } from './supabase';
import { projectId } from '../utils/supabase/info';

/**
 * Deduplicated session refresh — prevents multiple concurrent callers
 * (e.g. parallel API cache revalidations) from racing to refresh the
 * session simultaneously, which can invalidate each other's tokens.
 */
let refreshPromise: Promise<string | null> | null = null;
let getSessionPromise: Promise<string | null> | null = null;

async function refreshSessionOnce(): Promise<string | null> {
  if (refreshPromise) {
    console.log('[AUTH] Refresh already in progress, waiting...');
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      console.log('[AUTH] Starting session refresh...');
      
      // Wrap refreshSession in a race against timeout to catch lock hangs
      const REFRESH_TIMEOUT = 8000; // 8s
      const refreshCallPromise = supabase.auth.refreshSession();
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Refresh timeout')), REFRESH_TIMEOUT)
      );
      
      const { data: refreshData, error: refreshError } = await Promise.race([
        refreshCallPromise, 
        timeoutPromise
      ]);

      if (refreshError) {
        const isStaleToken = refreshError.message?.includes('Refresh Token Not Found') ||
                             refreshError.message?.includes('Invalid Refresh Token') ||
                             refreshError.message?.includes('expired') ||
                             refreshError.message?.includes('Auth session missing');

        if (isStaleToken) {
          // RACE-RECOVERY: a "Refresh Token Not Found" can mean either
          //   (a) the refresh token is genuinely stale → sign out, OR
          //   (b) another concurrent caller (e.g. Supabase's internal
          //       autoRefreshToken, or a sibling tab) already rotated the
          //       token, so the rotated value is sitting in storage right
          //       now and a fresh getSession() will return a valid token.
          // Check (b) first before nuking the session.
          try {
            const { data: recheck } = await supabase.auth.getSession();
            if (recheck.session?.access_token) {
              console.log('[AUTH] Refresh raced with another caller — recovered token from storage');
              return recheck.session.access_token;
            }
          } catch {}

          console.log('[AUTH] Refresh token invalid or expired, clearing local session...');
          await supabase.auth.signOut({ scope: 'local' });
          window.dispatchEvent(new CustomEvent('auth:session-expired', {
            detail: { reason: 'Token refresh failed: ' + refreshError.message }
          }));
        } else {
          console.warn('[AUTH] Error refreshing session:', refreshError.message);
        }
        return null;
      }

      if (!refreshData.session) {
        console.log('[AUTH] No session after refresh — user needs to sign in again');
        await supabase.auth.signOut({ scope: 'local' });
        // Dispatch event to notify app that session is invalid
        window.dispatchEvent(new CustomEvent('auth:session-expired', { 
          detail: { reason: 'No session after refresh' } 
        }));
        return null;
      }

      console.log('[AUTH] Session refreshed successfully, new token expires at:', 
        new Date(refreshData.session.expires_at! * 1000).toLocaleString());
      return refreshData.session.access_token;
    } catch (err: any) {
      // Handle LockManager timeout in refresh
      if (err.message?.includes('timed out waiting') || 
          err.message?.includes('Refresh timeout') ||
          err.message?.includes('LockManager')) {
        console.error('[AUTH] Lock timeout during refresh, cannot recover - user must re-login');
        await supabase.auth.signOut({ scope: 'local' });
        window.dispatchEvent(new CustomEvent('auth:session-expired', { 
          detail: { reason: 'Lock timeout during refresh' } 
        }));
        return null;
      }
      
      console.error('[AUTH] Unexpected error during refresh:', err);
      return null;
    } finally {
      // Clear the singleton so the next caller gets a fresh refresh
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Get the current user's access token for API requests
 * Handles LockManager timeouts gracefully with retry + fallback
 */
export async function getAuthToken(): Promise<string | null> {
  if (getSessionPromise) {
    return getSessionPromise;
  }

  getSessionPromise = (async () => {
    try {
      // Wrap getSession in a race against timeout to catch lock hangs
    const SESSION_TIMEOUT = 8000; // 8s — slightly less than Supabase's 10s lock timeout
    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Session fetch timeout')), SESSION_TIMEOUT)
    );
    
    const { data, error } = await Promise.race([sessionPromise, timeoutPromise]);
    
    if (error) {
      const isStaleToken = error.message?.includes('Refresh Token Not Found') ||
                           error.message?.includes('Invalid Refresh Token');
      if (isStaleToken) {
        console.log('[AUTH] Stale session in getAuthToken, clearing...');
        await supabase.auth.signOut({ scope: 'local' });
        window.dispatchEvent(new CustomEvent('auth:session-expired', { 
          detail: { reason: 'Stale token in getSession: ' + error.message } 
        }));
      } else {
        console.error('[AUTH] Error getting session:', error.message);
      }
      return null;
    }
    
    // No session
    if (!data.session) {
      // Don't log warning - this is normal during initialization
      return null;
    }
    
    // Only manually refresh when the token is ACTUALLY expired or expiring
    // within 30 seconds. Supabase's `autoRefreshToken: true` already handles
    // proactive refresh well before expiry; if we also refresh aggressively
    // here (e.g. 10 min ahead), the two refresh loops race each other and
    // rotate the refresh token concurrently — whichever call wins leaves
    // the other with "Refresh Token Not Found" → user gets signed out. The
    // 30s buffer is small enough to never race autoRefresh, large enough
    // to cover the round-trip of the request we're about to make.
    const shouldRefresh = !data.session.expires_at || (() => {
      const expiresAt = data.session.expires_at * 1000;
      const now = Date.now();
      return expiresAt < now + 30000;
    })();
    
    if (shouldRefresh) {
      console.log('[AUTH] Session expired or expiring soon, refreshing...');
      return refreshSessionOnce();
    }

    return data.session.access_token;
  } catch (err: any) {
    // Handle LockManager timeout specifically
    if (err.message?.includes('timed out waiting') || 
        err.message?.includes('Session fetch timeout') ||
        err.message?.includes('LockManager')) {
      console.warn('[AUTH] Lock timeout in getAuthToken, retrying with fallback...');
      
      // Fallback: read directly from localStorage (bypasses lock mechanism)
      try {
        const storageKey = `sb-${projectId.split('.')[0]}-auth-token`;
        const sessionData = localStorage.getItem(storageKey);
        if (sessionData) {
          const parsed = JSON.parse(sessionData);
          if (parsed.access_token && parsed.expires_at) {
            const expiresAt = parsed.expires_at * 1000;
            const now = Date.now();
            // Only use if not expired
            if (expiresAt > now) {
              console.log('[AUTH] Using fallback token from localStorage');
              return parsed.access_token;
            }
          }
        }
      } catch (fallbackErr) {
        console.error('[AUTH] Fallback localStorage read failed:', fallbackErr);
      }
      
      return null;
    }
    
    console.error('[AUTH] Unexpected error in getAuthToken:', err);
    return null;
  } finally {
    getSessionPromise = null;
  }
})();

  return getSessionPromise;
}

/**
 * Get authorization headers for API requests
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    // Downgraded to debug: all callers already check headers.Authorization before making
    // API calls, so this is expected during init, demo mode, and prefetch races.
    console.debug('[AUTH] getAuthHeaders: No auth token available — callers should guard against missing Authorization');
  }
  
  return headers;
}

/**
 * Make an authenticated API request with automatic retry on 401 (token expired)
 * and automatic retry on 5xx transient errors (502, 503, 504)
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // First attempt - get fresh token (will auto-refresh if expiring)
  let headers = await getAuthHeaders();
  
  if (!headers.Authorization) {
    // Silent throw — callers (especially prefetches) catch this gracefully.
    // Logging here creates noise during normal unauthenticated states (initial load, etc.)
    throw new Error('Not authenticated');
  }
  
  // Strip the caller's signal from options — we create per-attempt timeouts
  // to prevent a single AbortSignal.timeout() from expiring across all retries.
  const callerSignal = options.signal;
  const { signal: _stripped, ...retryOptions } = options;
  
  let response: Response;
  
  // ── Attempt with retry on transient 5xx / cold-start network errors ──
  const MAX_5XX_RETRIES = 3;
  const PER_ATTEMPT_TIMEOUT = 30000; // 30s per attempt
  for (let attempt = 0; attempt <= MAX_5XX_RETRIES; attempt++) {
    // If the caller's signal is already aborted, bail immediately
    if (callerSignal?.aborted) {
      throw new Error('Request aborted by caller');
    }
    
    // Create a fresh per-attempt timeout so retries get a full window
    const attemptController = new AbortController();
    const attemptTimeout = setTimeout(() => attemptController.abort(), PER_ATTEMPT_TIMEOUT);
    
    // Also abort if the caller's signal fires
    const onCallerAbort = () => attemptController.abort();
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
    
    try {
      response = await fetch(url, {
        ...retryOptions,
        signal: attemptController.signal,
        headers: {
          ...retryOptions.headers,
          ...headers,
        },
      });
    } catch (err: any) {
      // Network failures are expected during edge-function cold-starts,
      // connectivity blips, laptop sleep/wake, and similar transient events.
      if (attempt < MAX_5XX_RETRIES && !callerSignal?.aborted) {
        // Use longer back-off: 1.5s → 3s → 6s to give cold-starts time
        const delay = Math.min(1500 * Math.pow(2, attempt), 8000);
        // First attempt failure is very common during edge-function cold-starts — keep quiet
        if (attempt === 0) {
          console.debug(`[AUTH] Network error (attempt 1/${MAX_5XX_RETRIES + 1}), retrying in ${delay}ms — ${err.message}`);
        } else {
          console.warn(`[AUTH] Network error (attempt ${attempt + 1}/${MAX_5XX_RETRIES + 1}), retrying in ${delay}ms — ${err.message}`);
        }
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`Network error: ${err.message}`);
    } finally {
      clearTimeout(attemptTimeout);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
    
    // Retry on transient server errors (502/503/504) from cold-start or infra issues
    if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt < MAX_5XX_RETRIES) {
      const delay = Math.min(1500 * Math.pow(2, attempt), 8000);
      if (attempt === 0) {
        console.debug(`[AUTH] Got ${response.status} (attempt 1/${MAX_5XX_RETRIES + 1}), retrying in ${delay}ms...`);
      } else {
        console.warn(`[AUTH] Got ${response.status} (attempt ${attempt + 1}/${MAX_5XX_RETRIES + 1}), retrying in ${delay}ms...`);
      }
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    
    break; // Success or non-retryable status — exit loop
  }
  
  // If we get a 401, try refreshing the token and retry once
  if (response.status === 401) {
    console.log('[AUTH] Got 401 response, attempting token refresh and retry...');
    
    // Try to read the error message from the response
    let errorMsg = 'Session expired';
    try {
      const errorData = await response.clone().json();
      errorMsg = errorData.error || errorMsg;
    } catch {}
    
    console.log('[AUTH] Server error:', errorMsg);
    
    const newToken = await refreshSessionOnce();
    if (!newToken) {
      console.warn('[AUTH] Failed to refresh session, user needs to sign in again');
      // Trigger sign out to clear stale state
      await supabase.auth.signOut({ scope: 'local' });
      // Dispatch event to notify app that session is invalid
      window.dispatchEvent(new CustomEvent('auth:session-expired', { 
        detail: { reason: '401 response and refresh failed' } 
      }));
      throw new Error('Session expired - please sign in again');
    }
    
    // Retry with new token
    console.log('[AUTH] Retrying request with refreshed token...');
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${newToken}`,
    };
    
    response = await fetch(url, {
      ...retryOptions,
      headers: {
        ...retryOptions.headers,
        ...headers,
      },
    });
    
    if (response.status === 401) {
      console.error('[AUTH] Still got 401 after refresh, token may be invalid');
      await supabase.auth.signOut({ scope: 'local' });
      // Dispatch event to notify app that session is invalid
      window.dispatchEvent(new CustomEvent('auth:session-expired', { 
        detail: { reason: 'Still 401 after token refresh' } 
      }));
      throw new Error('Session expired - please sign in again');
    }
    
    console.log('[AUTH] Retry successful');
  }
  
  return response;
}
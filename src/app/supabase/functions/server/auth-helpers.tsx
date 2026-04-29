/**
 * Shared auth retry helpers for all server edge functions.
 * Handles transient PGRST002 schema-cache errors, connection resets,
 * and other cold-start failures with exponential backoff.
 *
 * Usage:
 *   import { authGetUser, isTransientAuthError } from "./auth-helpers.tsx";
 *   const { user, error } = await authGetUser(supabase, token, "MY-MODULE");
 *
 * v3.5.0 — 2026-03-05
 */

const AUTH_MAX_RETRIES = 5;
const AUTH_BASE_DELAY_MS = 300;

/** Detect transient network / DB errors that are worth retrying */
export function isTransientAuthError(msg: string): boolean {
  return (
    msg.includes("connection reset") ||
    msg.includes("error sending request") ||
    msg.includes("ECONNRESET") ||
    msg.includes("os error 104") ||
    msg.includes("broken pipe") ||
    msg.includes("network error") ||
    msg.includes("client error") ||
    msg.includes("SendRequest") ||
    msg.includes("ConnectionAborted") ||
    msg.includes("connection closed before message completed") ||
    msg.includes("connection unexpectedly") ||
    msg.includes("schema cache") ||
    msg.includes("PGRST002") ||
    msg.includes("Database error querying schema") ||
    msg.includes("Database error") ||
    msg.includes("Unexpected failure") ||
    msg.includes("fetch failed") ||
    msg.includes("Failed to fetch") ||
    msg.includes("timeout") ||
    msg.includes("too many connections") ||
    msg.includes("remaining connection slots") ||
    msg.includes("server closed the connection unexpectedly")
  );
}

/**
 * Call supabase.auth.getUser(token) with retry resilience.
 * Returns { user, error } — caller decides what to do on error.
 */
export async function authGetUser(
  supabase: any,
  token: string,
  label = "AUTH",
): Promise<{ user: any; error: any }> {
  let lastErr: any = null;
  for (let attempt = 0; attempt < AUTH_MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (error) {
        const msg = error.message ?? String(error);
        if (isTransientAuthError(msg) && attempt < AUTH_MAX_RETRIES - 1) {
          lastErr = error;
          const delay = AUTH_BASE_DELAY_MS * Math.pow(2, attempt);
          console.log(
            `[${label}] Auth transient error (attempt ${attempt + 1}/${AUTH_MAX_RETRIES}), retrying in ${delay}ms: ${msg.slice(0, 120)}`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        return { user: null, error };
      }
      return { user: data?.user ?? null, error: null };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (isTransientAuthError(msg) && attempt < AUTH_MAX_RETRIES - 1) {
        lastErr = err;
        const delay = AUTH_BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(
          `[${label}] Auth transient error (attempt ${attempt + 1}/${AUTH_MAX_RETRIES}), retrying in ${delay}ms: ${msg.slice(0, 120)}`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return { user: null, error: err };
    }
  }
  return { user: null, error: lastErr };
}

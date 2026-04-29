/**
 * Retry wrapper around kv_store.tsx to handle transient PGRST002
 * "Could not query the database for the schema cache" errors.
 *
 * Drop-in replacement: import * as kv from "./kv-retry.tsx"
 * Updated: 2026-04-08 — fixed cascading timeout loop:
 *   - Statement timeouts (57014 / "canceling statement due to") are NOT retried.
 *     The DB already killed the query; retrying just piles on more load.
 *   - Our own wrapper timeout ("Query timeout after Xms") is NOT retried for
 *     the same reason — the underlying operation is already hung.
 *   - Reduced QUERY_TIMEOUT_MS to 8s so it fires before the 10s DB statement
 *     timeout, giving the circuit breaker a chance to react sooner.
 *   - Circuit breaker auto-resets after CIRCUIT_COOLDOWN_MS.
 */
import * as kvRaw from "./kv_store.tsx";

const MAX_RETRIES = 3;        // 3 attempts — enough for schema cache warm-up
const BASE_DELAY_MS = 500;    // 500ms → 1s → 2s (with jitter)
const QUERY_TIMEOUT_MS = 8000;    // 8s per single-row op — fires before DB's 10s limit
const PREFIX_TIMEOUT_MS = 15000;  // 15s for prefix scans (may return many rows)
const BULK_WRITE_TIMEOUT_MS = 25000; // 25s for multi-row mset/mdel batches

// ── Circuit Breaker ──────────────────────────────────────────────────
// When the DB reports "out of shared memory", stop ALL writes for a
// cooldown period to let the DB recover.
const CIRCUIT_COOLDOWN_MS = 120_000; // 2 min cooldown
let _circuitOpenUntil = 0;
let _circuitTrips = 0;

function tripCircuit() {
  _circuitTrips++;
  _circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  if (_circuitTrips <= 3) {
    console.warn(`[KV-CIRCUIT] Database memory exhausted — circuit breaker OPEN. All writes paused for ${CIRCUIT_COOLDOWN_MS / 1000}s (trip #${_circuitTrips})`);
  }
}

function isCircuitOpen(): boolean {
  if (_circuitOpenUntil === 0) return false;
  if (Date.now() >= _circuitOpenUntil) {
    if (_circuitTrips > 0) {
      console.log(`[KV-CIRCUIT] Cooldown expired — circuit breaker CLOSED. Writes re-enabled.`);
    }
    _circuitOpenUntil = 0;
    _circuitTrips = 0;
    return false;
  }
  return true;
}

/** Exported so GC or admin can manually reset the circuit */
export function resetCircuit() {
  _circuitOpenUntil = 0;
  _circuitTrips = 0;
  console.log('[KV-CIRCUIT] Circuit breaker manually reset.');
}

/** Add random jitter (±30%) to avoid thundering herd */
function jitter(ms: number): number {
  return Math.round(ms * (0.7 + Math.random() * 0.6));
}

/**
 * Returns true for errors that are worth retrying.
 *
 * ⚠️  NOT retryable:
 *   - "canceling statement due to statement timeout" (57014) — DB killed the
 *     query because it was too slow; retrying just adds more load.
 *   - "Query timeout after Xms" — our own wrapper fired, meaning the DB is
 *     already hung; no point spawning a second attempt.
 *   - "out of shared memory" — DB memory full; trips circuit breaker instead.
 */
function isRetryable(msg: string): boolean {
  // Hard stops — do not retry
  if (
    msg.includes("canceling statement due to statement timeout") ||
    msg.includes("canceling statement due to") ||
    msg.includes("57014") ||                   // PostgreSQL statement_timeout code
    msg.includes("Query timeout after") ||      // our own wrapper timeout
    msg.includes("out of shared memory") ||
    msg.includes("shared memory")
  ) {
    return false;
  }

  // Transient errors worth retrying
  return (
    msg.includes("schema cache") ||
    msg.includes("PGRST002") ||
    !msg ||                                    // empty = Supabase internal race
    msg.includes("Connection reset") ||
    msg.includes("connection reset") ||
    msg.includes("os error 104") ||
    msg.includes("error sending request") ||
    msg.includes("ECONNRESET") ||
    msg.includes("broken pipe") ||
    msg.includes("network error") ||
    msg.includes("too many connections") ||
    msg.includes("remaining connection slots") ||
    msg.includes("server closed the connection unexpectedly") ||
    msg.includes("connection terminated") ||
    msg.includes("Load failed") ||
    msg.includes("Failed to fetch") ||
    msg.includes("fetch failed") ||
    msg.includes("tls handshake") ||
    msg.includes("client error")
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  timeoutMs = QUERY_TIMEOUT_MS,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Query timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      return result;
    } catch (err: any) {
      lastErr = err;
      const msg = err?.message ?? String(err);

      // "Out of shared memory" — trip circuit and bail immediately (no retry)
      if (msg.includes("out of shared memory") || msg.includes("shared memory")) {
        tripCircuit();
        throw new Error("Database memory full - operation failed");
      }

      // Statement / wrapper timeouts — fail fast, do not retry
      if (!isRetryable(msg) || attempt >= MAX_RETRIES - 1) {
        throw err;
      }

      // Schema cache errors need extra warm-up time
      const isSchemaCacheError = msg.includes("schema cache") || msg.includes("PGRST002");
      const schemaDelay = isSchemaCacheError ? 2500 : 0;
      const delay = jitter(BASE_DELAY_MS * Math.pow(2, attempt)) + schemaDelay;
      console.log(`[KV-RETRY] ${label} attempt ${attempt + 1}/${MAX_RETRIES} failed (${msg.slice(0, 120)}), retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export const set = (key: string, value: any): Promise<void> => {
  if (isCircuitOpen()) {
    return Promise.reject(new Error("Database memory full - writes paused by circuit breaker"));
  }
  return withRetry(() => kvRaw.set(key, value), `set(${key})`);
};

export const get = (key: string): Promise<any> =>
  withRetry(() => kvRaw.get(key), `get(${key})`);

export const del = (key: string): Promise<void> =>
  withRetry(() => kvRaw.del(key), `del(${key})`);

export const mset = (keys: string[], values: any[]): Promise<void> => {
  if (isCircuitOpen()) {
    return Promise.reject(new Error("Database memory full - writes paused by circuit breaker"));
  }
  return withRetry(() => kvRaw.mset(keys, values), `mset(${keys.length} keys)`, BULK_WRITE_TIMEOUT_MS);
};

export const mget = (keys: string[]): Promise<any[]> =>
  withRetry(() => kvRaw.mget(keys), `mget(${keys.length} keys)`);

export const mdel = (keys: string[]): Promise<void> =>
  withRetry(() => kvRaw.mdel(keys), `mdel(${keys.length} keys)`, BULK_WRITE_TIMEOUT_MS);

export const getByPrefix = (prefix: string): Promise<any[]> =>
  withRetry(() => kvRaw.getByPrefix(prefix), `getByPrefix(${prefix})`, PREFIX_TIMEOUT_MS);
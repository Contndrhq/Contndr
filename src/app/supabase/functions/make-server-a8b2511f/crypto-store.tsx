/**
 * Encryption-at-rest for sensitive KV values (OAuth tokens, API keys).
 *
 * Why: OAuth refresh tokens give long-lived access to a user's Gmail /
 * Outlook / HubSpot / Salesforce / etc. account. Storing them as plaintext
 * JSON in kv_store_a8b2511f means a database snapshot, backup leak, or
 * misconfigured RLS policy exposes every integration in a single dump.
 * SOC2 and most enterprise vendor questionnaires explicitly require
 * encryption-at-rest for credentials.
 *
 * Design
 * - AES-GCM with a 256-bit key derived from the TOKEN_ENCRYPTION_KEY env
 *   var (via SHA-256 if the env var isn't already 32 raw bytes / 64 hex).
 * - Envelope format: `enc:v1:<base64-iv>:<base64-ciphertext>` so future
 *   key rotations can introduce v2 without breaking existing values.
 * - Backwards-compatible: callers can pass plaintext to decrypt() and it
 *   returns it unchanged, so legacy un-encrypted values keep working until
 *   a write naturally re-encrypts them.
 * - Fail-soft: if the env var isn't set we log a warning ONCE and pass
 *   values through unchanged. This prevents a missing env var from
 *   breaking every integration at deploy time; the operator still sees
 *   the warning and can set the key. Tokens written during this window
 *   are plaintext and get upgraded on next read+write cycle once the key
 *   is configured.
 */

const ENVELOPE_PREFIX = "enc:v1:";

let _cachedKey: CryptoKey | null = null;
let _keyMissingWarned = false;

async function getKey(): Promise<CryptoKey | null> {
  if (_cachedKey) return _cachedKey;
  const raw = Deno.env.get("TOKEN_ENCRYPTION_KEY") || "";
  if (!raw) {
    if (!_keyMissingWarned) {
      _keyMissingWarned = true;
      console.warn(
        "[CRYPTO] TOKEN_ENCRYPTION_KEY is not set — OAuth tokens will be stored as plaintext. " +
          "Set this env var to a 32-byte secret (any string is fine; it gets hashed to 256 bits) to enable encryption-at-rest.",
      );
    }
    return null;
  }
  // Normalize any input string into a 256-bit key via SHA-256. This means
  // operators can use any random secret they like — short, long, base64,
  // or a passphrase — and it always derives a valid AES-GCM key.
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  _cachedKey = await crypto.subtle.importKey(
    "raw",
    buf,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return _cachedKey;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** True when `value` is wrapped in our encryption envelope. */
export function isEncrypted(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
}

/**
 * Encrypt a plaintext string. If TOKEN_ENCRYPTION_KEY isn't set, returns
 * the plaintext unchanged (with a one-time console warning) so the
 * application keeps working.
 */
export async function encryptString(plaintext: string): Promise<string> {
  if (typeof plaintext !== "string") {
    throw new Error("encryptString expects a string");
  }
  const key = await getKey();
  if (!key) return plaintext;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${ENVELOPE_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(ct))}`;
}

/**
 * Decrypt a value produced by encryptString. Accepts legacy plaintext
 * values transparently — anything not starting with the envelope prefix
 * is returned unchanged so existing kv_store values keep working through
 * the rollout. Returns null on decrypt failure (e.g. wrong key).
 */
export async function decryptString(value: unknown): Promise<string | null> {
  if (typeof value !== "string") return null;
  if (!value.startsWith(ENVELOPE_PREFIX)) return value; // legacy plaintext
  const key = await getKey();
  if (!key) {
    console.warn("[CRYPTO] Encountered encrypted value but TOKEN_ENCRYPTION_KEY is not set — cannot decrypt");
    return null;
  }
  try {
    const rest = value.slice(ENVELOPE_PREFIX.length);
    const sep = rest.indexOf(":");
    if (sep < 0) return null;
    const iv = fromBase64(rest.slice(0, sep));
    const ct = fromBase64(rest.slice(sep + 1));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch (err) {
    console.error("[CRYPTO] Decrypt failed:", (err as Error)?.message);
    return null;
  }
}

/**
 * Encrypt a JSON-serializable object — for callers storing token blobs
 * like { access_token, refresh_token, expires_at }. Roundtrips through
 * JSON so the on-the-wire representation is always a single string.
 */
export async function encryptJson(obj: unknown): Promise<string> {
  return encryptString(JSON.stringify(obj));
}

/**
 * Decrypt and JSON.parse. Returns null on decrypt OR parse failure.
 * Accepts legacy plaintext JSON values transparently.
 */
export async function decryptJson<T = unknown>(value: unknown): Promise<T | null> {
  const s = await decryptString(value);
  if (s == null) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

export interface IcypeasEmailResult {
  email: string;
  source: "icypeas";
  confidence?: string;
  raw?: any;
}

export interface IcypeasContactResult {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  confidence?: string | number;
  source: "icypeas";
  raw?: any;
}

export interface IcypeasVerificationResult {
  email: string;
  status: "valid" | "invalid" | "catch_all" | "risky" | "unknown";
  deliverable: boolean;
  raw?: any;
}

const ICYPEAS_BASE_URL = "https://app.icypeas.com/api";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function getIcypeasApiKey(): string {
  return Deno.env.get("ICYPEAS_API_KEY") || "";
}

function authHeaders(apiKey: string, bearer = false): HeadersInit {
  return {
    Authorization: bearer ? `Bearer ${apiKey}` : apiKey,
    "Content-Type": "application/json",
  };
}

async function postIcypeas(path: string, body: Record<string, any>, timeoutMs = 12000): Promise<Response> {
  const apiKey = getIcypeasApiKey();
  if (!apiKey) throw new Error("ICYPEAS_API_KEY is not configured");

  const url = `${ICYPEAS_BASE_URL}${path}`;
  const primary = await fetch(url, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (primary.status !== 401 && primary.status !== 403) return primary;

  return await fetch(url, {
    method: "POST",
    headers: authHeaders(apiKey, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function readJsonSafe(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase().replace(/[),.;:'">]+$/g, "");
  return EMAIL_RE.test(email) ? email : null;
}

function collectEmails(payload: any, out = new Set<string>(), depth = 0): Set<string> {
  if (!payload || depth > 8) return out;
  const direct = normalizeEmail(payload);
  if (direct) out.add(direct);
  if (Array.isArray(payload)) {
    for (const item of payload) collectEmails(item, out, depth + 1);
    return out;
  }
  if (typeof payload !== "object") return out;

  for (const key of ["email", "emailAddress", "email_address", "mail", "value"]) {
    const email = normalizeEmail(payload[key]);
    if (email) out.add(email);
  }
  for (const value of Object.values(payload)) collectEmails(value, out, depth + 1);
  return out;
}

function findJobId(payload: any): string | null {
  if (!payload || typeof payload !== "object") return null;
  for (const key of ["id", "_id", "jobId", "job_id", "searchId", "search_id", "requestId", "request_id"]) {
    if (typeof payload[key] === "string" && payload[key].trim()) return payload[key].trim();
  }
  if (payload.data && typeof payload.data === "object") return findJobId(payload.data);
  if (payload.result && typeof payload.result === "object") return findJobId(payload.result);
  return null;
}

async function pollIcypeas(path: string, jobId: string, timeoutMs = 20000): Promise<any | null> {
  const started = Date.now();
  let attempt = 0;
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(900 + attempt * 350, 2500)));
    attempt++;
    for (const body of [{ id: jobId }, { searchId: jobId }, { jobId }]) {
      const res = await postIcypeas(path, body, 9000).catch(() => null);
      if (!res || !res.ok) continue;
      const json = await readJsonSafe(res);
      const emails = collectEmails(json);
      const done = String(json?.status || json?.state || "").toLowerCase();
      if (emails.size > 0 || ["done", "finished", "completed", "success"].includes(done)) return json;
    }
  }
  return null;
}

function emailPayload(firstName: string, lastName: string, domainOrCompany: string) {
  return {
    firstname: firstName,
    lastname: lastName || "",
    domainOrCompany,
    first_name: firstName,
    last_name: lastName || "",
    domain: domainOrCompany,
  };
}

export async function icypeasEmailSearch(
  firstName: string,
  lastName: string,
  domainOrCompany: string,
): Promise<IcypeasEmailResult | null> {
  if (!firstName || !domainOrCompany || !getIcypeasApiKey()) return null;
  const body = emailPayload(firstName, lastName, domainOrCompany);

  try {
    const sync = await postIcypeas("/sync/email-search", body, 14000);
    if (sync.ok) {
      const json = await readJsonSafe(sync);
      const email = [...collectEmails(json)][0];
      return email ? { email, source: "icypeas", confidence: "high", raw: json } : null;
    }
    if (![400, 404, 405].includes(sync.status)) {
      console.warn(`[ICYPEAS] email-search HTTP ${sync.status}`);
      return null;
    }

    const queued = await postIcypeas("/email-search", body, 12000);
    if (!queued.ok) {
      console.warn(`[ICYPEAS] email-search queue HTTP ${queued.status}`);
      return null;
    }
    const queuedJson = await readJsonSafe(queued);
    const immediate = [...collectEmails(queuedJson)][0];
    if (immediate) return { email: immediate, source: "icypeas", confidence: "high", raw: queuedJson };

    const jobId = findJobId(queuedJson);
    if (!jobId) return null;
    const result = await pollIcypeas("/email-search/read", jobId);
    const email = [...collectEmails(result)][0];
    return email ? { email, source: "icypeas", confidence: "high", raw: result } : null;
  } catch (error) {
    console.warn(`[ICYPEAS] email-search failed: ${(error as Error).message}`);
    return null;
  }
}

function contactArray(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  for (const key of ["contacts", "emails", "results", "items", "data", "result"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  if (typeof payload === "object") return [payload];
  return [];
}

export async function icypeasDomainSearch(domainOrCompany: string): Promise<IcypeasContactResult[]> {
  if (!domainOrCompany || !getIcypeasApiKey()) return [];
  const body = { domainOrCompany, domain: domainOrCompany, company: domainOrCompany };
  try {
    let json: any = null;
    const sync = await postIcypeas("/sync/domain-search", body, 16000);
    if (sync.ok) {
      json = await readJsonSafe(sync);
    } else if ([400, 404, 405].includes(sync.status)) {
      const queued = await postIcypeas("/domain-search", body, 12000);
      if (queued.ok) {
        const queuedJson = await readJsonSafe(queued);
        const jobId = findJobId(queuedJson);
        json = [...collectEmails(queuedJson)].length || !jobId ? queuedJson : await pollIcypeas("/domain-search/read", jobId);
      }
    } else {
      console.warn(`[ICYPEAS] domain-search HTTP ${sync.status}`);
    }

    return contactArray(json).map((item: any) => {
      const email = [...collectEmails(item)][0];
      const first = item?.firstname || item?.first_name || item?.firstName || "";
      const last = item?.lastname || item?.last_name || item?.lastName || "";
      const full = item?.full_name || item?.fullName || item?.name || [first, last].filter(Boolean).join(" ");
      return {
        full_name: full,
        first_name: first,
        last_name: last,
        title: item?.title || item?.position || item?.job_title,
        email,
        linkedin_url: item?.linkedin_url || item?.linkedin || item?.profile_url,
        confidence: item?.confidence || item?.score,
        source: "icypeas" as const,
        raw: item,
      };
    }).filter((contact) => contact.email || contact.full_name);
  } catch (error) {
    console.warn(`[ICYPEAS] domain-search failed: ${(error as Error).message}`);
    return [];
  }
}

export async function icypeasVerifyEmail(email: string): Promise<IcypeasVerificationResult> {
  const fallback: IcypeasVerificationResult = { email, status: "unknown", deliverable: false };
  if (!email || !getIcypeasApiKey()) return fallback;
  try {
    const sync = await postIcypeas("/sync/email-verification", { email }, 12000);
    if (!sync.ok) {
      console.warn(`[ICYPEAS] email-verification HTTP ${sync.status}`);
      return fallback;
    }
    const json = await readJsonSafe(sync);
    const raw = String(json?.status || json?.result || json?.verdict || json?.data?.status || "").toLowerCase();
    if (["valid", "deliverable", "safe", "ok"].includes(raw)) return { email, status: "valid", deliverable: true, raw: json };
    if (["catch_all", "catch-all", "accept_all", "accept-all"].includes(raw)) return { email, status: "catch_all", deliverable: true, raw: json };
    if (["risky", "unknown", "disposable", "role"].includes(raw)) return { email, status: raw === "unknown" ? "unknown" : "risky", deliverable: false, raw: json };
    if (["invalid", "undeliverable", "bad"].includes(raw)) return { email, status: "invalid", deliverable: false, raw: json };
    return { email, status: "unknown", deliverable: false, raw: json };
  } catch (error) {
    console.warn(`[ICYPEAS] email-verification failed: ${(error as Error).message}`);
    return fallback;
  }
}

export async function testIcypeas(): Promise<{ ok: boolean; status?: number; data?: any; error?: string }> {
  if (!getIcypeasApiKey()) return { ok: false, error: "ICYPEAS_API_KEY is not configured" };
  try {
    const res = await postIcypeas("/sync/email-verification", { email: "test@example.com" }, 12000);
    const data = await readJsonSafe(res);
    return { ok: res.ok, status: res.status, data };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * EmailAuthChecker — diagnoses SPF / DKIM / DMARC for the user's
 * sending domain and surfaces actionable fix instructions.
 *
 * Why this exists: most users misconfigure one DNS record and don't
 * realize it until their bounce/spam rate gets ugly. Surfacing the
 * problem in the Settings → Email panel — with the exact TXT value
 * to paste into their DNS provider — eliminates a real deliverability
 * tax that we can't fix for them.
 *
 * Backend route: GET /email-auth/check?domain=example.com
 *   Uses DNS-over-HTTPS (Cloudflare) so it works in the Edge runtime.
 *   Returns { overall: 'pass'|'warn'|'fail', spf, dkim, dmarc }.
 */

import { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Shield, Copy, Check } from 'lucide-react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface RecordResult {
  status: 'ok' | 'missing' | 'misconfigured' | 'weak';
  record: string | null;
  issue: string | null;
  policy?: string | null;
}

interface CheckResult {
  domain: string;
  overall: 'pass' | 'warn' | 'fail';
  spf: RecordResult;
  dkim: RecordResult;
  dmarc: RecordResult;
  checked_at: string;
}

export function EmailAuthChecker({ defaultDomain }: { defaultDomain?: string }) {
  const [domain, setDomain] = useState(defaultDomain || '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*/, '');
    if (!d || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
      setError('Enter a valid domain like example.com');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authenticatedFetch(`${API_BASE}/email-auth/check?domain=${encodeURIComponent(d)}`);
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setResult(json);
    } catch (e: any) {
      setError(e.message || 'check failed');
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white dark:bg-black rounded-2xl border border-zinc-200 dark:border-white/10 p-6 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
          <Shield className="w-4.5 h-4.5 text-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-white">
            Sending-domain authentication
          </h3>
          <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400 mt-0.5">
            Checks SPF, DKIM, and DMARC for your domain. Misconfigured records are
            the most common reason emails go to spam.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && run()}
          placeholder="example.com"
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 dark:focus:border-white/20"
        />
        <button
          onClick={run}
          disabled={busy || !domain}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {busy ? 'Checking' : 'Check'}
        </button>
      </div>

      {error && (
        <div className="text-[12.5px] text-red-600 dark:text-red-400">{error}</div>
      )}

      {result && (
        <div className="space-y-2">
          <OverallBanner overall={result.overall} domain={result.domain} />
          <RecordRow label="SPF" record={result.spf} expectedHint="v=spf1 include:_spf.resend.com ~all" />
          <RecordRow label="DKIM" record={result.dkim} expectedHint="resend._domainkey TXT from your Resend dashboard" />
          <RecordRow label="DMARC" record={result.dmarc} expectedHint={`_dmarc.${result.domain} → v=DMARC1; p=quarantine; rua=mailto:dmarc@${result.domain}`} />
          <p className="text-[10.5px] text-zinc-400 dark:text-zinc-600 pt-1">
            Checked {new Date(result.checked_at).toLocaleString()}. DNS changes can take up to 24 hours to propagate.
          </p>
        </div>
      )}
    </div>
  );
}

function OverallBanner({ overall, domain }: { overall: 'pass' | 'warn' | 'fail'; domain: string }) {
  if (overall === 'pass') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 flex items-center gap-2.5">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-500 shrink-0" />
        <p className="text-[13px] font-medium text-emerald-900 dark:text-emerald-300">
          {domain} is fully authenticated.
        </p>
      </div>
    );
  }
  if (overall === 'warn') {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 flex items-center gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-500 shrink-0" />
        <p className="text-[13px] font-medium text-amber-900 dark:text-amber-300">
          {domain} has records but they need tightening. See below.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 flex items-center gap-2.5">
      <XCircle className="w-4 h-4 text-red-600 dark:text-red-500 shrink-0" />
      <p className="text-[13px] font-medium text-red-900 dark:text-red-300">
        {domain} is missing at least one critical record. Emails will likely be marked as spam.
      </p>
    </div>
  );
}

function RecordRow({ label, record, expectedHint }: { label: string; record: RecordResult; expectedHint: string }) {
  const [copied, setCopied] = useState(false);
  const icon = record.status === 'ok'
    ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
    : record.status === 'weak'
      ? <AlertTriangle className="w-4 h-4 text-amber-500" />
      : <XCircle className="w-4 h-4 text-red-500" />;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-zinc-900 dark:text-white">{label}</span>
            <span className={`text-[10.5px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${
              record.status === 'ok'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : record.status === 'weak'
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  : 'bg-red-500/10 text-red-700 dark:text-red-400'
            }`}>
              {record.status}
            </span>
            {record.policy && (
              <span className="text-[10.5px] text-zinc-500 dark:text-zinc-400">policy: {record.policy}</span>
            )}
          </div>
          {record.record && (
            <pre className="mt-1.5 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all">
              {record.record}
            </pre>
          )}
          {record.issue && (
            <div className="mt-1.5 flex items-start gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
              <p className="flex-1 leading-snug">{record.issue}</p>
              <button
                onClick={() => copy(record.issue!.split(':').slice(1).join(':').trim() || expectedHint)}
                className="shrink-0 inline-flex items-center gap-1 text-[10.5px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                title="Copy suggested value"
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
          {!record.issue && !record.record && (
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-1">No record found.</p>
          )}
        </div>
      </div>
    </div>
  );
}

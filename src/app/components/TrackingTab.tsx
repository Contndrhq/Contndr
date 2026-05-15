/**
 * TrackingTab
 * ───────────
 * Plan-aware Tracking tab. Scale/Enterprise (and whitelisted) users see the
 * full Website Connector; everyone else sees the simple legacy tracker.
 * One server roundtrip decides — no client-side plan duplication.
 */

import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { projectId } from '../utils/supabase/info';
import { authenticatedFetch } from '../lib/auth';
import { TrackingSettings } from './TrackingSettings';
import { WebsiteConnector } from './WebsiteConnector';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/wc`;

export function TrackingTab() {
  const [entitled, setEntitled] = useState<boolean | null>(null);
  const [plan, setPlan] = useState<string>('none');

  useEffect(() => {
    (async () => {
      try {
        const r = await authenticatedFetch(`${BASE}/workspace`);
        const data = await r.json();
        setEntitled(!!data.entitled);
        if (data.plan) setPlan(data.plan);
      } catch {
        setEntitled(false);
      }
    })();
  }, []);

  if (entitled === null) {
    return (
      <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (entitled) return <WebsiteConnector />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-300/40 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm">
          <div className="font-semibold text-amber-900 dark:text-amber-200">Website Connector available on Scale & Enterprise</div>
          <p className="text-amber-800 dark:text-amber-300/80 mt-1">
            Upgrade to auto-identify hot visitors, capture leads from any form on your site, and trigger AI calls based on intent.
            You're on <code className="px-1 rounded bg-amber-100 dark:bg-amber-900/40">{plan}</code>.
          </p>
        </div>
      </div>
      <TrackingSettings />
    </div>
  );
}

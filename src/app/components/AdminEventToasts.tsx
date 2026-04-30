/**
 * AdminEventToasts — polls for admin events and shows toast notifications.
 * Only active for @contndr.com admin users.
 */
import { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { UserPlus, ListPlus, CheckCircle, CreditCard, Zap, Send } from 'lucide-react';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { useDemoMode } from './DemoContext';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;
const POLL_INTERVAL = 20_000; // 20 seconds

const ADMIN_EMAILS = ['admin@contndr.com', 'or@roadr.com', 'or@contndr.com'];

type EventType = 'new_signup' | 'waitlist_join' | 'waitlist_approved' | 'subscription_created' | 'subscription_cancelled' | 'campaign_launched' | 'deal_closed' | 'team_member_joined' | 'system';

function getEventIcon(type: EventType) {
  switch (type) {
    case 'new_signup': return UserPlus;
    case 'waitlist_join': return ListPlus;
    case 'waitlist_approved': return CheckCircle;
    case 'subscription_created': return CreditCard;
    case 'deal_closed': return CreditCard;
    case 'campaign_launched': return Send;
    default: return Zap;
  }
}

function getEventStyle(type: EventType): { bg: string; border: string; icon: string } {
  // All teal + zinc — no rainbow
  switch (type) {
    case 'new_signup':
      return { bg: 'bg-[#1ED4A7]/[0.08]', border: 'border-[#1ED4A7]/20', icon: 'text-[#1ED4A7]' };
    case 'waitlist_join':
      return { bg: 'bg-white/[0.03]', border: 'border-white/[0.08]', icon: 'text-zinc-400' };
    case 'subscription_created':
    case 'deal_closed':
      return { bg: 'bg-[#1ED4A7]/[0.12]', border: 'border-[#1ED4A7]/30', icon: 'text-[#1ED4A7]' };
    case 'waitlist_approved':
    case 'campaign_launched':
      return { bg: 'bg-[#1ED4A7]/[0.06]', border: 'border-[#1ED4A7]/15', icon: 'text-[#1ED4A7]' };
    default:
      return { bg: 'bg-white/[0.03]', border: 'border-white/[0.06]', icon: 'text-zinc-400' };
  }
}

function AdminToast({ type, title, message }: { type: EventType; title: string; message: string }) {
  const Icon = getEventIcon(type);
  const style = getEventStyle(type);

  return (
    <div className="flex items-start gap-3 min-w-0">
      <div className={`w-8 h-8 rounded-lg ${style.bg} border ${style.border} flex items-center justify-center flex-shrink-0 mt-0.5`}>
        <Icon className={`w-4 h-4 ${style.icon}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-white leading-tight">{title}</p>
        <p className="text-[12px] text-zinc-400 mt-0.5 leading-snug">{message}</p>
      </div>
    </div>
  );
}

export function AdminEventToasts({ userEmail }: { userEmail?: string }) {
  const lastPollRef = useRef<string>(new Date().toISOString());
  const seenIdsRef = useRef<Set<string>>(new Set());
  const isDemoMode = useDemoMode();
  const isAdmin = !isDemoMode && userEmail && ADMIN_EMAILS.includes(userEmail.toLowerCase().trim());

  const poll = useCallback(async () => {
    if (!isAdmin) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const since = lastPollRef.current;
      const res = await fetch(`${API_BASE}/admin-events/recent?since=${encodeURIComponent(since)}&limit=50`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) return;
      const data = await res.json();
      if (data.degraded) return;
      const events = data.events || [];

      // Update timestamp for next poll
      lastPollRef.current = new Date().toISOString();

      for (const event of events) {
        // Deduplicate
        if (seenIdsRef.current.has(event.id)) continue;
        seenIdsRef.current.add(event.id);

        // Keep seen set bounded
        if (seenIdsRef.current.size > 500) {
          const arr = Array.from(seenIdsRef.current);
          seenIdsRef.current = new Set(arr.slice(arr.length - 200));
        }

        toast.custom(
          () => <AdminToast type={event.type} title={event.title} message={event.message} />,
          {
            duration: 8000,
            position: 'bottom-right',
            style: {
              background: 'rgba(24, 24, 27, 0.95)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px',
              padding: '14px 16px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            },
          }
        );
      }
    } catch (err: any) {
      // Silent fail — don't disrupt the app
      // Suppress transient network errors (Load failed, fetch errors) to reduce log noise
      const msg = err?.message ?? String(err);
      const isTransient = msg.includes('Load failed') || msg.includes('Failed to fetch')
        || msg.includes('fetch failed') || msg.includes('NetworkError')
        || msg.includes('network error') || msg.includes('tls handshake');
      if (!isTransient) {
        console.error('[ADMIN-TOASTS] Poll error:', err);
      }
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;

    // Initial poll after a short delay (let the app settle)
    const initialTimer = setTimeout(poll, 5000);

    // Recurring poll
    const interval = setInterval(poll, POLL_INTERVAL);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [isAdmin, poll]);

  // This component renders nothing — it only triggers toasts
  return null;
}

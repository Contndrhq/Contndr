/**
 * AIQuickCall — Compact AI-powered call button for visitor popups.
 * Admin-only. Initiates a Telnyx call with ElevenLabs Pro voice (Multilingual v2).
 *
 * Designed to be embedded inline in the RealTimeMap popup and
 * EngagementIntelligence live-visitor rows.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles,
  Phone,
  PhoneCall,
  PhoneOff,
  Loader2,
  Volume2,
  Mic,
  X,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';

// Admin UIDs that can use AI Calls
const ADMIN_UIDS = ['004b2df9-3e3f-48ec-acfd-5374ab55b09f'];
const ADMIN_EMAILS = ['admin@contndr.com', 'or@roadr.com', 'or@contndr.com'];

type CallStatus = 'idle' | 'loading' | 'connecting' | 'ringing' | 'active' | 'ended' | 'error';

const STATUS_CONFIG: Record<CallStatus, { label: string; color: string; pulse: boolean }> = {
  idle:       { label: '',              color: '',               pulse: false },
  loading:    { label: 'Preparing...',  color: 'bg-zinc-400',    pulse: true  },
  connecting: { label: 'Connecting...', color: 'bg-amber-400',   pulse: true  },
  ringing:    { label: 'Ringing...',    color: 'bg-amber-400',   pulse: true  },
  active:     { label: 'AI Speaking',   color: 'bg-[#1ED4A7]',   pulse: false },
  ended:      { label: 'Call Ended',    color: 'bg-zinc-400',    pulse: false },
  error:      { label: 'Failed',        color: 'bg-red-500',     pulse: false },
};

interface AIQuickCallProps {
  phone: string;
  leadName?: string;
  businessName?: string;
  leadId?: string;
  /** 'inline' for map popup, 'row' for list items */
  variant?: 'inline' | 'row';
  brand?: string;
  /** ElevenLabs voice: 'rachel' | 'bella' | 'josh' | 'adam' */
  voice?: string;
  /** Optional agent profile ID to use — if not set, uses user's default agent */
  agentId?: string;
}

export function AIQuickCall({
  phone,
  leadName,
  businessName,
  leadId,
  variant = 'inline',
  brand = 'contndr',
  voice = 'rachel',
  agentId,
}: AIQuickCallProps) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [status, setStatus] = useState<CallStatus>('idle');
  const [callId, setCallId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const agentCacheRef = useRef<any>(null);

  // Check if current user is admin
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const user = data?.session?.user;
        if (!user) return;
        const email = user.email?.toLowerCase() || '';
        if (ADMIN_UIDS.includes(user.id) || ADMIN_EMAILS.includes(email)) {
          setIsAdmin(true);
        }
      } catch {
        // not logged in
      }
    })();
  }, []);

  // Timer for call duration
  useEffect(() => {
    if (status === 'active') {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (status === 'idle') setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status]);

  // Poll call status
  useEffect(() => {
    if (!callId || status === 'ended' || status === 'error' || status === 'idle') {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/active-calls`,
          { headers, signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const data = await res.json();
          const calls = data.calls || [];
          const myCall = calls.find((c: any) => c.id === callId);
          if (myCall) {
            if (myCall.status === 'speaking' || myCall.status === 'active' || myCall.status === 'answered') {
              setStatus('active');
            } else if (myCall.status === 'ringing' || myCall.status === 'early') {
              setStatus('ringing');
            }
          }
        }
      } catch { /* ignore poll errors */ }
    }, 3000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [callId, status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const initiateCall = useCallback(async () => {
    setStatus('loading');
    setErrorMsg(null);
    setElapsed(0);

    try {
      const headers = await getAuthHeaders();

      // 0. Get current user ID for credit tracking
      let currentUserId: string | null = null;
      try {
        const { data } = await supabase.auth.getSession();
        currentUserId = data?.session?.user?.id || null;
      } catch {}

      // 0a. Pre-flight credit check
      if (currentUserId) {
        try {
          const creditRes = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-credits/credits/check`,
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ required: 1 }),
            }
          );
          if (creditRes.ok) {
            const creditData = await creditRes.json();
            if (!creditData.allowed) {
              throw new Error(creditData.message || 'Insufficient AI call credits. Purchase more to continue.');
            }
          }
        } catch (creditErr: any) {
          if (creditErr.message?.includes('Insufficient') || creditErr.message?.includes('credits')) {
            throw creditErr;
          }
          // Non-fatal for other errors — don't block calls if credit service is down
          console.warn('[AIQuickCall] Credit check error (non-blocking):', creditErr);
        }
      }

      // 1. Get an available from-number
      const numbersRes = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/numbers`,
        { headers }
      );
      if (!numbersRes.ok) throw new Error('Could not load phone numbers');
      const numbersData = await numbersRes.json();
      const numbers = numbersData.numbers || [];
      const activeNumber = numbers.find((n: any) => n.status === 'active');
      if (!activeNumber) throw new Error('No active phone number configured');

      const fromNumber = activeNumber.phone_number;

      setStatus('connecting');

      // 2. Load agent profile if available (use cache to avoid re-fetching)
      let agentProfile: any = agentCacheRef.current;
      if (!agentProfile) {
        try {
          if (agentId) {
            // Load specific agent
            const agentRes = await fetch(
              `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-agents/${agentId}`,
              { headers, signal: AbortSignal.timeout(5000) }
            );
            if (agentRes.ok) {
              const agentData = await agentRes.json();
              agentProfile = agentData.agent;
            }
          } else {
            // Load default agent
            const agentsRes = await fetch(
              `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ai-agents`,
              { headers, signal: AbortSignal.timeout(5000) }
            );
            if (agentsRes.ok) {
              const agentsData = await agentsRes.json();
              const agents = agentsData.agents || [];
              agentProfile = agents.find((a: any) => a.is_default) || agents[0] || null;
            }
          }
          agentCacheRef.current = agentProfile;
        } catch {
          // Non-fatal — fall back to defaults
          console.warn('[AIQuickCall] Could not load agent profile, using defaults');
        }
      }

      // 3. Build ai_config — merge agent profile with call context
      const resolvedVoice = agentProfile?.voice || voice;
      const resolvedName = agentProfile?.name || 'Alex';
      const resolvedRole = agentProfile?.role || 'Sales Specialist';
      const resolvedBrand = agentProfile?.business_name || agentProfile?.brand || brand;

      // Replace template vars in greeting
      const rawGreeting = agentProfile?.greeting || '';
      const resolvedGreeting = rawGreeting
        ? rawGreeting
            .replace(/\{name\}/g, resolvedName)
            .replace(/\{business_name\}/g, resolvedBrand)
            .replace(/\{role\}/g, resolvedRole)
        : `Hi, this is ${resolvedName} calling from ${resolvedBrand === 'contndr' ? 'Contndr' : resolvedBrand}. I noticed you were just checking out our platform — do you have a quick minute?`;

      const aiConfig: any = {
        name: resolvedName,
        role: resolvedRole,
        brand: resolvedBrand,
        lead_name: leadName || '',
        business_name: businessName || resolvedBrand,
        opening_line: resolvedGreeting,
        objective: 'book_call',
        voice: resolvedVoice,
      };

      // Merge agent profile fields for the server-side buildSystemPrompt
      if (agentProfile) {
        if (agentProfile.instructions) aiConfig.instructions = agentProfile.instructions;
        if (agentProfile.knowledge_base) aiConfig.knowledge_base = agentProfile.knowledge_base;
        if (agentProfile.transfer_rules?.length) aiConfig.transfer_rules = agentProfile.transfer_rules;
        if (agentProfile.qualification_questions?.length) aiConfig.qualification_questions = agentProfile.qualification_questions;
        if (agentProfile.operating_hours) aiConfig.operating_hours = agentProfile.operating_hours;
        if (agentProfile.max_turns) aiConfig.max_turns = agentProfile.max_turns;
        if (agentProfile.business_name) aiConfig.business_name = agentProfile.business_name;
        if (agentProfile.end_call_message) aiConfig.end_call_message = agentProfile.end_call_message;
      }

      // 4. Initiate the call
      const callRes = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/calls/initiate`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            from_number: fromNumber,
            to_number: phone,
            lead_id: leadId || undefined,
            lead_name: leadName || undefined,
            business_name: businessName || undefined,
            user_id: currentUserId || undefined,
            ai_config: aiConfig,
          }),
        }
      );

      if (!callRes.ok) {
        const errData = await callRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to start call');
      }

      const callData = await callRes.json();
      setCallId(callData.call?.id || null);
      setStatus('ringing');

      // Auto-transition to "active" after a short delay if we don't get poll data
      setTimeout(() => {
        setStatus(prev => (prev === 'ringing' ? 'active' : prev));
      }, 12000);

      // Auto-end after 5 min if still showing as active
      setTimeout(() => {
        setStatus(prev => (prev === 'active' || prev === 'ringing' ? 'ended' : prev));
      }, 300000);

    } catch (err: any) {
      console.error('[AIQuickCall] Error initiating call:', err);
      setErrorMsg(err.message || 'Call failed');
      setStatus('error');
    }
  }, [phone, leadId, leadName, businessName, brand, voice, agentId]);

  const endCall = useCallback(async () => {
    if (!callId) {
      setStatus('ended');
      return;
    }
    try {
      const headers = await getAuthHeaders();
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/calls/${callId}/hangup`,
        { method: 'POST', headers, body: JSON.stringify({}) }
      );
    } catch { /* best effort */ }
    setStatus('ended');
  }, [callId]);

  const copyPhone = useCallback(() => {
    navigator.clipboard.writeText(phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [phone]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!isAdmin || !phone) return null;

  // ── Row variant (for live visitor list) ──
  if (variant === 'row') {
    if (status === 'idle') {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); initiateCall(); }}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#1ED4A7] bg-[#1ED4A7]/10 rounded-md hover:bg-[#1ED4A7]/20 transition-all group"
          title="AI Call this visitor"
        >
          <Sparkles className="w-3 h-3 group-hover:scale-110 transition-transform" />
          <span>AI Call</span>
        </button>
      );
    }

    const cfg = STATUS_CONFIG[status];
    return (
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.color} ${cfg.pulse ? 'animate-pulse' : ''}`} />
        <span className="text-[10px] font-medium text-zinc-400">{cfg.label}</span>
        {(status === 'active' || status === 'ringing' || status === 'connecting') && (
          <button onClick={(e) => { e.stopPropagation(); endCall(); }} className="p-0.5 text-zinc-500 hover:text-red-400 transition-colors">
            <PhoneOff className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  // ── Inline variant (for map popup) ──

  // Idle state — show phone + copy + AI Call button
  if (status === 'idle') {
    return (
      <div className="space-y-2.5">
        {/* Phone row with copy */}
        <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <Phone className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 flex-shrink-0" />
          <span className="font-medium flex-1">{phone}</span>
          <button
            onClick={(e) => { e.stopPropagation(); copyPhone(); }}
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-white/10 transition-colors text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            title="Copy number"
          >
            {copied ? <Check className="w-3 h-3 text-[#1ED4A7]" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>

        {/* AI Call button */}
        <button
          onClick={(e) => { e.stopPropagation(); initiateCall(); }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#1ED4A7]/10 hover:bg-[#1ED4A7]/20 border border-[#1ED4A7]/20 hover:border-[#1ED4A7]/40 rounded-lg transition-all group"
        >
          <div className="relative">
            <Phone className="w-3.5 h-3.5 text-[#1ED4A7]" />
            <Sparkles className="w-2 h-2 text-[#1ED4A7] absolute -top-1 -right-1.5 group-hover:scale-125 transition-transform" />
          </div>
          <span className="text-xs font-bold text-[#1ED4A7] uppercase tracking-wider">
            AI Call Now
          </span>
        </button>
      </div>
    );
  }

  // Active / Connecting / Error states
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="space-y-2">
      {/* Status banner */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
        status === 'active' ? 'bg-[#1ED4A7]/10 border-[#1ED4A7]/20' :
        status === 'error' ? 'bg-red-500/10 border-red-500/20' :
        status === 'ended' ? 'bg-zinc-100 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700' :
        'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700'
      }`}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Status dot */}
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.color} ${cfg.pulse ? 'animate-pulse' : ''}`} />

          {/* Status label */}
          <span className={`text-xs font-bold uppercase tracking-wider ${
            status === 'active' ? 'text-[#1ED4A7]' :
            status === 'error' ? 'text-red-500' :
            'text-zinc-500 dark:text-zinc-400'
          }`}>
            {cfg.label}
          </span>

          {/* Active state extras */}
          {status === 'active' && (
            <div className="flex items-center gap-1.5 ml-auto">
              <Volume2 className="w-3 h-3 text-[#1ED4A7] animate-pulse" />
              <span className="text-[10px] font-mono text-[#1ED4A7] tabular-nums">
                {formatDuration(elapsed)}
              </span>
            </div>
          )}

          {/* Connecting / Ringing spinner */}
          {(status === 'loading' || status === 'connecting') && (
            <Loader2 className="w-3 h-3 text-zinc-400 animate-spin ml-auto" />
          )}

          {/* Ringing animation */}
          {status === 'ringing' && (
            <div className="flex gap-0.5 ml-auto">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="w-0.5 bg-amber-400 rounded-full animate-bounce"
                  style={{ height: '10px', animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          )}
        </div>

        {/* End call button */}
        {(status === 'active' || status === 'ringing' || status === 'connecting') && (
          <button
            onClick={(e) => { e.stopPropagation(); endCall(); }}
            className="p-1.5 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors flex-shrink-0"
            title="End call"
          >
            <PhoneOff className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Error message */}
      {status === 'error' && errorMsg && (
        <div className="flex items-start gap-1.5 text-[10px] text-red-500/80 px-1">
          <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Ended — retry button */}
      {status === 'ended' && (
        <button
          onClick={(e) => { e.stopPropagation(); setStatus('idle'); setCallId(null); }}
          className="w-full text-center text-[10px] font-medium text-zinc-400 hover:text-[#1ED4A7] transition-colors py-1"
        >
          Call again
        </button>
      )}

      {/* Error — retry button */}
      {status === 'error' && (
        <button
          onClick={(e) => { e.stopPropagation(); setStatus('idle'); setCallId(null); setErrorMsg(null); }}
          className="w-full text-center text-[10px] font-medium text-zinc-400 hover:text-[#1ED4A7] transition-colors py-1"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export default AIQuickCall;
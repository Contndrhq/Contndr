/**
 * SmartPhoneButton — Universal phone action button with hover popover.
 *
 * Drop-in replacement for any phone icon in the app. On hover it shows a
 * compact popover with:
 *   • Copy number
 *   • Regular call (tel: link)
 *   • AI Call (Growth/Enterprise plans or admin only)
 *
 * When an AI call is in progress the popover stays open showing live status.
 *
 * Design: dark zinc + teal (#1ED4A7) — Contndr design system.
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Sparkles,
  Copy,
  Check,
  Loader2,
  Volume2,
  AlertCircle,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

// ─── Constants ──────────────────────────────────────────────────────
const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;
const ADMIN_UIDS = ['004b2df9-3e3f-48ec-acfd-5374ab55b09f'];
const ADMIN_EMAILS = ['admin@contndr.com', 'or@roadr.com', 'or@contndr.com'];

// ─── Cached plan check (shared across all instances) ────────────────
let _accessCache: { checked: boolean; hasAccess: boolean; plan: string } = {
  checked: false,
  hasAccess: false,
  plan: 'none',
};
let _accessPromise: Promise<void> | null = null;
let _authListenerRegistered = false;

function registerAuthListener() {
  if (_authListenerRegistered) return;
  _authListenerRegistered = true;
  try {
    supabase.auth.onAuthStateChange(() => {
      _accessCache = { checked: false, hasAccess: false, plan: 'none' };
      _accessPromise = null;
    });
  } catch {
    // supabase may not be ready yet — non-fatal
  }
}

async function checkAICallAccess(): Promise<boolean> {
  // Lazily register the auth listener on first call
  registerAuthListener();

  if (_accessCache.checked) return _accessCache.hasAccess;

  if (!_accessPromise) {
    _accessPromise = (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const user = data?.session?.user;
        if (!user) {
          _accessCache = { checked: true, hasAccess: false, plan: 'none' };
          return;
        }

        const email = (user.email || '').toLowerCase();
        const isAdmin =
          ADMIN_UIDS.includes(user.id) || ADMIN_EMAILS.includes(email);

        if (isAdmin) {
          _accessCache = { checked: true, hasAccess: true, plan: 'admin' };
          return;
        }

        // Check subscription plan
        const headers = await getAuthHeaders();
        if (!headers.Authorization) {
          _accessCache = { checked: true, hasAccess: false, plan: 'none' };
          return;
        }
        const res = await fetch(`${API_BASE}/billing/subscription`, {
          headers,
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const sub = await res.json();
          const plan = (sub.plan || sub.subscription?.plan || 'none').toLowerCase();
          const isGrowthPlus = plan === 'growth' || plan === 'enterprise';
          _accessCache = { checked: true, hasAccess: isGrowthPlus, plan };
        } else {
          _accessCache = { checked: true, hasAccess: false, plan: 'none' };
        }
      } catch {
        _accessCache = { checked: true, hasAccess: false, plan: 'none' };
      }
    })();
  }

  await _accessPromise;
  return _accessCache.hasAccess;
}

// ─── Types ──────────────────────────────────────────────────────────
type CallStatus = 'idle' | 'loading' | 'connecting' | 'ringing' | 'active' | 'ended' | 'error';

interface SmartPhoneButtonProps {
  /** The phone number (E.164 or display format) */
  phone: string;
  /** Lead/contact name for AI greeting */
  leadName?: string;
  /** Business name for AI context */
  businessName?: string;
  /** Lead ID for call tracking */
  leadId?: string;
  /** Icon size classes (default: 'w-3.5 h-3.5') */
  iconClassName?: string;
  /** Additional wrapper classes */
  className?: string;
  /** Button color classes for the phone icon (default: 'text-zinc-400') */
  iconColor?: string;
  /** Show phone number text beside the icon */
  showNumber?: boolean;
  /** Formatted phone number display text */
  displayNumber?: string;
  /** Number classes */
  numberClassName?: string;
  /** Brand for AI call */
  brand?: string;
  /** AI agent ID */
  agentId?: string;
  /** Popover position preference */
  popoverPosition?: 'above' | 'below' | 'auto';
  /** Called on copy */
  onCopy?: () => void;
  /** Stop propagation on all clicks */
  stopPropagation?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────
export const SmartPhoneButton = memo(function SmartPhoneButton({
  phone,
  leadName,
  businessName,
  leadId,
  iconClassName = 'w-3.5 h-3.5',
  className = '',
  iconColor = 'text-zinc-400',
  showNumber = false,
  displayNumber,
  numberClassName = 'text-[11px] text-zinc-600 dark:text-zinc-400 font-mono tracking-tight',
  brand = 'contndr',
  agentId,
  popoverPosition = 'auto',
  onCopy,
  stopPropagation = true,
}: SmartPhoneButtonProps) {
  const { t } = useTranslation();
  const [showPopover, setShowPopover] = useState(false);
  const [hasAIAccess, setHasAIAccess] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [callId, setCallId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [posAbove, setPosAbove] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentCacheRef = useRef<any>(null);

  // Check access once on first hover (lazy)
  const ensureAccess = useCallback(async () => {
    if (accessChecked) return;
    const ok = await checkAICallAccess();
    setHasAIAccess(ok);
    setAccessChecked(true);
  }, [accessChecked]);

  // Determine popover position using screen coords (for portal)
  const calculatePosition = useCallback(() => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = popoverPosition === 'above' || (popoverPosition === 'auto' && spaceBelow < 180);
    setPosAbove(above);

    // Center horizontally on trigger, clamp to viewport
    const centerX = rect.left + rect.width / 2;
    const popW = 180; // min-width of popover
    let left = centerX - popW / 2;
    if (left < 8) left = 8;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - 8 - popW;

    const top = above ? rect.top - 6 : rect.bottom + 6;
    setPopoverPos({ top, left });
  }, [popoverPosition]);

  // Timer for call duration
  useEffect(() => {
    if (callStatus === 'active') {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (callStatus === 'idle') setElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callStatus]);

  // Keep popover open during active call
  useEffect(() => {
    if (callStatus !== 'idle' && callStatus !== 'ended' && callStatus !== 'error') {
      setShowPopover(true);
    }
  }, [callStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    calculatePosition();
    setShowPopover(true);
    ensureAccess();
  }, [calculatePosition, ensureAccess]);

  const handleMouseLeave = useCallback((e?: any) => {
    // Don't hide while call is active
    if (callStatus !== 'idle' && callStatus !== 'ended' && callStatus !== 'error') return;
    // Check if we're moving to the portal popover
    const related = e?.relatedTarget as HTMLElement | null;
    if (related && popoverRef.current?.contains(related)) return;
    if (related && wrapperRef.current?.contains(related)) return;
    hideTimeoutRef.current = setTimeout(() => setShowPopover(false), 200);
  }, [callStatus]);

  const handleCopy = useCallback(
    (e: ReactMouseEvent) => {
      if (stopPropagation) e.stopPropagation();
      navigator.clipboard.writeText(phone);
      setCopied(true);
      toast.success(t('smartPhoneButton.phoneCopied'));
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    },
    [phone, stopPropagation, onCopy, t]
  );

  const handleRegularCall = useCallback(
    (e: ReactMouseEvent) => {
      if (stopPropagation) e.stopPropagation();
      window.open(`tel:${phone}`, '_self');
    },
    [phone, stopPropagation]
  );

  const initiateAICall = useCallback(
    async (e: ReactMouseEvent) => {
      if (stopPropagation) e.stopPropagation();
      setCallStatus('loading');
      setErrorMsg(null);
      setElapsed(0);

      try {
        const headers = await getAuthHeaders();

        // Get user ID for credit tracking
        let currentUserId: string | null = null;
        try {
          const { data } = await supabase.auth.getSession();
          currentUserId = data?.session?.user?.id || null;
        } catch {}

        // Pre-flight credit check
        if (currentUserId) {
          try {
            const creditRes = await fetch(`${API_BASE}/ai-credits/credits/check`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ required: 1 }),
            });
            if (creditRes.ok) {
              const creditData = await creditRes.json();
              if (!creditData.allowed) {
                throw new Error(
                  creditData.message || 'Insufficient AI call credits'
                );
              }
            }
          } catch (creditErr: any) {
            if (
              creditErr.message?.includes('Insufficient') ||
              creditErr.message?.includes('credits')
            ) {
              throw creditErr;
            }
          }
        }

        // Get from number
        const numbersRes = await fetch(`${API_BASE}/telnyx/numbers`, {
          headers,
        });
        if (!numbersRes.ok) throw new Error('Could not load phone numbers');
        const numbersData = await numbersRes.json();
        const activeNumber = (numbersData.numbers || []).find(
          (n: any) => n.status === 'active'
        );
        if (!activeNumber) throw new Error('No active phone number');

        setCallStatus('connecting');

        // Load agent profile
        let agentProfile: any = agentCacheRef.current;
        if (!agentProfile) {
          try {
            if (agentId) {
              const agentRes = await fetch(`${API_BASE}/ai-agents/${agentId}`, {
                headers,
                signal: AbortSignal.timeout(5000),
              });
              if (agentRes.ok) {
                const d = await agentRes.json();
                agentProfile = d.agent;
              }
            } else {
              const agentsRes = await fetch(`${API_BASE}/ai-agents`, {
                headers,
                signal: AbortSignal.timeout(5000),
              });
              if (agentsRes.ok) {
                const d = await agentsRes.json();
                const agents = d.agents || [];
                agentProfile =
                  agents.find((a: any) => a.is_default) || agents[0] || null;
              }
            }
            agentCacheRef.current = agentProfile;
          } catch {
            console.warn('[SmartPhoneButton] Could not load agent profile');
          }
        }

        // Build AI config
        const resolvedVoice = agentProfile?.voice || 'rachel';
        const resolvedName = agentProfile?.name || 'Alex';
        const resolvedRole = agentProfile?.role || 'Sales Specialist';
        const resolvedBrand =
          agentProfile?.business_name || agentProfile?.brand || brand;

        const rawGreeting = agentProfile?.greeting || '';
        const resolvedGreeting = rawGreeting
          ? rawGreeting
              .replace(/\{name\}/g, resolvedName)
              .replace(/\{business_name\}/g, resolvedBrand)
              .replace(/\{role\}/g, resolvedRole)
          : `Hi, this is ${resolvedName} calling from ${resolvedBrand === 'contndr' ? 'Contndr' : resolvedBrand}. Do you have a quick minute?`;

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

        // Initiate call
        const callRes = await fetch(`${API_BASE}/telnyx/calls/initiate`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            from_number: activeNumber.phone_number,
            to_number: phone,
            lead_id: leadId || undefined,
            lead_name: leadName || undefined,
            business_name: businessName || undefined,
            user_id: currentUserId || undefined,
            ai_config: aiConfig,
          }),
        });

        if (!callRes.ok) {
          const errData = await callRes.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to start call');
        }

        const callData = await callRes.json();
        setCallId(callData.call?.id || null);
        setCallStatus('ringing');

        setTimeout(() => {
          setCallStatus((prev) => (prev === 'ringing' ? 'active' : prev));
        }, 12000);

        setTimeout(() => {
          setCallStatus((prev) =>
            prev === 'active' || prev === 'ringing' ? 'ended' : prev
          );
        }, 300000);
      } catch (err: any) {
        console.error('[SmartPhoneButton] AI Call error:', err);
        setErrorMsg(err.message || 'Call failed');
        setCallStatus('error');
      }
    },
    [phone, leadId, leadName, businessName, brand, agentId, stopPropagation]
  );

  const endCall = useCallback(
    async (e: ReactMouseEvent) => {
      if (stopPropagation) e.stopPropagation();
      if (callId) {
        try {
          const headers = await getAuthHeaders();
          await fetch(`${API_BASE}/telnyx/calls/${callId}/hangup`, {
            method: 'POST',
            headers,
            body: JSON.stringify({}),
          });
        } catch {}
      }
      setCallStatus('ended');
    },
    [callId, stopPropagation]
  );

  const resetCall = useCallback(
    (e: ReactMouseEvent) => {
      if (stopPropagation) e.stopPropagation();
      setCallStatus('idle');
      setCallId(null);
      setErrorMsg(null);
    },
    [stopPropagation]
  );

  const fmtDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!phone) return null;

  const isCallActive =
    callStatus === 'loading' ||
    callStatus === 'connecting' ||
    callStatus === 'ringing' ||
    callStatus === 'active';

  // ── Active-call icon color ──
  const resolvedIconColor =
    callStatus === 'active'
      ? 'text-[#1ED4A7]'
      : callStatus === 'ringing' || callStatus === 'connecting'
      ? 'text-amber-400'
      : callStatus === 'error'
      ? 'text-red-400'
      : iconColor;

  return (
    <div
      ref={wrapperRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Trigger: phone icon (+ optional number) */}
      <div className="flex items-center gap-1.5 cursor-pointer group/phone">
        <div className="relative">
          {isCallActive ? (
            callStatus === 'loading' || callStatus === 'connecting' ? (
              <Loader2
                className={`${iconClassName} text-zinc-400 animate-spin`}
              />
            ) : (
              <PhoneCall
                className={`${iconClassName} ${resolvedIconColor} ${callStatus === 'ringing' ? 'animate-pulse' : ''}`}
              />
            )
          ) : (
            <Phone
              className={`${iconClassName} ${resolvedIconColor} flex-shrink-0 group-hover/phone:text-[#1ED4A7] transition-colors`}
            />
          )}
          {/* Tiny sparkle badge for AI-enabled */}
          {hasAIAccess && callStatus === 'idle' && (
            <Sparkles className="absolute -top-1 -right-1.5 w-2 h-2 text-[#1ED4A7] opacity-0 group-hover/phone:opacity-100 transition-opacity" />
          )}
        </div>
        {showNumber && displayNumber && (
          <span className={`${numberClassName} truncate`}>{displayNumber}</span>
        )}
      </div>

      {/* Popover — rendered via portal to escape overflow:hidden containers */}
      {showPopover && popoverPos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[9999] min-w-[180px]"
          style={{
            top: posAbove ? undefined : popoverPos.top,
            bottom: posAbove ? window.innerHeight - popoverPos.top : undefined,
            left: popoverPos.left,
            animation: 'fadeIn 0.12s ease-out',
          }}
          onMouseEnter={() => {
            if (hideTimeoutRef.current) {
              clearTimeout(hideTimeoutRef.current);
              hideTimeoutRef.current = null;
            }
          }}
          onMouseLeave={handleMouseLeave}
        >
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl shadow-black/40 overflow-hidden">
            {/* ── Idle: action menu ── */}
            {callStatus === 'idle' && (
              <div className="py-1">
                {/* Copy */}
                <button
                  onClick={handleCopy}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-[#1ED4A7]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-zinc-500" />
                  )}
                  <span className="font-medium">
                    {copied ? t('smartPhoneButton.copied') : t('smartPhoneButton.copyNumber')}
                  </span>
                </button>

                {/* Regular call */}
                <button
                  onClick={handleRegularCall}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                >
                  <Phone className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="font-medium">{t('smartPhoneButton.call')}</span>
                </button>

                {/* AI Call — plan-gated */}
                {hasAIAccess && (
                  <>
                    <div className="mx-3 my-0.5 border-t border-zinc-800" />
                    <button
                      onClick={initiateAICall}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-[#1ED4A7] hover:bg-[#1ED4A7]/10 transition-colors group"
                    >
                      <div className="relative">
                        <Phone className="w-3.5 h-3.5" />
                        <Sparkles className="w-2 h-2 absolute -top-0.5 -right-1 group-hover:scale-125 transition-transform" />
                      </div>
                      <span className="font-bold">{t('smartPhoneButton.aiCall')}</span>
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── In-progress call status ── */}
            {callStatus !== 'idle' && (
              <div className="px-3.5 py-3 space-y-2">
                {/* Status row */}
                <div className="flex items-center gap-2">
                  {/* Status dot */}
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      callStatus === 'active'
                        ? 'bg-[#1ED4A7]'
                        : callStatus === 'error'
                        ? 'bg-red-500'
                        : callStatus === 'ended'
                        ? 'bg-zinc-500'
                        : 'bg-amber-400 animate-pulse'
                    }`}
                  />
                  <span
                    className={`text-[11px] font-bold uppercase tracking-wider flex-1 ${
                      callStatus === 'active'
                        ? 'text-[#1ED4A7]'
                        : callStatus === 'error'
                        ? 'text-red-400'
                        : callStatus === 'ended'
                        ? 'text-zinc-500'
                        : 'text-zinc-400'
                    }`}
                  >
                    {callStatus === 'loading'
                      ? t('smartPhoneButton.preparing')
                      : callStatus === 'connecting'
                      ? t('smartPhoneButton.connecting')
                      : callStatus === 'ringing'
                      ? t('smartPhoneButton.ringing')
                      : callStatus === 'active'
                      ? t('smartPhoneButton.aiSpeaking')
                      : callStatus === 'ended'
                      ? t('smartPhoneButton.callEnded')
                      : t('smartPhoneButton.failed')}
                  </span>

                  {/* Duration */}
                  {callStatus === 'active' && (
                    <div className="flex items-center gap-1">
                      <Volume2 className="w-3 h-3 text-[#1ED4A7] animate-pulse" />
                      <span className="text-[10px] font-mono text-[#1ED4A7] tabular-nums">
                        {fmtDuration(elapsed)}
                      </span>
                    </div>
                  )}

                  {/* Spinner for connecting */}
                  {(callStatus === 'loading' || callStatus === 'connecting') && (
                    <Loader2 className="w-3 h-3 text-zinc-500 animate-spin" />
                  )}

                  {/* Ringing dots */}
                  {callStatus === 'ringing' && (
                    <div className="flex gap-0.5">
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="w-0.5 bg-amber-400 rounded-full animate-bounce"
                          style={{
                            height: '8px',
                            animationDelay: `${i * 150}ms`,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Error message */}
                {callStatus === 'error' && errorMsg && (
                  <div className="flex items-start gap-1.5 text-[10px] text-red-400/80">
                    <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    <span className="leading-tight">{errorMsg}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-1.5">
                  {isCallActive && (
                    <button
                      onClick={endCall}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 text-[11px] font-semibold transition-colors"
                    >
                      <PhoneOff className="w-3 h-3" />
                      {t('smartPhoneButton.end')}
                    </button>
                  )}
                  {(callStatus === 'ended' || callStatus === 'error') && (
                    <>
                      <button
                        onClick={resetCall}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] border border-zinc-700 rounded-lg text-zinc-300 text-[11px] font-medium transition-colors"
                      >
                        <Phone className="w-3 h-3" />
                        {t('smartPhoneButton.again')}
                      </button>
                      <button
                        onClick={(e) => {
                          if (stopPropagation) e.stopPropagation();
                          resetCall(e);
                          setShowPopover(false);
                        }}
                        className="flex items-center justify-center p-1.5 hover:bg-white/[0.06] rounded-lg text-zinc-500 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

export default SmartPhoneButton;
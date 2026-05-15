/**
 * QuoDialer — Internal-only click-to-call dialer for Contndr sales team.
 * Supports two modes:
 *   • Browser Call (WebRTC) – audio through the browser via Telnyx WebRTC SDK
 *   • Bridge Call (legacy) – rings rep's phone then bridges to lead
 *
 * Rendered inside LeadDetailModal for internal/admin users only.
 * Monochromatic zinc/white aesthetic — emerald only on live status indicators.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Clock,
  Plus,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Voicemail,
  UserX,
  Loader2,
  NotebookPen,
  Trash2,
  PhoneOutgoing,
  Mic,
  MicOff,
  Pause,
  Play,
  Hash,
  Wifi,
  Monitor,
  Smartphone,
  Volume2,
  Sparkles,
  ArrowRight,
  Target,
  TrendingUp,
  AlertCircle,
  Tag
} from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { toast } from 'sonner';
import { formatPhoneDisplay } from '../lib/phone-format';

// @telnyx/webrtc is loaded dynamically at call time to avoid static import failures
// We load from CDN to bypass Vite/Rollup bundling since the npm package isn't available.
// The UMD bundle exposes the constructor under various global names depending on version.
let _cachedSDK: any = null;

const findTelnyxGlobal = (): any => {
  const w = window as any;
  
  // Helper to check if something is a valid constructor
  const isConstructor = (obj: any): boolean => {
    if (typeof obj !== 'function') return false;
    try {
      // Check if it has prototype properties typical of a class
      return obj.prototype && obj.prototype.constructor === obj;
    } catch {
      return false;
    }
  };
  
  // Check all known global export names used by Telnyx WebRTC SDK versions
  // Direct window.TelnyxRTC
  if (w.TelnyxRTC) {
    if (isConstructor(w.TelnyxRTC)) return w.TelnyxRTC;
    // Could be a module object with default export
    if (w.TelnyxRTC.default && isConstructor(w.TelnyxRTC.default)) return w.TelnyxRTC.default;
    // Could be a module object with named export
    if (w.TelnyxRTC.TelnyxRTC && isConstructor(w.TelnyxRTC.TelnyxRTC)) return w.TelnyxRTC.TelnyxRTC;
  }
  
  // window.TelnyxWebRTC
  if (w.TelnyxWebRTC && isConstructor(w.TelnyxWebRTC)) return w.TelnyxWebRTC;
  
  // Namespaced under window.Telnyx
  if (w.Telnyx) {
    if (isConstructor(w.Telnyx)) return w.Telnyx;
    if (w.Telnyx.TelnyxRTC && isConstructor(w.Telnyx.TelnyxRTC)) return w.Telnyx.TelnyxRTC;
    if (w.Telnyx.default && isConstructor(w.Telnyx.default)) return w.Telnyx.default;
  }
  
  // Fallback: scan for any Telnyx-prefixed constructor on window
  for (const key of Object.keys(w)) {
    if (/^Telnyx/i.test(key)) {
      const obj = w[key];
      if (isConstructor(obj)) {
        console.log(`[QuoDialer] Found Telnyx SDK constructor at window.${key}`);
        return obj;
      }
      // Check if it's a module object with nested constructor
      if (obj && typeof obj === 'object') {
        if (obj.default && isConstructor(obj.default)) {
          console.log(`[QuoDialer] Found Telnyx SDK constructor at window.${key}.default`);
          return obj.default;
        }
        for (const nestedKey of Object.keys(obj)) {
          if (/telnyx|rtc/i.test(nestedKey) && isConstructor(obj[nestedKey])) {
            console.log(`[QuoDialer] Found Telnyx SDK constructor at window.${key}.${nestedKey}`);
            return obj[nestedKey];
          }
        }
      }
    }
  }
  return null;
};

const loadTelnyxSDK = (): Promise<any> => {
  if (_cachedSDK) return Promise.resolve(_cachedSDK);
  const existing = findTelnyxGlobal();
  if (existing) { _cachedSDK = existing; return Promise.resolve(existing); }

  return new Promise(async (resolve, reject) => {
    // Check if a script is already loading
    const existingScript = document.querySelector('script[data-telnyx-sdk]');
    if (existingScript) {
      existingScript.addEventListener('load', () => {
        const sdk = findTelnyxGlobal();
        if (sdk) { _cachedSDK = sdk; resolve(sdk); }
        else reject(new Error('TelnyxRTC not found on window after loading SDK'));
      });
      return;
    }

    // Skip dynamic import and use UMD script loading
    const cdnUrls = [
      'https://unpkg.com/@telnyx/webrtc@2.12.0/dist/bundle.umd.js',
      'https://unpkg.com/@telnyx/webrtc@2.12.0',
      'https://unpkg.com/@telnyx/webrtc@2.12.0/lib/bundle.js',
    ];
    
    let attemptIndex = 0;
    
    const tryNextUrl = () => {
      if (attemptIndex >= cdnUrls.length) {
        reject(new Error('Failed to load Telnyx WebRTC SDK from all CDN sources'));
        return;
      }
      
      const script = document.createElement('script');
      script.setAttribute('data-telnyx-sdk', '1');
      script.src = cdnUrls[attemptIndex];
      script.async = true;
      
      console.log(`[QuoDialer] Attempting to load Telnyx SDK via script tag from: ${script.src}`);
      attemptIndex++;
      
      script.onload = () => {
        // Give the UMD wrapper a tick to assign globals
        setTimeout(() => {
          const sdk = findTelnyxGlobal();
          if (sdk) {
            _cachedSDK = sdk;
            console.log('[QuoDialer] Telnyx WebRTC SDK loaded successfully from:', script.src);
            resolve(sdk);
          } else {
            // Debug: log all Telnyx-related globals
            const telnyxKeys = Object.keys(window).filter(k => /telnyx/i.test(k));
            console.warn(`[QuoDialer] No constructor found from ${script.src}, trying next URL...`);
            
            if (telnyxKeys.length > 0) {
              console.error('[QuoDialer] Found Telnyx-like window keys:', telnyxKeys);
              telnyxKeys.forEach(key => {
                const val = (window as any)[key];
                console.error(`  - window.${key} = ${typeof val}`, val);
                if (val && typeof val === 'object') {
                  console.error(`    - Keys: ${Object.keys(val).slice(0, 10).join(', ')}`);
                }
              });
            }
            
            // Try next URL
            script.remove();
            tryNextUrl();
          }
        }, 150);
      };
      
      script.onerror = () => {
        console.warn(`[QuoDialer] Failed to load from ${script.src}, trying next URL...`);
        script.remove();
        tryNextUrl();
      };
      
      document.head.appendChild(script);
    };
    
    tryNextUrl();
  });
};

const QUO_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/quo`;
const WEBRTC_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/quo-webrtc`;

// ── Types ──

interface AiSummary {
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  interest_level: 'high' | 'medium' | 'low' | 'none';
  action_items: string[];
  suggested_follow_up: string;
  key_objections: string[];
  deal_probability: number;
  tags: string[];
}

interface QuoCall {
  id: string;
  quo_call_id: string | null;
  lead_id: string | null;
  lead_name: string | null;
  business_name: string | null;
  from_number_id: string | null;
  to_number: string;
  status: string;
  initiated_by: string;
  started_at: string;
  updated_at: string;
  notes: string;
  outcome: string | null;
  duration_seconds: number | null;
  manual?: boolean;
  ai_summary?: AiSummary | null;
  ai_generated_at?: string | null;
}

interface QuoNumber {
  id: string;
  phoneNumber?: string;
  phone_number?: string;
  name?: string;
  formattedPhoneNumber?: string;
}

interface QuoDialerProps {
  leadId: string;
  leadName: string;
  businessName: string;
  phones: Array<{ phone: string; type: string }>;
}

type DialerMode = 'browser' | 'bridge';
type WebRTCStatus = 'idle' | 'connecting' | 'requesting' | 'trying' | 'ringing' | 'early' | 'active' | 'held' | 'done' | 'error';

// Human-readable label + color for each status
const STATUS_META: Record<WebRTCStatus, { label: string; color: string; pulse: boolean }> = {
  idle:        { label: '',                color: '',                pulse: false },
  connecting:  { label: 'Connecting…',     color: 'bg-zinc-400',    pulse: true  },
  requesting:  { label: 'Requesting…',     color: 'bg-zinc-400',    pulse: true  },
  trying:      { label: 'Trying…',         color: 'bg-amber-400',   pulse: true  },
  ringing:     { label: 'Ringing…',        color: 'bg-amber-400',   pulse: true  },
  early:       { label: 'Ringing…',        color: 'bg-amber-400',   pulse: true  },
  active:      { label: 'Connected',       color: 'bg-[#1ED4A7]',   pulse: false },
  held:        { label: 'On Hold',         color: 'bg-amber-400',   pulse: false },
  done:        { label: 'Call Ended',      color: 'bg-zinc-400',    pulse: false },
  error:       { label: 'Failed',          color: 'bg-red-500',     pulse: false },
};

const CALL_OUTCOMES = [
  { value: 'connected', label: 'Connected', icon: CheckCircle2 },
  { value: 'no_answer', label: 'No Answer', icon: PhoneOff },
  { value: 'voicemail', label: 'Left Voicemail', icon: Voicemail },
  { value: 'busy', label: 'Busy', icon: XCircle },
  { value: 'wrong_number', label: 'Wrong Number', icon: UserX },
  { value: 'callback_scheduled', label: 'Callback Scheduled', icon: Clock },
  { value: 'interested', label: 'Interested', icon: CheckCircle2 },
  { value: 'not_interested', label: 'Not Interested', icon: XCircle },
];

const DTMF_KEYS = ['1','2','3','4','5','6','7','8','9','*','0','#'];

export function QuoDialer({ leadId, leadName, businessName, phones }: QuoDialerProps) {
  // ── Shared state ──
  const [callHistory, setCallHistory] = useState<QuoCall[]>([]);
  const [quoNumbers, setQuoNumbers] = useState<QuoNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLogForm, setShowLogForm] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState('');
  const [selectedFromNumber, setSelectedFromNumber] = useState('');
  const [logNotes, setLogNotes] = useState('');
  const [logOutcome, setLogOutcome] = useState('');
  const [logDuration, setLogDuration] = useState('');
  const [loggingCall, setLoggingCall] = useState(false);
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null);

  // ── Mode toggle ──
  const [mode, setMode] = useState<DialerMode>(() => {
    return (localStorage.getItem('quo_dialer_mode') as DialerMode) || 'browser';
  });

  // ── Bridge-mode state ──
  const [repPhone, setRepPhone] = useState(() => {
    return localStorage.getItem('quo_rep_phone') || '';
  });

  // ── WebRTC state ──
  const [webrtcStatus, setWebrtcStatus] = useState<WebRTCStatus>('idle');
  const [webrtcAvailable, setWebrtcAvailable] = useState<boolean | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [showDTMF, setShowDTMF] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [webrtcError, setWebrtcError] = useState<string | null>(null);

  // ── Post-call AI state ──
  const [showPostCall, setShowPostCall] = useState(false);
  const [postCallOutcome, setPostCallOutcome] = useState('');
  const [postCallNotes, setPostCallNotes] = useState('');
  const [postCallDuration, setPostCallDuration] = useState(0);
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [savingPostCall, setSavingPostCall] = useState(false);
  const [lastCallId, setLastCallId] = useState<string | null>(null);

  // Refs for the WebRTC client and active call
  const telnyxClientRef = useRef<any>(null);
  const activeCallRef = useRef<any>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callEndedRef = useRef(false);
  const finalDurationRef = useRef(0);

  // Persist mode choice
  useEffect(() => {
    localStorage.setItem('quo_dialer_mode', mode);
  }, [mode]);

  // ── Check WebRTC availability ──
  useEffect(() => {
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${WEBRTC_BASE}/status`, { headers });
        if (res.ok) {
          const data = await res.json();
          setWebrtcAvailable(data.webrtc_available === true);
        } else {
          setWebrtcAvailable(false);
        }
      } catch {
        setWebrtcAvailable(false);
      }
    })();
  }, []);

  // If WebRTC not available, fall back to bridge
  useEffect(() => {
    if (webrtcAvailable === false && mode === 'browser') {
      setMode('bridge');
    }
  }, [webrtcAvailable, mode]);

  // ── Fetch config + call history + phone numbers ──
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();

      const configRes = await fetch(`${QUO_BASE}/config`, { headers });
      if (configRes.ok) {
        const configData = await configRes.json();
        setApiConfigured(configData.config?.api_key_configured || false);
      }

      const numbersRes = await fetch(`${QUO_BASE}/phone-numbers`, { headers });
      if (numbersRes.ok) {
        const numbersData = await numbersRes.json();
        const nums = numbersData.numbers || [];
        setQuoNumbers(nums);
        if (nums.length > 0 && !selectedFromNumber) {
          setSelectedFromNumber(nums[0].id);
        }
      }

      const historyRes = await fetch(`${QUO_BASE}/calls/history?lead_id=${leadId}`, { headers });
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setCallHistory(historyData.calls || []);
      }
    } catch (err) {
      console.error('[QuoDialer] Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }, [leadId, selectedFromNumber]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (phones.length > 0 && !selectedNumber) {
      setSelectedNumber(phones[0].phone);
    }
  }, [phones, selectedNumber]);

  // ── Clean up WebRTC on unmount ──
  useEffect(() => {
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
      if (streamPollRef.current) clearInterval(streamPollRef.current);
      if (activeCallRef.current) {
        try { activeCallRef.current.hangup(); } catch {}
      }
      if (telnyxClientRef.current) {
        try { telnyxClientRef.current.disconnect(); } catch {}
      }
      if (audioRef.current) {
        audioRef.current.srcObject = null;
        audioRef.current.remove();
      }
    };
  }, []);

  // ── Call timer ──
  const startCallTimer = () => {
    setCallDuration(0);
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    callTimerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  const stopCallTimer = () => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // ──────────────────────────────────────
  // WebRTC: Connect + Place Call
  // ──────────────────────────────────────
  const initiateWebRTCCall = async () => {
    if (!selectedNumber) {
      toast.error('Select a phone number to call');
      return;
    }

    setCalling(true);
    setWebrtcError(null);
    setWebrtcStatus('connecting');
    callEndedRef.current = false;
    setShowPostCall(false);
    setAiSummary(null);

    try {
      // 1. Get a login token from our backend
      const headers = await getAuthHeaders();
      const tokenRes = await fetch(`${WEBRTC_BASE}/token`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' }
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        throw new Error(err.error || 'Failed to get WebRTC token');
      }

      const tokenData = await tokenRes.json();
      const loginToken = tokenData.token;

      if (!loginToken) {
        throw new Error('No token received from server');
      }

      // 2. Create TelnyxRTC client with the login token
      const TelnyxRTCClass = await loadTelnyxSDK();
      
      // Validate that we got a constructor
      if (typeof TelnyxRTCClass !== 'function') {
        console.error('[QuoDialer] TelnyxRTCClass is not a function:', typeof TelnyxRTCClass, TelnyxRTCClass);
        throw new Error(`TelnyxRTC SDK loaded but is not a constructor (type: ${typeof TelnyxRTCClass})`);
      }
      
      console.log('[QuoDialer] Creating WebRTC client with login token...');
      const client = new TelnyxRTCClass({
        login_token: loginToken,
      });

      // Helper: aggressively search for the remote audio stream on a call object
      const findRemoteStream = (callObj: any): MediaStream | null => {
        if (!callObj) return null;
        // Direct .remoteStream (most common)
        if (callObj.remoteStream instanceof MediaStream && callObj.remoteStream.getAudioTracks().length > 0) {
          return callObj.remoteStream;
        }
        // Peer connection remote streams
        if (callObj.peer) {
          if (callObj.peer.remoteStream instanceof MediaStream && callObj.peer.remoteStream.getAudioTracks().length > 0) {
            return callObj.peer.remoteStream;
          }
          // RTCPeerConnection.getReceivers()
          const pc = callObj.peer?.instance || callObj.peer?._pc || callObj.peer;
          if (pc && typeof pc.getReceivers === 'function') {
            try {
              const receivers = pc.getReceivers();
              const audioReceivers = receivers.filter((r: any) => r.track && r.track.kind === 'audio');
              if (audioReceivers.length > 0) {
                const stream = new MediaStream(audioReceivers.map((r: any) => r.track));
                console.log('[QuoDialer] Built remote stream from RTCPeerConnection receivers');
                return stream;
              }
            } catch (_e) { /* ignore */ }
          }
        }
        // Fallback: check .remoteStream even without audio tracks (it might add tracks later)
        if (callObj.remoteStream instanceof MediaStream) {
          return callObj.remoteStream;
        }
        return null;
      };

      // Helper: poll for remote stream up to N times, then give up
      const pollForRemoteStream = (callObj: any, maxAttempts = 20, intervalMs = 300) => {
        let attempts = 0;
        const poll = setInterval(() => {
          attempts++;
          const stream = findRemoteStream(callObj);
          if (stream) {
            clearInterval(poll);
            console.log(`[QuoDialer] Remote stream found after ${attempts} poll(s)`);
            attachAudio(stream);
            // Also monitor for track additions on this stream
            stream.addEventListener('addtrack', () => {
              console.log('[QuoDialer] New track added to remote stream, re-attaching audio');
              attachAudio(stream);
            });
          } else if (attempts >= maxAttempts) {
            clearInterval(poll);
            console.warn(`[QuoDialer] No remote audio stream found after ${maxAttempts} polls — call may have no audio`);
          }
        }, intervalMs);
        return poll;
      };

      // Attach event handlers
      client.on('telnyx.ready', () => {
        console.log('[QuoDialer] WebRTC client ready');
        setWebrtcStatus('requesting');

        // Clear the SDK-connect timeout since we're connected to Telnyx
        if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null; }

        // Resolve caller ID
        const fromLine = quoNumbers.find(n => n.id === selectedFromNumber);
        const callerNumber = fromLine?.phone_number || fromLine?.phoneNumber || fromLine?.formattedPhoneNumber || '';

        // 3. Place the call
        const call = client.newCall({
          destinationNumber: selectedNumber,
          callerNumber: callerNumber,
          audio: true,
          video: false,
        });

        activeCallRef.current = call;
        setWebrtcStatus('trying');

        // Ringing timeout — if nobody answers within 45s, end it
        const ringingTimeout = setTimeout(() => {
          if (activeCallRef.current === call) {
            console.log('[QuoDialer] Ringing timeout — no answer after 45s');
            setWebrtcError('No answer — call timed out');
            try { call.hangup(); } catch {}
            handleCallEnd('done');
          }
        }, 45_000);

        // Listen for call state changes
        call.on('telnyx.notification', (notification: any) => {
          const state = notification?.call?.state;
          const cause = notification?.call?.cause;
          const causeCode = notification?.call?.causeCode;
          console.log('[QuoDialer] Call state:', state, '| cause:', cause, '| causeCode:', causeCode, '| remoteStream:', !!notification?.call?.remoteStream);

          // ── Map every Telnyx state to our smart status ──
          switch (state) {
            case 'new':
            case 'requesting':
              setWebrtcStatus('requesting');
              break;
            case 'trying':
              setWebrtcStatus('trying');
              break;
            case 'recovering':
              setWebrtcStatus('trying');
              break;
            case 'ringing':
              setWebrtcStatus('ringing');
              setCalling(false);
              break;
            case 'answering':
              setWebrtcStatus('ringing');
              break;
            case 'early':
              setWebrtcStatus('early');
              {
                const stream = findRemoteStream(notification.call || call);
                if (stream) {
                  console.log('[QuoDialer] Early media available, attaching audio');
                  attachAudio(stream);
                }
              }
              break;
            case 'active':
              clearTimeout(ringingTimeout);
              setWebrtcStatus('active');
              startCallTimer();
              setCalling(false);
              {
                const stream = findRemoteStream(notification.call || call);
                if (stream) {
                  attachAudio(stream);
                } else {
                  console.log('[QuoDialer] No remote stream at active state, starting poll...');
                  if (streamPollRef.current) clearInterval(streamPollRef.current);
                  streamPollRef.current = pollForRemoteStream(call);
                }
              }
              break;
            case 'held':
              setWebrtcStatus('held');
              break;
            case 'hangup':
            case 'destroy':
            case 'purge': {
              clearTimeout(ringingTimeout);
              if (streamPollRef.current) { clearInterval(streamPollRef.current); streamPollRef.current = null; }
              const reason = deriveHangupReason(cause, causeCode);
              if (reason) {
                console.log('[QuoDialer] Hangup reason:', reason);
                setWebrtcError(reason);
              }
              handleCallEnd('done');
              break;
            }
            default:
              console.log('[QuoDialer] Unhandled Telnyx state:', state);
              break;
          }
        });
      });

      // SDK-level connection timeout (15s to connect to Telnyx signalling)
      connectionTimeoutRef.current = setTimeout(() => {
        console.error('[QuoDialer] SDK connection timeout after 15s');
        setWebrtcError('Connection to Telnyx timed out — check your network');
        setWebrtcStatus('error');
        setCalling(false);
        if (telnyxClientRef.current) { try { telnyxClientRef.current.disconnect(); } catch {} }
        telnyxClientRef.current = null;
      }, 15_000);

      client.on('telnyx.error', (error: any) => {
        console.error('[QuoDialer] WebRTC error:', error);
        if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null; }
        setWebrtcError(error?.message || 'WebRTC connection error');
        setWebrtcStatus('error');
        setCalling(false);
      });

      client.on('telnyx.notification', (notification: any) => {
        // Handle any call media at the client level as a safety net
        const callObj = notification?.call;
        if (callObj) {
          const stream = findRemoteStream(callObj);
          if (stream) {
            console.log('[QuoDialer] Client-level notification: attaching remote stream');
            attachAudio(stream);
          }
        }
      });

      client.connect();
      telnyxClientRef.current = client;

    } catch (err: any) {
      console.error('[QuoDialer] WebRTC call error:', err);
      setWebrtcError(err.message || 'Failed to start browser call');
      setWebrtcStatus('error');
      toast.error(err.message || 'Failed to start browser call');
      setCalling(false);
    }
  };

  // Attach remote audio stream to an <audio> element
  const attachAudio = (stream: MediaStream) => {
    // Debug: log stream details
    const audioTracks = stream.getAudioTracks();
    console.log(`[QuoDialer] attachAudio called — tracks: ${audioTracks.length}, active: ${stream.active}`);
    audioTracks.forEach((t, i) => {
      console.log(`[QuoDialer]   track[${i}]: id=${t.id}, enabled=${t.enabled}, muted=${t.muted}, readyState=${t.readyState}`);
      // Ensure tracks are enabled
      if (!t.enabled) {
        t.enabled = true;
        console.log(`[QuoDialer]   track[${i}]: force-enabled`);
      }
    });

    // Remove any stale audio element first
    const stale = document.getElementById('quo-remote-audio');
    if (stale && stale !== audioRef.current) {
      stale.remove();
    }

    if (!audioRef.current) {
      const audio = document.createElement('audio');
      audio.id = 'quo-remote-audio';
      audio.autoplay = true;
      audio.playsInline = true;
      audio.volume = 1.0;
      // Some browsers need the element in the DOM before setting srcObject
      document.body.appendChild(audio);
      audioRef.current = audio;
    }

    const audio = audioRef.current;
    // Only re-assign if the stream actually changed
    if (audio.srcObject !== stream) {
      audio.srcObject = stream;
      console.log('[QuoDialer] srcObject assigned to audio element');
    }
    audio.volume = 1.0;
    audio.muted = false;

    // Force play with user-gesture retry
    const tryPlay = () => {
      audio.play().then(() => {
        console.log('[QuoDialer] Audio playback started successfully');
      }).catch((err) => {
        console.warn('[QuoDialer] Audio play() blocked:', err.message);
        // Retry once after a short delay (browser may allow after state change)
        setTimeout(() => {
          audio.play().catch((e2) => {
            console.error('[QuoDialer] Audio play() retry also failed:', e2.message);
          });
        }, 500);
      });
    };
    tryPlay();
  };

  // Derive a human-readable hangup reason from Telnyx cause/causeCode
  const deriveHangupReason = (cause?: string, causeCode?: number | string): string | null => {
    const cc = typeof causeCode === 'string' ? parseInt(causeCode, 10) : causeCode;
    const c = (cause || '').toLowerCase();
    if (cc === 19 || cc === 18 || c.includes('timeout') || c.includes('no_answer') || c === 'recovery_on_timer_expire') {
      return 'No answer — recipient didn\'t pick up';
    }
    if (cc === 17 || c.includes('busy') || c === 'user_busy') {
      return 'Line busy — try again later';
    }
    if (cc === 21 || c.includes('rejected') || c.includes('declined') || c === 'call_rejected') {
      return 'Call rejected by recipient';
    }
    if (cc === 20 || cc === 27 || c.includes('unavailable') || c.includes('subscriber_absent')) {
      return 'Number not reachable or out of service';
    }
    if (cc === 1 || cc === 28 || c.includes('invalid') || c.includes('unallocated_number')) {
      return 'Invalid or unallocated phone number';
    }
    if (cc === 16 || c === 'normal_clearing' || c === 'normal clearing' || c === 'originator_cancel') {
      return null;
    }
    if (cc === 34 || cc === 42 || c.includes('congestion') || c.includes('circuit')) {
      return 'Network congestion — try again';
    }
    if (cause && cause !== 'NORMAL_CLEARING' && cause !== 'normal_clearing') {
      return `Call ended: ${cause.replace(/_/g, ' ')}`;
    }
    return null;
  };

  // End call with optional final status ('done' shows a brief banner then resets)
  const handleCallEnd = (finalStatus: WebRTCStatus = 'idle') => {
    // Prevent double-execution from both hangup button + SDK notification
    if (callEndedRef.current && finalStatus === 'done') return;
    callEndedRef.current = true;

    stopCallTimer();
    // Capture final duration before it resets
    finalDurationRef.current = callDuration;
    if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null; }
    if (streamPollRef.current) { clearInterval(streamPollRef.current); streamPollRef.current = null; }

    setIsMuted(false);
    setIsOnHold(false);
    setShowDTMF(false);
    setCalling(false);
    activeCallRef.current = null;

    // Disconnect the SDK client AFTER a brief delay so the BYE signal can propagate
    setTimeout(() => {
      if (telnyxClientRef.current) {
        try { telnyxClientRef.current.disconnect(); } catch {}
        telnyxClientRef.current = null;
      }
    }, 500);

    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.remove();
      audioRef.current = null;
    }

    // Show final status then transition to post-call panel
    if (finalStatus === 'done') {
      setWebrtcStatus('done');
      const dur = finalDurationRef.current;
      // Log the raw call to history
      if (dur > 0) {
        logWebRTCCallToHistory();
      }
      // After a brief "Call Ended" banner, show post-call AI panel
      setTimeout(() => {
        setWebrtcStatus('idle');
        setPostCallDuration(dur);
        setPostCallNotes('');
        setPostCallOutcome('');
        setAiSummary(null);
        setShowPostCall(true);
        callEndedRef.current = false;
      }, 2000);
    } else {
      setWebrtcStatus(finalStatus);
      callEndedRef.current = false;
    }
  };

  const hangupWebRTC = () => {
    if (activeCallRef.current) {
      try { activeCallRef.current.hangup(); } catch {}
      // Set a fallback — if the SDK doesn't fire hangup/destroy within 3s, force cleanup
      setTimeout(() => {
        if (!callEndedRef.current) {
          console.log('[QuoDialer] Hangup fallback — SDK did not fire hangup event, forcing cleanup');
          handleCallEnd('done');
        }
      }, 3000);
    } else {
      // No active call object — just clean up directly
      handleCallEnd('done');
    }
  };

  const toggleMute = () => {
    if (!activeCallRef.current) return;
    if (isMuted) {
      activeCallRef.current.unmuteAudio();
    } else {
      activeCallRef.current.muteAudio();
    }
    setIsMuted(!isMuted);
  };

  const toggleHold = () => {
    if (!activeCallRef.current) return;
    if (isOnHold) {
      activeCallRef.current.unhold();
    } else {
      activeCallRef.current.hold();
    }
    setIsOnHold(!isOnHold);
  };

  const sendDTMF = (digit: string) => {
    if (!activeCallRef.current) return;
    activeCallRef.current.dtmf(digit);
    toast.success(`DTMF: ${digit}`, { duration: 800 });
  };

  // Log a WebRTC call to our KV history after it ends
  const logWebRTCCallToHistory = async () => {
    try {
      const dur = finalDurationRef.current || callDuration;
      const headers = await getAuthHeaders();
      const res = await fetch(`${QUO_BASE}/calls/manual-log`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: leadId,
          lead_name: leadName,
          business_name: businessName,
          to_number: selectedNumber || phones[0]?.phone || '',
          notes: `Browser call (WebRTC) — ${formatDuration(dur)}`,
          outcome: 'connected',
          duration_seconds: dur
        })
      });
      if (res.ok) {
        const data = await res.json();
        setCallHistory(prev => [data.call, ...prev]);
        // Store the call ID so the post-call panel can update it
        setLastCallId(data.call?.id || null);
      }
    } catch (err) {
      console.error('[QuoDialer] Failed to log WebRTC call:', err);
    }
  };

  // ──────────────────────────────────────
  // Bridge: Initiate call (legacy)
  // ──────────────────────────────────────
  const initiateBridgeCall = async () => {
    if (!selectedNumber) {
      toast.error('Select a phone number to call');
      return;
    }
    if (!selectedFromNumber && quoNumbers.length > 0) {
      toast.error('Select a line to call from');
      return;
    }
    if (!repPhone) {
      toast.error('Enter your phone number to receive the bridged call');
      return;
    }

    localStorage.setItem('quo_rep_phone', repPhone);

    const fromLine = quoNumbers.find(n => n.id === selectedFromNumber);
    const fromPhoneNumber = fromLine?.phone_number || fromLine?.phoneNumber || fromLine?.formattedPhoneNumber || null;

    setCalling(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${QUO_BASE}/calls/initiate`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_number: selectedNumber,
          from_number_id: selectedFromNumber,
          from_phone_number: fromPhoneNumber,
          rep_phone: repPhone,
          lead_id: leadId,
          lead_name: leadName,
          business_name: businessName
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to initiate call');
      }

      const data = await res.json();
      toast.success(`Call initiated! Your phone (${formatPhoneDisplay(repPhone)}) will ring first.`);
      setCallHistory(prev => [data.call, ...prev]);
    } catch (err: any) {
      console.error('[QuoDialer] Bridge call error:', err);
      toast.error(err.message || 'Failed to initiate call');
    } finally {
      setCalling(false);
    }
  };

  // ── Log manual call ──
  const logManualCall = async () => {
    if (!logOutcome) {
      toast.error('Select a call outcome');
      return;
    }

    setLoggingCall(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${QUO_BASE}/calls/manual-log`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: leadId,
          lead_name: leadName,
          business_name: businessName,
          to_number: selectedNumber || phones[0]?.phone || '',
          notes: logNotes,
          outcome: logOutcome,
          duration_seconds: logDuration ? parseInt(logDuration) : null
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to log call');
      }

      const data = await res.json();
      toast.success('Call logged successfully');
      setCallHistory(prev => [data.call, ...prev]);
      setShowLogForm(false);
      setLogNotes('');
      setLogOutcome('');
      setLogDuration('');
    } catch (err: any) {
      console.error('[QuoDialer] Log error:', err);
      toast.error(err.message || 'Failed to log call');
    } finally {
      setLoggingCall(false);
    }
  };

  // ── Delete call record ──
  const deleteCall = async (callId: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${QUO_BASE}/calls/${callId}`, {
        method: 'DELETE',
        headers
      });
      if (res.ok) {
        setCallHistory(prev => prev.filter(c => c.id !== callId));
        toast.success('Call record deleted');
      }
    } catch (err) {
      console.error('[QuoDialer] Delete error:', err);
      toast.error('Failed to delete call record');
    }
  };

  // ── AI Summary Generation ──
  const generateAiSummary = async (callId?: string) => {
    setAiLoading(true);
    try {
      const headers = await getAuthHeaders();
      const targetCallId = callId || lastCallId || 'preview';
      const res = await fetch(`${QUO_BASE}/calls/${targetCallId}/ai-summary`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: postCallNotes,
          outcome: postCallOutcome,
          duration_seconds: postCallDuration,
          lead_name: leadName,
          business_name: businessName,
          to_number: selectedNumber || phones[0]?.phone || '',
          previous_calls: callHistory.slice(0, 5).map(c => ({
            outcome: c.outcome,
            duration_seconds: c.duration_seconds,
            notes: c.notes,
          })),
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ai_summary) {
          setAiSummary(data.ai_summary);
          toast.success('AI analysis generated');
        }
      } else {
        const err = await res.json();
        toast.error(err.error || 'AI generation failed');
      }
    } catch (err: any) {
      console.error('[QuoDialer] AI summary error:', err);
      toast.error('Failed to generate AI summary');
    } finally {
      setAiLoading(false);
    }
  };

  // ── Save Post-Call with AI data ──
  const savePostCallLog = async () => {
    if (!postCallOutcome) {
      toast.error('Select a call outcome');
      return;
    }
    setSavingPostCall(true);
    try {
      const headers = await getAuthHeaders();
      // If we have a lastCallId, update it; otherwise create a new manual log
      if (lastCallId) {
        const res = await fetch(`${QUO_BASE}/calls/${lastCallId}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notes: postCallNotes || `Browser call — ${formatDuration(postCallDuration)}`,
            outcome: postCallOutcome,
            ai_summary: aiSummary || undefined,
          })
        });
        if (res.ok) {
          const data = await res.json();
          setCallHistory(prev => prev.map(c => c.id === lastCallId ? data.call : c));
          toast.success('Call log saved with AI insights');
        }
      } else {
        // Fallback: create new manual log
        const res = await fetch(`${QUO_BASE}/calls/manual-log`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead_id: leadId,
            lead_name: leadName,
            business_name: businessName,
            to_number: selectedNumber || phones[0]?.phone || '',
            notes: postCallNotes || `Browser call — ${formatDuration(postCallDuration)}`,
            outcome: postCallOutcome,
            duration_seconds: postCallDuration,
          })
        });
        if (res.ok) {
          const data = await res.json();
          setCallHistory(prev => [data.call, ...prev]);
          toast.success('Call logged successfully');
        }
      }
      setShowPostCall(false);
      setAiSummary(null);
      setLastCallId(null);
    } catch (err: any) {
      console.error('[QuoDialer] Save post-call error:', err);
      toast.error('Failed to save call log');
    } finally {
      setSavingPostCall(false);
    }
  };

  // ── Outcome color/icon ──
  function outcomeDisplay(outcome: string | null) {
    const match = CALL_OUTCOMES.find(o => o.value === outcome);
    if (!match) return { label: outcome || 'Unknown', Icon: Phone, color: 'text-zinc-500' };

    const color = ['connected', 'interested', 'callback_scheduled'].includes(match.value)
      ? 'text-[#1ED4A7]'
      : ['no_answer', 'busy', 'wrong_number', 'not_interested'].includes(match.value)
        ? 'text-zinc-500'
        : 'text-amber-500';

    return { label: match.label, Icon: match.icon, color };
  }

  // ── Active call status from STATUS_META ──
  const statusMeta = STATUS_META[webrtcStatus];

  // ── Loading state ──
  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center text-zinc-500">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading dialer...
      </div>
    );
  }

  if (apiConfigured === false) {
    return (
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 bg-zinc-50 dark:bg-zinc-950">
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <PhoneOff className="w-4 h-4" />
          <span>Telnyx API not configured. Set TELNYX_API_KEY to enable calling.</span>
        </div>
      </div>
    );
  }

  // ── Active WebRTC call UI ──
  // Show in-call UI for any non-idle, non-error status (including 'done' briefly)
  const isInCall = !['idle', 'error'].includes(webrtcStatus);
  // Show in-call controls only when actively connected or held
  const showCallControls = webrtcStatus === 'active' || webrtcStatus === 'held';

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      {/* ── Header ── */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PhoneOutgoing className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Phone Dialer
          </span>
          {webrtcStatus !== 'idle' && statusMeta.label && (
            <span className="flex items-center gap-1.5 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.color} ${statusMeta.pulse ? 'animate-pulse' : ''}`} />
              <span className="text-zinc-500">
                {webrtcStatus === 'active' ? formatDuration(callDuration) : statusMeta.label}
              </span>
            </span>
          )}
          <span className="text-xs text-zinc-500 dark:text-zinc-500">Internal Only</span>
        </div>
        <div className="flex items-center gap-2">
          {callHistory.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
              {callHistory.length} call{callHistory.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* ── Active Call / Status Banner ── */}
      {isInCall && (
        <div className="p-4 space-y-3 bg-zinc-100 dark:bg-zinc-800/40">
          {/* Call info bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-zinc-500" />
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {formatPhoneDisplay(selectedNumber)}
              </span>
            </div>
            <span className={`text-xs font-medium ${webrtcStatus === 'active' ? 'text-[#1ED4A7]' : webrtcStatus === 'done' ? 'text-zinc-400' : 'text-zinc-500'}`}>
              {statusMeta.label}
              {webrtcStatus === 'active' && ` · ${formatDuration(callDuration)}`}
            </span>
          </div>

          {/* Error/reason banner when call ended with a cause */}
          {(webrtcStatus === 'done') && webrtcError && (
            <div className="text-xs px-3 py-2 rounded-lg border text-zinc-500 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800">
              {webrtcError}
            </div>
          )}

          {/* In-call controls — only when active or held */}
          {showCallControls && (
            <>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={toggleMute}
                  disabled={webrtcStatus !== 'active'}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg transition-colors ${
                    isMuted
                      ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                      : 'bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                  } disabled:opacity-40`}
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  <span className="text-[10px]">{isMuted ? 'Unmute' : 'Mute'}</span>
                </button>

                <button
                  onClick={toggleHold}
                  disabled={webrtcStatus !== 'active'}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg transition-colors ${
                    isOnHold
                      ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                      : 'bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                  } disabled:opacity-40`}
                  title={isOnHold ? 'Resume' : 'Hold'}
                >
                  {isOnHold ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                  <span className="text-[10px]">{isOnHold ? 'Resume' : 'Hold'}</span>
                </button>

                <button
                  onClick={() => setShowDTMF(!showDTMF)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg transition-colors ${
                    showDTMF
                      ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                      : 'bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                  }`}
                  title="Keypad"
                >
                  <Hash className="w-5 h-5" />
                  <span className="text-[10px]">Keypad</span>
                </button>

                <button
                  onClick={hangupWebRTC}
                  className="flex flex-col items-center gap-1 p-3 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
                  title="Hang up"
                >
                  <PhoneOff className="w-5 h-5" />
                  <span className="text-[10px]">End</span>
                </button>
              </div>

              {/* DTMF pad */}
              {showDTMF && (
                <div className="grid grid-cols-3 gap-1.5 max-w-[180px] mx-auto">
                  {DTMF_KEYS.map(key => (
                    <button
                      key={key}
                      onClick={() => sendDTMF(key)}
                      className="py-2.5 text-sm font-medium rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                    >
                      {key}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Cancel button during connecting/ringing/trying phases */}
          {!showCallControls && webrtcStatus !== 'done' && (
            <div className="flex justify-center">
              <button
                onClick={hangupWebRTC}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                <PhoneOff className="w-4 h-4" />
                Cancel Call
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Post-Call AI Panel ── */}
      {showPostCall && !isInCall && (
        <div className="p-4 space-y-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-zinc-500" />
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">Post-Call Log</span>
            </div>
            <div className="flex items-center gap-2">
              {postCallDuration > 0 && (
                <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDuration(postCallDuration)}
                </span>
              )}
              <button
                onClick={() => { setShowPostCall(false); setAiSummary(null); setLastCallId(null); }}
                className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                Skip
              </button>
            </div>
          </div>

          {/* Outcome selector */}
          <div className="grid grid-cols-2 gap-1.5">
            {CALL_OUTCOMES.map(o => {
              const Icon = o.icon;
              const isSelected = postCallOutcome === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => setPostCallOutcome(o.value)}
                  className={`flex items-center gap-1.5 px-2.5 py-2 text-xs rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {o.label}
                </button>
              );
            })}
          </div>

          {/* Notes */}
          <textarea
            value={postCallNotes}
            onChange={e => setPostCallNotes(e.target.value)}
            placeholder="Quick notes — what was discussed, next steps..."
            rows={2}
            className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400 resize-none placeholder:text-zinc-400"
          />

          {/* AI Summary Section */}
          {aiSummary && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
              <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-[#1ED4A7]" />
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">AI Analysis</span>
                {aiSummary.sentiment && (
                  <span className={`ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                    aiSummary.sentiment === 'positive' ? 'bg-[#1ED4A7]/10 text-[#1ED4A7]' :
                    aiSummary.sentiment === 'negative' ? 'bg-red-500/10 text-red-500' :
                    'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                  }`}>
                    {aiSummary.sentiment}
                  </span>
                )}
              </div>
              <div className="p-3 space-y-2.5">
                {/* Summary */}
                <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">{aiSummary.summary}</p>

                {/* Key metrics row */}
                <div className="flex items-center gap-3">
                  {aiSummary.interest_level && (
                    <div className="flex items-center gap-1">
                      <Target className="w-3 h-3 text-zinc-400" />
                      <span className={`text-[10px] font-medium ${
                        aiSummary.interest_level === 'high' ? 'text-[#1ED4A7]' :
                        aiSummary.interest_level === 'medium' ? 'text-amber-500' :
                        'text-zinc-400'
                      }`}>
                        {aiSummary.interest_level} interest
                      </span>
                    </div>
                  )}
                  {aiSummary.deal_probability > 0 && (
                    <div className="flex items-center gap-1">
                      <TrendingUp className="w-3 h-3 text-zinc-400" />
                      <span className="text-[10px] font-medium text-zinc-500">{aiSummary.deal_probability}% deal prob</span>
                    </div>
                  )}
                </div>

                {/* Action items */}
                {aiSummary.action_items?.length > 0 && (
                  <div>
                    <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Action Items</span>
                    <div className="mt-1 space-y-1">
                      {aiSummary.action_items.map((item, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                          <ArrowRight className="w-3 h-3 mt-0.5 shrink-0 text-zinc-400" />
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Follow-up */}
                {aiSummary.suggested_follow_up && (
                  <div className="flex items-start gap-1.5 text-xs bg-zinc-50 dark:bg-zinc-800/50 rounded-md px-2 py-1.5">
                    <Clock className="w-3 h-3 mt-0.5 shrink-0 text-zinc-400" />
                    <span className="text-zinc-600 dark:text-zinc-400">{aiSummary.suggested_follow_up}</span>
                  </div>
                )}

                {/* Objections */}
                {aiSummary.key_objections?.length > 0 && aiSummary.key_objections[0] && (
                  <div className="flex items-start gap-1.5 text-xs">
                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" />
                    <span className="text-zinc-600 dark:text-zinc-400">{aiSummary.key_objections.join(', ')}</span>
                  </div>
                )}

                {/* Tags */}
                {aiSummary.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {aiSummary.tags.map((tag, i) => (
                      <span key={i} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                        <Tag className="w-2.5 h-2.5" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => generateAiSummary()}
              disabled={aiLoading}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                aiSummary
                  ? 'border-[#1ED4A7]/30 text-[#1ED4A7] hover:bg-[#1ED4A7]/5'
                  : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {aiLoading ? 'Analyzing…' : aiSummary ? 'Re-analyze' : 'AI Analyze'}
            </button>
            <button
              onClick={savePostCallLog}
              disabled={savingPostCall || !postCallOutcome}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {savingPostCall ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Save Call Log
            </button>
          </div>
        </div>
      )}

      {/* ── Dialer Controls (when not in active call) ── */}
      {!isInCall && !showPostCall && (
        <div className="p-4 space-y-3">
          {/* Mode toggle */}
          {webrtcAvailable && (
            <div className="flex rounded-lg bg-zinc-200 dark:bg-zinc-800 p-0.5">
              <button
                onClick={() => setMode('browser')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  mode === 'browser'
                    ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Browser Call
              </button>
              <button
                onClick={() => setMode('bridge')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  mode === 'bridge'
                    ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Bridge Call
              </button>
            </div>
          )}

          {/* WebRTC error display */}
          {(webrtcStatus === 'error') && webrtcError && (
            <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {webrtcError}
            </div>
          )}
          {webrtcStatus === 'idle' && webrtcError && (
            <div className="text-xs text-zinc-500 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2">
              {webrtcError}
            </div>
          )}

          {/* Phone number selector */}
          {phones.length > 0 ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">Call To</label>
              <select
                value={selectedNumber}
                onChange={e => setSelectedNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              >
                {phones.map((p, i) => (
                  <option key={i} value={p.phone}>
                    {formatPhoneDisplay(p.phone)} ({p.type.replace('_', ' ')})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="text-sm text-zinc-500">No phone numbers on file for this lead</div>
          )}

          {/* Caller ID (from number) selector */}
          {quoNumbers.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">Call From</label>
              <select
                value={selectedFromNumber}
                onChange={e => setSelectedFromNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              >
                {quoNumbers.map(n => (
                  <option key={n.id} value={n.id}>
                    {n.formattedPhoneNumber || n.phoneNumber || n.phone_number || n.name || n.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Bridge-only: Rep phone input */}
          {mode === 'bridge' && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
                Your Phone (Bridge Destination)
              </label>
              <input
                type="tel"
                value={repPhone}
                onChange={e => setRepPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
              <p className="text-[10px] text-zinc-500 dark:text-zinc-500">
                Your phone will ring first, then connect to the lead when you answer
              </p>
            </div>
          )}

          {/* Browser mode info */}
          {mode === 'browser' && (
            <div className="flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-500">
              <Wifi className="w-3 h-3" />
              Audio will play through your browser — headset recommended
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={mode === 'browser' ? initiateWebRTCCall : initiateBridgeCall}
              disabled={calling || !selectedNumber || phones.length === 0 || webrtcStatus === 'connecting' || webrtcStatus === 'done'}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {calling ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === 'browser' ? (
                <Monitor className="w-4 h-4" />
              ) : (
                <PhoneCall className="w-4 h-4" />
              )}
              {calling
                ? (statusMeta.label || 'Connecting…')
                : 'Place Call'}
            </button>

            <button
              onClick={() => setShowLogForm(!showLogForm)}
              className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <NotebookPen className="w-4 h-4" />
              Log
            </button>
          </div>
        </div>
      )}

      {/* ── Manual Log Form ── */}
      {showLogForm && !isInCall && !showPostCall && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-3">
          <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Log a Call</div>

          <div className="grid grid-cols-2 gap-1.5">
            {CALL_OUTCOMES.map(o => {
              const Icon = o.icon;
              const isSelected = logOutcome === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => setLogOutcome(o.value)}
                  className={`flex items-center gap-1.5 px-2.5 py-2 text-xs rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {o.label}
                </button>
              );
            })}
          </div>

          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Duration (seconds)</label>
            <input
              type="number"
              value={logDuration}
              onChange={e => setLogDuration(e.target.value)}
              placeholder="e.g. 120"
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Notes</label>
            <textarea
              value={logNotes}
              onChange={e => setLogNotes(e.target.value)}
              placeholder="What was discussed..."
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400 resize-none"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={logManualCall}
              disabled={loggingCall || !logOutcome}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loggingCall ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Save Call Log
            </button>
            <button
              onClick={() => { setShowLogForm(false); setLogNotes(''); setLogOutcome(''); setLogDuration(''); }}
              className="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Call History ── */}
      {callHistory.length > 0 && (
        <div className="border-t border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <span>Call History ({callHistory.length})</span>
            {showHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showHistory && (
            <div className="max-h-64 overflow-y-auto">
              {callHistory.map(call => {
                const { label, Icon, color } = outcomeDisplay(call.outcome);
                const time = new Date(call.started_at);
                const timeStr = time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
                  ' ' + time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                const durationStr = call.duration_seconds
                  ? `${Math.floor(call.duration_seconds / 60)}:${String(call.duration_seconds % 60).padStart(2, '0')}`
                  : null;

                return (
                  <div
                    key={call.id}
                    className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Icon className={`w-3.5 h-3.5 ${color}`} />
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
                        {call.manual && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400">
                            Manual
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {durationStr && (
                          <span className="text-xs text-zinc-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {durationStr}
                          </span>
                        )}
                        <button
                          onClick={() => deleteCall(call.id)}
                          className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <span>{timeStr}</span>
                      <span>{call.to_number ? formatPhoneDisplay(call.to_number) : ''}</span>
                      <span>by {call.initiated_by}</span>
                    </div>

                    {call.notes && (
                      <div className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 rounded px-2.5 py-1.5">
                        <MessageSquare className="w-3 h-3 inline mr-1 text-zinc-400" />
                        {call.notes}
                      </div>
                    )}

                    {/* AI Summary inline */}
                    {call.ai_summary && (
                      <div className="mt-1.5 text-[11px] space-y-1">
                        <div className="flex items-center gap-1.5 text-zinc-500">
                          <Sparkles className="w-3 h-3 text-[#1ED4A7]" />
                          <span className="text-zinc-600 dark:text-zinc-400">{call.ai_summary.summary}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {call.ai_summary.interest_level && (
                            <span className={`text-[10px] font-medium ${
                              call.ai_summary.interest_level === 'high' ? 'text-[#1ED4A7]' :
                              call.ai_summary.interest_level === 'medium' ? 'text-amber-500' : 'text-zinc-400'
                            }`}>
                              {call.ai_summary.interest_level} interest
                            </span>
                          )}
                          {call.ai_summary.deal_probability > 0 && (
                            <span className="text-[10px] text-zinc-400">{call.ai_summary.deal_probability}% deal</span>
                          )}
                          {call.ai_summary.tags?.slice(0, 3).map((tag: string, ti: number) => (
                            <span key={ti} className="text-[9px] px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-400">{tag}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import * as React from 'react';
import { MapPin, Clock, Globe, Zap, X } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { WebTrackingManager } from './WebTrackingManager';
import { OutdatedScriptWarning } from './OutdatedScriptWarning';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders, authenticatedFetch } from '../lib/auth';
import { useDemoMode } from './DemoContext';

import { RealTimeMap } from './RealTimeMap';
import { AIQuickCall } from './AIQuickCall';
import { SmartPhoneButton } from './SmartPhoneButton';

// ─── Retry helper for Supabase queries with transient "Failed to fetch" ───
// Handles BOTH thrown errors AND errors returned in Supabase's { data, error } response
function _isTransientMsg(msg: string): boolean {
  return msg.includes('Failed to fetch') || msg.includes('NetworkError')
    || msg.includes('network error') || msg.includes('Load failed')
    || msg.includes('ECONNRESET') || msg.includes('fetch failed')
    || msg.includes('TypeError') || msg.includes('AbortError')
    || msg.includes('schema cache') || msg.includes('PGRST002')
    || msg.includes('Database error') || msg.includes('Unexpected failure')
    || msg.includes('57014') || msg.includes('statement timeout') || msg.includes('canceling statement');
}

async function retryQuery<T extends { data: any; error: any }>(
  fn: () => PromiseLike<T>, label: string, maxAttempts = 3
): Promise<T> {
  let lastResult: T | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await fn();
      // Check if Supabase returned a transient error in the error field
      if (result.error) {
        const msg = result.error?.message ?? String(result.error);
        if (_isTransientMsg(msg) && attempt < maxAttempts - 1) {
          lastResult = result;
          const delay = 800 * Math.pow(2, attempt);
          console.warn(`[Engagement] ${label} transient error (attempt ${attempt + 1}/${maxAttempts}), retrying in ${delay}ms: ${msg}`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
      return result;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (_isTransientMsg(msg) && attempt < maxAttempts - 1) {
        const delay = 800 * Math.pow(2, attempt);
        console.warn(`[Engagement] ${label} thrown error (attempt ${attempt + 1}/${maxAttempts}), retrying in ${delay}ms: ${msg}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  return lastResult as T;
}

interface EngagementIntelligenceProps {
  brandFilter: string;
}

interface LiveVisit {
  id: string;
  timestamp: string;
  url: string;
  title: string;
  city?: string;
  country?: string;
  region?: string;
  lead?: {
    business_name: string;
    brand: string;
    city?: string;
    state?: string;
    country?: string;
    phone?: string;
    contact_name?: string;
    id?: string;
    isp?: string;
  };
  isp?: string;
}

export function EngagementIntelligence({ brandFilter }: EngagementIntelligenceProps) {
  const isDemoMode = useDemoMode();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [emailData, setEmailData] = useState<any[]>([]);
  const [geoData, setGeoData] = useState<any[]>([]);
  const [view, setView] = useState<'temporal' | 'geographic' | 'live' | 'map'>('temporal');
  const [showSetup, setShowSetup] = useState(false);
  const [liveVisitors, setLiveVisitors] = useState<any[]>([]);
  const firstLoadRef = React.useRef(true);
  const seenIdsRef = React.useRef<Set<string>>(new Set());

  useEffect(() => {
    if (isDemoMode) {
      loadDemoData();
      return;
    }
    
    loadData();
    // Refresh visits every 30 seconds (reduced from 15s to prevent CPU exhaustion)
    const interval = setInterval(loadRecentVisits, 30000);
    return () => clearInterval(interval);
  }, [brandFilter, isDemoMode]);

  async function loadRecentVisits() {
    try {
      if (!projectId) {
        console.error('Project ID missing');
        return;
      }

      // Check online status to prevent unnecessary errors
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;

      // Check for active session before polling to avoid "No active session to refresh" errors
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/live-traffic`
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data.visits) {
           const filtered = data.visits.filter((v: any) => {
             if (brandFilter === 'all') return true;
             return v.lead?.brand?.toLowerCase() === brandFilter;
           });
           
           // Filter for visits in the last 15 minutes ONLY
           const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
           const recentVisits = filtered.filter((v: any) => new Date(v.timestamp).getTime() > fifteenMinutesAgo);
           
           // Determine new visitors using Ref to avoid stale closure issues
           const newVisits = recentVisits.filter((v: any) => !seenIdsRef.current.has(v.id));
           
           // Update seen IDs immediately
           const currentIds = new Set(recentVisits.map((v: any) => v.id));
           seenIdsRef.current = currentIds;
           
           if (newVisits.length > 0 && !firstLoadRef.current) {
              // Notify for each new visitor (limit to 3 to prevent spam)
              newVisits.slice(0, 3).forEach((visit: any) => {
                 toast.custom((toastItem) => (
                    <div className="bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-lg shadow-xl p-4 flex items-start gap-3 w-full max-w-sm pointer-events-auto ring-1 ring-black/5">
                      <div className="relative flex-shrink-0">
                        <div className="w-10 h-10 rounded-full bg-[#1ED4A7]/10 dark:bg-[#1ED4A7]/10 flex items-center justify-center text-[#1ED4A7] dark:text-[#1ED4A7] font-bold text-sm">
                          {(visit.lead?.contact_name || visit.lead?.business_name)?.charAt(0) || '?'}
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#1ED4A7] border-2 border-white dark:border-black rounded-full animate-pulse" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                           <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate pr-2">
                              {(() => {
                                const name = visit.lead?.contact_name && !['Unknown', 'Visitor', 'Anonymous Visitor'].includes(visit.lead.contact_name)
                                  ? visit.lead.contact_name
                                  : visit.lead?.business_name && visit.lead.business_name !== 'Anonymous Visitor'
                                  ? visit.lead.business_name
                                  : null;
                                return name || visit.lead?.isp || visit.isp || (visit.city ? t('dashboard.visitorFrom', { city: visit.city }) : t('dashboard.anonymousVisitor'));
                              })()}
                           </h3>
                           <span className="text-xs text-gray-400 flex-shrink-0">{t('dashboard.justNow')}</span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate mb-1.5" title={visit.title}>
                           {visit.title || t('dashboard.viewingAPage')}
                        </p>
                        <div className="flex items-center gap-2">
                           {(visit.city || visit.country || visit.region) && (
                              <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                                 <MapPin className="w-3 h-3" />
                                 {[
                                    visit.city, 
                                    visit.region,
                                    !visit.city && !visit.region ? visit.country : null
                                 ].filter(Boolean).join(', ')}
                              </span>
                           )}
                        </div>
                      </div>
                      <button 
                        onClick={() => toast.dismiss(toastItem)} 
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1"
                      >
                         <X className="w-4 h-4" />
                      </button>
                    </div>
                 ), { duration: 5000 });
              });
           }
           
           setLiveVisitors(recentVisits);
           firstLoadRef.current = false;
        }
      }
    } catch (error) {
      // Ignore network errors during polling (common when user closes laptop or switches networks)
      if (error instanceof TypeError && error.message === 'Failed to fetch') return;
      if (error instanceof Error && error.message.includes('Network error')) return;
      
      // Ignore session expired errors (handled by auth listeners)
      if (error instanceof Error && (
        error.message.includes('Session expired') || 
        error.message.includes('Not authenticated')
      )) {
        return;
      }
      
      // Use warn for polling errors to avoid console noise
      console.warn('Error polling visits:', error);
    }
  }

  function loadDemoData() {
    console.log('[DEMO] Loading demo engagement intelligence data');
    
    // Generate demo email engagement data across multiple days (more realistic)
    const demoEmailData = [];
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    // Spread engagement across 14 days with varying activity
    for (let dayOffset = 13; dayOffset >= 0; dayOffset--) {
      const baseDate = now - (dayOffset * dayMs);
      // More activity on recent days
      const eventsPerDay = dayOffset < 3 ? 15 : dayOffset < 7 ? 10 : 5;
      
      for (let i = 0; i < eventsPerDay; i++) {
        // Random hour between 8 AM and 6 PM (business hours)
        const hour = 8 + Math.floor(Math.random() * 10);
        const minute = Math.floor(Math.random() * 60);
        const date = new Date(baseDate);
        date.setHours(hour, minute, 0, 0);
        
        const hasClick = Math.random() > 0.7; // 30% click rate
        demoEmailData.push({
          opened_at: date.toISOString(),
          clicked_at: hasClick ? date.toISOString() : null,
          hour_of_day: hour,
        });
      }
    }
    
    // Demo geographic data - realistic US companies
    const demoGeoData = [
      { business_name: 'Stripe', state: 'CA', city: 'San Francisco', country: 'United States' },
      { business_name: 'Notion', state: 'CA', city: 'San Francisco', country: 'United States' },
      { business_name: 'Linear', state: 'CA', city: 'San Francisco', country: 'United States' },
      { business_name: 'Datadog', state: 'NY', city: 'New York', country: 'United States' },
      { business_name: 'Shopify', state: 'ON', city: 'Ottawa', country: 'Canada' },
      { business_name: 'Vercel', state: 'CA', city: 'San Francisco', country: 'United States' },
    ];
    
    // Demo live visitors - just a few recent ones (more realistic)
    const demoLiveVisitors = [
      {
        id: 'demo-visit-1',
        timestamp: new Date(now - 3 * 60000).toISOString(), // 3 minutes ago
        url: 'https://contndr.com/pricing',
        title: 'Pricing - Contndr',
        city: 'San Francisco',
        region: 'CA',
        country: 'United States',
        latitude: 37.7749,
        longitude: -122.4194,
        lead: { business_name: 'Stripe', brand: 'contndr', city: 'San Francisco', state: 'CA' },
      },
      {
        id: 'demo-visit-2',
        timestamp: new Date(now - 8 * 60000).toISOString(), // 8 minutes ago
        url: 'https://contndr.com/features',
        title: 'Features - Contndr',
        city: 'New York',
        region: 'NY',
        country: 'United States',
        latitude: 40.7128,
        longitude: -74.0060,
        lead: { business_name: 'Datadog', brand: 'contndr', city: 'New York', state: 'NY' },
      },
      {
        id: 'demo-visit-3',
        timestamp: new Date(now - 12 * 60000).toISOString(), // 12 minutes ago
        url: 'https://contndr.com/',
        title: 'Contndr - Cold Outreach Platform',
        city: 'Seattle',
        region: 'WA',
        country: 'United States',
        latitude: 47.6062,
        longitude: -122.3321,
      },
    ];
    
    setEmailData(demoEmailData);
    setGeoData(demoGeoData);
    setLiveVisitors(demoLiveVisitors);
    setLoading(false);
  }

  async function loadData() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const userId = session.user.id;

      // 0. Get relevant campaign IDs for the brand filter
      let campaignIds: string[] = [];
      if (brandFilter !== 'all') {
         // Use ilike for brand to be case-insensitive, and keep product matching
         const { data: campaigns } = await retryQuery(
           () => supabase
            .from('campaigns')
            .select('id')
            .eq('user_id', userId)
            .or(`brand.ilike.${brandFilter},product.ilike.${brandFilter}%`),
           'campaigns'
         );
         
         if (campaigns) {
            campaignIds = campaigns.map(c => c.id);
         }
         
         // If brand is specific but no campaigns found, return empty data immediately
         if (campaignIds.length === 0) {
             setEmailData([]);
             setGeoData([]);
             setLoading(false);
             return;
         }
      }

      // 1. Load Email Engagement Data (Opens/Clicks)
      // Query directly on emails.user_id — avoids the !inner join that caused 57014 timeouts
      // on large datasets (108K+ leads). No join needed: emails table has user_id directly.
      let queryBuilder = supabase
        .from('emails')
        .select('opened_at, clicked_at, lead_id, campaign_id')
        .eq('user_id', userId)
        .not('opened_at', 'is', null)
        .order('opened_at', { ascending: false })
        .limit(500); // Reduced from 1000 — 500 rows is enough for heatmap accuracy

      // Apply brand filtering via campaign_id if specific brand selected
      if (brandFilter !== 'all') {
         if (campaignIds.length > 100) {
             queryBuilder = queryBuilder.in('campaign_id', campaignIds.slice(-100));
         } else {
             queryBuilder = queryBuilder.in('campaign_id', campaignIds);
         }
      }

      // Execute email query with retry
      const { data: emails, error: emailError } = await retryQuery(
        () => queryBuilder,
        'emails'
      );
      
      if (emailError) {
          console.error('[Engagement] Error loading emails:', emailError);
      }
      
      if (emails) {
          setEmailData(emails);
      } else {
          setEmailData([]);
      }

      // 2. Load Location Data (Leads) separately for efficiency
      // Select only columns that exist in the schema (no 'address' column)
      const { data: leads, error: leadError } = await retryQuery(
        () => supabase
          .from('leads')
          .select('id, state, city')
          .eq('user_id', userId)
          .limit(500), // Reduced from 2000 — geographic heatmap only needs a sample
        'leads'
      );

      if (leadError) {
          console.error('[Engagement] Error loading leads:', leadError);
      }

      if (!leads || leads.length === 0) {
         // Only return early if NOT the legacy mock user
         if (session.user.email !== 'or@roadr.com') {
             // If no leads, we can't show location data, but we might show temporal data if emails exist
             // (though emails require leads usually).
             if (!emails || emails.length === 0) {
                 setEmailData([]);
                 setGeoData([]);
                 setLoading(false);
                 return;
             }
         }
      }
      
      if (leads) {
          setGeoData(leads);
      } else {
          setGeoData([]);
      }
      
      // Legacy mock data logic for or@roadr.com
      if (session.user.email === 'or@roadr.com' && brandFilter !== 'contndr') {
         // ... (keep existing logic if needed, or rely on real data if available)
         // Assuming legacy logic is fine as is, but we need to merge with fetched data
         // The original code merged mock emails into finalEmails.
         
         const mockEmails = [];
         const now = new Date();
         const targetLeadIds = leads && leads.length > 0 ? leads.map(l => l.id) : ['legacy_mock'];
         
         for (let d = 0; d < 7; d++) {
             const date = new Date(now);
             date.setDate(date.getDate() - d);
             const day = date.getDay();
             const isWeekend = day === 0 || day === 6;
             const count = isWeekend ? Math.floor(Math.random() * 5) + 2 : Math.floor(Math.random() * 15) + 20;
             
             for (let i = 0; i < count; i++) {
                 let hour;
                 const r = Math.random();
                 if (isWeekend) {
                    hour = Math.floor(Math.random() * 12) + 10; 
                 } else {
                    if (r < 0.3) hour = Math.floor(Math.random() * 2) + 9;
                    else if (r < 0.6) hour = Math.floor(Math.random() * 3) + 14;
                    else hour = Math.floor(Math.random() * 12) + 8;
                 }
                 const eventDate = new Date(date);
                 eventDate.setHours(hour, Math.floor(Math.random() * 60));
                 
                 mockEmails.push({
                     opened_at: eventDate.toISOString(),
                     clicked_at: null,
                     lead_id: targetLeadIds[Math.floor(Math.random() * targetLeadIds.length)]
                 });
             }
         }
         
         // Merge mock emails
         setEmailData(prev => [...prev, ...mockEmails]);
      }
      
      // 3. Load recent web visits (this handles auth internally via headers usually, or we pass token)
      loadRecentVisits();

      if (leads) setGeoData(leads);

    } catch (error) {
      console.error('Error loading engagement data:', error);
    } finally {
      setLoading(false);
    }
  }

  // --- Temporal Heatmap Logic ---
  const temporalHeatmap = useMemo(() => {
    // Initialize 7x24 grid
    const grid = Array(7).fill(0).map(() => Array(24).fill(0));
    let max = 0;

    emailData.forEach(email => {
      if (!email.opened_at) return;
      const date = new Date(email.opened_at);
      const day = date.getDay(); // 0 = Sunday
      const hour = date.getHours(); // 0-23
      
      // Adjust day so Monday is 0 (0-6)
      const adjustedDay = day === 0 ? 6 : day - 1;
      
      grid[adjustedDay][hour]++;
      if (grid[adjustedDay][hour] > max) max = grid[adjustedDay][hour];
    });

    return { grid, max };
  }, [emailData]);

  const days = [
    t('common.weekdaysShort.mon'), t('common.weekdaysShort.tue'), t('common.weekdaysShort.wed'),
    t('common.weekdaysShort.thu'), t('common.weekdaysShort.fri'), t('common.weekdaysShort.sat'),
    t('common.weekdaysShort.sun')
  ];
  const hours = [
    '12am', '1am', '2am', '3am', '4am', '5am', '6am', '7am', '8am', '9am', '10am', '11am',
    '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm'
  ];

  const US_STATES = new Set([
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
  ]);

  const FULL_STATE_TO_ABBREV: Record<string, string> = {
    'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR', 'CALIFORNIA': 'CA',
    'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE', 'FLORIDA': 'FL', 'GEORGIA': 'GA',
    'HAWAII': 'HI', 'IDAHO': 'ID', 'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA',
    'KANSAS': 'KS', 'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME', 'MARYLAND': 'MD',
    'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS', 'MISSOURI': 'MO',
    'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
    'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH',
    'OKLAHOMA': 'OK', 'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
    'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT', 'VERMONT': 'VT',
    'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'WEST VIRGINIA': 'WV', 'WISCONSIN': 'WI', 'WYOMING': 'WY',
    'DISTRICT OF COLUMBIA': 'DC'
  };
  
  const COMMON_COUNTRIES = [
    'United States', 'USA', 'United Kingdom', 'UK', 'Canada', 'Australia', 'Germany', 'France', 
    'Mexico', 'Egypt', 'Netherlands', 'Belgium', 'Austria', 'Italy', 'Spain', 'Brazil', 'India', 
    'China', 'Japan', 'South Korea', 'Russia', 'South Africa', 'Sweden', 'Norway', 'Denmark',
    'Switzerland', 'Ireland', 'Singapore', 'New Zealand'
  ];

  // --- Geographic Logic ---
  const geographicStats = useMemo(() => {
    const stateCounts: Record<string, number> = {};
    const engagedLeadIds = new Set(emailData.map(e => e.lead_id).filter(Boolean));

    geoData.forEach(lead => {
      // IMPORTANT: Only process leads that have actually engaged (opened/clicked)
      if (!engagedLeadIds.has(lead.id)) return;

      let state = lead.state;

      if (!state && lead.address) {
         const addr = lead.address.trim();
         
         // Strategy 0: Check for Non-US Country
         let countryMatch = null;
         for (const c of COMMON_COUNTRIES) {
             if (addr.includes(c)) {
                 countryMatch = c;
                 break;
             }
         }
         
         if (countryMatch && countryMatch !== 'United States' && countryMatch !== 'USA') {
             state = countryMatch;
         } else {
             // Strategy 1: Look for State Code at the END of string (possibly followed by Zip)
             // Matches: "City, FL" or "City, FL 33101" or "FL"
             const endRegex = /\b([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?\s*$/i;
             const match = addr.match(endRegex);
             
             if (match) {
                 const candidate = match[1].toUpperCase();
                 if (US_STATES.has(candidate)) {
                     state = candidate;
                 }
             }
             
             // Strategy 2: Look for full state name
             if (!state) {
                 const upperAddr = addr.toUpperCase();
                 for (const [fullName, code] of Object.entries(FULL_STATE_TO_ABBREV)) {
                     if (upperAddr.includes(fullName)) {
                         state = code;
                         break;
                     }
                 }
             }
         }
      }

      if (!state) return;
      
      const normalizedState = state.trim(); // Don't uppercase countries like "France"
      const normalizedStateUpper = normalizedState.toUpperCase();
      
      // Allow if it's a US State OR a known Country
      const isUSState = US_STATES.has(normalizedStateUpper);
      const isCountry = COMMON_COUNTRIES.some(c => c.toUpperCase() === normalizedStateUpper);
      
      if (isUSState || isCountry) {
          // Keep consistent casing: Upper for US States, Title Case for Countries
          const key = isUSState ? normalizedStateUpper : normalizedState;
          stateCounts[key] = (stateCounts[key] || 0) + 1;
      }
    });

    return Object.entries(stateCounts)
      .map(([state, count]) => ({ name: state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [geoData, emailData]);

  // Function to get color intensity (Teal scale)
  const getIntensityColor = (value: number, max: number) => {
    if (value === 0) return 'bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/5';
    const intensity = value / max;
    if (intensity < 0.2) return 'bg-[#1ED4A7]/10 border border-[#1ED4A7]/5';
    if (intensity < 0.4) return 'bg-[#1ED4A7]/30 border border-[#1ED4A7]/10';
    if (intensity < 0.6) return 'bg-[#1ED4A7]/50 border border-[#1ED4A7]/20';
    if (intensity < 0.8) return 'bg-[#1ED4A7]/70 border border-[#1ED4A7]/30';
    return 'bg-[#1ED4A7] shadow-[0_0_10px_rgba(30,212,167,0.4)] border border-[#1ED4A7]';
  };

  if (loading) return <div className="h-64 bg-white/5 rounded-xl animate-pulse border border-white/10" />;

  return (
    <div className="glass-card p-4 sm:p-5 relative h-full flex flex-col overflow-hidden">
      <OutdatedScriptWarning />
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 sm:mb-4 gap-3 flex-shrink-0">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
            {t('engagement.title', 'Engagement')}
            {view === 'live' && (
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1ED4A7]/70 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1ED4A7]"></span>
              </span>
            )}
          </h3>
          {view === 'live' ? (
            <div className="flex items-center gap-3 text-sm">
               <span className={`font-medium ${liveVisitors.length > 0 ? 'text-[#1ED4A7] drop-shadow-[0_0_5px_rgba(30,212,167,0.5)]' : 'text-gray-500'}`}>
                 {liveVisitors.length} {liveVisitors.length === 1 ? t('dashboard.userOnline') : t('dashboard.usersOnline')}
               </span>
               <span className="text-gray-600">|</span>
               <button 
                 onClick={() => setShowSetup(true)}
                 className="text-gray-400 hover:text-[#1ED4A7] flex items-center gap-1 transition-colors"
               >
                 <Globe className="w-3 h-3" />
                 {t('dashboard.setup')}
               </button>
            </div>
          ) : (
            <p className="text-[11px] text-gray-400">{t('dashboard.whenWhereActive')}</p>
          )}
        </div>
        
        <div className="flex bg-gray-100 dark:bg-black/40 border border-gray-200 dark:border-white/10 rounded-xl p-1 self-start sm:self-auto backdrop-blur-md">
          <button
            onClick={() => setView('temporal')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-2 ${
              view === 'temporal' 
                ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm border border-gray-200 dark:border-white/5' 
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/5'
            }`}
          >
            <Clock className="w-3 h-3" /> {t('common.time')}
          </button>
          <button
            onClick={() => setView('geographic')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-2 ${
              view === 'geographic' 
                ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm border border-gray-200 dark:border-white/5' 
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/5'
            }`}
          >
            <MapPin className="w-3 h-3" /> {t('dashboard.location')}
          </button>
          <button
            onClick={() => setView('map')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-2 ${
              view === 'map' 
                ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm border border-gray-200 dark:border-white/5' 
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/5'
            }`}
          >
            <Globe className="w-3 h-3" /> {t('dashboard.map')}
          </button>
          <button
            onClick={() => setView('live')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-2 ${
              view === 'live' 
                ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm border border-gray-200 dark:border-white/5' 
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/5'
            }`}
          >
            <Zap className="w-3 h-3" /> {t('dashboard.live')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {view === 'temporal' && (
          <div className="w-full h-full overflow-y-auto pr-2 custom-scrollbar">
             <div className="w-full">
               {/* Header Hours */}
               <div className="flex mb-2">
                  <div className="w-8 md:w-16 flex-shrink-0" />
                  {hours.map((h, i) => (
                     <div key={i} className="flex-1 text-[8px] md:text-xs text-gray-500 text-center font-medium">
                        <span className="hidden md:inline">{i % 2 === 0 ? h.replace(':00', '') : ''}</span>
                        <span className="md:hidden">{i % 4 === 0 ? h.replace(':00', '') : ''}</span>
                     </div>
                  ))}
               </div>

               {/* Grid */}
               <div className="space-y-1">
                 {temporalHeatmap.grid.map((row, dayIndex) => (
                   <div key={dayIndex} className="flex items-center gap-1">
                     <div className="w-8 md:w-16 text-xs md:text-xs font-medium text-gray-400 text-right pr-2 md:pr-3 flex-shrink-0 truncate">
                       <span className="hidden md:inline">{days[dayIndex]}</span>
                       <span className="md:hidden">{days[dayIndex].charAt(0)}</span>
                     </div>
                     {row.map((val, hourIndex) => (
                       <div
                         key={hourIndex}
                         className={`flex-1 h-6 md:h-8 rounded-sm transition-colors relative group ${getIntensityColor(val, temporalHeatmap.max)}`}
                       >
                         <div className={`opacity-0 group-hover:opacity-100 absolute left-1/2 -translate-x-1/2 px-3 py-1.5 bg-black/90 backdrop-blur-xl border border-white/10 text-white text-xs rounded-lg pointer-events-none whitespace-nowrap z-20 shadow-xl ${dayIndex === 0 ? 'top-full mt-2' : 'bottom-full mb-2'}`}>
                            <div className="font-bold text-[#1ED4A7] mb-0.5">{t('common.opensCount', { count: val })}</div>
                            <div className="text-gray-400 text-xs">{t('common.dayAtTime', { day: days[dayIndex], time: hours[hourIndex] })}</div>
                         </div>
                       </div>
                     ))}
                   </div>
                 ))}
               </div>
               
               <div className="mt-4 flex items-center justify-end gap-2 text-xs text-gray-500 font-medium">
                  <span>{t('dashboard.heatmapLess')}</span>
                  <div className="flex gap-1">
                     <div className="w-3 h-3 bg-white/5 border border-white/5 rounded-sm" />
                     <div className="w-3 h-3 bg-[#1ED4A7]/30 border border-[#1ED4A7]/10 rounded-sm" />
                     <div className="w-3 h-3 bg-[#1ED4A7]/70 border border-[#1ED4A7]/30 rounded-sm" />
                     <div className="w-3 h-3 bg-[#1ED4A7] border border-[#1ED4A7] rounded-sm shadow-[0_0_5px_rgba(30,212,167,0.4)]" />
                  </div>
                  <span>{t('dashboard.heatmapMore')}</span>
               </div>
            </div>
          </div>
        )}

        {view === 'geographic' && (
          <div className="h-full min-h-[300px] relative">
            {geographicStats.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={100} debounce={200}>
                <BarChart 
                  data={geographicStats}  
                  layout="vertical" 
                  margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                >
                  <XAxis type="number" hide />
                  <YAxis 
                     dataKey="name" 
                     type="category" 
                     width={80}
                     tick={{ fontSize: 11, fill: '#A1A1AA', fontWeight: 500 }}
                     interval={0}
                     axisLine={false}
                     tickLine={false}
                  />
                  <Tooltip 
                     cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                     contentStyle={{ backgroundColor: 'rgba(5,5,5,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
                  />
                  <Bar dataKey="count" fill="#1ED4A7" radius={[0, 4, 4, 0]} barSize={20}>
                    {geographicStats.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index < 3 ? '#1ED4A7' : 'rgba(30, 212, 167, 0.3)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                 <MapPin className="w-8 h-8 mb-2 opacity-20" />
                 <p>{t('dashboard.noLocationDataYet')}</p>
              </div>
            )}
          </div>
        )}

        {view === 'map' && (
          <div className="h-full min-h-[300px] relative rounded-xl overflow-hidden border border-gray-200 dark:border-white/5">
             <RealTimeMap 
               visits={liveVisitors} 
               className="w-full h-full absolute inset-0"
             />
          </div>
        )}

        {view === 'live' && (
          <div className="w-full max-h-[240px] overflow-y-auto pr-2 custom-scrollbar">
            {liveVisitors.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <Globe className="w-12 h-12 mb-3 text-gray-700" />
                <p className="font-medium text-gray-400">{t('dashboard.noLiveVisitors')}</p>
                <p className="text-xs text-gray-600 mt-1">{t('dashboard.waitingForActivity')}</p>
              </div>
            ) : (
              <div className="space-y-0">
                {liveVisitors.map((visit) => (
                  <div key={visit.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5 last:border-0 group">
                    <div className="relative flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 flex items-center justify-center text-[#1ED4A7] font-bold text-xs shadow-[0_0_10px_rgba(30,212,167,0.1)]">
                        {(visit.lead?.contact_name || visit.lead?.business_name)?.charAt(0) || '?'}
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#1ED4A7] border-2 border-black rounded-full animate-pulse shadow-[0_0_5px_#1ED4A7]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-gray-900 dark:text-white truncate group-hover:text-[#1ED4A7] transition-colors">
                          {(() => {
                            const name = visit.lead?.contact_name && !['Unknown', 'Visitor', 'Anonymous Visitor'].includes(visit.lead.contact_name)
                              ? visit.lead.contact_name
                              : visit.lead?.business_name && visit.lead.business_name !== 'Anonymous Visitor'
                              ? visit.lead.business_name
                              : null;
                            return name || visit.lead?.isp || visit.isp || (visit.city ? t('dashboard.visitorFrom', { city: visit.city }) : t('dashboard.anonymousVisitor'));
                          })()}
                        </p>
                        <span className="text-xs text-gray-500 flex-shrink-0 font-medium bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded">
                          {new Date(visit.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      {/* Location Data */}
                      {(visit.city || visit.country || visit.region || visit.lead?.city || visit.lead?.state) && (
                         <div className="flex items-center gap-1 text-xs text-gray-400 mb-0.5">
                            <MapPin className="w-3 h-3 text-gray-600" />
                            <span className="truncate">
                               {[
                                  visit.city || visit.lead?.city,
                                  visit.region || visit.lead?.state || visit.country || visit.lead?.country
                               ].filter(Boolean).join(', ')}
                            </span>
                         </div>
                      )}

                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {visit.title || visit.url || t('dashboard.viewingAPage')}
                      </p>

                      {/* AI Call button for visitors with phone */}
                      {visit.lead?.phone && (
                        <div className="mt-1.5">
                          <SmartPhoneButton
                            phone={visit.lead.phone}
                            leadName={visit.lead?.contact_name}
                            businessName={visit.lead?.business_name}
                            leadId={visit.lead?.id}
                            showNumber
                            displayNumber={visit.lead.phone}
                            iconClassName="w-3.5 h-3.5"
                            numberClassName="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono"
                            brand={visit.lead?.brand || 'contndr'}
                          />
                        </div>
                      )}

                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Setup Modal */}
      {showSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-fade-in">
          <div 
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={() => setShowSetup(false)}
          />
          <div className="relative w-full max-w-2xl bg-white dark:bg-black rounded-2xl shadow-2xl animate-scale-in border border-gray-200 dark:border-gray-800 max-h-[85dvh] flex flex-col">
            <div className="flex items-center justify-end p-4 pb-0 flex-shrink-0">
              <button 
                onClick={() => setShowSetup(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:focus-visible:ring-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 pt-2 overflow-y-auto">
              <WebTrackingManager />
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <button
                  onClick={() => {
                    setShowSetup(false);
                    window.dispatchEvent(new CustomEvent('navigate-to', { detail: 'settings' }));
                    setTimeout(() => window.dispatchEvent(new CustomEvent('switch-settings-tab', { detail: 'tracking' })), 100);
                  }}
                  className="w-full text-center text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors py-2"
                >
                  {t('dashboard.openTrackingSettings')} &rarr;
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
import { useEffect, useRef } from 'react';
import { projectId, publicAnonKey } from '../utils/supabase/info';

export function ContndrTracking() {
  const originalPushState = useRef<typeof history.pushState | null>(null);

  useEffect(() => {
    // 1. Check for campaign attribution in URL parameters (from Contndr emails)
    const urlParams = new URLSearchParams(window.location.search);
    const lid = urlParams.get('lid') || urlParams.get('ct_lead') || urlParams.get('lead_id');
    const campaignId = urlParams.get('ct_campaign') || urlParams.get('campaign_id');
    const emailId = urlParams.get('ct_email') || urlParams.get('email_id');
    
    // 2. Persist attribution if present so SPA route changes keep the session tied to the campaign.
    if (lid) localStorage.setItem('contndr_lid', lid);
    if (campaignId) localStorage.setItem('contndr_campaign_id', campaignId);
    if (emailId) localStorage.setItem('contndr_email_id', emailId);
    
    // 3. Get attribution from storage (if any)
    const storedLid = localStorage.getItem('contndr_lid');
    const storedCampaignId = localStorage.getItem('contndr_campaign_id');
    const storedEmailId = localStorage.getItem('contndr_email_id');
    
    // 3b. Check for affiliate ref from multiple sources:
    //   - URL param ?ref=slug (direct affiliate link in email signatures)
    //   - sessionStorage (set by AffiliateRedirect when visitor clicked /r/:slug)
    const urlRef = urlParams.get('ref');
    if (urlRef) {
      try { sessionStorage.setItem('contndr_affiliate_ref', urlRef); } catch (e) {}
    }
    let affiliateRef: string | null = null;
    try {
      affiliateRef = sessionStorage.getItem('contndr_affiliate_ref');
    } catch (e) {
      // sessionStorage may be blocked in some browsers
    }
    
    const postEvent = async (eventType: 'page_view' | 'click', extra: Record<string, unknown> = {}) => {
      // Optional: Try to get precise location if permission is already granted
      let coords: Record<string, number> = {};
      if (eventType === 'page_view') try {
        if ("geolocation" in navigator && "permissions" in navigator) {
          // @ts-ignore
          const perm = await navigator.permissions.query({ name: 'geolocation' });
          if (perm.state === 'granted') {
             const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
               navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 1000, maximumAge: 300000 });
             });
             if (pos && pos.coords) {
               coords = {
                 latitude: pos.coords.latitude,
                 longitude: pos.coords.longitude
               };
             }
          }
        }
      } catch (e) {
        // Ignore geolocation errors - fallback to IP
      }

      try {
        const response = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/track/web`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({
            account_id: '6001f3ec-1907-4d28-b732-a0a60ae23002', // Identifies the Contndr account
            brand: 'contndr', // Explicitly set the brand
            lead_id: storedLid, // Can be null for anonymous
            campaign_id: storedCampaignId,
            email_id: storedEmailId,
            event_type: eventType,
            affiliate_ref: affiliateRef, // Which rep's affiliate link brought this visitor (if any)
            url: window.location.href,
            title: document.title,
            timestamp: Date.now(),
            ...extra,
            ...coords
          })
        });
        
        const data = await response.json();
        
        if (!data.success) {
          console.warn('Contndr Tracking Script Outdated!');
          console.warn('Action Required:', data.message);
          if (data.instructions) {
            // @ts-ignore
            data.instructions.forEach((step: string) => console.warn('  ', step));
          }
        }
      } catch (err) {
        // Silently handle network errors during tracking
      }
    };

    // 4. Send "Page View" heartbeat
    const track = () => postEvent('page_view');
    
    // Track immediately on mount
    track();
    
    // Track on history changes (SPA support)
    originalPushState.current = history.pushState;
    history.pushState = function(...args) {
      originalPushState.current?.apply(history, args);
      track();
    };
    
    const handlePopState = () => track();
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const element = target?.closest?.('a,button,[role="button"]') as HTMLElement | null;
      if (!element) return;
      const anchor = element instanceof HTMLAnchorElement ? element : element.closest('a');
      postEvent('click', {
        element_text: (element.innerText || element.getAttribute('aria-label') || '').slice(0, 160),
        element_href: anchor?.href || null,
      });
    };

    window.addEventListener('popstate', handlePopState);
    document.addEventListener('click', handleClick, { capture: true });

    return () => {
      // Restore original pushState on unmount
      if (originalPushState.current) {
        history.pushState = originalPushState.current;
      }
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('click', handleClick, { capture: true });
    };
  }, []);

  return null;
}

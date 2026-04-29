import { useEffect, useRef } from 'react';
import { projectId, publicAnonKey } from '../utils/supabase/info';

export function ContndrTracking() {
  const originalPushState = useRef<typeof history.pushState | null>(null);

  useEffect(() => {
    // 1. Check for Lead ID in URL parameters (from Contndr emails)
    const urlParams = new URLSearchParams(window.location.search);
    const lid = urlParams.get('lid');
    
    // 2. Persist Lead ID if present
    if (lid) {
      localStorage.setItem('contndr_lid', lid);
    }
    
    // 3. Get Lead ID from storage (if any)
    const storedLid = localStorage.getItem('contndr_lid');
    
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
    
    // 4. Send "Page View" Heartbeat
    const track = async () => {
      // Optional: Try to get precise location if permission is already granted
      let coords: Record<string, number> = {};
      try {
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
            affiliate_ref: affiliateRef, // Which rep's affiliate link brought this visitor (if any)
            url: window.location.href,
            title: document.title,
            timestamp: Date.now(),
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
    
    // Track immediately on mount
    track();
    
    // Track on history changes (SPA support)
    originalPushState.current = history.pushState;
    history.pushState = function(...args) {
      originalPushState.current?.apply(history, args);
      track();
    };
    
    const handlePopState = () => track();
    window.addEventListener('popstate', handlePopState);

    return () => {
      // Restore original pushState on unmount
      if (originalPushState.current) {
        history.pushState = originalPushState.current;
      }
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  return null;
}

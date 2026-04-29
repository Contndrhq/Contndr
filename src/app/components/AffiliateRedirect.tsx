import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { LoadingSpinner } from './LoadingSpinner';

/**
 * Affiliate redirect handler for /r/:slug
 * Stores the ref in sessionStorage so it persists across pages,
 * logs the click to Supabase KV, then redirects to the landing page.
 * When the visitor eventually signs up (from any page, even days later
 * in the same browser session), AuthScreen picks up the ref automatically.
 */
export function AffiliateRedirect() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current || !slug) return;
    processed.current = true;

    // 1. Persist the affiliate ref in sessionStorage immediately
    //    This survives page navigations within the same tab/session
    try {
      sessionStorage.setItem('contndr_affiliate_ref', slug);
      console.log('[AFFILIATE] Stored ref in sessionStorage:', slug);
    } catch (err) {
      console.warn('[AFFILIATE] Could not write to sessionStorage:', err);
    }

    // 2. Log affiliate click to backend (non-blocking)
    fetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/affiliate/click`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify({
          slug,
          referrer: document.referrer || null,
          timestamp: new Date().toISOString(),
        }),
      }
    ).catch((err) => {
      // Non-blocking — don't let a logging failure block the redirect
      console.warn('[AFFILIATE] Failed to log click:', err);
    });

    // 3. Redirect to the landing page (not the auth screen)
    //    The visitor can explore the full site freely before signing up
    navigate('/', { replace: true });
  }, [slug, navigate]);

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center">
      <LoadingSpinner size="lg" text="Redirecting..." center />
    </div>
  );
}

export default AffiliateRedirect;
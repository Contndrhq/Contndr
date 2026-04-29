import { useState, useEffect } from 'react';
import { Copy, Check, Terminal, ExternalLink, Globe, AlertTriangle, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { TrackingHealthMonitor } from './TrackingHealthMonitor';
import { TrackingDebugHelper } from './TrackingDebugHelper';
import { useTranslation } from 'react-i18next';

export function WebTrackingSetup() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [showUpdateWarning, setShowUpdateWarning] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState('sourcr'); // Default to Sourcr for legacy tracking enforcement

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user) {
        setUserId(data.session.user.id);
        setUserEmail(data.session.user.email || null);
      }
    });
  }, []);

  const handleTest = async () => {
    if (!userId) {
      toast.error(t('tracking.errorAccountLoad'));
      return;
    }
    
    setTesting(true);
    try {
      // Try to get location for the test
      let coords = {};
      try {
        if ("geolocation" in navigator) {
           const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
             navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 2000 });
           });
           if (pos?.coords) {
             coords = {
               latitude: pos.coords.latitude,
               longitude: pos.coords.longitude
             };
           }
        }
      } catch (e) {
        console.log('Test location skipped');
      }

      const response = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/track/web`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: userId,
          lead_id: null,
          url: window.location.href,
          title: 'Test Visit from Analytics',
          brand: selectedBrand,
          timestamp: Date.now(),
          ...coords
        })
      });
      
      if (response.ok) {
        toast.success(t('tracking.testSuccess'));
      } else {
        const text = await response.text();
        toast.error(`${t('tracking.testFailed')}: ${text}`);
      }
    } catch (err) {
      toast.error(`${t('tracking.testFailed')}: ${err}`);
      console.error('Test tracking error:', err);
    } finally {
      setTesting(false);
    }
  };

  // The tracking script to be embedded
  const trackingScript = `
<script>
  (function() {
    // 1. Check for Lead ID in URL parameters (from Contndr emails)
    const urlParams = new URLSearchParams(window.location.search);
    const lid = urlParams.get('lid');
    
    // 2. Persist Lead ID if present
    if (lid) {
      localStorage.setItem('contndr_lid', lid);
    }
    
    // 3. Get Lead ID from storage (if any)
    const storedLid = localStorage.getItem('contndr_lid');
    
    // 4. Send "Page View" Heartbeat (Works for both leads and anonymous visitors)
    const track = async () => {
      // Optional: Try to get precise location if permission is already granted
      // This improves map accuracy for testing/admin users without annoying visitors
      let coords = {};
      try {
        if ("geolocation" in navigator && "permissions" in navigator) {
          const perm = await navigator.permissions.query({ name: 'geolocation' });
          if (perm.state === 'granted') {
             const pos = await new Promise((resolve, reject) => {
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

      fetch('https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/track/web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: '${userId || ""}' || null, // Identifies the Contndr account
          brand: '${selectedBrand}', // Explicitly set the brand
          lead_id: storedLid, // Can be null for anonymous
          url: window.location.href,
          title: document.title,
          timestamp: Date.now(),
          ...coords
        })
      })
      .then(res => res.json())
      .then(data => {
        if (!data.success) {
          console.warn('Contndr Tracking Script Outdated!');
          console.warn('Action Required:', data.message);
          if (data.instructions) {
            console.warn('How to Fix:');
            data.instructions.forEach(step => console.warn('  ', step));
          }
        }
      })
      .catch(err => console.error('Contndr Tracking Error:', err));
    };
    
    // Track immediately (always fire, even without userId for anonymous tracking)
    track();
    
    // Track on history changes (SPA support)
    const pushState = history.pushState;
    history.pushState = function() {
      pushState.apply(history, arguments);
      track();
    };
    
    window.addEventListener('popstate', track);
  })();
</script>
`.trim();

  const handleCopy = () => {
    if (!userId) {
      toast.error(t('tracking.errorAccountLoad'));
      return;
    }
    
    // Validate the script actually contains a real user ID
    if (!trackingScript.includes(userId)) {
      toast.error(t('tracking.testFailed'));
      return;
    }
    
    navigator.clipboard.writeText(trackingScript);
    setCopied(true);
    setShowUpdateWarning(true);
    toast.success(t('tracking.scriptCopied'));
    // Notify onboarding walkthrough that tracking step was completed
    window.dispatchEvent(new Event('onboarding-step-completed'));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white dark:bg-black rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="p-6 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
              <Globe className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('tracking.title')}</h3>
              <p className="text-sm text-gray-500">{t('tracking.description')}</p>
            </div>
          </div>
          {userId && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{t('tracking.ready')}</span>
            </div>
          )}
        </div>
      </div>
      
      <div className="p-6 space-y-6">
        {/* Brand Configuration */}
        {(userEmail === 'admin@contndr.com' || userEmail === 'or@roadr.com') && (
        <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-800">
           <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                 <Tag className="w-4 h-4 text-gray-600 dark:text-gray-400 flex-shrink-0" />
                 <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{t('tracking.brandConfiguration')}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('tracking.brandConfigurationDesc')}</p>
                 </div>
              </div>
              <select
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
                className="px-3 py-1.5 text-sm bg-white dark:bg-black border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600 w-full sm:w-auto flex-shrink-0"
              >
                 <option value="contndr">Contndr</option>
                 <option value="sourcr">Sourcr</option>
                 <option value="covera">Covera</option>
                 <option value="roadr">Roadr</option>
              </select>
           </div>
        </div>
        )}

        <TrackingHealthMonitor />
        
        {!userId && (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-200 dark:border-amber-900/20">
            <p className="text-sm text-amber-800 dark:text-amber-400">
              ⏳ {t('tracking.loadingTrackingCode')}
            </p>
          </div>
        )}
        
        {showUpdateWarning && (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-200 dark:border-amber-900/20">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-300 mb-1">
                  📝 {t('tracking.updateWarningTitle')}
                </p>
                <p className="text-sm text-amber-800 dark:text-amber-400 mb-2">
                  {t('tracking.updateWarningDesc')}
                </p>
                <ol className="text-sm text-amber-800 dark:text-amber-400 space-y-1 ml-4 list-decimal">
                  <li>{t('tracking.updateStep1')}</li>
                  <li>{t('tracking.updateStep2')} <code className="px-1 py-0.5 bg-amber-100 dark:bg-amber-900/30 rounded text-xs">&lt;head&gt;</code></li>
                  <li>{t('tracking.updateStep3')}</li>
                  <li>{t('tracking.updateStep4')}</li>
                </ol>
                <button 
                  onClick={() => setShowUpdateWarning(false)}
                  className="mt-3 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 font-medium"
                >
                  {t('tracking.updateDismiss')}
                </button>
              </div>
            </div>
          </div>
        )}
        
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-sm font-semibold text-gray-900 dark:text-white">
            1
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-1">{t('tracking.copyScript')}</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {t('tracking.pasteSnippetInstructions')} <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">&lt;head&gt;</code> {t('tracking.pasteSnippetSuffix')}
            </p>
            
            <div className="relative group">
              {!userId && (
                <div className="absolute inset-0 bg-gray-900/80 backdrop-blur-sm rounded-xl z-20 flex items-center justify-center">
                  <div className="text-center p-4">
                    <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <p className="text-xs text-amber-400 font-medium">{t('tracking.loadingTrackingScript')}</p>
                  </div>
                </div>
              )}
              
              <div className="absolute top-3 right-3 z-10">
                <button
                  onClick={handleCopy}
                  disabled={!userId}
                  className="p-2 bg-gray-800/50 hover:bg-gray-700/50 disabled:bg-gray-800/30 text-gray-300 hover:text-white disabled:text-gray-600 rounded-lg transition-colors backdrop-blur-sm disabled:cursor-not-allowed"
                  title={userId ? t('tracking.copy') : t('tracking.errorAccountLoad')}
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <pre className="p-4 bg-gray-900 rounded-xl overflow-x-auto overflow-y-auto max-h-[300px] text-xs font-mono text-gray-300 leading-relaxed border border-gray-800 custom-scrollbar">
                {trackingScript}
              </pre>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-sm font-semibold text-gray-900 dark:text-white">
            2
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-1">{t('tracking.identifyLeads')}</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('tracking.identifyLeadsDesc')} <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">?lid=...</code> {t('tracking.identifyLeadsSuffix')}
            </p>
          </div>
        </div>
        
        <div className="space-y-3">
          <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-800">
            <div className="flex items-start gap-3">
              <Terminal className="w-4 h-4 text-gray-600 dark:text-gray-400 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-gray-900 dark:text-gray-300 mb-1">{t('tracking.howItWorks')}</p>
                <p className="text-xs text-gray-700 dark:text-gray-400 leading-relaxed">
                  {t('tracking.howItWorksDesc')} <strong>{t('tracking.howItWorksWho')}</strong> {t('tracking.howItWorksSuffix')}
                </p>
              </div>
            </div>
          </div>
          
          <button
            onClick={handleTest}
            disabled={!userId || testing}
            className="w-full px-4 py-2.5 bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white dark:text-gray-900 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {testing ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                {t('tracking.testing')}
              </>
            ) : (
              <>
                <ExternalLink className="w-4 h-4" />
                {t('tracking.sendTest')}
              </>
            )}
          </button>
          
          <TrackingDebugHelper />
        </div>
      </div>
    </div>
  );
}
import { useState } from 'react';
import { Code, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

export function TrackingDebugHelper() {
  const [copied, setCopied] = useState(false);

  const debugScript = `
// Contndr Tracking Script Debug Tool
// Copy and paste this into your browser console while on a website with Contndr tracking

(function() {
  console.log('Checking for Contndr tracking script...');
  
  // Check if tracking is running
  const scripts = Array.from(document.querySelectorAll('script'));
  const contndrScript = scripts.find(s => s.innerHTML.includes('contndr_lid') || s.innerHTML.includes('track/web'));
  
  if (!contndrScript) {
    console.error('No Contndr tracking script found on this page');
    return;
  }
  
  console.log('Contndr tracking script found');
  
  // Extract account_id from script
  const scriptText = contndrScript.innerHTML;
  const accountIdMatch = scriptText.match(/account_id:\\\\s*([^,]+)/);
  
  if (accountIdMatch) {
    const accountIdValue = accountIdMatch[1].trim();
    console.log('Account ID configuration:', accountIdValue);
    
    // Check for common issues
    if (accountIdValue === 'null') {
      console.warn('Account ID is null - this script was copied before user ID loaded');
      console.warn('Action: Re-copy the tracking script from Contndr Analytics page');
    } else if (accountIdValue.includes('undefined')) {
      console.error('CRITICAL: Account ID contains "undefined"');
      console.error('Action: IMMEDIATELY re-copy the tracking script from Contndr Analytics page');
    } else if (accountIdValue.startsWith("'") && accountIdValue.endsWith("'")) {
      const cleanId = accountIdValue.slice(1, -1);
      console.log('Account ID looks valid:', cleanId);
      console.log('Script should be working correctly');
    } else {
      console.warn('Unexpected account ID format:', accountIdValue);
    }
  } else {
    console.error('Could not find account_id in tracking script');
  }
  
  // Check lead ID storage
  const storedLid = localStorage.getItem('contndr_lid');
  if (storedLid) {
    console.log('Lead ID found in localStorage:', storedLid);
  } else {
    console.log('No lead ID stored (visitor is anonymous)');
  }
  
  console.log('\\\\nSummary:');
  console.log('Script found:', !!contndrScript ? 'Yes' : 'No');
  console.log('Account ID:', accountIdMatch ? accountIdMatch[1] : 'Not found');
  console.log('Lead ID:', storedLid || 'None (anonymous)');
})();
`.trim();

  const handleCopy = () => {
    navigator.clipboard.writeText(debugScript);
    setCopied(true);
    toast.success('Debug script copied! Paste it into your browser console.');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="flex items-start gap-3 mb-3">
        <Code className="w-4 h-4 text-gray-600 dark:text-gray-400 mt-0.5" />
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
            Debug Tool
          </h4>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Check if your tracking script is working correctly on any website
          </p>
        </div>
      </div>
      
      <button
        onClick={handleCopy}
        className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2 border border-gray-300 dark:border-gray-700"
      >
        {copied ? (
          <>
            <Check className="w-4 h-4" />
            Copied!
          </>
        ) : (
          <>
            <Copy className="w-4 h-4" />
            Copy Debug Script
          </>
        )}
      </button>
      
      <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
        1. Copy this script<br />
        2. Open browser DevTools (F12) on your website<br />
        3. Paste into Console tab and press Enter<br />
        4. Read the diagnostic output
      </p>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { useDemoMode } from './DemoContext';

/**
 * Background automation scheduler component
 * Checks every 5 minutes if any automation rules are due to run
 * This component should be mounted once in the app (e.g., in App.tsx)
 */
export function AutomationScheduler() {
  const isDemoMode = useDemoMode();
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (isDemoMode) return;

    console.log('🤖 Automation scheduler started');

    // Run check immediately on mount
    checkAndRunAutomations();

    // Then check every 5 minutes
    intervalRef.current = window.setInterval(() => {
      checkAndRunAutomations();
    }, 5 * 60 * 1000); // 5 minutes

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        console.log('🤖 Automation scheduler stopped');
      }
    };
  }, []);

  async function checkAndRunAutomations() {
    try {
      const headers = await getAuthHeaders();
      
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/automation/check-and-run`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({})
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.rules_processed > 0) {
          console.log(`⏰ Automation scheduler: Processed ${data.rules_processed} rule(s)`);
        }
      }
    } catch (error) {
      // Silent fail - don't spam console
      console.debug('Automation check error:', error);
    }
  }

  // This component doesn't render anything
  return null;
}
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface UserRole {
  role: 'master' | 'admin' | 'affiliate' | 'user' | 'sales_rep' | 'org_admin' | 'account_exec' | 'sdr' | 'team_lead';
  restrictedFeatures: string[];
  canSignup?: boolean;
}

let cachedUserRole: UserRole | null = null;

export function useUserRole(): UserRole {
  const [userRole, setUserRole] = useState<UserRole>(
    cachedUserRole || {
      role: 'user',
      restrictedFeatures: [],
      canSignup: false
    }
  );

  useEffect(() => {
    async function loadUserRole() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.user_metadata) {
          const role: UserRole = {
            role: user.user_metadata.role || 'user',
            restrictedFeatures: user.user_metadata.restricted_features || [],
            canSignup: user.user_metadata.can_signup
          };
          cachedUserRole = role;
          setUserRole(role);
        }
      } catch (err) {
        console.error('[RBAC] Error loading user role:', err);
      }
    }

    loadUserRole();
  }, []);

  return userRole;
}

export function useFeatureAccess(feature: string): boolean {
  const userRole = useUserRole();
  
  // Master has access to everything
  if (userRole.role === 'master') return true;
  
  // Check if feature is restricted
  return !userRole.restrictedFeatures.includes(feature);
}

export function useCanAccessAdmin(): boolean {
  const userRole = useUserRole();
  return userRole.role === 'master' || userRole.role === 'admin' || userRole.role === 'org_admin';
}

export function useIsMaster(): boolean {
  const userRole = useUserRole();
  return userRole.role === 'master';
}

// Feature IDs
export const FEATURES = {
  CAMPAIGNS: 'campaigns',
  LEADS: 'leads',
  COMPANY_SEARCH: 'company_search',
  APOLLO_SEARCH: 'apollo_search',
  AI_ASSISTANT: 'ai_assistant',
  ANALYTICS: 'analytics',
  SEQUENCES: 'sequences',
  INTEGRATIONS: 'integrations',
  PIPELINE: 'pipeline',
  WARM_UP: 'warm_up',
} as const;
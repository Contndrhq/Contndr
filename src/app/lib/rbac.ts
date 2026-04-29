// Role-based access control utilities
// This file provides helpers for checking user roles and feature restrictions

export interface UserRole {
  role: 'master' | 'admin' | 'affiliate' | 'user' | 'sales_rep' | 'org_admin' | 'account_exec' | 'sdr' | 'team_lead';
  restrictedFeatures: string[];
  canSignup?: boolean;
}

export function parseUserRole(userMetadata: any): UserRole {
  return {
    role: userMetadata?.role || 'user',
    restrictedFeatures: userMetadata?.restricted_features || [],
    canSignup: userMetadata?.can_signup
  };
}

export function hasFeatureAccess(userRole: UserRole, feature: string): boolean {
  // Master has access to everything
  if (userRole.role === 'master') return true;
  
  // Check if feature is restricted
  return !userRole.restrictedFeatures.includes(feature);
}

export function canAccessAdmin(userRole: UserRole): boolean {
  return userRole.role === 'master' || userRole.role === 'admin' || userRole.role === 'org_admin';
}

export function isMaster(userRole: UserRole): boolean {
  return userRole.role === 'master';
}

// Feature IDs that can be restricted
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
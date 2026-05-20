export type PlanKey = 'none' | 'starter' | 'professional' | 'growth' | 'scale' | 'enterprise';

export interface PlanEntitlement {
  monthlyLeadLimit: number;
  agentMode: boolean;
  aiCalling: boolean;
  intentAutoCall: boolean;
  seats: number;
}

export const PLAN_ENTITLEMENTS: Record<PlanKey, PlanEntitlement> = {
  none: {
    monthlyLeadLimit: 100,
    agentMode: false,
    aiCalling: false,
    intentAutoCall: false,
    seats: 1,
  },
  starter: {
    monthlyLeadLimit: 2500,
    agentMode: false,
    aiCalling: false,
    intentAutoCall: false,
    seats: 1,
  },
  professional: {
    monthlyLeadLimit: 10000,
    agentMode: false,
    aiCalling: false,
    intentAutoCall: false,
    seats: 3,
  },
  growth: {
    monthlyLeadLimit: 10000,
    agentMode: true,
    aiCalling: false,
    intentAutoCall: false,
    seats: 5,
  },
  scale: {
    monthlyLeadLimit: 50000,
    agentMode: true,
    aiCalling: true,
    intentAutoCall: true,
    seats: 10,
  },
  enterprise: {
    monthlyLeadLimit: -1,
    agentMode: true,
    aiCalling: true,
    intentAutoCall: true,
    seats: -1,
  },
};

export function normalizePlan(plan: string | undefined | null): PlanKey {
  const key = (plan || 'none').toLowerCase() as PlanKey;
  return key in PLAN_ENTITLEMENTS ? key : 'none';
}

export function getPlanEntitlements(plan: string | undefined | null): PlanEntitlement {
  return PLAN_ENTITLEMENTS[normalizePlan(plan)];
}

export function getLeadLimitForPlan(plan: string | undefined | null): number {
  return getPlanEntitlements(plan).monthlyLeadLimit;
}

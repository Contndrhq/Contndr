import { ReactNode } from 'react';
import { useFeatureAccess, useUserRole } from '../hooks/useUserRole';
import { Lock, Crown } from 'lucide-react';

interface FeatureGateProps {
  feature: string;
  children: ReactNode;
  fallback?: ReactNode;
  showRestricted?: boolean;
}

export function FeatureGate({ feature, children, fallback, showRestricted = false }: FeatureGateProps) {
  const hasAccess = useFeatureAccess(feature);
  const userRole = useUserRole();

  if (hasAccess) {
    return <>{children}</>;
  }

  if (showRestricted) {
    return (
      <div className="relative">
        <div className="pointer-events-none opacity-40 blur-[2px]">
          {children}
        </div>
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm rounded-lg border-2 border-zinc-300 dark:border-zinc-700">
          <div className="text-center p-6">
            <Lock className="w-8 h-8 mx-auto mb-3 text-zinc-400" />
            <p className="text-sm font-semibold text-[var(--text-main)] mb-1">
              Feature Restricted
            </p>
            <p className="text-xs text-zinc-500">
              This feature has been restricted for your account.
              {userRole.role !== 'master' && ' Contact your administrator for access.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{fallback || null}</>;
}

interface AdminGateProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function AdminGate({ children, fallback }: AdminGateProps) {
  const userRole = useUserRole();
  const canAccess = userRole.role === 'master' || userRole.role === 'admin' || userRole.role === 'org_admin';

  if (canAccess) {
    return <>{children}</>;
  }

  return <>{fallback || null}</>;
}

interface MasterGateProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function MasterGate({ children, fallback }: MasterGateProps) {
  const userRole = useUserRole();
  const isMaster = userRole.role === 'master';

  if (isMaster) {
    return <>{children}</>;
  }

  return <>{fallback || null}</>;
}

// Role badge component
export function RoleBadge() {
  const userRole = useUserRole();

  if (userRole.role === 'user') return null;

  const config: Record<string, { label: string; icon: any; className: string }> = {
    master: {
      label: 'Master',
      icon: Crown,
      className: 'bg-[#1ED4A7]/10 text-[#1ED4A7] border-[#1ED4A7]/20'
    },
    admin: {
      label: 'Admin',
      icon: Lock,
      className: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20'
    },
    affiliate: {
      label: 'Affiliate',
      icon: Lock,
      className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
    },
    sales_rep: {
      label: 'Sales Rep',
      icon: Lock,
      className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
    },
    org_admin: {
      label: 'Org Admin',
      icon: Lock,
      className: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20'
    },
    account_exec: {
      label: 'Account Exec',
      icon: Lock,
      className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
    },
    sdr: {
      label: 'SDR',
      icon: Lock,
      className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
    },
    team_lead: {
      label: 'Team Lead',
      icon: Lock,
      className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
    }
  };

  const roleConfig = config[userRole.role];

  if (!roleConfig) return null;

  const Icon = roleConfig.icon;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-semibold uppercase tracking-wider ${roleConfig.className}`}>
      <Icon className="w-3 h-3" />
      {roleConfig.label}
    </div>
  );
}

export default FeatureGate;
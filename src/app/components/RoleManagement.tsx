import { useState, useEffect } from 'react';
import {
  Shield, UserCog, Users, Key, Loader2, Search, X, Check, AlertTriangle,
  Crown, UserCheck, UserX, Mail, Calendar, ChevronDown, ChevronUp, Eye, EyeOff,
  Copy, RefreshCw, Lock, Unlock, Plus, Trash2, Edit2, UserPlus
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { toTitleCase } from '../utils/title-case';

// ── Types ──

interface UserRole {
  id: string;
  email: string;
  role: 'master' | 'admin' | 'affiliate' | 'user' | 'sales_rep' | 'org_admin' | 'account_exec' | 'sdr' | 'team_lead';
  created_at: string;
  last_sign_in_at: string;
  user_metadata: {
    name?: string;
    full_name?: string;
  };
  can_signup?: boolean;
  restricted_features?: string[];
}

interface RoleStats {
  totalUsers: number;
  masterCount: number;
  adminCount: number;
  affiliateCount: number;
  userCount: number;
}

// ── Constants ──

const ROLE_CONFIG = {
  master: {
    label: 'Master',
    icon: Crown,
    color: 'text-[#1ED4A7]',
    bg: 'bg-[#1ED4A7]/10',
    border: 'border-[#1ED4A7]/20',
    description: 'Full system control, cannot be restricted',
    permissions: ['All permissions', 'Manage roles', 'System configuration', 'View all data']
  },
  admin: {
    label: 'Admin',
    icon: Shield,
    color: 'text-zinc-300',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/20',
    description: 'Can manage users and view analytics',
    permissions: ['Manage users', 'View analytics', 'Access admin portal', 'Manage affiliates']
  },
  affiliate: {
    label: 'Affiliate',
    icon: Users,
    color: 'text-zinc-400',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/20',
    description: 'Can track referrals and commissions',
    permissions: ['View referrals', 'Track commissions', 'Generate affiliate links']
  },
  user: {
    label: 'User',
    icon: UserCheck,
    color: 'text-zinc-500',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/20',
    description: 'Standard platform access',
    permissions: ['Use platform features', 'Manage own account']
  },
  sales_rep: {
    label: 'Sales Rep',
    icon: UserCog,
    color: 'text-zinc-400',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/20',
    description: 'Sales representative with limited access',
    permissions: ['Manage leads', 'Track sales', 'Generate reports']
  },
  org_admin: {
    label: 'Org Admin',
    icon: Shield,
    color: 'text-zinc-300',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/20',
    description: 'Organizational administrator with broad access',
    permissions: ['Manage users', 'View analytics', 'Access admin portal', 'Manage affiliates']
  },
  account_exec: {
    label: 'Account Exec',
    icon: UserCog,
    color: 'text-zinc-400',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/20',
    description: 'Account executive with limited access',
    permissions: ['Manage leads', 'Track sales', 'Generate reports']
  },
  sdr: {
    label: 'SDR',
    icon: UserCog,
    color: 'text-zinc-400',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/20',
    description: 'Sales Development Representative with limited access',
    permissions: ['Manage leads', 'Track sales', 'Generate reports']
  },
  team_lead: {
    label: 'Team Lead',
    icon: UserCog,
    color: 'text-zinc-400',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/20',
    description: 'Team leader with limited access',
    permissions: ['Manage leads', 'Track sales', 'Generate reports']
  }
};

const RESTRICTABLE_FEATURES = [
  { id: 'campaigns', label: 'Email Campaigns' },
  { id: 'leads', label: 'Lead Management' },
  { id: 'company_search', label: 'Company Search' },
  { id: 'apollo_search', label: 'Apollo Search' },
  { id: 'ai_assistant', label: 'AI Assistant' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'sequences', label: 'Email Sequences' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'pipeline', label: 'Pipeline/CRM' },
  { id: 'warm_up', label: 'Email Warm-up' },
];

// ── Main Component ──

export function RoleManagement() {
  const [users, setUsers] = useState<UserRole[]>([]);
  const [stats, setStats] = useState<RoleStats>({
    totalUsers: 0,
    masterCount: 0,
    adminCount: 0,
    affiliateCount: 0,
    userCount: 0
  });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserRole | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // New user form
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    name: '',
    role: 'user' as 'master' | 'admin' | 'affiliate' | 'user' | 'sales_rep' | 'org_admin' | 'account_exec' | 'sdr' | 'team_lead',
    can_signup: true
  });
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/roles/users`,
        { headers }
      );
      const data = await res.json();
      
      if (res.ok) {
        setUsers(data.users || []);
        setStats(data.stats || stats);
      } else {
        toast.error('Failed to load users', { description: data.error });
      }
    } catch (err: any) {
      toast.error('Error loading users', { description: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function updateUserRole(userId: string, newRole: string) {
    setProcessingId(userId);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/roles/update`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, role: newRole })
        }
      );
      const data = await res.json();
      
      if (res.ok) {
        toast.success('Role updated', { description: `User is now ${ROLE_CONFIG[newRole as keyof typeof ROLE_CONFIG].label}` });
        loadUsers();
      } else {
        toast.error('Failed to update role', { description: data.error });
      }
    } catch (err: any) {
      toast.error('Error updating role', { description: err.message });
    } finally {
      setProcessingId(null);
      setEditingUser(null);
    }
  }

  async function updateRestrictions(userId: string, restrictions: string[]) {
    setProcessingId(userId);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/roles/restrictions`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, restrictions })
        }
      );
      const data = await res.json();
      
      if (res.ok) {
        toast.success('Restrictions updated');
        loadUsers();
      } else {
        toast.error('Failed to update restrictions', { description: data.error });
      }
    } catch (err: any) {
      toast.error('Error updating restrictions', { description: err.message });
    } finally {
      setProcessingId(null);
    }
  }

  async function toggleSignupAccess(userId: string, canSignup: boolean) {
    setProcessingId(userId);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/roles/signup-access`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, canSignup })
        }
      );
      const data = await res.json();
      
      if (res.ok) {
        toast.success(canSignup ? 'Signup enabled' : 'Signup disabled');
        loadUsers();
      } else {
        toast.error('Failed to update access', { description: data.error });
      }
    } catch (err: any) {
      toast.error('Error updating access', { description: err.message });
    } finally {
      setProcessingId(null);
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newUser.email || !newUser.password) return;
    
    setProcessingId('creating');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/roles/create`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(newUser)
        }
      );
      const data = await res.json();
      
      if (res.ok) {
        toast.success('User created', { description: `${newUser.email} added as ${ROLE_CONFIG[newUser.role].label}` });
        setShowAddUser(false);
        setNewUser({ email: '', password: '', name: '', role: 'user', can_signup: true });
        loadUsers();
      } else {
        toast.error('Failed to create user', { description: data.error });
      }
    } catch (err: any) {
      toast.error('Error creating user', { description: err.message });
    } finally {
      setProcessingId(null);
    }
  }

  async function deleteUser(userId: string, email: string) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    
    setProcessingId(userId);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/admin/roles/delete`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId })
        }
      );
      const data = await res.json();
      
      if (res.ok) {
        toast.success('User deleted');
        loadUsers();
      } else {
        toast.error('Failed to delete user', { description: data.error });
      }
    } catch (err: any) {
      toast.error('Error deleting user', { description: err.message });
    } finally {
      setProcessingId(null);
    }
  }

  // Filter users
  const filteredUsers = users.filter(user => {
    const matchesSearch = !searchTerm || 
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.user_metadata?.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = selectedRole === 'all' || user.role === selectedRole;
    return matchesSearch && matchesRole;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Stats — matches Active Users style */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total Users', count: stats.totalUsers },
          { label: 'Master', count: stats.masterCount },
          { label: 'Admin', count: stats.adminCount },
          { label: 'Affiliate', count: stats.affiliateCount },
          { label: 'User', count: stats.userCount },
        ].map((stat, i) => (
          <div key={i} className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm">
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
              {stat.label}
            </div>
            <div className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
              {stat.count}
            </div>
          </div>
        ))}
      </div>

      {/* Actions bar */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div className="text-sm font-medium text-zinc-900 dark:text-white">Roles &amp; permissions</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddUser(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 text-xs font-medium transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" />
            Add user
          </button>
          <button
            onClick={loadUsers}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
          <input
            type="text"
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors shadow-sm"
          />
        </div>
        <select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value)}
          className="px-3 py-2.5 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors shadow-sm"
        >
          <option value="all">All Roles</option>
          <option value="master">Master</option>
          <option value="admin">Admin</option>
          <option value="affiliate">Affiliate</option>
          <option value="user">User</option>
          <option value="sales_rep">Sales Rep</option>
          <option value="org_admin">Org Admin</option>
          <option value="account_exec">Account Exec</option>
          <option value="sdr">SDR</option>
          <option value="team_lead">Team Lead</option>
        </select>
      </div>

      {/* Users List */}
      <div>
        <div className="space-y-2">
          {filteredUsers.length === 0 ? (
            <div className="text-center py-12">
              <UserX className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500">No users found</p>
            </div>
          ) : (
            filteredUsers.map(user => {
              const roleConfig = ROLE_CONFIG[user.role as keyof typeof ROLE_CONFIG];
              
              // Skip users with invalid roles
              if (!roleConfig) {
                console.warn(`Invalid role for user ${user.id}: ${user.role}`);
                return null;
              }
              
              const RoleIcon = roleConfig.icon;
              const isExpanded = expandedUser === user.id;
              const isProcessing = processingId === user.id;
              const isMaster = user.role === 'master';

              const displayName = user.user_metadata?.name || user.user_metadata?.full_name || user.email;
              const initials = (displayName.match(/[A-Za-z0-9]/g) || ['?']).slice(0, 2).join('').toUpperCase();
              return (
                <div
                  key={user.id}
                  className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm"
                >
                  {/* User Header */}
                  <button
                    onClick={() => setExpandedUser(isExpanded ? null : user.id)}
                    disabled={isProcessing}
                    className="w-full text-left p-3 sm:p-4 hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {/* Neutral monochrome avatar */}
                      <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold border bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800">
                        {initials}
                      </div>

                      {/* User Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{displayName}</h3>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 flex-shrink-0">
                            <RoleIcon className="w-3 h-3" />
                            {roleConfig.label}
                          </span>
                          {isMaster && <Crown className="w-3.5 h-3.5 text-[#1ED4A7] flex-shrink-0" />}
                        </div>
                        <p className="text-xs text-zinc-500 truncate">{user.email}</p>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400 dark:text-zinc-600 mt-1">
                          <span>joined {new Date(user.created_at).toLocaleDateString()}</span>
                          {user.last_sign_in_at && (
                            <span>· last seen {new Date(user.last_sign_in_at).toLocaleDateString()}</span>
                          )}
                          {user.can_signup !== undefined && !user.can_signup && (
                            <span className="text-rose-500 flex items-center gap-1">
                              <Lock className="w-3 h-3" /> Signup disabled
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex-shrink-0">
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-zinc-500" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-zinc-500" />
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
                      {/* Role Change */}
                      {!isMaster && (
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                            Change Role
                          </label>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {Object.entries(ROLE_CONFIG).map(([roleKey, config]) => {
                              if (roleKey === 'master') return null; // Master can only be set manually
                              const Icon = config.icon;
                              const isSelected = user.role === roleKey;
                              
                              return (
                                <button
                                  key={roleKey}
                                  onClick={() => updateUserRole(user.id, roleKey)}
                                  disabled={isProcessing || isSelected}
                                  className={`p-3 rounded-lg border-2 transition-all text-left ${
                                    isSelected
                                      ? `${config.bg} ${config.border} ${config.color}`
                                      : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                  <Icon className={`w-4 h-4 mb-1 ${isSelected ? config.color : 'text-zinc-400'}`} />
                                  <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{config.label}</div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Permissions */}
                      <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                          Permissions
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {roleConfig.permissions.map((perm, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                              <Check className="w-3.5 h-3.5 text-[#1ED4A7] flex-shrink-0" />
                              <span>{perm}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Feature Restrictions (non-master only) */}
                      {!isMaster && (
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                            Feature Restrictions
                          </label>
                          <p className="text-[10px] text-zinc-400 mb-3">Select features to restrict for this user</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {RESTRICTABLE_FEATURES.map(feature => {
                              const isRestricted = user.restricted_features?.includes(feature.id);
                              
                              return (
                                <button
                                  key={feature.id}
                                  onClick={() => {
                                    const current = user.restricted_features || [];
                                    const updated = isRestricted
                                      ? current.filter(f => f !== feature.id)
                                      : [...current, feature.id];
                                    updateRestrictions(user.id, updated);
                                  }}
                                  disabled={isProcessing}
                                  className={`p-2 rounded-lg border text-left transition-all ${
                                    isRestricted
                                      ? 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/20'
                                      : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                                  } disabled:opacity-50`}
                                >
                                  <div className="flex items-center gap-2">
                                    {isRestricted ? (
                                      <X className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                                    ) : (
                                      <Check className="w-3.5 h-3.5 text-[#1ED4A7] flex-shrink-0" />
                                    )}
                                    <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{feature.label}</span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Signup Access Toggle (for affiliates) */}
                      {user.role === 'affiliate' && (
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                            Signup Access
                          </label>
                          <button
                            onClick={() => toggleSignupAccess(user.id, !user.can_signup)}
                            disabled={isProcessing}
                            className={`w-full sm:w-auto px-4 py-2 rounded-lg border-2 transition-all font-medium text-sm ${
                              user.can_signup
                                ? 'border-[#1ED4A7]/30 dark:border-[#1ED4A7]/20 bg-[#1ED4A7]/5 dark:bg-[#1ED4A7]/10 text-[#1ED4A7]'
                                : 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400'
                            } disabled:opacity-50`}
                          >
                            {user.can_signup ? (
                              <>
                                <Unlock className="w-4 h-4 inline mr-2" />
                                Signup Enabled
                              </>
                            ) : (
                              <>
                                <Lock className="w-4 h-4 inline mr-2" />
                                Signup Disabled
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {/* Danger Zone */}
                      {!isMaster && (
                        <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800">
                          <button
                            onClick={() => deleteUser(user.id, user.email)}
                            disabled={isProcessing}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span>Delete User</span>
                          </button>
                        </div>
                      )}

                      {/* Processing Overlay */}
                      {isProcessing && (
                        <div className="absolute inset-0 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm flex items-center justify-center rounded-lg">
                          <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Add User Modal */}
      {showAddUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Add New User</h3>
                <button
                  onClick={() => setShowAddUser(false)}
                  className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
                >
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>

              <form onSubmit={createUser} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1.5">Email *</label>
                  <input
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white/20"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1.5">Password *</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={newUser.password}
                      onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                      className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white/20"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4 text-zinc-400" />
                      ) : (
                        <Eye className="w-4 h-4 text-zinc-400" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1.5">Name</label>
                  <input
                    type="text"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-2">Role *</label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(ROLE_CONFIG).map(([roleKey, config]) => {
                      if (roleKey === 'master') return null;
                      const Icon = config.icon;
                      const isSelected = newUser.role === roleKey;
                      
                      return (
                        <button
                          key={roleKey}
                          type="button"
                          onClick={() => setNewUser({ ...newUser, role: roleKey as any })}
                          className={`p-3 rounded-lg border-2 transition-all text-left ${
                            isSelected
                              ? `${config.bg} ${config.border} ${config.color}`
                              : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                          }`}
                        >
                          <Icon className={`w-4 h-4 mb-1 ${isSelected ? config.color : 'text-zinc-400'}`} />
                          <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{config.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {newUser.role === 'affiliate' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="can-signup"
                      checked={newUser.can_signup}
                      onChange={(e) => setNewUser({ ...newUser, can_signup: e.target.checked })}
                      className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700"
                    />
                    <label htmlFor="can-signup" className="text-sm text-zinc-900 dark:text-zinc-100">
                      Allow signup access
                    </label>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddUser(false)}
                    className="flex-1 px-4 py-2.5 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={processingId === 'creating'}
                    className="flex-1 px-4 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {processingId === 'creating' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Creating...</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" />
                        <span>Create User</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RoleManagement;
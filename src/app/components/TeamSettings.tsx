import { useState, useEffect } from 'react';
import { Users, Plus, Mail, X, Trash2, CheckCircle, AlertCircle, Shield } from 'lucide-react';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders, authenticatedFetch } from '../lib/auth';
import { LoadingSpinner } from './LoadingSpinner';
import { apiCache } from '../lib/api-cache';
import { useDemoMode, DEMO_TEAM_SETTINGS } from './DemoContext';
import { useTranslation } from 'react-i18next';

interface Member {
  id: string;
  email: string;
  role: string;
  status: 'active' | 'invited';
  joined_at?: string;
  name?: string;
  avatar_url?: string;
}

interface Invite {
  email: string;
  role: string;
  token: string;
  created_at: string;
}

interface TeamData {
  teamId: string;
  isOwner: boolean;
  members: Member[];
  invites: Invite[];
  plan: string;
  limit: number;
  usage: number;
}

export function TeamSettings() {
  const { t } = useTranslation();
  const isDemoMode = useDemoMode();
  const [team, setTeam] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [inviteEmail, setInviteEmail] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    loadTeam();
  }, [isDemoMode]);

  async function loadTeam() {
    if (isDemoMode) {
      setTeam(DEMO_TEAM_SETTINGS as TeamData);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await apiCache.fetch(
        'settings:team',
        async () => {
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/team`
          );
          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to load team');
          }
          return response.json();
        },
        { staleTime: 60_000, cacheTime: 300_000 }
      );
      setTeam(data.data);
    } catch (err: any) {
      console.error('Error loading team:', err);
      setError(err.message || 'Failed to load team information');
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail) return;

    setInviting(true);
    setInviteError(null);

    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/team/invite`,
        {
          method: 'POST',
          body: JSON.stringify({ email: inviteEmail }),
        }
      );

      const data = await response.json();
      
      if (response.ok) {
        setInviteEmail('');
        setShowInviteModal(false);
        apiCache.invalidate('settings:team');
        loadTeam(); // Reload data
      } else {
        setInviteError(data.error || t('teamSettings.inviteFailed'));
      }
    } catch (err) {
      setInviteError(t('teamSettings.inviteFailed'));
    } finally {
      setInviting(false);
    }
  }

  async function cancelInvite(email: string) {
    if (!confirm(t('teamSettings.confirmCancelInvite', { defaultValue: 'Are you sure you want to cancel the invitation for {{email}}?', email }))) return;

    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/team/cancel-invite`,
        {
          method: 'POST',
          body: JSON.stringify({ email }),
        }
      );

      if (response.ok) {
        apiCache.invalidate('settings:team');
        loadTeam();
      } else {
        alert(t('teamSettings.cancelInviteFailed', 'Failed to cancel invitation'));
      }
    } catch (err) {
      console.error('Error cancelling invite:', err);
    }
  }

  async function removeMember(memberId: string) {
    if (!confirm(t('teamSettings.confirmRemove', 'Are you sure you want to remove this member? They will lose access to the team workspace.'))) return;

    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/team/member/${memberId}`,
        {
          method: 'DELETE',
        }
      );

      if (response.ok) {
        apiCache.invalidate('settings:team');
        loadTeam();
      } else {
        alert(t('teamSettings.removeMemberFailed', 'Failed to remove member'));
      }
    } catch (err) {
      console.error('Error removing member:', err);
    }
  }

  if (loading) {
    return <LoadingSpinner center size="lg" />;
  }

  if (error || !team) {
    return (
      <div className="p-6 text-center text-red-500">
        <AlertCircle className="w-8 h-8 mx-auto mb-2" />
        <p>{error || t('teamSettings.loadFailed', 'Failed to load team data')}</p>
        <button onClick={loadTeam} className="mt-4 text-zinc-900 dark:text-white hover:underline">{t('teamSettings.retry', 'Retry')}</button>
      </div>
    );
  }

  const seatsLeft = team.limit - team.usage;
  const canInvite = seatsLeft > 0 && team.isOwner;

  const translateRole = (role: string): string => {
    const roleMap: Record<string, string> = {
      owner: t('teamSettings.owner', 'Owner'),
      admin: t('roles.admin', 'Admin'),
      master: t('roles.master', 'Master'),
      affiliate: t('roles.affiliate', 'Affiliate'),
      user: t('roles.user', 'User'),
      sales_rep: t('roles.salesRep', 'Sales Rep'),
      org_admin: t('roles.orgAdmin', 'Org Admin'),
      account_exec: t('roles.accountExec', 'Account Exec'),
      sdr: t('roles.sdr', 'SDR'),
      team_lead: t('roles.teamLead', 'Team Lead'),
    };
    return roleMap[role?.toLowerCase()] || role;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5" /> {t('teamSettings.title', 'Team Members')}
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {t('teamSettings.subtitle', 'Manage your team and control workspace access.')}
          </p>
        </div>
        {team.isOwner && (
          <button
            onClick={() => setShowInviteModal(true)}
            disabled={!canInvite}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all w-full sm:w-auto flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
            {t('teamSettings.inviteMember', 'Invite Member')}
          </button>
        )}
      </div>

      {/* Plan Info */}
      <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-900 dark:text-white">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-white capitalize">{team.plan} {t('teamSettings.plan', 'Plan')}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t('teamSettings.seatsIncluded', { count: team.limit, defaultValue: '{{count}} seats included' })}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {team.usage}<span className="text-zinc-400 text-lg font-normal">/{team.limit}</span>
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('teamSettings.seatsUsed', 'Seats Used')}</p>
        </div>
      </div>

      {!canInvite && team.isOwner && (
        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg p-3 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {t('teamSettings.limitReached', 'Team limit reached')}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              {t('teamSettings.limitReachedDesc', { plan: team.plan, defaultValue: "You've used all available seats on your {{plan}} plan. Upgrade your plan to invite more members." })}
            </p>
          </div>
        </div>
      )}

      {/* Members List */}
      <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {/* Active Members */}
          {team.members.map((member) => (
            <div key={member.id} className="p-4 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
              <div className="flex items-center gap-3">
                {member.avatar_url ? (
                  <img src={member.avatar_url} alt={member.name || member.email} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 font-medium text-sm">
                    {(member.name || member.email || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="font-medium text-sm text-gray-900 dark:text-white flex items-center gap-2">
                    {member.name || member.email}
                    {member.role === 'owner' && (
                      <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded text-[10px] font-bold uppercase tracking-wide">
                        {t('teamSettings.owner', 'Owner')}
                      </span>
                    )}
                    {member.id === team.teamId && team.isOwner && (
                       <span className="text-xs text-zinc-400">({t('teamSettings.you', 'You')})</span>
                    )}
                  </div>
                  {member.name && (
                    <p className="text-xs text-zinc-500">{member.email}</p>
                  )}
                  <p className="text-xs text-zinc-500 capitalize">{translateRole(member.role)}</p>
                </div>
              </div>
              
              {team.isOwner && member.role !== 'owner' && (
                <button
                  onClick={() => removeMember(member.id)}
                  className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                  title={t('teamSettings.removeMember', 'Remove Member')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}

          {/* Pending Invites */}
          {team.invites.map((invite) => (
            <div key={invite.token} className="p-4 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors bg-zinc-50/50 dark:bg-zinc-900/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full border-2 border-dashed border-zinc-300 dark:border-zinc-700 flex items-center justify-center text-zinc-400">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-medium text-sm text-gray-900 dark:text-white flex items-center gap-2">
                    {invite.email}
                    <span className="px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded text-[10px] font-bold uppercase tracking-wide">
                      {t('teamSettings.pending', 'Pending')}
                    </span>
                  </p>
                  <p className="text-xs text-zinc-500">{t('teamSettings.invitedJustNow', 'Invited just now')}</p>
                </div>
              </div>
              
              {team.isOwner && (
                <button
                  onClick={() => cancelInvite(invite.email)}
                  className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                  title={t('teamSettings.cancelInvitation', 'Cancel Invitation')}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}

          {team.members.length === 0 && team.invites.length === 0 && (
            <div className="p-8 text-center text-zinc-500">
              {t('teamSettings.noMembers', 'No team members yet.')}
            </div>
          )}
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl max-w-md w-full p-6 shadow-xl animate-scale-in">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('teamSettings.inviteMember', 'Invite Team Member')}</h3>
              <button 
                onClick={() => setShowInviteModal(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleInvite}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t('teamSettings.emailAddress', 'Email Address')}
                  </label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    required
                    className="w-full px-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-500/20 focus:border-zinc-500"
                  />
                </div>

                {inviteError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {inviteError}
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={inviting || !inviteEmail}
                    className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {inviting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white"></div>
                        {t('teamSettings.sendingInvite', 'Sending Invite...')}
                      </>
                    ) : (
                      <>
                        <Mail className="w-4 h-4" /> {t('teamSettings.sendInvitation', 'Send Invitation')}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
import { useState, useEffect, useRef } from 'react';
import { User, Building, Mail, Camera, Upload, Loader2, CheckCircle, Download } from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders, authenticatedFetch } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from './LoadingSpinner';
import { RoleBadge } from './FeatureGate';
import { useTranslation } from 'react-i18next';

// Profile settings
export function ProfileSettings() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    name: '',
    company: '',
    avatarUrl: ''
  });
  const [exporting, setExporting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  // ── GDPR: download all user data as a single JSON file ────────────
  async function downloadMyData() {
    setExporting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/account/export`,
        { headers },
      );
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contndr-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Your data download has started');
    } catch (e: any) {
      toast.error('Export failed', { description: e.message });
    } finally {
      setExporting(false);
    }
  }

  // ── GDPR: permanently delete account ──────────────────────────────
  async function deleteMyAccount() {
    if (deleteText !== 'DELETE') return;
    setDeleting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/account/delete`,
        { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Delete failed (${res.status})`);
      }
      toast.success('Account deleted', { description: 'Signing you out…' });
      // Auth is already gone server-side; clean up local session and route to landing.
      await supabase.auth.signOut({ scope: 'local' });
      setTimeout(() => { window.location.href = '/'; }, 1200);
    } catch (e: any) {
      toast.error('Delete failed', { description: e.message });
      setDeleting(false);
    }
  }

  async function loadUser() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(session.user);
      setFormData({
        name: session.user.user_metadata?.name || '',
        company: session.user.user_metadata?.brand || '',
        avatarUrl: session.user.user_metadata?.avatar_url || ''
      });
    }
    setLoading(false);
  }

  async function updateProfile() {
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          name: formData.name,
          brand: formData.company,
          avatar_url: formData.avatarUrl
        }
      });

      if (error) throw error;
      
      toast.success(t('profile.profileUpdated'));
      
      // Refresh user data to ensure UI syncs (use getSession to avoid 404 on /auth/v1/user)
      const { data: { session: updatedSession } } = await supabase.auth.getSession();
      if (updatedSession?.user) setUser(updatedSession.user);
      
      // Force a reload of the app or dispatch event to update sidebar
      // Since Sidebar reads from auth state which should update, but sometimes needs a nudge
      window.dispatchEvent(new Event('storage')); // Sometimes triggers listeners
      window.dispatchEvent(new Event('profile-updated')); // For onboarding tracking
      
    } catch (error: any) {
      console.error('Error updating profile:', error);
      toast.error(t('profile.profileUpdateFailed'), { description: error.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('profile.fileSizeError'));
      return;
    }

    setUploading(true);
    try {
      const headers = await getAuthHeaders();
      const formDataUpload = new FormData();
      formDataUpload.append('file', file);

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/user/avatar`,
        {
          method: 'POST',
          headers: {
             // Do NOT set Content-Type header here, let browser set it with boundary
             'Authorization': headers['Authorization']
          },
          body: formDataUpload
        }
      );

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Upload failed');

      setFormData(prev => ({ ...prev, avatarUrl: data.url }));
      toast.success(t('profile.avatarUploaded'));
      
      // Also update profile immediately
      await supabase.auth.updateUser({
        data: { avatar_url: data.url }
      });
      window.dispatchEvent(new Event('profile-updated'));

    } catch (error: any) {
      console.error('Error uploading avatar:', error);
      toast.error(t('profile.avatarUploadFailed'), { description: error.message });
    } finally {
      setUploading(false);
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // Pre-generated avatars using DiceBear or similar could be cool, 
  // but for now let's stick to initials or custom URL to be safe.
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  if (loading) {
    return <LoadingSpinner center size="md" />;
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <User className="w-5 h-5 text-zinc-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('profile.profileAndIdentity')}</h2>
        </div>
        <RoleBadge />
      </div>

      <div className="space-y-6">
        {/* Avatar Section */}
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-4">{t('profile.profilePhoto')}</label>
          <div className="flex items-start gap-6">
            <div className="relative group">
              <div 
                onClick={() => !uploading && fileInputRef.current?.click()}
                className="w-24 h-24 rounded-full bg-gradient-to-br from-gray-800 to-black border border-white/10 flex items-center justify-center text-xl font-medium text-white shadow-inner overflow-hidden cursor-pointer relative"
              >
                {uploading ? (
                   <Loader2 className="w-8 h-8 animate-spin text-white" />
                ) : formData.avatarUrl ? (
                  <img src={formData.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span>{getInitials(formData.name || user?.email || 'U')}</span>
                )}
                
                {/* Overlay */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                   <Camera className="w-6 h-6 text-white" />
                </div>
              </div>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*"
                onChange={handleFileChange}
              />
            </div>

            <div className="flex-1 space-y-4 pt-2">
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">{t('profile.uploadNewPhoto')}</h3>
                <p className="text-xs text-zinc-500 mb-3">
                  {t('profile.uploadPhotoDesc')}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {t('profile.uploadPhoto')}
                  </button>
                  {formData.avatarUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormData(prev => ({ ...prev, avatarUrl: '' }));
                        // We could also trigger a delete on server if we wanted to be clean
                      }}
                      className="px-3 py-1.5 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 text-xs font-medium rounded-lg transition-colors"
                    >
                      {t('common.remove')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Details Section */}
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t('profile.fullName')}</label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="John Doe"
                  className="w-full px-3 py-2 pl-9 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-gray-900 dark:text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7]"
                />
                <User className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t('profile.companyBrand')}</label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  placeholder="Acme Corp"
                  className="w-full px-3 py-2 pl-9 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-gray-900 dark:text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#1ED4A7]/20 focus:border-[#1ED4A7]"
                />
                <Building className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
              </div>
              <p className="text-xs text-zinc-500 mt-1.5">{t('profile.companyBrandDesc')}</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{t('profile.emailAddress')}</label>
            <div className="relative">
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full px-3 py-2 pl-9 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-500 cursor-not-allowed"
              />
              <Mail className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">{t('profile.emailCannotChange')}</p>
          </div>
        </div>

        {/* Lead Avatars Section — hidden (avatars still resolve automatically via batch API) */}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={updateProfile}
            disabled={saving}
            className="px-6 py-2.5 bg-black dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-black font-semibold rounded-xl transition-all shadow-lg hover:shadow-xl disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            <span>{t('profile.saveChanges')}</span>
          </button>
        </div>

        {/* ── Privacy & data (GDPR / CCPA) ──────────────── */}
        <div className="mt-8 pt-5 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Privacy & data</h3>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <button
                onClick={downloadMyData}
                disabled={exporting}
                className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>Download my data</span>
              </button>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
              >
                Delete account
              </button>
            </div>
          </div>

          {showDeleteConfirm && (
            <div className="mt-3 border border-red-200 dark:border-red-900/40 bg-red-50/40 dark:bg-red-950/15 rounded-lg p-3 space-y-2.5">
              <p className="text-xs text-red-700 dark:text-red-300">
                All your leads, campaigns, emails, and settings will be permanently removed. Type <span className="font-mono font-semibold">DELETE</span> to confirm.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={deleteText}
                  onChange={(e) => setDeleteText(e.target.value)}
                  placeholder='DELETE'
                  className="flex-1 px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-900/40 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                  disabled={deleting}
                />
                <button
                  onClick={deleteMyAccount}
                  disabled={deleteText !== 'DELETE' || deleting}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {deleting && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>Delete</span>
                </button>
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteText(''); }}
                  disabled={deleting}
                  className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
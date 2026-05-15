/**
 * ImpersonationBanner — visible at the top of the app whenever an admin is
 * impersonating another user. Click to exit (restore the admin session that
 * was backed up in localStorage when impersonation started).
 */
import { useEffect, useState } from 'react';
import { X, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

const KEY = 'contndr_impersonation';
const BACKUP_KEY = 'contndr_impersonation_admin_backup';

export function ImpersonationBanner() {
  const [target, setTarget] = useState<{ email: string; admin_email: string } | null>(null);

  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(KEY);
        setTarget(raw ? JSON.parse(raw) : null);
      } catch {
        setTarget(null);
      }
    };
    read();
    window.addEventListener('storage', read);
    window.addEventListener('contndr:impersonation-changed', read as any);
    return () => {
      window.removeEventListener('storage', read);
      window.removeEventListener('contndr:impersonation-changed', read as any);
    };
  }, []);

  const exit = async () => {
    try {
      const backup = localStorage.getItem(BACKUP_KEY);
      if (!backup) {
        // No backup means we can't restore — just sign out.
        localStorage.removeItem(KEY);
        await supabase.auth.signOut();
        toast.success('Exited impersonation — please sign back in');
        window.location.href = '/';
        return;
      }
      const { access_token, refresh_token } = JSON.parse(backup);
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
      localStorage.removeItem(KEY);
      localStorage.removeItem(BACKUP_KEY);
      window.dispatchEvent(new CustomEvent('contndr:impersonation-changed'));
      toast.success('Restored admin session');
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message || 'Exit failed — try signing out manually');
    }
  };

  if (!target) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-zinc-900 px-4 py-2 flex items-center justify-between gap-3 shadow-lg">
      <div className="flex items-center gap-2 min-w-0">
        <ShieldAlert className="w-4 h-4 flex-shrink-0" />
        <span className="text-xs font-semibold whitespace-nowrap">Impersonating</span>
        <span className="text-xs truncate">{target.email}</span>
        <span className="text-xs opacity-70 hidden sm:inline">· acting as {target.admin_email}</span>
      </div>
      <button
        onClick={exit}
        className="flex items-center gap-1 px-3 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium transition-colors flex-shrink-0"
      >
        <X className="w-3 h-3" />
        Exit impersonation
      </button>
    </div>
  );
}

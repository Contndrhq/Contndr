import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { authenticatedFetch } from '../lib/auth';
import { LoadingSpinner } from './LoadingSpinner';

export function AcceptInviteHandler() {
  const processed = useRef(false);

  useEffect(() => {
    // Prevent double invocation
    if (processed.current) return;
    processed.current = true;

    const searchParams = new URLSearchParams(window.location.search);
    const token = searchParams.get('token');

    if (!token) {
      toast.error('Missing invitation token');
      window.history.replaceState({}, '', '/app');
      window.location.reload();
      return;
    }

    acceptInvite(token);
  }, []);

  async function acceptInvite(token: string) {
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/team/accept`,
        {
          method: 'POST',
          body: JSON.stringify({ token }),
        }
      );

      const data = await response.json();

      if (response.ok) {
        toast.success(data.message || 'Successfully joined team');
        // Redirect to dashboard and reload to refresh team/subscription state
        window.history.replaceState({}, '', '/app');
        window.location.reload();
      } else {
        toast.error(data.error || 'Failed to join team');
        window.history.replaceState({}, '', '/app');
        window.location.reload();
      }
    } catch (err) {
      console.error('Error accepting invite:', err);
      toast.error('Failed to join team');
      window.history.replaceState({}, '', '/app');
      window.location.reload();
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-white dark:bg-black">
      <LoadingSpinner size="lg" text="Joining team..." center />
    </div>
  );
}

export default AcceptInviteHandler;
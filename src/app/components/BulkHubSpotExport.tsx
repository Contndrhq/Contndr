import { useState } from 'react';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { toast } from 'sonner';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/hubspot`;

interface BulkLead {
  id: string;
  business_name?: string;
  email?: string;
  phone?: string;
  city?: string;
  [key: string]: any;
}

interface BulkExportToHubSpotProps {
  leads: BulkLead[];
}

export function BulkExportToHubSpot({ leads }: BulkExportToHubSpotProps) {
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ exported: number; updated: number; failed: number } | null>(null);

  async function handleBulkExport() {
    if (leads.length === 0) return;

    if (leads.length > 100) {
      toast.error('Maximum 100 leads per bulk export. Please select fewer leads.');
      return;
    }

    const confirmed = confirm(
      `Export ${leads.length} lead${leads.length > 1 ? 's' : ''} to HubSpot?\n\nExisting contacts will be updated, new ones will be created.`
    );
    if (!confirmed) return;

    try {
      setExporting(true);
      setResult(null);

      const mappedLeads = leads.map(l => ({
        first_name: l.contact_name?.split(' ')[0] || l.first_name || '',
        last_name: l.contact_name?.split(' ').slice(1).join(' ') || l.last_name || '',
        email: l.email || '',
        phone: l.phone || '',
        job_title: l.title || l.job_title || '',
        company_name: l.business_name || l.company_name || '',
      }));

      const res = await authenticatedFetch(`${API_BASE}/export/bulk`, {
        method: 'POST',
        body: JSON.stringify({ leads: mappedLeads }),
      });

      const data = await res.json();

      if (data.success) {
        setResult(data.results);
        const msg = [];
        if (data.results.exported > 0) msg.push(`${data.results.exported} created`);
        if (data.results.updated > 0) msg.push(`${data.results.updated} updated`);
        if (data.results.failed > 0) msg.push(`${data.results.failed} failed`);
        toast.success(`HubSpot export: ${msg.join(', ')}`);
      } else if (res.status === 401) {
        toast.error('HubSpot not connected. Go to Settings > Integrations to connect.');
      } else {
        throw new Error(data.error || 'Bulk export failed');
      }
    } catch (err: any) {
      console.error('[HUBSPOT] Bulk export error:', err);
      toast.error(err.message || 'Failed to export to HubSpot');
    } finally {
      setExporting(false);
    }
  }

  if (leads.length === 0) return null;

  return (
    <button
      onClick={handleBulkExport}
      disabled={exporting}
      className="flex items-center gap-2 px-4 py-2 text-[13px] border border-[#FF7A59]/30 bg-[#FF7A59]/10 text-[#FF7A59] rounded-full hover:bg-[#FF7A59]/20 transition-colors whitespace-nowrap disabled:opacity-50"
      title={result ? `${result.exported} created, ${result.updated} updated, ${result.failed} failed` : 'Export selected leads to HubSpot'}
    >
      {exporting ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
      ) : result ? (
        <CheckCircle className="w-3.5 h-3.5" strokeWidth={1.5} />
      ) : (
        <svg width="14" height="14" viewBox="0 0 512 512" fill="currentColor">
          <path d="M384.1 201.3V151c13.1-6.3 22.2-19.5 22.4-34.8v-1c-.2-21.2-17.3-38.3-38.5-38.5h-1c-15.3.2-28.5 9.3-34.8 22.4h-50.3c-6.3-13.1-19.5-22.2-34.8-22.4h-1c-21.2.2-38.3 17.3-38.5 38.5v1c.2 15.3 9.3 28.5 22.4 34.8v50.3c-53.1 13.6-92.4 62.3-92.4 119.7 0 68.1 55.2 123.3 123.3 123.3 57.4 0 106.1-39.3 119.7-92.4h50.3c6.3 13.1 19.5 22.2 34.8 22.4h1c21.2-.2 38.3-17.3 38.5-38.5v-1c-.2-15.3-9.3-28.5-22.4-34.8v-50.3c13.1-6.3 22.2-19.5 22.4-34.8v-1c-.2-21.2-17.3-38.3-38.5-38.5h-1c-15.3.2-28.5 9.3-34.8 22.4h-50.3zM260.6 399c-42.5 0-77-34.5-77-77s34.5-77 77-77 77 34.5 77 77-34.5 77-77 77z"/>
        </svg>
      )}
      <span className="hidden xs:inline">{exporting ? 'Exporting...' : result ? 'Exported' : 'HubSpot'}</span>
      <span className="xs:hidden">{exporting ? '...' : 'HS'}</span>
    </button>
  );
}
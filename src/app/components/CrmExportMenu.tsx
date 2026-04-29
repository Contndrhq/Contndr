import { useState, useRef, useEffect } from 'react';
import { Share2, Loader2, CheckCircle, ChevronDown } from 'lucide-react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { toast } from 'sonner';

const HUBSPOT_API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/hubspot`;
const SALESFORCE_API = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/salesforce`;

interface Lead {
  id: string;
  business_name?: string;
  company_name?: string;
  contact_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  title?: string;
  job_title?: string;
  city?: string;
  state?: string;
  country?: string;
  website?: string;
  [key: string]: any;
}

interface CrmExportMenuProps {
  leads: Lead[];
}

type ExportTarget = 'hubspot' | 'salesforce' | null;

export function CrmExportMenu({ leads }: CrmExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportTarget>(null);
  const [lastResult, setLastResult] = useState<{ target: ExportTarget; exported: number; updated: number; failed: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (leads.length === 0) return null;

  // ── HubSpot bulk export ──────────────────────────────
  async function exportToHubSpot() {
    if (leads.length > 100) {
      toast.error('Max 100 leads per HubSpot export.');
      return;
    }
    const confirmed = confirm(
      `Export ${leads.length} lead${leads.length > 1 ? 's' : ''} to HubSpot?\n\nExisting contacts will be updated, new ones created.`
    );
    if (!confirmed) return;

    try {
      setExporting('hubspot');
      setOpen(false);

      const mappedLeads = leads.map(l => ({
        first_name: l.contact_name?.split(' ')[0] || l.first_name || '',
        last_name: l.contact_name?.split(' ').slice(1).join(' ') || l.last_name || '',
        email: l.email || '',
        phone: l.phone || '',
        job_title: l.title || l.job_title || '',
        company_name: l.business_name || l.company_name || '',
      }));

      const res = await authenticatedFetch(`${HUBSPOT_API}/export/bulk`, {
        method: 'POST',
        body: JSON.stringify({ leads: mappedLeads }),
      });

      const data = await res.json();

      if (data.success) {
        setLastResult({ target: 'hubspot', ...data.results });
        const msg: string[] = [];
        if (data.results.exported > 0) msg.push(`${data.results.exported} created`);
        if (data.results.updated > 0) msg.push(`${data.results.updated} updated`);
        if (data.results.failed > 0) msg.push(`${data.results.failed} failed`);
        toast.success(`HubSpot export: ${msg.join(', ')}`);
      } else if (res.status === 401) {
        toast.error('HubSpot not connected. Go to Settings → Integrations to connect.');
      } else {
        throw new Error(data.error || 'Export failed');
      }
    } catch (err: any) {
      console.error('[HUBSPOT] Bulk export error:', err);
      toast.error(err.message || 'Failed to export to HubSpot');
    } finally {
      setExporting(null);
    }
  }

  // ── Salesforce bulk export ───────────────────────────
  async function exportToSalesforce() {
    if (leads.length > 50) {
      toast.error('Max 50 leads per Salesforce export.');
      return;
    }
    const confirmed = confirm(
      `Export ${leads.length} lead${leads.length > 1 ? 's' : ''} to Salesforce?\n\nExisting leads will be updated, new ones created.`
    );
    if (!confirmed) return;

    try {
      setExporting('salesforce');
      setOpen(false);

      let exported = 0, updated = 0, failed = 0;

      for (let i = 0; i < leads.length; i++) {
        const l = leads[i];
        try {
          const res = await authenticatedFetch(`${SALESFORCE_API}/export/lead`, {
            method: 'POST',
            body: JSON.stringify({
              first_name: l.contact_name?.split(' ')[0] || l.first_name || '',
              last_name: l.contact_name?.split(' ').slice(1).join(' ') || l.last_name || '',
              email: l.email || '',
              phone: l.phone || '',
              job_title: l.title || l.job_title || '',
              company_name: l.business_name || l.company_name || '',
              city: l.city || '',
              state: l.state || '',
              country: l.country || '',
              website: l.website || '',
            }),
          });
          if (res.status === 401) {
            toast.error('Salesforce not connected. Go to Settings → Integrations to connect.');
            break;
          }
          const data = await res.json();
          if (data.success) {
            if (data.action === 'created') exported++; else updated++;
          } else { failed++; }
        } catch { failed++; }

        if (i < leads.length - 1) await new Promise(r => setTimeout(r, 300));
      }

      setLastResult({ target: 'salesforce', exported, updated, failed });
      const msg: string[] = [];
      if (exported > 0) msg.push(`${exported} created`);
      if (updated > 0) msg.push(`${updated} updated`);
      if (failed > 0) msg.push(`${failed} failed`);
      toast.success(`Salesforce export: ${msg.join(', ')}`);
    } catch (err: any) {
      console.error('[SALESFORCE] Bulk export error:', err);
      toast.error(err.message || 'Failed to export to Salesforce');
    } finally {
      setExporting(null);
    }
  }

  const isExporting = exporting !== null;

  return (
    <div ref={menuRef} className="relative">
      {/* Trigger */}
      <button
        onClick={() => !isExporting && setOpen(!open)}
        disabled={isExporting}
        className="flex items-center gap-2 px-4 py-2 text-[13px] rounded-full border border-white/10 bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] hover:text-white transition-all whitespace-nowrap disabled:opacity-60"
      >
        {isExporting ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
        ) : (
          <Share2 className="w-3.5 h-3.5" strokeWidth={1.5} />
        )}
        <span className="hidden xs:inline">{isExporting ? 'Exporting…' : 'Export to CRM'}</span>
        <span className="xs:hidden">{isExporting ? '…' : 'CRM'}</span>
        {!isExporting && <ChevronDown className="w-3 h-3 opacity-50" strokeWidth={2} />}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-white/10 bg-[#111113] shadow-2xl shadow-black/60 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="px-4 pt-3 pb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Export {leads.length} lead{leads.length > 1 ? 's' : ''} to</p>
          </div>

          {/* HubSpot */}
          <button
            onClick={exportToHubSpot}
            className="w-full flex items-center gap-3.5 px-4 py-3 hover:bg-white/[0.04] transition-colors group"
          >
            <div className="w-9 h-9 rounded-lg bg-[#FF7A59]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#FF7A59]/15 transition-colors">
              <svg width="18" height="18" viewBox="0 0 31 32" fill="#FF7A59">
                <path d="M23.5121 10.5729V6.7809C24.0149 6.54599 24.4405 6.17299 24.7394 5.70539C25.0382 5.23779 25.198 4.69485 25.2001 4.1399V4.0509C25.198 3.27659 24.8894 2.53459 24.3419 1.98707C23.7944 1.43954 23.0524 1.13101 22.2781 1.1289H22.1891C21.414 1.12996 20.6708 1.43799 20.1223 1.9856C19.5738 2.53321 19.2645 3.27581 19.2621 4.0509V4.1399C19.265 4.6912 19.4235 5.23049 19.7193 5.69574C20.015 6.16099 20.4361 6.53331 20.9341 6.7699L20.9501 6.7799V10.5819C19.4993 10.8021 18.1332 11.4044 16.9921 12.3269L17.0081 12.3169L6.57007 4.1869C7.51307 0.665903 2.91907 -1.5891 0.711073 1.3119C-1.50293 4.2079 1.87807 8.0409 5.02907 6.2079L5.01307 6.2179L15.2731 14.2019C14.3662 15.5639 13.8842 17.1646 13.8881 18.8009C13.8881 20.5869 14.4561 22.2489 15.4191 23.6079L15.4031 23.5819L12.2781 26.7019C12.0281 26.6239 11.7681 26.5819 11.5071 26.5769H11.5021C9.09107 26.5769 7.87707 29.4989 9.58507 31.2069C11.2931 32.9099 14.2151 31.7019 14.2151 29.2899C14.2095 29.019 14.1641 28.7505 14.0801 28.4929L14.0851 28.5139L17.1741 25.4249C18.1818 26.1936 19.3514 26.7226 20.5941 26.9718C21.8368 27.221 23.1199 27.1837 24.3461 26.8629C25.5708 26.5403 26.7058 25.9428 27.6651 25.1158C28.6243 24.2889 29.3825 23.2542 29.882 22.0904C30.3815 20.9266 30.6093 19.6643 30.548 18.3993C30.4866 17.1343 30.1378 15.8999 29.5281 14.7899C28.9183 13.68 28.0632 12.724 27.0279 11.9948C25.9926 11.2655 24.8045 10.7823 23.5541 10.5819L23.5021 10.5719L23.5121 10.5729ZM22.2251 23.0779C18.4181 23.0679 16.5221 18.4629 19.2201 15.7759C21.9131 13.0879 26.5121 14.9949 26.5121 18.8019V18.8069C26.5121 19.3682 26.4014 19.924 26.1865 20.4425C25.9715 20.961 25.6565 21.4321 25.2594 21.8287C24.8622 22.2254 24.3908 22.5399 23.872 22.7542C23.3533 22.9686 22.7974 23.0786 22.2361 23.0779H22.2251Z" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-[13px] font-medium text-white group-hover:text-[#FF7A59] transition-colors">HubSpot</p>
              <p className="text-[11px] text-gray-500">Sync contacts & companies</p>
            </div>
            {lastResult?.target === 'hubspot' && (
              <CheckCircle className="w-4 h-4 text-[#1ED4A7] ml-auto flex-shrink-0" strokeWidth={1.5} />
            )}
          </button>

          {/* Divider */}
          <div className="mx-4 border-t border-white/[0.06]" />

          {/* Salesforce */}
          <button
            onClick={exportToSalesforce}
            className="w-full flex items-center gap-3.5 px-4 py-3 hover:bg-white/[0.04] transition-colors group"
          >
            <div className="w-9 h-9 rounded-lg bg-[#00A1E0]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#00A1E0]/15 transition-colors">
              <svg width="20" height="14" viewBox="0 0 30 21" fill="#00A1E0" xmlns="http://www.w3.org/2000/svg">
                <path d="M11.6666 10.0135H10.4315C10.4638 9.77164 10.5871 9.35167 11.0708 9.35167C11.3872 9.35167 11.6319 9.53072 11.6666 10.0135ZM18.0726 9.36292C18.0506 9.36292 17.4112 9.27996 17.4112 10.3003C17.4112 11.3207 18.0501 11.2378 18.0726 11.2378C18.682 11.2378 18.734 10.6031 18.734 10.3003C18.734 9.28043 18.0937 9.36292 18.0726 9.36292ZM6.6716 10.4766C6.62022 10.5169 6.57937 10.569 6.55251 10.6285C6.52566 10.688 6.5136 10.7531 6.51738 10.8183C6.51738 11.0423 6.61488 11.1018 6.6716 11.1487C6.89191 11.3221 7.37801 11.2481 7.6527 11.1932V10.3992C7.40332 10.3491 6.86847 10.3074 6.6716 10.4766ZM30 9.37417C30 13.4791 26.25 16.6106 22.2487 15.7688C21.3876 17.3155 18.9332 19.0849 16.0518 17.72C14.1224 22.2219 7.71317 22.0406 6.02941 17.4777C0.417502 18.5974 -2.35283 10.9922 2.50111 8.13725C0.872192 4.4143 3.56236 0 7.85942 0C8.75302 0.000554939 9.63452 0.206723 10.4357 0.602543C11.2368 0.998364 11.9361 1.57322 12.4794 2.28261C13.4498 1.27957 14.7951 0.651036 16.2834 0.651036C18.2681 0.651036 19.9865 1.75344 20.9146 3.39626C25.2656 1.48956 30 4.71943 30 9.37417ZM5.64597 10.8647C5.64597 10.3135 5.098 10.1536 4.80831 10.0599C4.56127 9.96099 4.17971 9.89538 4.17971 9.64087C4.17971 9.19747 4.97659 9.32871 5.35956 9.5415C5.35956 9.5415 5.4144 9.57478 5.43643 9.51947C5.44768 9.48666 5.54706 9.21106 5.55784 9.17778C5.56204 9.16466 5.56096 9.15042 5.55484 9.13809C5.54871 9.12575 5.53802 9.11628 5.52503 9.11169C4.94706 8.75407 3.61721 8.71282 3.61721 9.70695C3.61721 10.291 4.1558 10.4306 4.45534 10.5117C4.67659 10.5858 5.07268 10.6523 5.07268 10.9195C5.07268 11.107 4.90721 11.2504 4.64284 11.2504C4.32162 11.2499 4.0092 11.1455 3.75221 10.9528C3.73018 10.942 3.68564 10.9195 3.67486 10.9861L3.56236 11.3362C3.54033 11.3802 3.57314 11.3915 3.57314 11.4023C3.65518 11.4679 4.05596 11.7112 4.64284 11.7112C5.26018 11.7112 5.64597 11.3802 5.64597 10.8623V10.8647ZM7.14597 8.8689C6.67113 8.8689 6.27128 9.01748 6.14284 9.11169C6.13771 9.11525 6.13333 9.11979 6.12998 9.12506C6.12663 9.13033 6.12436 9.13621 6.12331 9.14237C6.12226 9.14853 6.12245 9.15483 6.12388 9.16091C6.1253 9.16699 6.12792 9.17273 6.13159 9.17778L6.253 9.50869C6.2563 9.52018 6.26386 9.52998 6.27414 9.53608C6.28442 9.54218 6.29665 9.54412 6.30831 9.5415C6.33878 9.5415 6.62707 9.35402 7.10191 9.35402C7.28941 9.35402 7.43285 9.38729 7.53223 9.46463C7.70098 9.59587 7.67566 9.85319 7.67566 9.96053C7.45113 9.94646 6.77988 9.79929 6.29706 10.1368C6.187 10.2122 6.09777 10.3143 6.03762 10.4334C5.97748 10.5525 5.94837 10.6849 5.953 10.8183C5.953 11.0948 6.02378 11.3057 6.26191 11.4909C6.83566 11.8733 7.96254 11.5846 8.04785 11.5569C8.12192 11.5419 8.21332 11.526 8.21332 11.4688V9.88085C8.2152 9.66477 8.22832 8.86656 7.14551 8.86656L7.14597 8.8689ZM9.32802 7.88555C9.3285 7.87817 9.3274 7.87076 9.32479 7.86383C9.32218 7.8569 9.31812 7.85061 9.31289 7.84537C9.30765 7.84014 9.30136 7.83608 9.29443 7.83347C9.2875 7.83086 9.28009 7.82976 9.2727 7.83025H8.81239C8.80504 7.82983 8.79768 7.83098 8.79081 7.83362C8.78394 7.83626 8.7777 7.84033 8.77252 7.84556C8.76734 7.85079 8.76332 7.85705 8.76074 7.86395C8.75816 7.87084 8.75707 7.87821 8.75755 7.88555V11.5884C8.75707 11.5957 8.75816 11.6031 8.76074 11.61C8.76332 11.6168 8.76734 11.6231 8.77252 11.6283C8.7777 11.6336 8.78394 11.6376 8.79081 11.6403C8.79768 11.6429 8.80504 11.6441 8.81239 11.6437H9.27552C9.28291 11.6441 9.29031 11.643 9.29724 11.6404C9.30417 11.6378 9.31046 11.6338 9.3157 11.6285C9.32094 11.6233 9.32499 11.617 9.3276 11.6101C9.33021 11.6031 9.33131 11.5957 9.33083 11.5884L9.32802 7.88555ZM11.9413 9.24153C11.8429 9.13326 11.623 8.88859 11.114 8.88859C10.9494 8.88859 10.4502 8.89937 10.1436 9.30761C9.84599 9.66524 9.83521 10.1564 9.83521 10.3111C9.83521 10.4574 9.84224 10.9795 10.1661 11.3034C10.2899 11.4398 10.5908 11.6891 11.2354 11.6891C11.7426 11.6891 12.0074 11.579 12.1063 11.5129C12.1283 11.5016 12.1396 11.4796 12.1176 11.4248L12.0074 11.1046C12.0018 11.0925 11.9921 11.0826 11.9801 11.0766C11.9681 11.0707 11.9544 11.069 11.9413 11.0718C11.8199 11.1159 11.6437 11.204 11.2246 11.204C10.408 11.204 10.4347 10.5131 10.4305 10.4213H12.1729C12.1856 10.421 12.1979 10.4165 12.2078 10.4086C12.2177 10.4006 12.2247 10.3896 12.2277 10.3772C12.2141 10.3772 12.3248 9.68821 11.9422 9.24153H11.9413ZM13.6612 11.7112C14.2785 11.7112 14.6648 11.3802 14.6648 10.8623C14.6648 10.3111 14.1163 10.1513 13.8266 10.0575C13.6326 9.97974 13.198 9.89913 13.198 9.63852C13.198 9.46229 13.3523 9.34089 13.5951 9.34089C13.8677 9.34637 14.1355 9.41419 14.3779 9.53916C14.3779 9.53916 14.4332 9.57244 14.4552 9.51713C14.466 9.48432 14.5654 9.20872 14.5762 9.17544C14.5804 9.16232 14.5793 9.14808 14.5732 9.13574C14.567 9.1234 14.5563 9.11394 14.5434 9.10935C14.1726 8.87968 13.7587 8.87781 13.5951 8.87781C13.0326 8.87781 12.636 9.2195 12.636 9.70461C12.636 10.2886 13.1741 10.4283 13.4737 10.5094C13.7601 10.6031 14.091 10.6622 14.091 10.9172C14.091 11.1046 13.926 11.2481 13.6612 11.2481C13.34 11.2474 13.0276 11.143 12.7705 10.9504C12.7639 10.9447 12.7558 10.941 12.7471 10.9397C12.7384 10.9384 12.7295 10.9395 12.7215 10.943C12.7134 10.9464 12.7065 10.9521 12.7015 10.9593C12.6965 10.9665 12.6936 10.975 12.6932 10.9837L12.583 11.3362C12.561 11.3802 12.5938 11.3915 12.5938 11.4023C12.6744 11.4679 13.078 11.7112 13.6621 11.7112H13.6612ZM16.7385 8.9992C16.7385 8.96593 16.7273 8.9439 16.6832 8.9439H16.132C16.132 8.93734 16.176 8.52487 16.3415 8.35942C16.5365 8.1649 16.8927 8.28255 16.904 8.28255C16.9588 8.30458 16.9701 8.28255 16.9809 8.26052L17.1135 7.89633C17.1463 7.85227 17.1135 7.84149 17.1023 7.83025C16.8637 7.7365 16.289 7.69573 15.9557 8.02898C15.6988 8.28583 15.6276 8.68142 15.5807 8.9439H15.1837C15.1694 8.94508 15.1561 8.95131 15.1461 8.96144C15.136 8.97158 15.1299 8.98497 15.1288 8.9992L15.0623 9.36292C15.0623 9.39573 15.0735 9.41776 15.1176 9.41776H15.5034C15.1045 11.6629 15.0932 11.7711 15.0182 12.02C14.9676 12.1897 14.864 12.3434 14.7426 12.3837C14.7384 12.3837 14.5607 12.4625 14.2907 12.3725C14.2907 12.3725 14.2466 12.3505 14.2246 12.4058C14.2134 12.4391 14.1032 12.7254 14.0919 12.7587C14.0807 12.792 14.0919 12.8248 14.114 12.8248C14.3535 12.9185 14.7234 12.9078 14.9521 12.8248C15.2465 12.7179 15.4077 12.455 15.4926 12.2183C15.6215 11.8569 15.6243 11.7594 16.0438 9.41823H16.6171C16.6314 9.41706 16.6448 9.41085 16.6549 9.40072C16.6651 9.39059 16.6713 9.3772 16.6724 9.36292L16.7385 8.9992ZM19.2412 9.74914C19.2149 9.6704 19.0021 8.90031 18.0613 8.90031C17.3465 8.90031 16.9832 9.36902 16.882 9.74914C16.8351 9.88975 16.7329 10.4053 16.882 10.8515C16.8862 10.8656 17.0887 11.7008 18.0613 11.7008C18.7621 11.7008 19.1348 11.2504 19.2412 10.8515C19.3917 10.4011 19.2885 9.88975 19.2412 9.74914ZM21.3693 8.9664C21.135 8.88906 20.5903 8.87734 20.3329 9.21997V9.01045C20.3333 9.0031 20.3322 8.99575 20.3295 8.98888C20.3269 8.98201 20.3228 8.97577 20.3176 8.97059C20.3124 8.9654 20.3061 8.96139 20.2992 8.95881C20.2923 8.95623 20.285 8.95514 20.2776 8.95562H19.837C19.8296 8.95514 19.8223 8.95623 19.8154 8.95881C19.8085 8.96139 19.8022 8.9654 19.797 8.97059C19.7918 8.97577 19.7877 8.98201 19.785 8.98888C19.7824 8.99575 19.7813 9.0031 19.7817 9.01045V11.6015C19.7813 11.6088 19.7824 11.6162 19.785 11.6231C19.7877 11.63 19.7917 11.6363 19.797 11.6415C19.8022 11.6467 19.8084 11.6508 19.8153 11.6534C19.8222 11.656 19.8296 11.6572 19.837 11.6568H20.2889C20.2962 11.6572 20.3036 11.656 20.3105 11.6534C20.3174 11.6508 20.3237 11.6467 20.3289 11.6415C20.3341 11.6363 20.3382 11.63 20.3408 11.6231C20.3434 11.6162 20.3446 11.6088 20.3442 11.6015V10.2999C20.3442 10.1635 20.3465 9.76695 20.5532 9.59446C20.7829 9.3648 21.1157 9.43698 21.1818 9.45104C21.1959 9.45079 21.2096 9.4465 21.2213 9.43869C21.233 9.43088 21.2423 9.41988 21.2479 9.40698C21.3029 9.28487 21.3508 9.15967 21.3914 9.03201C21.396 9.02016 21.3963 9.00706 21.3923 8.99498C21.3883 8.9829 21.3802 8.97262 21.3693 8.96593V8.9664ZM23.5636 11.5021L23.4642 11.1604C23.4422 11.1051 23.3981 11.1271 23.3981 11.1271C23.1998 11.2124 22.9223 11.2157 22.8689 11.2157C22.6514 11.2157 22.064 11.1628 22.064 10.2896C22.064 9.99755 22.1507 9.36339 22.8361 9.36339C23.0191 9.35872 23.2017 9.38487 23.3761 9.44073C23.3761 9.44073 23.4201 9.46276 23.4314 9.40745C23.4754 9.28605 23.5082 9.19794 23.5528 9.05451C23.5636 9.01045 23.5307 8.99967 23.5195 8.99967C22.9762 8.81828 22.4723 8.88109 22.2182 8.99967C22.1437 9.03436 21.4575 9.30387 21.4575 10.2896C21.4575 10.4255 21.4303 11.7008 22.814 11.7008C23.0625 11.7004 23.3089 11.6554 23.5415 11.5682C23.5516 11.5607 23.5591 11.5503 23.5631 11.5384C23.567 11.5265 23.5672 11.5137 23.5636 11.5016V11.5021ZM26.0887 9.64977C26.0512 9.50916 25.837 8.88906 25.0411 8.88906C24.2911 8.88906 23.9386 9.36292 23.8392 9.76039C23.7851 9.93903 23.759 10.125 23.7618 10.3116C23.7618 11.5241 24.645 11.6896 25.1625 11.6896C25.6697 11.6896 25.934 11.5794 26.0334 11.5134C26.0554 11.5021 26.0667 11.4801 26.0447 11.4252L25.934 11.1051C25.9284 11.093 25.9188 11.0831 25.9068 11.0771C25.8947 11.0712 25.8811 11.0695 25.8679 11.0723C25.7465 11.1164 25.5703 11.2045 25.1512 11.2045C24.3347 11.2045 24.3614 10.5136 24.3576 10.4217H26.0995C26.1123 10.4214 26.1246 10.4169 26.1346 10.409C26.1445 10.401 26.1517 10.39 26.1548 10.3777C26.1436 10.3772 26.1989 10.0463 26.0887 9.6493V9.64977ZM24.997 9.35214C24.5128 9.35214 24.3876 9.77398 24.3576 10.014H25.5937C25.5525 9.45526 25.2365 9.35167 24.997 9.35167V9.35214Z" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-[13px] font-medium text-white group-hover:text-[#00A1E0] transition-colors">Salesforce</p>
              <p className="text-[11px] text-gray-500">Push leads & opportunities</p>
            </div>
            {lastResult?.target === 'salesforce' && (
              <CheckCircle className="w-4 h-4 text-[#1ED4A7] ml-auto flex-shrink-0" strokeWidth={1.5} />
            )}
          </button>

          <div className="h-1.5" />
        </div>
      )}
    </div>
  );
}
import { useState, useRef, useEffect, useCallback } from 'react';
import { X, AlertCircle, Check, ChevronRight, ChevronLeft, FileDown, FileSpreadsheet, Sparkles, Upload, AlertTriangle, Info, Loader2, CheckCircle2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { parseCSV } from '../../utils/csv-parser';
import { useTranslation } from 'react-i18next';
import { useIsMobile } from '../ui/use-mobile';
import { MobileFilterSheet } from '../ui/mobile-filter-sheet';

interface ImportProgress {
  discovered: number;
  imported: number;
  duplicates: number;
  message?: string;
}

interface CSVImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (leads: any[], fileName?: string) => Promise<void>;
  isImporting: boolean;
  importProgress?: ImportProgress | null;
}

// ---------- Contndr system fields ----------
const SYSTEM_FIELDS = [
  { key: 'business_name', label: 'Company Name', required: true },
  { key: 'contact_name', label: 'Contact Name', required: false },
  { key: 'email', label: 'Email Address', required: false },
  { key: 'phone', label: 'Phone Number', required: false },
  { key: 'job_title', label: 'Job Title', required: false },
  { key: 'website', label: 'Website', required: false },
  { key: 'linkedin', label: 'LinkedIn URL', required: false },
  { key: 'address', label: 'Address', required: false },
  { key: 'city', label: 'City', required: false },
  { key: 'state', label: 'State', required: false },
  { key: 'country', label: 'Country', required: false },
  { key: 'industry', label: 'Industry', required: false },
  { key: 'category', label: 'Category', required: false },
  { key: 'employees', label: 'Employees', required: false },
  { key: 'keywords', label: 'Keywords', required: false },
  { key: 'notes', label: 'Notes', required: false },
];

// ---------- Known CSV source signatures ----------
type DetectedSource = 'apollo' | 'hubspot' | 'salesforce' | 'linkedin' | 'generic';

const SOURCE_META: Record<DetectedSource, { label: string; color: string }> = {
  apollo:      { label: 'B2B Export',   color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  hubspot:     { label: 'HubSpot',     color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  salesforce:  { label: 'Salesforce',  color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  linkedin:    { label: 'LinkedIn',    color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  generic:     { label: 'CSV',         color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
};

function detectSource(headerLine: string): DetectedSource {
  const h = headerLine.toLowerCase();
  if (['apollo contact id', 'apollo account id', 'work direct phone', 'company name for emails'].some(s => h.includes(s))) return 'apollo';
  if (['hubspot', 'hs_object_id', 'associated company', 'lifecycle stage'].some(s => h.includes(s))) return 'hubspot';
  if (['salesforce', 'account id', 'opportunity', 'lead source'].some(s => h.includes(s))) return 'salesforce';
  if (['connection on', 'connected on', 'invitation sent on', 'profile url'].some(s => h.includes(s))) return 'linkedin';
  return 'generic';
}

// ---------- Inline sample template generator ----------
function downloadSampleTemplate() {
  const headers = [
    'Company Name', 'Contact Name', 'Email', 'Phone', 'Job Title',
    'Website', 'LinkedIn URL', 'Address', 'City', 'State', 'Country',
    'Industry', 'Category', 'Employees', 'Keywords', 'Notes'
  ];
  const sampleRows = [
    ['Acme Corp', 'John Smith', 'john@acme.com', '(555) 100-2000', 'CEO', 'www.acme.com', 'linkedin.com/in/jsmith', '123 Main St', 'New York', 'NY', 'US', 'Technology', 'SaaS', '50-200', 'software, cloud', 'Decision maker'],
    ['Bright Solutions', 'Sarah Lee', 'sarah@brightsolutions.io', '(555) 300-4000', 'VP Marketing', 'brightsolutions.io', '', '456 Oak Ave', 'Austin', 'TX', 'US', 'Marketing', 'Agency', '10-50', 'branding, digital', 'Met at conference'],
    ['Global Trade LLC', 'Mike Chen', 'mike@globaltrade.com', '', 'Director', 'globaltrade.com', '', '', 'Miami', 'FL', 'US', 'Logistics', 'Import/Export', '200-500', '', ''],
  ];

  const escape = (v: string) => (v.includes(',') || v.includes('"')) ? `"${v.replace(/"/g, '""')}"` : v;
  const csv = [headers.join(','), ...sampleRows.map(r => r.map(escape).join(','))].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'contndr-sample-leads.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Deduplicate parsed leads ----------
function deduplicateLeads(leads: any[]): { unique: any[]; dupeCount: number } {
  const seen = new Map<string, boolean>();
  const unique: any[] = [];
  let dupeCount = 0;

  for (const lead of leads) {
    let key = '';
    if (lead.email?.trim()) {
      key = `e:${lead.email.toLowerCase().trim()}`;
    } else if (lead.phone?.trim()) {
      key = `p:${lead.phone.trim()}`;
    } else {
      const biz = (lead.business_name || '').toLowerCase().trim();
      const con = (lead.contact_name || '').toLowerCase().trim();
      key = biz || con ? `n:${biz}:${con}` : `raw:${JSON.stringify(lead)}`;
    }

    if (seen.has(key)) {
      dupeCount++;
    } else {
      seen.set(key, true);
      unique.push(lead);
    }
  }
  return { unique, dupeCount };
}

// ---------- Parse CSV line respecting quotes ----------
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if ((c === ',' || c === '\t') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

// ---------- Auto-map CSV headers to system fields ----------
function autoMapHeaders(csvHeaders: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};

  // Priority-ordered rules. First match wins for each system field.
  const rules: Array<{ systemKey: string; test: (h: string) => boolean }> = [
    // Email
    { systemKey: 'email', test: h => h.includes('email') || h.includes('e-mail') || h === 'mail' },
    // Phone
    { systemKey: 'phone', test: h => h.includes('phone') || h.includes('mobile') || h.includes('tel') || h.includes('cell') },
    // Company
    { systemKey: 'business_name', test: h => h.includes('company') || h.includes('business') || h.includes('organization') || h.includes('organisation') || h.includes('account name') || h.includes('firm') },
    // Contact name
    { systemKey: 'contact_name', test: h => h.includes('contact') || h.includes('full name') || h.includes('person') || (h.includes('first') && h.includes('name')) },
    // Job title
    { systemKey: 'job_title', test: h => h.includes('title') || h.includes('role') || h.includes('position') || h.includes('job') || h.includes('designation') },
    // Website
    { systemKey: 'website', test: h => h.includes('website') || h.includes('web') || h.includes('url') || h.includes('domain') || h.includes('site') },
    // LinkedIn
    { systemKey: 'linkedin', test: h => h.includes('linkedin') },
    // Address
    { systemKey: 'address', test: h => (h.includes('address') && !h.includes('email')) || h.includes('street') || h.includes('location') },
    // City
    { systemKey: 'city', test: h => h.includes('city') || h.includes('town') || h.includes('municipality') },
    // State
    { systemKey: 'state', test: h => h.includes('state') || h.includes('province') || h.includes('region') },
    // Country
    { systemKey: 'country', test: h => h.includes('country') || h.includes('nation') },
    // Industry
    { systemKey: 'industry', test: h => h.includes('industry') || h.includes('sector') || h.includes('vertical') },
    // Category
    { systemKey: 'category', test: h => h.includes('category') || h.includes('type') || h.includes('segment') },
    // Employees
    { systemKey: 'employees', test: h => h.includes('employee') || h.includes('headcount') || h.includes('staff') || h.includes('size') },
    // Keywords
    { systemKey: 'keywords', test: h => h.includes('keyword') || h.includes('tag') },
    // Notes
    { systemKey: 'notes', test: h => h.includes('note') || h.includes('comment') || h.includes('description') },
  ];

  for (const header of csvHeaders) {
    const lower = header.toLowerCase().trim();
    for (const rule of rules) {
      if (!mapping[rule.systemKey] && rule.test(lower)) {
        mapping[rule.systemKey] = header;
        break;
      }
    }
  }

  // Fallback: bare "name" -> business_name (if nothing mapped yet)
  if (!mapping['business_name'] && !mapping['contact_name']) {
    const nameHeader = csvHeaders.find(h => h.toLowerCase().trim() === 'name');
    if (nameHeader) mapping['business_name'] = nameHeader;
  }

  return mapping;
}

// =====================================================================
// COMPONENT
// =====================================================================
export function CSVImportModal({ isOpen, onClose, onImport, isImporting, importProgress }: CSVImportModalProps) {
  const [step, setStep] = useState<'upload' | 'map' | 'preview'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [onlyImportWithEmail, setOnlyImportWithEmail] = useState(false);
  const [detectedSource, setDetectedSource] = useState<DetectedSource>('generic');
  const [dupeCount, setDupeCount] = useState(0);
  const [useSmartParse, setUseSmartParse] = useState(false); // for Apollo/HubSpot etc.
  const [smartParsedLeads, setSmartParsedLeads] = useState<any[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStartTime, setImportStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // Track elapsed time when importing
  useEffect(() => {
    if (isImporting && !importStartTime) {
      setImportStartTime(Date.now());
      setElapsed(0);
    }
    if (!isImporting && importStartTime) {
      setImportStartTime(null);
    }
  }, [isImporting]);

  useEffect(() => {
    if (!isImporting || !importStartTime) return;
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - importStartTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isImporting, importStartTime]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setStep('upload');
      setFile(null);
      setCsvHeaders([]);
      setCsvData([]);
      setColumnMapping({});
      setPreviewData([]);
      setDupeCount(0);
      setUseSmartParse(false);
      setSmartParsedLeads([]);
      setDetectedSource('generic');
      setParseError(null);
      setOnlyImportWithEmail(false);
    }
  }, [isOpen]);

  // ---- File processing ----
  const processFile = useCallback((f: File) => {
    setFile(f);
    setParseError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let text = e.target?.result as string;
        if (!text || text.trim().length === 0) {
          setParseError('The file is empty.');
          return;
        }

        // Normalise line endings
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
          setParseError('The file needs at least a header row and one data row.');
          return;
        }

        const source = detectSource(lines[0]);
        setDetectedSource(source);

        // For known sources, try the smart parser first
        if (source !== 'generic') {
          try {
            const smartParsed = parseCSV(text);
            if (smartParsed.length > 0) {
              const { unique, dupeCount: dc } = deduplicateLeads(smartParsed);
              setSmartParsedLeads(unique);
              setDupeCount(dc);
              setUseSmartParse(true);
              // Also parse raw for manual mapping fallback
              parseRawCSV(lines);
              setStep('preview');
              return;
            }
          } catch (err) {
            console.warn('Smart parser failed, falling back to manual mapping:', err);
          }
        }

        // Generic path: manual column mapping
        setUseSmartParse(false);
        parseRawCSV(lines);
        setStep('map');
      } catch (err: any) {
        console.error('CSV parse error:', err);
        setParseError(err.message || 'Failed to parse the file. Please check the format.');
      }
    };
    reader.onerror = () => setParseError('Could not read the file.');
    reader.readAsText(f);
  }, []);

  const parseRawCSV = (lines: string[]) => {
    const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
    setCsvHeaders(headers);
    const rows = lines.slice(1).map(line => parseCSVLine(line));
    setCsvData(rows);
    setColumnMapping(autoMapHeaders(headers));
  };

  // ---- Drag & drop handlers ----
  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && (f.name.endsWith('.csv') || f.name.endsWith('.tsv') || f.name.endsWith('.txt') || f.type.includes('csv') || f.type.includes('tab-separated') || f.type === 'text/plain')) {
      processFile(f);
    } else {
      toast.error('Unsupported file type', { description: 'Please upload a .csv or .tsv file.' });
    }
  }, [processFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  };

  // ---- Column mapping ----
  const updateMapping = (systemField: string, csvHeader: string) => {
    setColumnMapping(prev => ({ ...prev, [systemField]: csvHeader }));
  };

  // ---- Generate preview from manual mapping ----
  const generatePreview = () => {
    const mapped = csvData.map(row => {
      const lead: any = {};
      Object.entries(columnMapping).forEach(([sysKey, csvH]) => {
        if (!csvH) return;
        const idx = csvHeaders.indexOf(csvH);
        if (idx !== -1 && row[idx]) lead[sysKey] = row[idx];
      });
      return lead;
    }).filter(l => l.business_name || l.email || l.contact_name);

    const { unique, dupeCount: dc } = deduplicateLeads(mapped);
    setPreviewData(unique);
    setDupeCount(dc);
    setStep('preview');
  };

  // ---- Switch between smart-parsed and manual mapping in preview ----
  const switchToManualMapping = () => {
    setUseSmartParse(false);
    setStep('map');
  };

  // ---- Final import ----
  const handleImport = async () => {
    let leads = useSmartParse ? smartParsedLeads : previewData;
    if (onlyImportWithEmail) {
      leads = leads.filter(l => l.email?.trim());
    }
    if (leads.length === 0) {
      toast.error('No leads to import');
      return;
    }
    await onImport(leads, file?.name);
  };

  // ---- Counts ----
  const currentLeads = useSmartParse ? smartParsedLeads : previewData;
  const leadsWithEmail = currentLeads.filter(l => l.email?.trim()).length;
  const leadsWithPhone = currentLeads.filter(l => l.phone?.trim()).length;
  const importCount = onlyImportWithEmail ? leadsWithEmail : currentLeads.length;

  if (!isOpen) return null;

  const srcMeta = SOURCE_META[detectedSource];

  const modalContent = (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">

      {/* ═══ IMPORT PROGRESS OVERLAY ═══ */}
          {isImporting && importProgress && (() => {
            const total = importProgress.discovered;
            const done = importProgress.imported + importProgress.duplicates;
            const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
            const isComplete = importProgress.message?.toLowerCase().includes('success');
            
            // Estimate remaining time
            const rate = elapsed > 0 ? done / elapsed : 0;
            const remaining = rate > 0 ? Math.ceil((total - done) / rate) : 0;
            const formatTime = (s: number) => {
              if (s < 60) return `${s}s`;
              const m = Math.floor(s / 60);
              const sec = s % 60;
              return `${m}m ${sec}s`;
            };

            // Batch info from message
            const batchMatch = importProgress.message?.match(/batch (\d+)\/(\d+)/i);
            const currentBatch = batchMatch ? parseInt(batchMatch[1]) : null;
            const totalBatches = batchMatch ? parseInt(batchMatch[2]) : null;

            return (
              <div className="flex flex-col items-center justify-center py-10 space-y-8 min-h-[320px]">
                {/* Circular progress */}
                <div className="relative w-32 h-32">
                  <svg className="w-32 h-32 -rotate-90" viewBox="0 0 128 128">
                    {/* Track */}
                    <circle cx="64" cy="64" r="56" fill="none" strokeWidth="6"
                      className="text-zinc-100 dark:text-zinc-800" stroke="currentColor" />
                    {/* Progress arc */}
                    <circle cx="64" cy="64" r="56" fill="none" strokeWidth="6"
                      className={isComplete ? 'text-emerald-500' : 'text-zinc-900 dark:text-white'}
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeDasharray={`${(pct / 100) * 351.86} 351.86`}
                      style={{ transition: 'stroke-dasharray 0.6s ease' }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    {isComplete ? (
                      <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    ) : (
                      <>
                        <span className="text-2xl font-bold text-zinc-900 dark:text-white tabular-nums">{pct}%</span>
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">{done}/{total}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Status text */}
                <div className="text-center space-y-1.5 max-w-sm">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                    {isComplete ? t('leadImport.importCompleteLabel') : t('leadImport.importingLeads')}
                  </p>
                  {importProgress.message && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {importProgress.message}
                    </p>
                  )}
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-6">
                  <div className="flex flex-col items-center">
                    <span className="text-lg font-bold text-zinc-900 dark:text-white tabular-nums">{importProgress.imported.toLocaleString()}</span>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-medium">{t('leadImport.imported')}</span>
                  </div>
                  {importProgress.duplicates > 0 && (
                    <div className="flex flex-col items-center">
                      <span className="text-lg font-bold text-amber-600 dark:text-amber-400 tabular-nums">{importProgress.duplicates.toLocaleString()}</span>
                      <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-medium">{t('leadImport.duplicates')}</span>
                    </div>
                  )}
                  <div className="flex flex-col items-center">
                    <span className="text-lg font-bold text-zinc-900 dark:text-white tabular-nums">{total.toLocaleString()}</span>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-medium">{t('leadImport.total')}</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full max-w-xs space-y-2">
                  <div className="relative h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${isComplete ? 'bg-emerald-500' : 'bg-zinc-900 dark:bg-white'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                    <span>
                      {currentBatch && totalBatches
                        ? t('leadImport.batchOf', { current: currentBatch, total: totalBatches })
                        : t('leadImport.ofLeads', { done, total })}
                    </span>
                    <span>
                      {isComplete
                        ? t('leadImport.doneIn', { time: formatTime(elapsed) })
                        : elapsed > 2 && remaining > 0
                        ? t('leadImport.timeLeft', { time: formatTime(remaining) })
                        : t('leadImport.timeElapsed', { time: formatTime(elapsed) })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ═══ Normal step content (hidden during import) ═══ */}
          {!(isImporting && importProgress) && (
            <>
          {/* STEP 1 — UPLOAD */}
          {step === 'upload' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-6">
              {/* Drop zone */}
              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={`w-full max-w-lg border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer relative ${
                  isDragging
                    ? 'border-zinc-900 dark:border-zinc-300 bg-zinc-50 dark:bg-zinc-900 scale-[1.01]'
                    : 'border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500'
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className={`w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center ${isDragging ? 'bg-zinc-200 dark:bg-zinc-700' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
                  <Upload className={`w-7 h-7 ${isDragging ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'}`} />
                </div>
                <p className="text-sm font-medium text-zinc-900 dark:text-white mb-1">
                  {isDragging ? t('leadImport.dropFileHere') : t('leadImport.dragDropOrClick')}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t('leadImport.fileTypes')}
                </p>
              </div>

              {parseError && (
                <div className="flex items-start gap-2 px-4 py-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30 rounded-lg max-w-lg w-full">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-300">{parseError}</p>
                </div>
              )}

              {/* Compatible sources */}
              <div className="max-w-lg w-full space-y-4">
                <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="font-medium">{t('leadImport.autoDetects')}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {['B2B Databases', 'HubSpot', 'Salesforce', 'LinkedIn', 'Google Sheets', 'Excel', 'Airtable', 'Pipedrive', 'Zoho', 'Any CSV'].map(name => (
                    <span key={name} className="px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-md text-xs font-medium">{name}</span>
                  ))}
                </div>

                <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <button
                    onClick={(e) => { e.stopPropagation(); downloadSampleTemplate(); }}
                    className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white font-medium transition-colors"
                  >
                    <FileDown className="w-4 h-4" />
                    {t('leadImport.downloadSampleTemplate')}
                  </button>
                  <span className="text-xs text-zinc-400">{t('leadImport.needHelp')}</span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2 — MAP COLUMNS */}
          {step === 'map' && (
            <div className="space-y-6">
              {/* Source badge & file info */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${srcMeta.color}`}>{srcMeta.label}</span>
                  {file && (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {file.name} &middot; {csvData.length.toLocaleString()} rows &middot; {csvHeaders.length} columns
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { setStep('upload'); setFile(null); setParseError(null); }}
                  className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white font-medium transition-colors"
                >
                  {t('leadImport.chooseDifferentFile')}
                </button>
              </div>

              <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3.5 rounded-xl flex items-start gap-3">
                <Info className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {t('leadImport.autoMatchedInfo')} <strong>{t('leadImport.companyNameRequired')}</strong> {t('leadImport.isRequired')}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {SYSTEM_FIELDS.map((field) => {
                  const mappedHeader = columnMapping[field.key];
                  const previewVal = mappedHeader ? csvData[0]?.[csvHeaders.indexOf(mappedHeader)] : null;
                  return (
                    <div key={field.key} className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                        {field.label}
                        {field.required && <span className="text-red-500">*</span>}
                        {mappedHeader && <Check className="w-3 h-3 text-emerald-500 ml-auto" />}
                      </label>
                      <select
                        value={mappedHeader || ''}
                        onChange={(e) => updateMapping(field.key, e.target.value)}
                        className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400/40 transition-all ${
                          mappedHeader
                            ? 'bg-white dark:bg-zinc-800 border-zinc-400 dark:border-zinc-600 text-zinc-900 dark:text-white'
                            : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-400'
                        }`}
                      >
                        <option value="">{t('leadImport.skipOption')}</option>
                        {csvHeaders.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                      {previewVal && (
                        <p className="text-[11px] text-zinc-500 truncate px-0.5">
                          {t('leadImport.eg')} <span className="text-zinc-700 dark:text-zinc-300 font-medium">{previewVal}</span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3 — PREVIEW */}
          {step === 'preview' && (
            <div className="space-y-5">
              {/* Stats bar */}
              <div className="flex flex-wrap items-center gap-3">
                <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${srcMeta.color}`}>{srcMeta.label}</span>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-zinc-900 dark:text-white font-semibold">{currentLeads.length.toLocaleString()} {t('leadImport.leads')}</span>
                  <span className="text-zinc-500">{leadsWithEmail.toLocaleString()} {t('leadImport.withEmail')}</span>
                  <span className="text-zinc-500">{leadsWithPhone.toLocaleString()} {t('leadImport.withPhone')}</span>
                </div>
                {dupeCount > 0 && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 px-2 py-1 rounded-md">
                    <AlertTriangle className="w-3 h-3" /> {t('leadImport.duplicatesRemoved', { count: dupeCount })}
                  </span>
                )}
              </div>

              {/* Smart parse info */}
              {useSmartParse && (
                <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30 p-3 rounded-xl flex items-start gap-3">
                  <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-emerald-700 dark:text-emerald-300">
                      <strong>{t('leadImport.formatDetected', { format: srcMeta.label })}</strong> &mdash; {t('leadImport.allFieldsAutoMapped')}
                    </p>
                    <button onClick={switchToManualMapping} className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline mt-1 font-medium">
                      {t('leadImport.switchToManual')}
                    </button>
                  </div>
                </div>
              )}

              {/* Email filter */}
              <label className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-lg cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                <input
                  type="checkbox"
                  checked={onlyImportWithEmail}
                  onChange={(e) => setOnlyImportWithEmail(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 accent-zinc-900 dark:accent-white"
                />
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">{t('leadImport.onlyWithEmail')}</p>
                  <p className="text-xs text-zinc-500">
                    {onlyImportWithEmail
                      ? t('leadImport.leadsHaveEmail', { withEmail: leadsWithEmail.toLocaleString(), total: currentLeads.length.toLocaleString() })
                      : t('leadImport.allLeadsWillImport', { count: currentLeads.length.toLocaleString() })}
                  </p>
                </div>
              </label>

              {/* Preview table */}
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden max-h-[350px] overflow-y-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-zinc-50 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400 sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-2.5 font-medium text-xs">#</th>
                      <th className="px-4 py-2.5 font-medium text-xs">{t('leadImport.fieldCompanyName')}</th>
                      <th className="px-4 py-2.5 font-medium text-xs">{t('leadImport.fieldContactName')}</th>
                      <th className="px-4 py-2.5 font-medium text-xs">{t('leadImport.fieldEmail')}</th>
                      <th className="px-4 py-2.5 font-medium text-xs">{t('leadImport.fieldPhone')}</th>
                      <th className="px-4 py-2.5 font-medium text-xs">{t('leadImport.fieldCity')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {currentLeads.slice(0, 100).map((lead, i) => (
                      <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                        <td className="px-4 py-2 text-zinc-400 text-xs">{i + 1}</td>
                        <td className="px-4 py-2 text-zinc-900 dark:text-white font-medium truncate max-w-[180px]">{lead.business_name || <span className="text-zinc-400 italic">{t('leadImport.na')}</span>}</td>
                        <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400 truncate max-w-[150px]">{lead.contact_name || '-'}</td>
                        <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400 truncate max-w-[180px]">{lead.email || <span className="text-red-400 text-xs">{t('leadImport.missing')}</span>}</td>
                        <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400 truncate max-w-[120px]">{lead.phone || '-'}</td>
                        <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400 truncate max-w-[100px]">{lead.city || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {currentLeads.length > 100 && (
                  <div className="p-2.5 text-center text-xs text-zinc-500 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800">
                    {t('leadImport.showingOf', { count: currentLeads.length.toLocaleString() })}
                  </div>
                )}
              </div>
            </div>
          )}
            </>
          )}
        </div>
  );

  const footerContent = (
    <div className="flex items-center justify-between w-full">
      {isImporting && importProgress ? (
        <>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
            {importProgress.message || t('leadImport.processing')}
          </p>
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="w-3 h-3 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
            {t('leadImport.doNotClose')}
          </div>
        </>
      ) : (
        <>
          {step === 'upload' ? (
            <button onClick={onClose} className="px-5 py-2.5 font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors text-sm">
              {t('leadImport.cancel')}
            </button>
          ) : (
            <button
              onClick={() => {
                if (step === 'preview' && !useSmartParse) setStep('map');
                else if (step === 'preview' && useSmartParse) setStep('upload');
                else setStep('upload');
              }}
              className="flex items-center gap-1.5 px-5 py-2.5 font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors text-sm"
            >
              <ChevronLeft className="w-4 h-4" /> {t('leadImport.back')}
            </button>
          )}

          {step === 'upload' && <div />}

          {step === 'map' && (
            <button
              onClick={generatePreview}
              disabled={!columnMapping['business_name'] && !columnMapping['email']}
              className="flex items-center gap-2 px-7 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('leadImport.nextPreview')} <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {step === 'preview' && (
            <button
              onClick={handleImport}
              disabled={isImporting || importCount === 0}
              className="flex items-center gap-2 px-7 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl font-bold text-sm hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-zinc-900/10 dark:shadow-white/10"
            >
              {isImporting ? (
                <>
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  {t('leadImport.importing')}
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  {t('leadImport.importCountLeads', { count: importCount.toLocaleString() })}
                </>
              )}
            </button>
          )}
        </>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <MobileFilterSheet
        isOpen={isOpen}
        onClose={onClose}
        title={t('leadImport.title')}
        footerActions={footerContent}
        size="large"
      >
        {modalContent}
      </MobileFilterSheet>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl bg-white dark:bg-[#111] border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

        {/* ─── Header ─── */}
        <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{t('leadImport.title')}</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {step === 'upload' && t('leadImport.uploadDescription')}
                {step === 'map' && t('leadImport.mapDescription')}
                {step === 'preview' && t('leadImport.previewDescription')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Step indicator */}
            <div className="hidden sm:flex items-center gap-1 text-xs">
              {[t('leadImport.stepUpload'), t('leadImport.stepMap'), t('leadImport.stepImport')].map((s, i) => {
                const stepIdx = step === 'upload' ? 0 : step === 'map' ? 1 : 2;
                const completed = i < stepIdx;
                const current = i === stepIdx;
                return (
                  <span key={s} className="flex items-center gap-1">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      completed ? 'bg-emerald-500 text-white' : current ? 'bg-zinc-900 dark:bg-white text-white dark:text-black' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500'
                    }`}>
                      {completed ? <Check className="w-3 h-3" /> : i + 1}
                    </span>
                    <span className={`${completed || current ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'} font-medium`}>{s}</span>
                    {i < 2 && <ChevronRight className="w-3 h-3 text-zinc-300 dark:text-zinc-600 mx-0.5" />}
                  </span>
                );
              })}
            </div>
            <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/10 rounded-lg transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ─── Content ─── */}
        {modalContent}

        {/* ─── Footer ─── */}
        <div className="p-5 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          {footerContent}
        </div>
      </div>
    </div>
  );
}
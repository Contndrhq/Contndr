import { createContext, useContext, useState, useRef, useCallback, type ReactNode } from 'react';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { apiCache } from '../lib/api-cache';
import { toast } from 'sonner';

// ── Types ──

export interface ImportBatchLogEntry {
  id: string;
  batchIndex: number;
  size: number;
  imported: number;
  duplicates: number;
  error?: string;
  timestamp: number;
}

interface ImportBroadcastState {
  active: boolean;
  fileName: string;
  total: number;
  imported: number;
  duplicates: number;
  errors: number;
  currentBatch: number;
  totalBatches: number;
  log: ImportBatchLogEntry[];
  done: boolean;
  failed: boolean;
  viewMode: 'minimized' | 'default' | 'maximized';
  message: string;
  startTime: number | null;
}

interface ImportBroadcastContextValue extends ImportBroadcastState {
  startImport: (opts: {
    leads: any[];
    fileName?: string;
    onComplete?: () => void;
    onUpgrade?: () => void;
  }) => void;
  dismiss: () => void;
  setViewMode: (mode: 'minimized' | 'default' | 'maximized') => void;
}

const initialState: ImportBroadcastState = {
  active: false,
  fileName: '',
  total: 0,
  imported: 0,
  duplicates: 0,
  errors: 0,
  currentBatch: 0,
  totalBatches: 0,
  log: [],
  done: false,
  failed: false,
  viewMode: 'default',
  message: '',
  startTime: null,
};

const ImportBroadcastContext = createContext<ImportBroadcastContextValue>({
  ...initialState,
  startImport: () => {},
  dismiss: () => {},
  setViewMode: () => {},
});

export function useImportBroadcast() {
  return useContext(ImportBroadcastContext);
}

// ── Provider ──

const BATCH_SIZE = 50;

export function ImportBroadcastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ImportBroadcastState>(initialState);
  const abortRef = useRef(false);
  const runningRef = useRef(false);

  const dismiss = useCallback(() => {
    abortRef.current = true;
    setState(initialState);
  }, []);

  const setViewMode = useCallback((mode: 'minimized' | 'default' | 'maximized') => {
    setState(prev => ({ ...prev, viewMode: mode }));
  }, []);

  const startImport = useCallback(({ leads, fileName, onComplete, onUpgrade }: {
    leads: any[];
    fileName?: string;
    onComplete?: () => void;
    onUpgrade?: () => void;
  }) => {
    if (runningRef.current) {
      toast.error('An import is already in progress');
      return;
    }

    if (!leads.length) {
      toast.error('No leads to import');
      return;
    }

    abortRef.current = false;
    runningRef.current = true;

    const chunks: any[][] = [];
    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
      chunks.push(leads.slice(i, i + BATCH_SIZE));
    }

    setState({
      active: true,
      fileName: fileName || 'CSV Import',
      total: leads.length,
      imported: 0,
      duplicates: 0,
      errors: 0,
      currentBatch: 0,
      totalBatches: chunks.length,
      log: [],
      done: false,
      failed: false,
      viewMode: 'default',
      message: `Preparing ${leads.length.toLocaleString()} leads in ${chunks.length} batch${chunks.length !== 1 ? 'es' : ''}...`,
      startTime: Date.now(),
    });

    // Run the import loop in the background
    (async () => {
      let totalImported = 0;
      let totalDuplicates = 0;
      let totalErrors = 0;
      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 3;

      for (let i = 0; i < chunks.length; i++) {
        if (abortRef.current) break;

        const batchNum = i + 1;
        setState(prev => ({
          ...prev,
          currentBatch: batchNum,
          message: `Uploading batch ${batchNum} of ${chunks.length}...`,
        }));

        try {
          const response = await authenticatedFetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/import`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ leads: chunks[i] }),
            }
          );

          if (response.ok) {
            consecutiveErrors = 0;
            const data = await response.json();
            const batchImported = data.imported || 0;
            const batchDuplicates = data.duplicates || 0;
            totalImported += batchImported;
            totalDuplicates += batchDuplicates;

            const entry: ImportBatchLogEntry = {
              id: `batch-${batchNum}`,
              batchIndex: batchNum,
              size: chunks[i].length,
              imported: batchImported,
              duplicates: batchDuplicates,
              timestamp: Date.now(),
            };

            setState(prev => ({
              ...prev,
              imported: totalImported,
              duplicates: totalDuplicates,
              log: [...prev.log, entry],
            }));
          } else {
            const errorData = await response.json().catch(() => ({}));

            // Handle lead limit exceeded
            if (response.status === 403 && errorData.error === 'LEAD_LIMIT_EXCEEDED') {
              console.warn('[IMPORT BROADCAST] Lead limit exceeded:', errorData);
              toast.error('Lead limit reached', {
                description: errorData.message || "You've reached your plan's contact limit.",
                duration: 6000,
                action: onUpgrade ? { label: 'Upgrade', onClick: onUpgrade } : undefined,
              });
              if (onUpgrade) {
                setTimeout(() => onUpgrade(), 1500);
              }

              setState(prev => ({
                ...prev,
                done: true,
                failed: true,
                message: `Import stopped: lead limit reached after ${totalImported} imported.`,
              }));
              runningRef.current = false;
              return;
            }

            // Duplicates error
            if (response.status === 400 && errorData.duplicates) {
              totalDuplicates += errorData.duplicates;
              const entry: ImportBatchLogEntry = {
                id: `batch-${batchNum}`,
                batchIndex: batchNum,
                size: chunks[i].length,
                imported: 0,
                duplicates: errorData.duplicates,
                timestamp: Date.now(),
              };
              setState(prev => ({
                ...prev,
                duplicates: totalDuplicates,
                log: [...prev.log, entry],
              }));
            } else {
              // General error
              console.error(`[IMPORT BROADCAST] Batch ${batchNum} failed:`, response.status, errorData);
              totalErrors += chunks[i].length;
              consecutiveErrors++;

              const entry: ImportBatchLogEntry = {
                id: `batch-${batchNum}`,
                batchIndex: batchNum,
                size: chunks[i].length,
                imported: 0,
                duplicates: 0,
                error: errorData.message || `HTTP ${response.status}`,
                timestamp: Date.now(),
              };

              setState(prev => ({
                ...prev,
                errors: totalErrors,
                log: [...prev.log, entry],
              }));

              if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                toast.error('Import paused', {
                  description: 'Too many consecutive errors.',
                  duration: 5000,
                });
                break;
              }
            }
          }
        } catch (networkError: any) {
          console.error(`[IMPORT BROADCAST] Batch ${batchNum} network error:`, networkError);
          totalErrors += chunks[i].length;
          consecutiveErrors++;

          const entry: ImportBatchLogEntry = {
            id: `batch-${batchNum}`,
            batchIndex: batchNum,
            size: chunks[i].length,
            imported: 0,
            duplicates: 0,
            error: networkError.message || 'Network error',
            timestamp: Date.now(),
          };

          setState(prev => ({
            ...prev,
            errors: totalErrors,
            log: [...prev.log, entry],
          }));

          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            toast.error('Import stopped', {
              description: 'Connection lost after multiple retries.',
              duration: 5000,
            });
            break;
          }

          // Brief backoff
          await new Promise(r => setTimeout(r, 2000 * consecutiveErrors));
        }

        // Small delay between successful batches
        if (!abortRef.current && i < chunks.length - 1) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      // Done
      const hasFailed = consecutiveErrors >= MAX_CONSECUTIVE_ERRORS;
      setState(prev => ({
        ...prev,
        currentBatch: prev.totalBatches,
        done: true,
        failed: hasFailed,
        message: hasFailed
          ? `Import incomplete: ${totalImported} imported, ${totalErrors} failed.`
          : `Successfully imported ${totalImported.toLocaleString()} leads!${totalDuplicates > 0 ? ` (${totalDuplicates} duplicates skipped)` : ''}`,
      }));
      runningRef.current = false;

      // Invalidate caches
      apiCache.invalidate('crm:*');
      apiCache.invalidate('dashboard:*');

      if (!abortRef.current) {
        if (totalImported > 0) {
          toast.success(`Imported ${totalImported.toLocaleString()} leads`, {
            description: totalDuplicates > 0
              ? `${totalDuplicates} duplicates were skipped`
              : 'All leads imported successfully',
          });
        } else if (totalDuplicates > 0) {
          toast.info('No new leads imported', {
            description: `All ${totalDuplicates} leads were duplicates`,
          });
        }

        // Trigger the callback to reload leads
        if (onComplete) {
          onComplete();
        }

        // Auto-minimize after completion
        setTimeout(() => {
          setState(prev => (prev.active ? { ...prev, viewMode: 'minimized' } : prev));
        }, 4000);
      }
    })();
  }, []);

  return (
    <ImportBroadcastContext.Provider value={{
      ...state,
      startImport,
      dismiss,
      setViewMode,
    }}>
      {children}
    </ImportBroadcastContext.Provider>
  );
}

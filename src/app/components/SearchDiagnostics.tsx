import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Info, XCircle, ChevronDown, ChevronUp } from 'lucide-react';

export interface DiagnosticLog {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  category: string;
  message: string;
  data?: any;
}

interface SearchDiagnosticsProps {
  logs: DiagnosticLog[];
  onClear?: () => void;
}

export function SearchDiagnostics({ logs, onClear }: SearchDiagnosticsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const categories = ['all', ...Array.from(new Set(logs.map(l => l.category)))];
  const filteredLogs = selectedCategory === 'all' 
    ? logs 
    : logs.filter(l => l.category === selectedCategory);

  if (logs.length === 0) return null;

  return (
    <div className="mb-4 bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-zinc-200">
            Search Diagnostics
          </span>
          <span className="text-xs text-zinc-500">({logs.length} logs)</span>
        </div>
        {isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
      </button>

      {isExpanded && (
        <div className="border-t border-zinc-800">
          <div className="px-4 py-2 bg-zinc-900/80 flex items-center gap-2 text-xs">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : cat}
                </option>
              ))}
            </select>
            {onClear && (
              <button
                onClick={onClear}
                className="ml-auto text-zinc-400 hover:text-zinc-200 underline"
              >
                Clear
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto p-2 space-y-1">
            {filteredLogs.map((log, idx) => (
              <div
                key={idx}
                className={`px-3 py-2 rounded text-xs font-mono ${
                  log.level === 'error' ? 'bg-red-950/50 text-red-300 border border-red-900/50' :
                  log.level === 'warn' ? 'bg-amber-950/50 text-amber-300 border border-amber-900/50' :
                  log.level === 'success' ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-900/50' :
                  'bg-zinc-800/50 text-zinc-300'
                }`}
              >
                <div className="flex items-start gap-2">
                  {log.level === 'error' && <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                  {log.level === 'warn' && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                  {log.level === 'success' && <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                  {log.level === 'info' && <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-zinc-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span className="text-zinc-400">[{log.category}]</span>
                    </div>
                    <div className="text-white">{log.message}</div>
                    {log.data && (
                      <details className="mt-1">
                        <summary className="text-zinc-400 cursor-pointer hover:text-zinc-200">
                          View data
                        </summary>
                        <pre className="mt-1 text-xs text-zinc-400 overflow-x-auto">
                          {JSON.stringify(log.data, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Hook to collect logs
export function useDiagnosticLogger() {
  const [logs, setLogs] = useState<DiagnosticLog[]>([]);

  const log = (level: DiagnosticLog['level'], category: string, message: string, data?: any) => {
    setLogs(prev => [...prev, {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
    }]);
  };

  const clear = () => setLogs([]);

  return {
    logs,
    log,
    clear,
    info: (category: string, message: string, data?: any) => log('info', category, message, data),
    warn: (category: string, message: string, data?: any) => log('warn', category, message, data),
    error: (category: string, message: string, data?: any) => log('error', category, message, data),
    success: (category: string, message: string, data?: any) => log('success', category, message, data),
  };
}

import { useState } from 'react';
import { FileText, AlertCircle, CheckCircle, X, Download } from 'lucide-react';
import { parseCSV } from '../utils/csv-parser';

interface CSVDiagnosticToolProps {
  onClose: () => void;
  onFixAndImport?: (fixedLeads: any[]) => void;
}

export function CSVDiagnosticTool({ onClose, onFixAndImport }: CSVDiagnosticToolProps) {
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [parsedLeads, setParsedLeads] = useState<any[]>([]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      analyzeCsv(text);
    };
    reader.readAsText(file);
  };

  const analyzeCsv = (text: string) => {
    const lines = text.split('\n').filter(l => l.trim());
    
    if (lines.length < 2) {
      setDiagnostics({
        error: 'CSV has less than 2 lines (needs headers + at least 1 data row)',
        totalLines: lines.length,
      });
      return;
    }

    // Parse headers
    const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    
    // Detect CSV format
    const lowerHeaders = rawHeaders.map(h => h.toLowerCase());
    const apolloIndicators = [
      'apollo contact id',
      'apollo account id',
      'primary email source',
      'company name for emails',
      'secondary email',
      'work direct phone'
    ];
    
    const isApolloFormat = apolloIndicators.some(indicator => 
      lowerHeaders.some(h => h.includes(indicator))
    );
    
    // Try parsing
    const parsed = parseCSV(text);
    
    // Analyze the data
    const issues: string[] = [];
    const warnings: string[] = [];
    const stats: any = {
      totalRows: lines.length - 1,
      parsedLeads: parsed.length,
      headers: rawHeaders,
      missingEmails: 0,
      missingBusinessNames: 0,
      missingPhones: 0,
      emptyRows: 0,
    };

    parsed.forEach(lead => {
      if (!lead.email) stats.missingEmails++;
      if (!lead.business_name) stats.missingBusinessNames++;
      if (!lead.phone) stats.missingPhones++;
    });

    stats.emptyRows = stats.totalRows - stats.parsedLeads;

    // Check for issues
    if (stats.parsedLeads === 0) {
      issues.push('❌ No leads were parsed from the CSV');
      issues.push('This usually means the CSV format is not recognized');
    }

    if (stats.parsedLeads < stats.totalRows * 0.8) {
      warnings.push(`⚠️ Only ${stats.parsedLeads} of ${stats.totalRows} rows were parsed (${Math.round(stats.parsedLeads/stats.totalRows*100)}%)`);
      warnings.push('Some rows may have been skipped due to missing data');
    }

    if (stats.missingEmails > stats.parsedLeads * 0.5) {
      warnings.push(`⚠️ ${stats.missingEmails} leads (${Math.round(stats.missingEmails/stats.parsedLeads*100)}%) are missing email addresses`);
    }

    if (stats.missingBusinessNames > 0) {
      warnings.push(`⚠️ ${stats.missingBusinessNames} leads are missing business names (will use contact name or email domain)`);
    }

    // Check for common header issues
    const hasEmail = lowerHeaders.some(h => h.includes('email') || h.includes('mail'));
    const hasCompany = lowerHeaders.some(h => 
      h.includes('company') || h.includes('business') || h.includes('organization') || h.includes('name')
    );

    if (!hasEmail) {
      issues.push('❌ No email column detected - please add an "Email" column');
    }
    if (!hasCompany) {
      warnings.push('⚠️ No company/business column detected - business names will be auto-generated');
    }

    setParsedLeads(parsed);
    setDiagnostics({
      stats,
      issues,
      warnings,
      success: issues.length === 0,
      isApolloFormat,
    });
  };

  const downloadFixedCsv = () => {
    if (parsedLeads.length === 0) return;

    // Create CSV with all fields properly mapped
    const headers = ['business_name', 'contact_name', 'email', 'phone', 'website', 'address', 'category', 'notes', 'job_title', 'linkedin', 'employees', 'industry', 'keywords'];
    
    let csvContent = headers.join(',') + '\n';
    
    parsedLeads.forEach(lead => {
      const row = headers.map(h => {
        const value = lead[h] || '';
        // Escape commas and quotes
        if (value.toString().includes(',') || value.toString().includes('"')) {
          return `"${value.toString().replace(/"/g, '""')}"`;
        }
        return value;
      });
      csvContent += row.join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fixed_leads.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-black rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-black border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-[#1ED4A7]" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              CSV Diagnostic Tool
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* File Upload */}
          {!csvFile && (
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
                id="csv-diagnostic-upload"
              />
              <label
                htmlFor="csv-diagnostic-upload"
                className="flex flex-col items-center justify-center cursor-pointer"
              >
                <FileText className="w-12 h-12 text-gray-400 mb-3" />
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Upload CSV to diagnose
                </p>
                <p className="text-xs text-gray-500">
                  We'll analyze your file and show you what's wrong
                </p>
              </label>
            </div>
          )}

          {/* Diagnostics Results */}
          {diagnostics && (
            <div className="space-y-4">
              {/* Header Info */}
              {diagnostics.stats && (
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                  <h3 className="font-semibold text-sm text-gray-900 dark:text-white mb-3">
                    CSV Analysis
                    {diagnostics.isApolloFormat && (
                      <span className="ml-2 px-2 py-0.5 bg-[#1ED4A7] text-black text-xs rounded font-medium">
                        Extended Format Detected
                      </span>
                    )}
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Total rows:</span>
                      <span className="ml-2 font-medium text-gray-900 dark:text-white">
                        {diagnostics.stats.totalRows}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Parsed leads:</span>
                      <span className="ml-2 font-medium text-gray-900 dark:text-white">
                        {diagnostics.stats.parsedLeads}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Missing emails:</span>
                      <span className="ml-2 font-medium text-gray-900 dark:text-white">
                        {diagnostics.stats.missingEmails}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Empty/skipped rows:</span>
                      <span className="ml-2 font-medium text-gray-900 dark:text-white">
                        {diagnostics.stats.emptyRows}
                      </span>
                    </div>
                  </div>
                  
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                      Detected Headers:
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {diagnostics.stats.headers.map((header: string, i: number) => (
                        <span
                          key={i}
                          className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded text-xs"
                        >
                          {header}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Issues */}
              {diagnostics.issues && diagnostics.issues.length > 0 && (
                <div className="bg-zinc-100 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/50 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-zinc-500 dark:text-zinc-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h3 className="font-semibold text-sm text-zinc-800 dark:text-zinc-100">
                        Critical Issues
                      </h3>
                      {diagnostics.issues.map((issue: string, i: number) => (
                        <p key={i} className="text-sm text-zinc-600 dark:text-zinc-300">
                          {issue}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Warnings */}
              {diagnostics.warnings && diagnostics.warnings.length > 0 && (
                <div className="bg-zinc-100 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/50 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-zinc-500 dark:text-zinc-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h3 className="font-semibold text-sm text-zinc-800 dark:text-zinc-100">
                        Warnings
                      </h3>
                      {diagnostics.warnings.map((warning: string, i: number) => (
                        <p key={i} className="text-sm text-zinc-600 dark:text-zinc-300">
                          {warning}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Success */}
              {diagnostics.success && diagnostics.issues.length === 0 && (
                <div className="bg-[#1ED4A7]/5 dark:bg-[#1ED4A7]/5 border border-[#1ED4A7]/20 dark:border-[#1ED4A7]/15 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-[#1ED4A7] flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-sm text-zinc-800 dark:text-zinc-100 mb-1">
                        CSV looks good!
                      </h3>
                      <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        Your CSV was parsed successfully. {parsedLeads.length} leads ready to import.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Sample Data Preview */}
              {parsedLeads.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-900 dark:text-white mb-3">
                    Preview (first 3 leads)
                  </h3>
                  <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 dark:bg-gray-800">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">Business</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">Contact</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">Email</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">Phone</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                          {parsedLeads.slice(0, 3).map((lead, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2 text-gray-900 dark:text-white">
                                {lead.business_name || <span className="text-gray-400">—</span>}
                              </td>
                              <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                                {lead.contact_name || <span className="text-gray-400">—</span>}
                              </td>
                              <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                                {lead.email || <span className="text-zinc-400">Missing</span>}
                              </td>
                              <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                                {lead.phone || <span className="text-gray-400">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
                <button
                  onClick={downloadFixedCsv}
                  disabled={parsedLeads.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white dark:bg-white dark:text-black rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  <Download className="w-4 h-4" />
                  Download Fixed CSV
                </button>
                
                {onFixAndImport && parsedLeads.length > 0 && (
                  <button
                    onClick={() => onFixAndImport(parsedLeads)}
                    className="flex items-center gap-2 px-4 py-2 bg-[#1ED4A7] text-white rounded-lg hover:bg-[#1ED4A7]/90 transition-colors text-sm"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Import {parsedLeads.length} Leads
                  </button>
                )}

                <button
                  onClick={() => {
                    setCsvFile(null);
                    setDiagnostics(null);
                    setParsedLeads([]);
                  }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
                >
                  Try Another File
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
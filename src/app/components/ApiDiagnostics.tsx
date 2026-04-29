import React, { useState, useEffect } from 'react';
import { Check, X, AlertTriangle, Loader2, RefreshCw, Database, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';

interface ApiTestResult {
  service: string;
  status: 'success' | 'error' | 'warning' | 'not_configured';
  message: string;
  details?: any;
  credits_remaining?: number;
  rate_limit?: string;
  response_time_ms?: number;
}

interface DiagnosticReport {
  timestamp: string;
  overall_status: 'healthy' | 'degraded' | 'critical';
  results: ApiTestResult[];
  recommendations: string[];
}

interface CleanupAnalysis {
  total_leads: number;
  issues: {
    coordinates_in_city: number;
    empty_city: number;
    invalid_format: number;
    too_long: number;
  };
  sample_issues: Array<{
    lead_id: string;
    business_name: string;
    city: string | null;
    address: string | null;
    issue_type: string;
  }>;
}

interface CleanupResult {
  total_leads_scanned: number;
  issues_found: number;
  fixes_applied: number;
  errors: number;
  issues_by_type: {
    coordinates_in_city: number;
    empty_city: number;
    invalid_format: number;
    too_long: number;
  };
  sample_fixes: Array<{
    lead_id: string;
    business_name: string;
    before: string;
    after: string;
    fix_type: string;
  }>;
}

export default function ApiDiagnostics() {
  const [isLoading, setIsLoading] = useState(false);
  const [diagnosticReport, setDiagnosticReport] = useState<DiagnosticReport | null>(null);
  const [cleanupAnalysis, setCleanupAnalysis] = useState<CleanupAnalysis | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);
  const [showDetails, setShowDetails] = useState<{ [key: string]: boolean }>({});
  const [expandedSections, setExpandedSections] = useState({
    diagnostics: true,
    cleanup: true
  });
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Get access token from Supabase session
  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        setAccessToken(session.access_token);
      }
    };
    getSession();
  }, []);

  const runDiagnostics = async () => {
    if (!accessToken) {
      toast.error('Not authenticated');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/api-diagnostics`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setDiagnosticReport(data.report);
      toast.success('API diagnostics completed');
    } catch (error) {
      console.error('Diagnostics error:', error);
      toast.error(`Failed to run diagnostics: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const analyzeCityData = async () => {
    if (!accessToken) {
      toast.error('Not authenticated');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/city-cleanup/analyze`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setCleanupAnalysis(data.analysis);
      
      const totalIssues = Object.values(data.analysis.issues).reduce((sum: number, count) => sum + (count as number), 0);
      if (totalIssues === 0) {
        toast.success('No city field issues found!');
      } else {
        toast.info(`Found ${totalIssues} issues in city field`);
      }
    } catch (error) {
      console.error('Analysis error:', error);
      toast.error(`Failed to analyze city data: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const fixCityData = async (dryRun: boolean = true) => {
    if (!accessToken) {
      toast.error('Not authenticated');
      return;
    }

    if (!dryRun) {
      const confirmed = confirm(
        '⚠️ This will permanently modify your leads data. Are you sure you want to proceed with the actual cleanup (not a dry run)?'
      );
      if (!confirmed) return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/city-cleanup/fix`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            dryRun,
            fixCoordinates: true,
            fillEmptyCities: true,
            removeInvalidCities: true
          })
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setCleanupResult(data.result);
      
      if (dryRun) {
        toast.success(`Dry run complete: ${data.result.fixes_applied} fixes would be applied`);
      } else {
        toast.success(`Cleanup complete: ${data.result.fixes_applied} fixes applied`);
        // Refresh analysis after actual cleanup
        setTimeout(() => analyzeCityData(), 1000);
      }
    } catch (error) {
      console.error('Cleanup error:', error);
      toast.error(`Failed to fix city data: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <Check className="w-5 h-5 text-[#1ED4A7]" />;
      case 'error':
        return <X className="w-5 h-5 text-zinc-400" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-zinc-500" />;
      case 'not_configured':
        return <AlertTriangle className="w-5 h-5 text-zinc-500" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'border-[#1ED4A7]/30 bg-[#1ED4A7]/5';
      case 'error':
        return 'border-zinc-500/30 bg-zinc-500/5';
      case 'warning':
        return 'border-zinc-500/30 bg-zinc-500/5';
      case 'not_configured':
        return 'border-zinc-500/30 bg-zinc-500/5';
      default:
        return 'border-zinc-500/20 bg-zinc-500/5';
    }
  };

  const toggleDetails = (service: string) => {
    setShowDetails(prev => ({ ...prev, [service]: !prev[service] }));
  };

  const toggleSection = (section: 'diagnostics' | 'cleanup') => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-[24px] font-bold text-white mb-2">System Diagnostics</h1>
        <p className="text-zinc-400 text-[14px]">
          Test API integrations and clean up data pollution
        </p>
      </div>

      {/* API Diagnostics Section */}
      <div className="border border-white/10 rounded-xl overflow-hidden bg-black/40 backdrop-blur-sm">
        <button
          onClick={() => toggleSection('diagnostics')}
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-[#1ED4A7]" />
            <h2 className="text-[18px] font-semibold text-white">API Integration Tests</h2>
          </div>
          {expandedSections.diagnostics ? (
            <ChevronUp className="w-5 h-5 text-zinc-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-zinc-400" />
          )}
        </button>

        {expandedSections.diagnostics && (
          <div className="p-4 pt-0 space-y-4">
            <p className="text-zinc-400 text-[14px]">
              Test connectivity and functionality for lead discovery and enrichment services
            </p>

            <button
              onClick={runDiagnostics}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white dark:bg-white dark:text-black rounded-lg font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Running Tests...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Run API Diagnostics
                </>
              )}
            </button>

            {diagnosticReport && (
              <div className="space-y-4">
                {/* Overall Status */}
                <div className={`p-4 rounded-lg border ${
                  diagnosticReport.overall_status === 'healthy' ? 'border-[#1ED4A7]/30 bg-[#1ED4A7]/5' :
                  diagnosticReport.overall_status === 'degraded' ? 'border-zinc-500/30 bg-zinc-500/5' :
                  'border-zinc-500/30 bg-zinc-500/5'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white font-medium">Overall Status</span>
                    <span className={`px-3 py-1 rounded-full text-[12px] font-medium ${
                      diagnosticReport.overall_status === 'healthy' ? 'bg-[#1ED4A7] text-black' :
                      diagnosticReport.overall_status === 'degraded' ? 'bg-zinc-500 text-black' :
                      'bg-zinc-500 text-white'
                    }`}>
                      {diagnosticReport.overall_status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-zinc-400 text-[12px]">
                    Tested at {new Date(diagnosticReport.timestamp).toLocaleString()}
                  </p>
                </div>

                {/* API Results */}
                <div className="space-y-3">
                  {diagnosticReport.results.map((result, idx) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-lg border ${getStatusColor(result.status)}`}
                    >
                      <div className="flex items-start gap-3">
                        {getStatusIcon(result.status)}
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <h3 className="text-white font-medium">{result.service}</h3>
                            {result.response_time_ms && (
                              <span className="text-zinc-500 text-[12px]">
                                {result.response_time_ms}ms
                              </span>
                            )}
                          </div>
                          <p className="text-zinc-300 text-[14px] mb-2">{result.message}</p>
                          
                          {(result.credits_remaining !== undefined || result.rate_limit) && (
                            <div className="flex gap-4 text-[12px]">
                              {result.credits_remaining !== undefined && (
                                <span className="text-zinc-400">
                                  Credits: <span className="text-white">{result.credits_remaining.toLocaleString()}</span>
                                </span>
                              )}
                              {result.rate_limit && (
                                <span className="text-zinc-400">
                                  Plan: <span className="text-white">{result.rate_limit}</span>
                                </span>
                              )}
                            </div>
                          )}

                          {result.details && (
                            <>
                              <button
                                onClick={() => toggleDetails(result.service)}
                                className="mt-2 text-[#1ED4A7] text-[12px] hover:underline"
                              >
                                {showDetails[result.service] ? 'Hide Details' : 'Show Details'}
                              </button>
                              {showDetails[result.service] && (
                                <pre className="mt-2 p-2 bg-black/40 rounded text-[11px] text-zinc-400 overflow-x-auto">
                                  {JSON.stringify(result.details, null, 2)}
                                </pre>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Recommendations */}
                {diagnosticReport.recommendations.length > 0 && (
                  <div className="p-4 rounded-lg border border-zinc-500/30 bg-zinc-500/5">
                    <h3 className="text-white font-medium mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Recommendations
                    </h3>
                    <ul className="space-y-1">
                      {diagnosticReport.recommendations.map((rec, idx) => (
                        <li key={idx} className="text-zinc-300 text-[14px]">
                          • {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* City Data Cleanup Section */}
      <div className="border border-white/10 rounded-xl overflow-hidden bg-black/40 backdrop-blur-sm">
        <button
          onClick={() => toggleSection('cleanup')}
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-[#1ED4A7]" />
            <h2 className="text-[18px] font-semibold text-white">City Field Cleanup</h2>
          </div>
          {expandedSections.cleanup ? (
            <ChevronUp className="w-5 h-5 text-zinc-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-zinc-400" />
          )}
        </button>

        {expandedSections.cleanup && (
          <div className="p-4 pt-0 space-y-4">
            <p className="text-zinc-400 text-[14px]">
              Fix data pollution in the leads table city field (coordinates, invalid formats, etc.)
            </p>

            <div className="flex gap-2">
              <button
                onClick={analyzeCityData}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-700 text-white rounded-lg font-medium hover:bg-zinc-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Database className="w-4 h-4" />
                    Analyze City Data
                  </>
                )}
              </button>

              {cleanupAnalysis && Object.values(cleanupAnalysis.issues).reduce((sum, count) => sum + count, 0) > 0 && (
                <>
                  <button
                    onClick={() => fixCityData(true)}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-500/20 text-zinc-300 border border-zinc-500/30 rounded-lg font-medium hover:bg-zinc-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Preview Fixes (Dry Run)
                  </button>

                  <button
                    onClick={() => fixCityData(false)}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white dark:bg-white dark:text-black rounded-lg font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Apply Fixes
                  </button>
                </>
              )}
            </div>

            {cleanupAnalysis && (
              <div className="space-y-4">
                {/* Summary */}
                <div className="p-4 rounded-lg border border-white/10 bg-white/5">
                  <h3 className="text-white font-medium mb-3">Analysis Summary</h3>
                  <div className="grid grid-cols-2 gap-3 text-[14px]">
                    <div>
                      <span className="text-zinc-400">Total Leads:</span>
                      <span className="ml-2 text-white font-medium">{cleanupAnalysis.total_leads.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-zinc-400">Coordinates in City:</span>
                      <span className="ml-2 text-white font-medium">{cleanupAnalysis.issues.coordinates_in_city.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-zinc-400">Empty City:</span>
                      <span className="ml-2 text-white font-medium">{cleanupAnalysis.issues.empty_city.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-zinc-400">Invalid Format:</span>
                      <span className="ml-2 text-white font-medium">{cleanupAnalysis.issues.invalid_format.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-zinc-400">Too Long:</span>
                      <span className="ml-2 text-white font-medium">{cleanupAnalysis.issues.too_long.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-zinc-400">Total Issues:</span>
                      <span className="ml-2 text-white font-medium">
                        {Object.values(cleanupAnalysis.issues).reduce((sum, count) => sum + count, 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Sample Issues */}
                {cleanupAnalysis.sample_issues.length > 0 && (
                  <div className="p-4 rounded-lg border border-white/10 bg-white/5">
                    <h3 className="text-white font-medium mb-3">Sample Issues</h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {cleanupAnalysis.sample_issues.slice(0, 10).map((issue, idx) => (
                        <div key={idx} className="p-2 rounded bg-black/40 text-[12px]">
                          <div className="text-white font-medium">{issue.business_name}</div>
                          <div className="text-zinc-400">
                            City: <span className="text-zinc-300">{issue.city || '(empty)'}</span>
                          </div>
                          <div className="text-zinc-500">Type: {issue.issue_type.replace(/_/g, ' ')}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {cleanupResult && (
              <div className="space-y-4">
                {/* Cleanup Results */}
                <div className="p-4 rounded-lg border border-[#1ED4A7]/30 bg-[#1ED4A7]/5">
                  <h3 className="text-white font-medium mb-3">Cleanup Results</h3>
                  <div className="grid grid-cols-2 gap-3 text-[14px]">
                    <div>
                      <span className="text-zinc-300">Leads Scanned:</span>
                      <span className="ml-2 text-white font-medium">{cleanupResult.total_leads_scanned.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-zinc-300">Issues Found:</span>
                      <span className="ml-2 text-white font-medium">{cleanupResult.issues_found.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-zinc-300">Fixes Applied:</span>
                      <span className="ml-2 text-[#1ED4A7] font-medium">{cleanupResult.fixes_applied.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-zinc-300">Errors:</span>
                      <span className="ml-2 text-white font-medium">{cleanupResult.errors.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {/* Sample Fixes */}
                {cleanupResult.sample_fixes.length > 0 && (
                  <div className="p-4 rounded-lg border border-white/10 bg-white/5">
                    <h3 className="text-white font-medium mb-3">Sample Fixes Applied</h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {cleanupResult.sample_fixes.map((fix, idx) => (
                        <div key={idx} className="p-2 rounded bg-black/40 text-[12px]">
                          <div className="text-white font-medium">{fix.business_name}</div>
                          <div className="text-zinc-400">
                            Before: <span className="text-zinc-400">{fix.before}</span>
                          </div>
                          <div className="text-zinc-400">
                            After: <span className="text-[#1ED4A7]">{fix.after}</span>
                          </div>
                          <div className="text-zinc-500">Type: {fix.fix_type.replace(/_/g, ' ')}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
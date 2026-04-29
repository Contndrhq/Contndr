import React, { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';

export function LeadScoringTest() {
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<any>(null);

  const runTests = async () => {
    setTesting(true);
    setResults(null);

    const testResults: any = {
      columnExists: false,
      sampleLeadsFetched: false,
      scoringEndpointWorks: false,
      sampleScores: [],
      errors: []
    };

    try {
      // Get access token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }
      const accessToken = session.access_token;

      // Test 1: Check if score column exists
      console.log('[TEST] Checking if score column exists...');
      try {
        const { data, error } = await supabase
          .from('leads')
          .select('id, score')
          .eq('user_id', session.user.id)
          .limit(5);

        if (error) {
          testResults.errors.push(`Column check error: ${error.message}`);
          testResults.columnExists = false;
        } else {
          testResults.columnExists = true;
          testResults.sampleLeadsFetched = true;
          testResults.sampleLeadsCount = data?.length || 0;
          console.log(`[TEST] Found ${data?.length || 0} sample leads`);
        }
      } catch (err: any) {
        testResults.errors.push(`Column check failed: ${err.message}`);
      }

      // Test 2: Try scoring a single lead if we have one
      if (testResults.sampleLeadsFetched && testResults.sampleLeadsCount > 0) {
        console.log('[TEST] Testing lead scoring endpoint...');
        const { data: leads } = await supabase
          .from('leads')
          .select('id, contact_name, business_name')
          .eq('user_id', session.user.id)
          .limit(1);

        if (leads && leads[0]) {
          const testLeadId = leads[0].id;
          console.log(`[TEST] Scoring lead ${testLeadId}...`);

          try {
            const response = await fetch(
              `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/score/${testLeadId}`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json'
                }
              }
            );

            if (response.ok) {
              const data = await response.json();
              testResults.scoringEndpointWorks = true;
              testResults.sampleScores.push({
                leadId: testLeadId,
                leadName: leads[0].contact_name || leads[0].business_name,
                score: data.score,
                grade: data.grade
              });
              console.log(`[TEST] Lead scored successfully: ${data.score} (${data.grade})`);
            } else {
              const error = await response.json();
              testResults.errors.push(`Scoring endpoint error: ${error.error || response.statusText}`);
            }
          } catch (err: any) {
            testResults.errors.push(`Scoring request failed: ${err.message}`);
          }
        }
      }

      // Test 3: Check database migration endpoint
      console.log('[TEST] Checking database migration endpoint...');
      try {
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/db/add-score-column`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const data = await response.json();
        if (response.ok) {
          testResults.migrationEndpoint = {
            status: 'success',
            message: data.message
          };
        } else {
          testResults.migrationEndpoint = {
            status: 'needs_migration',
            message: data.message,
            sql: data.sql
          };
        }
      } catch (err: any) {
        testResults.errors.push(`Migration check failed: ${err.message}`);
      }

      setResults(testResults);

      if (testResults.columnExists && testResults.scoringEndpointWorks) {
        toast.success('✅ Lead scoring system is working correctly!');
      } else if (testResults.errors.length > 0) {
        toast.error('❌ Lead scoring tests failed', {
          description: testResults.errors[0]
        });
      } else {
        toast.warning('⚠️ Lead scoring system needs setup');
      }

    } catch (error: any) {
      console.error('[TEST] Error:', error);
      toast.error('Test failed: ' + error.message);
      testResults.errors.push(`Fatal error: ${error.message}`);
      setResults(testResults);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="border border-white/10 rounded-xl bg-black/40 backdrop-blur-sm p-6">
      <h2 className="text-[18px] font-semibold text-white mb-4">Lead Scoring System Test</h2>
      
      <button
        onClick={runTests}
        disabled={testing}
        className="px-4 py-2 bg-[#1ED4A7] text-black rounded-lg font-medium hover:bg-[#1ED4A7]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {testing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Running Tests...
          </>
        ) : (
          'Run System Tests'
        )}
      </button>

      {results && (
        <div className="mt-6 space-y-4">
          {/* Column Exists Check */}
          <div className="flex items-start gap-3 p-3 bg-white/5 rounded-lg border border-white/10">
            {results.columnExists ? (
              <CheckCircle className="w-5 h-5 text-[#1ED4A7] flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 text-zinc-400 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <div className="text-white font-medium">Score Column Exists</div>
              <div className="text-zinc-400 text-sm">
                {results.columnExists 
                  ? `✓ Column exists. Found ${results.sampleLeadsCount} sample leads.`
                  : '✗ Column does not exist or cannot be accessed.'
                }
              </div>
            </div>
          </div>

          {/* Scoring Endpoint Check */}
          <div className="flex items-start gap-3 p-3 bg-white/5 rounded-lg border border-white/10">
            {results.scoringEndpointWorks ? (
              <CheckCircle className="w-5 h-5 text-[#1ED4A7] flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <div className="text-white font-medium">Scoring Endpoint</div>
              <div className="text-zinc-400 text-sm">
                {results.scoringEndpointWorks 
                  ? '✓ API endpoint is working correctly'
                  : '✗ API endpoint failed or not accessible'
                }
              </div>
              {results.sampleScores.length > 0 && (
                <div className="mt-2 p-2 bg-black/30 rounded border border-white/5">
                  <div className="text-xs text-zinc-400 mb-1">Sample Score:</div>
                  {results.sampleScores.map((sample: any, idx: number) => (
                    <div key={idx} className="text-sm text-white">
                      <span className="text-zinc-400">{sample.leadName}</span>
                      {' → '}
                      <span className="font-bold text-[#1ED4A7]">{sample.score}</span>
                      <span className="text-zinc-400"> ({sample.grade})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Migration Status */}
          {results.migrationEndpoint && (
            <div className="flex items-start gap-3 p-3 bg-white/5 rounded-lg border border-white/10">
              {results.migrationEndpoint.status === 'success' ? (
                <CheckCircle className="w-5 h-5 text-[#1ED4A7] flex-shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-zinc-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="text-white font-medium">Database Migration</div>
                <div className="text-zinc-400 text-sm">{results.migrationEndpoint.message}</div>
                {results.migrationEndpoint.sql && (
                  <div className="mt-2 p-2 bg-black/30 rounded border border-zinc-500/20">
                    <div className="text-xs text-zinc-400 mb-1">Run this SQL in Supabase:</div>
                    <code className="text-xs text-white font-mono block">
                      {results.migrationEndpoint.sql}
                    </code>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Errors */}
          {results.errors.length > 0 && (
            <div className="p-3 bg-zinc-500/10 rounded-lg border border-zinc-500/30">
              <div className="text-zinc-400 font-medium mb-2">Errors:</div>
              <ul className="space-y-1">
                {results.errors.map((error: string, idx: number) => (
                  <li key={idx} className="text-sm text-zinc-300">• {error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Summary */}
          <div className="p-4 bg-zinc-500/10 rounded-lg border border-zinc-500/30">
            <div className="text-zinc-300 font-medium mb-2">Test Summary:</div>
            <div className="text-sm text-zinc-300 space-y-1">
              {results.columnExists && results.scoringEndpointWorks ? (
                <>
                  <div>✅ All systems operational</div>
                  <div>• Lead scoring is ready to use</div>
                  <div>• Navigate to Settings → Lead Scoring to score all your leads</div>
                </>
              ) : (
                <>
                  <div>⚠️ System requires setup</div>
                  {!results.columnExists && <div>• Add the score column to your leads table</div>}
                  {!results.scoringEndpointWorks && <div>• Fix the scoring API endpoint</div>}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
/**
 * Data Cleanup Utility Component
 * One-time scripts to fix and clean up lead data
 * 
 * Updated: 2025-02-14 - Added city cleanup functionality
 * Updated: 2026-02-14 - Enhanced state mapping fix to handle truncated city names
 *   - Fixes "New, California" → "New York, New York"
 *   - Fixes "Los, California" → "Los Angeles, California"
 *   - Intelligently corrects state mappings for 300+ US cities
 */

import { useState } from 'react';
import { Database, CheckCircle, AlertCircle, Loader2, Globe, MapPin, Building2, X } from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';

interface DataCleanupUtilityProps {
  onClose: () => void;
  onDataChanged: () => void;
}

// List of US states for the dropdown
const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
  'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'
];

export function DataCleanupUtility({ onClose, onDataChanged }: DataCleanupUtilityProps) {
  const [running, setRunning] = useState(false);
  const [countryStats, setCountryStats] = useState<any>(null);
  const [stateStats, setStateStats] = useState<any>(null);
  const [cityStats, setCityStats] = useState<any>(null);
  const [stateMappingStats, setStateMappingStats] = useState<any>(null);
  const [loadingCountryStats, setLoadingCountryStats] = useState(false);
  const [loadingStateStats, setLoadingStateStats] = useState(false);
  const [loadingCityStats, setLoadingCityStats] = useState(false);
  const [loadingStateMappingStats, setLoadingStateMappingStats] = useState(false);
  const [defaultState, setDefaultState] = useState('California');
  const [showCitySamples, setShowCitySamples] = useState(false);
  const [showStateMappingSamples, setShowStateMappingSamples] = useState(false);

  async function loadCountryStats() {
    setLoadingCountryStats(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/country-stats`,
        { headers }
      );

      if (!response.ok) throw new Error('Failed to load stats');

      const result = await response.json();
      setCountryStats(result.stats);
    } catch (error: any) {
      toast.error('Failed to load country stats', { description: error.message });
    } finally {
      setLoadingCountryStats(false);
    }
  }

  async function loadStateStats() {
    setLoadingStateStats(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/state-stats`,
        { headers }
      );

      if (!response.ok) throw new Error('Failed to load stats');

      const result = await response.json();
      setStateStats(result.stats);
    } catch (error: any) {
      toast.error('Failed to load state stats', { description: error.message });
    } finally {
      setLoadingStateStats(false);
    }
  }

  async function runCountryBackfill() {
    const confirmed = confirm(
      `This will set "United States" as the country for all ${countryStats?.without_country || '?'} leads that don't have a country set.\n\nThis is a one-time operation to prepare your data before adding international leads.\n\nContinue?`
    );

    if (!confirmed) return;

    setRunning(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/backfill-country`,
        {
          method: 'POST',
          headers,
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to backfill country data');
      }

      const result = await response.json();
      
      toast.success('Country data backfilled!', { 
        description: result.message 
      });

      // Reload stats and notify parent
      await loadCountryStats();
      onDataChanged();
    } catch (error: any) {
      toast.error('Backfill failed', { description: error.message });
    } finally {
      setRunning(false);
    }
  }

  async function runStateBackfill() {
    const confirmed = confirm(
      `This will set "${defaultState}" as the state for all ${stateStats?.without_state || '?'} leads that don't have a state set.\n\nYou can change the default state before running.\n\nContinue?`
    );

    if (!confirmed) return;

    setRunning(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/backfill-state`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ state: defaultState }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to backfill state data');
      }

      const result = await response.json();
      
      toast.success('State data backfilled!', { 
        description: result.message 
      });

      // Reload stats and notify parent
      await loadStateStats();
      onDataChanged();
    } catch (error: any) {
      toast.error('Backfill failed', { description: error.message });
    } finally {
      setRunning(false);
    }
  }

  async function loadCityStats() {
    setLoadingCityStats(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/city-analysis`,
        { headers }
      );

      if (!response.ok) throw new Error('Failed to load stats');

      const result = await response.json();
      setCityStats(result.stats);
    } catch (error: any) {
      toast.error('Failed to load city stats', { description: error.message });
    } finally {
      setLoadingCityStats(false);
    }
  }

  async function runCityCleanup() {
    const confirmed = confirm(
      `This will normalize ${cityStats?.needsFixing || '?'} city names by:\n• Expanding abbreviations (LA → Los Angeles, NYC → New York)\n• Fixing capitalization\n• Standardizing spelling\n\nContinue?`
    );

    if (!confirmed) return;

    setRunning(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/cleanup-cities`,
        {
          method: 'POST',
          headers,
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to cleanup city data');
      }

      const result = await response.json();
      
      toast.success('City data cleaned up!', { 
        description: result.message 
      });

      // Reload stats and notify parent
      await loadCityStats();
      onDataChanged();
    } catch (error: any) {
      toast.error('Cleanup failed', { description: error.message });
    } finally {
      setRunning(false);
    }
  }

  async function loadStateMappingStats() {
    setLoadingStateMappingStats(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/analyze-state-mappings`,
        { headers }
      );

      if (!response.ok) throw new Error('Failed to load stats');

      const result = await response.json();
      setStateMappingStats(result.stats);
    } catch (error: any) {
      toast.error('Failed to load state mapping stats', { description: error.message });
    } finally {
      setLoadingStateMappingStats(false);
    }
  }

  async function runFixStateMappings() {
    const confirmed = confirm(
      `This will intelligently fix ${stateMappingStats?.incorrect || '?'} city and state mappings.\n\nExamples of fixes:\n• "New, California" → "New York, New York"\n• "Los, California" → "Los Angeles, California"\n• "Houston, California" → "Houston, Texas"\n• "Atlanta, California" → "Atlanta, Georgia"\n\nContinue?`
    );

    if (!confirmed) return;

    setRunning(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/fix-state-mappings`,
        {
          method: 'POST',
          headers,
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fix state mappings');
      }

      const result = await response.json();
      
      toast.success('State mappings fixed!', { 
        description: result.message 
      });

      // Reload stats and notify parent
      await loadStateMappingStats();
      await loadStateStats();
      onDataChanged();
    } catch (error: any) {
      toast.error('Fix failed', { description: error.message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
              <Database className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Data Cleanup Utilities
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                One-time scripts to fix and standardize your lead data
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Country Backfill */}
          <div className="border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="w-4 h-4 text-gray-400" />
                  <h4 className="font-medium text-gray-900 dark:text-white">
                    Country Data Backfill
                  </h4>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Set "United States" as the default country for all existing leads. 
                  Run this once before adding international leads.
                </p>

                {countryStats && (
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5 text-[#1ED4A7]" />
                      <span className="text-gray-600 dark:text-gray-400">
                        {countryStats.total - countryStats.without_country} with country
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-gray-600 dark:text-gray-400">
                        {countryStats.without_country} without country
                      </span>
                    </div>
                  </div>
                )}

                {countryStats?.by_country && countryStats.by_country.length > 0 && (
                  <div className="mt-2 text-xs text-gray-500">
                    Current countries: {countryStats.by_country.map((c: any) => `${c.country} (${c.count})`).join(', ')}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={loadCountryStats}
                  disabled={loadingCountryStats}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-zinc-700 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  {loadingCountryStats ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    'Check Status'
                  )}
                </button>

                {countryStats && countryStats.without_country > 0 && (
                  <button
                    onClick={runCountryBackfill}
                    disabled={running}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {running ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Running...
                      </>
                    ) : (
                      `Fix ${countryStats.without_country} Leads`
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* State Backfill */}
          <div className="border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  <h4 className="font-medium text-gray-900 dark:text-white">
                    State Data Backfill
                  </h4>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Set a default state for all existing leads without state data.
                </p>

                {stateStats && (
                  <div className="flex items-center gap-4 text-xs mb-3">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5 text-[#1ED4A7]" />
                      <span className="text-gray-600 dark:text-gray-400">
                        {stateStats.total - stateStats.without_state} with state
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-gray-600 dark:text-gray-400">
                        {stateStats.without_state} without state
                      </span>
                    </div>
                  </div>
                )}

                {stateStats?.by_state && stateStats.by_state.length > 0 && (
                  <div className="mt-2 text-xs text-gray-500">
                    Current states: {stateStats.by_state.slice(0, 5).map((s: any) => `${s.state} (${s.count})`).join(', ')}
                    {stateStats.by_state.length > 5 && ` +${stateStats.by_state.length - 5} more`}
                  </div>
                )}

                {stateStats && stateStats.without_state > 0 && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Default State:
                    </label>
                    <select
                      value={defaultState}
                      onChange={(e) => setDefaultState(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                    >
                      {US_STATES.map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={loadStateStats}
                  disabled={loadingStateStats}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-zinc-700 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  {loadingStateStats ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    'Check Status'
                  )}
                </button>

                {stateStats && stateStats.without_state > 0 && (
                  <button
                    onClick={runStateBackfill}
                    disabled={running}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {running ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Running...
                      </>
                    ) : (
                      `Fix ${stateStats.without_state} Leads`
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Fix State Mappings - NEW SECTION TO FIX THE CALIFORNIA MESS */}
          <div className="border border-zinc-700 rounded-lg p-4 bg-zinc-800/50">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-zinc-400" />
                  <h4 className="font-medium text-gray-900 dark:text-white">
                    🚨 Fix Incorrect State Mappings
                  </h4>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Intelligently map cities to their correct states and fix truncated city names. This fixes issues like "New, California" → "New York, New York" and "Houston, California" → "Houston, Texas".
                </p>

                {stateMappingStats && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-[#1ED4A7]" />
                        <span className="text-gray-600 dark:text-gray-400">
                          {stateMappingStats.correct} correct
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-zinc-400" />
                        <span className="text-gray-600 dark:text-gray-400">
                          {stateMappingStats.incorrect} incorrect
                        </span>
                      </div>
                      {stateMappingStats.noState > 0 && (
                        <div className="flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-zinc-500" />
                          <span className="text-gray-600 dark:text-gray-400">
                            {stateMappingStats.noState} missing state
                          </span>
                        </div>
                      )}
                    </div>

                    {stateMappingStats.topIssues && stateMappingStats.topIssues.length > 0 && (
                      <div className="mt-2">
                        <button
                          onClick={() => setShowStateMappingSamples(!showStateMappingSamples)}
                          className="text-xs text-zinc-400 hover:underline font-medium"
                        >
                          {showStateMappingSamples ? 'Hide' : 'Show'} incorrect mappings
                        </button>
                        
                        {showStateMappingSamples && (
                          <div className="mt-2 space-y-2 text-xs">
                            {stateMappingStats.topIssues.map((issue: any, i: number) => (
                              <div key={i} className="bg-zinc-800/50 border border-zinc-700 rounded p-2">
                                <div className="font-medium text-zinc-300 mb-1">
                                  {issue.count} leads incorrectly marked as "{issue.incorrectState}":
                                </div>
                                {issue.examples.map((example: string, j: number) => (
                                  <div key={j} className="text-gray-700 dark:text-gray-300 ml-2">
                                    • {example}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {stateMappingStats.samples && stateMappingStats.samples.length > 0 && !showStateMappingSamples && (
                      <div className="mt-2 text-xs text-gray-500">
                        Examples: {stateMappingStats.samples.slice(0, 3).map((s: any) => `${s.city} (${s.currentState} → ${s.correctState})`).join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={loadStateMappingStats}
                  disabled={loadingStateMappingStats}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-zinc-700 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  {loadingStateMappingStats ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    'Analyze Issues'
                  )}
                </button>

                {stateMappingStats && stateMappingStats.incorrect > 0 && (
                  <button
                    onClick={runFixStateMappings}
                    disabled={running}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {running ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Fixing...
                      </>
                    ) : (
                      `Fix ${stateMappingStats.incorrect} Leads`
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* City Cleanup */}
          <div className="border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="w-4 h-4 text-gray-400" />
                  <h4 className="font-medium text-gray-900 dark:text-white">
                    City Name Cleanup
                  </h4>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Fix misspellings, abbreviations, and inconsistent capitalization in city names.
                  Example: "LA" → "Los Angeles", "nyc" → "New York"
                </p>

                {cityStats && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-[#1ED4A7]" />
                        <span className="text-gray-600 dark:text-gray-400">
                          {cityStats.total - cityStats.needsFixing - cityStats.empty} clean
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-zinc-500" />
                        <span className="text-gray-600 dark:text-gray-400">
                          {cityStats.needsFixing} need fixing
                        </span>
                      </div>
                      {cityStats.empty > 0 && (
                        <div className="flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-zinc-400" />
                          <span className="text-gray-600 dark:text-gray-400">
                            {cityStats.empty} empty
                          </span>
                        </div>
                      )}
                    </div>

                    {cityStats.needsFixing > 0 && (
                      <div className="text-xs text-gray-500">
                        <div>• {cityStats.abbreviations} abbreviations</div>
                        <div>• {cityStats.casingIssues} casing issues</div>
                        {cityStats.other > 0 && <div>• {cityStats.other} other issues</div>}
                      </div>
                    )}

                    {cityStats.samples && (
                      <div className="mt-2">
                        <button
                          onClick={() => setShowCitySamples(!showCitySamples)}
                          className="text-xs text-zinc-400 hover:underline"
                        >
                          {showCitySamples ? 'Hide' : 'Show'} examples
                        </button>
                        
                        {showCitySamples && (
                          <div className="mt-2 space-y-2 text-xs">
                            {cityStats.samples.abbreviations.length > 0 && (
                              <div className="bg-zinc-800/50 border border-zinc-700 rounded p-2">
                                <div className="font-medium text-zinc-300 mb-1">Abbreviations:</div>
                                {cityStats.samples.abbreviations.slice(0, 3).map((item: any, i: number) => (
                                  <div key={i} className="text-gray-700 dark:text-gray-300">
                                    "{item.original}" → "{item.normalized}"
                                  </div>
                                ))}
                              </div>
                            )}
                            {cityStats.samples.casingIssues.length > 0 && (
                              <div className="bg-zinc-800/50 border border-zinc-700 rounded p-2">
                                <div className="font-medium text-zinc-300 mb-1">Casing:</div>
                                {cityStats.samples.casingIssues.slice(0, 3).map((item: any, i: number) => (
                                  <div key={i} className="text-gray-700 dark:text-gray-300">
                                    "{item.original}" → "{item.normalized}"
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={loadCityStats}
                  disabled={loadingCityStats}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-zinc-700 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  {loadingCityStats ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    'Analyze Cities'
                  )}
                </button>

                {cityStats && cityStats.needsFixing > 0 && (
                  <button
                    onClick={runCityCleanup}
                    disabled={running}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {running ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Running...
                      </>
                    ) : (
                      `Fix ${cityStats.needsFixing} Cities`
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 pt-3 border-t border-gray-200 dark:border-zinc-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            💡 Tip: These scripts are safe to run multiple times and won't affect leads that already have data.
          </p>
        </div>
      </div>
    </div>
  );
}
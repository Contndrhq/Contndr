/**
 * AdminLeadBrowser — Admin panel for browsing ALL leads in the database,
 * filtering by category/state/city, and assigning them to specific user accounts.
 * Now with proper city filtering (same as CRM), "Select All from Results" functionality,
 * and full mobile optimization.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import {
  Search, Filter, ChevronDown, ChevronLeft, ChevronRight, Check,
  Loader2, Users, Database, UserPlus, Copy, ArrowRightLeft,
  Mail, Phone, Building2, MapPin, X, CheckSquare, Square,
  AlertTriangle, RefreshCw, ChevronUp, Globe,
} from 'lucide-react';
import { toast } from 'sonner';
import { isCountryName } from '../utils/country-names';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

interface Lead {
  id: string;
  user_id: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  state: string;
  country: string;
  category: string;
  status: string;
  source: string;
  brand: string;
  industry: string;
  title: string;
  created_at: string;
}

interface UserOption {
  id: string;
  email: string;
  name?: string;
}

interface ServerFilterOptions {
  categories: string[];
  countries: string[];
  statesByCountry: Record<string, string[]>;
  citiesByLocation: Record<string, string[]>;
}

export function AdminLeadBrowser({ searchTerm }: { searchTerm: string }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [loading, setLoading] = useState(false);
  const [filtersLoading, setFiltersLoading] = useState(true);

  // Server-side filter options (same structure as CRM)
  const [serverFilterOptions, setServerFilterOptions] = useState<ServerFilterOptions>({
    categories: [],
    countries: [],
    statesByCountry: {},
    citiesByLocation: {},
  });

  // Active filters
  const [selectedCountries, setSelectedCountries] = useState<string[]>(['United States']);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [hasEmail, setHasEmail] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const [showFilters, setShowFilters] = useState(true);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [selectAllResults, setSelectAllResults] = useState(false); // New: select all search results

  // Assign
  const [users, setUsers] = useState<UserOption[]>([]);
  const [targetUserId, setTargetUserId] = useState('');
  const [assignMode, setAssignMode] = useState<'copy' | 'move'>('copy');
  const [assigning, setAssigning] = useState(false);
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const searchTimeoutRef = useRef<any>(null);

  // ─── Computed Filter Options (Same as CRM logic) ───────────────────────────
  const availableStates = useMemo(() => {
    if (selectedCountries.length === 0) {
      // No country filter - show ALL states from all countries
      const allStates: string[] = [];
      Object.values(serverFilterOptions.statesByCountry || {}).forEach(states => {
        allStates.push(...states);
      });
      return Array.from(new Set(allStates)).sort();
    }
    
    // Countries selected - show only states from those countries
    const allStates: string[] = [];
    selectedCountries.forEach(country => {
      const states = serverFilterOptions.statesByCountry?.[country] || [];
      allStates.push(...states);
    });
    return Array.from(new Set(allStates)).sort();
  }, [selectedCountries, serverFilterOptions.statesByCountry]);

  const availableCities = useMemo(() => {
    if (selectedCountries.length === 0) {
      // No country filter - show ALL cities from all locations
      const allCities: string[] = [];
      Object.values(serverFilterOptions.citiesByLocation || {}).forEach(cities => {
        allCities.push(...cities);
      });
      return Array.from(new Set(allCities)).sort();
    }
    
    if (selectedStates.length === 0) {
      // Countries selected but no states - show cities from all selected countries
      const allCities: string[] = [];
      selectedCountries.forEach(country => {
        const cities = serverFilterOptions.citiesByLocation?.[country] || [];
        allCities.push(...cities);
      });
      return Array.from(new Set(allCities)).sort();
    }
    
    // Both countries and states selected - show cities only from those states
    const allCities: string[] = [];
    selectedCountries.forEach(country => {
      selectedStates.forEach(state => {
        const key = `${country}|${state}`;
        const cities = serverFilterOptions.citiesByLocation?.[key] || [];
        allCities.push(...cities);
      });
    });
    
    return Array.from(new Set(allCities)).sort();
  }, [selectedCountries, selectedStates, serverFilterOptions.citiesByLocation]);

  // Load filter options
  useEffect(() => {
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_BASE}/admin/leads/filters`, { headers });
        if (res.ok) {
          const data = await res.json();
          // Filter out dirty country data
          if (data.countries) {
            data.countries = data.countries.filter((c: string) => {
              if (!c || c.trim() === '') return false;
              if (/^-?\d+\.\d+/.test(c)) return false;
              if (c.includes(',')) return false;
              if (c.length > 50) return false;
              if (!isCountryName(c)) return false;
              return true;
            });
          }
          console.log('[ADMIN LEADS] Filter options:', data);
          setServerFilterOptions(data);
        }
      } catch (e) {
        console.error('[ADMIN LEADS] Failed to load filters:', e);
      } finally {
        setFiltersLoading(false);
      }
    })();
  }, []);

  // Load users list
  useEffect(() => {
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_BASE}/admin/users`, { headers });
        if (res.ok) {
          const data = await res.json();
          const userList = (data.users || []).map((u: any) => ({
            id: u.id,
            email: u.email,
            name: u.user_metadata?.name || u.user_metadata?.full_name || '',
          }));
          setUsers(userList);
        }
      } catch (e) {
        console.error('[ADMIN LEADS] Failed to load users:', e);
      }
    })();
  }, []);

  // Fetch leads with server-side filtering
  const fetchLeads = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({
        page: String(p),
        per_page: String(perPage),
      });
      if (localSearch) params.set('search', localSearch);
      
      // Use industry / category for backwards compatibility but support multiple via | delimited string
      if (selectedIndustries.length > 0) {
        params.set('industry', selectedIndustries.join('|'));
        params.set('category', selectedIndustries.join('|'));
      }
      
      // Send first selected country/state/city for server-side filtering
      // (Backend might only support single for admin, but we pass first for now)
      if (selectedCountries.length > 0) params.set('country', selectedCountries[0]);
      if (selectedStates.length > 0) params.set('state', selectedStates[0]);
      if (selectedCities.length > 0) params.set('city', selectedCities[0]);
      
      if (hasEmail) params.set('has_email', 'true');
      if (hasPhone) params.set('has_phone', 'true');

      const res = await fetch(`${API_BASE}/admin/leads/browse?${params}`, { headers });
      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        console.error(`[ADMIN LEADS] Server error ${res.status}: ${errorBody}`);
        throw new Error(`Server ${res.status}: ${errorBody || res.statusText}`);
      }
      const data = await res.json();
      setLeads(data.leads || []);
      setTotal(data.total || 0);
    } catch (e: any) {
      console.error('[ADMIN LEADS] Fetch error:', e);
      toast.error(e.message || 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, localSearch, selectedIndustries, selectedCountries, selectedStates, selectedCities, hasEmail, hasPhone]);

  // Auto-fetch on filter changes
  useEffect(() => {
    setPage(1);
    // Don't clear selections when filters change - let user maintain multi-page selection
    // setSelectedIds(new Set());
    // setSelectAll(false);
    setSelectAllResults(false);
    fetchLeads(1);
  }, [selectedIndustries, selectedCountries, selectedStates, selectedCities, hasEmail, hasPhone]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setPage(1);
      // Don't clear selections when searching - let user maintain multi-page selection
      // setSelectedIds(new Set());
      // setSelectAll(false);
      setSelectAllResults(false);
      fetchLeads(1);
    }, 400);
    return () => clearTimeout(searchTimeoutRef.current);
  }, [localSearch]);

  // Page change
  useEffect(() => {
    if (page > 1) fetchLeads(page);
  }, [page]);

  // Clear dependent filters when parent selection changes
  useEffect(() => {
    if (selectedCountries.length === 0) {
      setSelectedStates([]);
      setSelectedCities([]);
    }
  }, [selectedCountries]);

  useEffect(() => {
    if (selectedStates.length === 0) {
      setSelectedCities([]);
    }
  }, [selectedStates]);

  const totalPages = Math.ceil(total / perPage);

  // Selection handlers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Clear "select all results" flag when manually selecting
    setSelectAllResults(false);
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      // Deselect all current page leads
      setSelectedIds(prev => {
        const next = new Set(prev);
        leads.forEach(l => next.delete(l.id));
        return next;
      });
      setSelectAll(false);
    } else {
      // Select all current page leads (add to existing selections)
      setSelectedIds(prev => {
        const next = new Set(prev);
        leads.forEach(l => next.add(l.id));
        return next;
      });
      setSelectAll(true);
    }
    setSelectAllResults(false);
  };

  // Check if all leads on current page are selected
  useEffect(() => {
    if (leads.length > 0) {
      const allCurrentPageSelected = leads.every(l => selectedIds.has(l.id));
      setSelectAll(allCurrentPageSelected);
    } else {
      setSelectAll(false);
    }
  }, [leads, selectedIds]);

  const toggleSelectAllResults = () => {
    const newValue = !selectAllResults;
    setSelectAllResults(newValue);
    if (newValue) {
      // Clear individual selections when "select all results" is enabled
      setSelectedIds(new Set());
      setSelectAll(false);
    }
  };

  // Clear selections button
  const clearAllSelections = () => {
    setSelectedIds(new Set());
    setSelectAll(false);
    setSelectAllResults(false);
  };

  // Assign selected leads
  const handleAssign = async () => {
    if (!targetUserId) {
      toast.error('Please select a target user');
      return;
    }
    if (!selectAllResults && selectedIds.size === 0) {
      toast.error('No leads selected');
      return;
    }

    // If "Select All Results" is checked, use bulk assign endpoint
    if (selectAllResults) {
      await handleAssignAllFiltered();
      return;
    }

    setAssigning(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/leads/assign`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_ids: Array.from(selectedIds),
          target_user_id: targetUserId,
          mode: assignMode,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to assign');

      const targetUser = users.find(u => u.id === targetUserId);
      const label = targetUser?.email || targetUserId;

      if (data.assigned > 0) {
        toast.success(`${data.assigned} leads ${assignMode === 'copy' ? 'copied' : 'moved'} to ${label}${data.skipped ? ` (${data.skipped} duplicates skipped)` : ''}`);
      } else {
        toast.info(data.message || 'No new leads assigned (all duplicates)');
      }

      setSelectedIds(new Set());
      setSelectAll(false);
      if (assignMode === 'move') fetchLeads(page);
    } catch (e: any) {
      console.error('[ADMIN LEADS] Assign error:', e);
      toast.error(e.message || 'Failed to assign leads');
    } finally {
      setAssigning(false);
    }
  };

  // Assign all matching filters
  const handleAssignAllFiltered = async () => {
    if (!targetUserId) {
      toast.error('Please select a target user');
      return;
    }
    if (!confirm(`This will copy up to 5,000 leads matching current filters to the selected user. Continue?`)) return;

    setAssigning(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/leads/assign-filtered`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_user_id: targetUserId,
          industry: selectedIndustries.length > 0 ? selectedIndustries[0] : undefined,
          category: selectedIndustries.length > 0 ? selectedIndustries[0] : undefined,
          state: selectedStates.length > 0 ? selectedStates[0] : undefined,
          city: selectedCities.length > 0 ? selectedCities[0] : undefined,
          country: selectedCountries.length > 0 ? selectedCountries[0] : undefined,
          search: localSearch || undefined,
          has_email: hasEmail || undefined,
          has_phone: hasPhone || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to assign');

      const targetUser = users.find(u => u.id === targetUserId);
      const label = targetUser?.email || targetUserId;

      if (data.assigned > 0) {
        toast.success(`${data.assigned} leads copied to ${label}${data.skipped ? ` (${data.skipped} duplicates skipped)` : ''}`);
      } else {
        toast.info(data.message || 'No new leads to assign');
      }
      
      setSelectAllResults(false);
    } catch (e: any) {
      console.error('[ADMIN LEADS] Bulk assign error:', e);
      toast.error(e.message || 'Failed to bulk assign');
    } finally {
      setAssigning(false);
    }
  };

  const filteredUsers = users.filter(u =>
    !userSearch ||
    u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.name && u.name.toLowerCase().includes(userSearch.toLowerCase()))
  );

  const selectedUser = users.find(u => u.id === targetUserId);

  // Multi-select filter component (for countries, states, cities)
  const MultiSelectFilter = ({ 
    label, 
    selected, 
    onChange, 
    options, 
    icon: Icon,
    disabled 
  }: {
    label: string;
    selected: string[];
    onChange: (values: string[]) => void;
    options: string[];
    icon?: any;
    disabled?: boolean;
  }) => {
    const [isOpen, setIsOpen] = useState(false);
    
    const toggleOption = (option: string) => {
      if (selected.includes(option)) {
        onChange(selected.filter(v => v !== option));
      } else {
        onChange([...selected, option]);
      }
    };

    return (
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{label}</label>
        <div className="relative">
          <button
            onClick={() => !disabled && setIsOpen(!isOpen)}
            disabled={disabled}
            className={`w-full flex items-center justify-between ${Icon ? 'pl-8' : 'pl-3'} pr-8 py-2 bg-zinc-50 dark:bg-[#111] border border-zinc-200 dark:border-white/5 rounded-lg text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-teal-500 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className={selected.length === 0 ? 'text-zinc-500' : ''}>
              {selected.length === 0 ? `All ${label}` : `${selected.length} selected`}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
          </button>
          {Icon && <Icon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />}
          
          {isOpen && !disabled && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
              <div className="absolute z-50 top-full mt-1 left-0 w-full min-w-[200px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                {options.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-zinc-400">No options available</div>
                ) : (
                  <>
                    <button
                      onClick={() => onChange([])}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-zinc-600 dark:text-zinc-400"
                    >
                      Clear Selection
                    </button>
                    {options.map(option => (
                      <button
                        key={option}
                        onClick={() => toggleOption(option)}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors flex items-center justify-between ${selected.includes(option) ? 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-500/10' : 'text-zinc-900 dark:text-zinc-200'}`}
                      >
                        <span className="truncate">{option}</span>
                        {selected.includes(option) && <Check className="w-3.5 h-3.5 shrink-0 ml-2" />}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };



  return (
    <div className="flex flex-col h-full min-h-0 gap-3 sm:gap-4 overflow-y-auto md:overflow-hidden p-3 sm:p-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0">
            <Database className="w-4.5 h-4.5 text-teal-500" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">Lead Database Browser</h2>
            <p className="text-[11px] text-zinc-500 truncate">
              {total.toLocaleString()} leads in database
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border whitespace-nowrap ${showFilters ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20' : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700/50 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Filters</span>
            {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <button
            onClick={() => { setShowAssignPanel(!showAssignPanel); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border whitespace-nowrap ${showAssignPanel ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-300 dark:border-zinc-600' : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700/50 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Assign</span>
          </button>
          <button
            onClick={() => fetchLeads(page)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 dark:bg-zinc-800 border border-zinc-700/50 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Assign Panel */}
      {showAssignPanel && (
        <div className="bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl p-3 sm:p-4 shadow-sm dark:shadow-none">
          <div className="flex flex-col gap-3">
            {/* User selector */}
            <div className="flex-1 min-w-0">
              <label className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1 block">Target User Account</label>
              <div className="relative">
                <button
                  onClick={() => setShowUserDropdown(!showUserDropdown)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs text-left transition-colors hover:border-teal-500"
                >
                  <span className={`truncate ${selectedUser ? 'text-white' : 'text-zinc-500'}`}>
                    {selectedUser ? `${selectedUser.name ? selectedUser.name + ' — ' : ''}${selectedUser.email}` : 'Select user...'}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0 ml-2" />
                </button>

                {showUserDropdown && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowUserDropdown(false)} />
                    <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl max-h-60 overflow-hidden flex flex-col">
                      <div className="p-2 border-b border-zinc-200 dark:border-zinc-700">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
                          <input
                            type="text"
                            value={userSearch}
                            onChange={e => setUserSearch(e.target.value)}
                            placeholder="Search users..."
                            className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-teal-500"
                            autoFocus
                          />
                        </div>
                      </div>
                      <div className="overflow-y-auto max-h-48">
                        {filteredUsers.map(u => (
                          <button
                            key={u.id}
                            onClick={() => { setTargetUserId(u.id); setShowUserDropdown(false); setUserSearch(''); }}
                            className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-700 transition-colors flex items-center justify-between ${u.id === targetUserId ? 'bg-teal-500/10 text-teal-400' : 'text-zinc-300'}`}
                          >
                            <div className="truncate">
                              {u.name && <span className="font-medium">{u.name} — </span>}
                              <span className="text-zinc-400">{u.email}</span>
                            </div>
                            {u.id === targetUserId && <Check className="w-3.5 h-3.5 text-teal-500 shrink-0" />}
                          </button>
                        ))}
                        {filteredUsers.length === 0 && (
                          <p className="px-3 py-3 text-xs text-zinc-400 text-center">No users found</p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              {/* Mode toggle */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Mode</label>
                <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5">
                  <button
                    onClick={() => setAssignMode('copy')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${assignMode === 'copy' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </button>
                  <button
                    onClick={() => setAssignMode('move')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${assignMode === 'move' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    <ArrowRightLeft className="w-3 h-3" />
                    Move
                  </button>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 flex-wrap sm:ml-auto">
                <button
                  onClick={handleAssign}
                  disabled={assigning || (!selectAllResults && selectedIds.size === 0) || !targetUserId}
                  className="flex items-center gap-1.5 px-4 py-2 bg-zinc-900 text-white dark:bg-white dark:text-black rounded-lg text-xs font-semibold transition-all hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap min-h-[44px]"
                >
                  {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                  {selectAllResults 
                    ? `Copy All (${Math.min(total, 5000).toLocaleString()})`
                    : selectedIds.size > 0 
                      ? `${assignMode === 'copy' ? 'Copy' : 'Move'} ${selectedIds.size}` 
                      : 'Assign Selected'
                  }
                </button>
              </div>
            </div>
          </div>

          {assignMode === 'move' && (
            <div className="mt-2 flex items-start gap-2 text-[11px] text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Move mode will reassign lead ownership. The original user will lose access to these leads.
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <div className="bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl p-3 sm:p-4 shadow-sm dark:shadow-none">
          <div className="flex flex-col gap-3">
            {/* Search */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
                <input
                  type="text"
                  value={localSearch}
                  onChange={e => setLocalSearch(e.target.value)}
                  placeholder="Name, email, business, industry..."
                  className="w-full pl-8 pr-3 py-2 bg-zinc-50 dark:bg-[#111] border border-zinc-200 dark:border-white/5 rounded-lg text-xs text-zinc-900 dark:text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                />
                {localSearch && (
                  <button onClick={() => setLocalSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    <X className="w-3.5 h-3.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" />
                  </button>
                )}
              </div>
            </div>

            {/* Filters Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <MultiSelectFilter label="Industry" selected={selectedIndustries} onChange={setSelectedIndustries} options={serverFilterOptions.categories} icon={Building2} />
              <MultiSelectFilter label="Country" selected={selectedCountries} onChange={setSelectedCountries} options={serverFilterOptions.countries} icon={Globe} />
              <MultiSelectFilter label="State" selected={selectedStates} onChange={setSelectedStates} options={availableStates} icon={MapPin} disabled={selectedCountries.length === 0} />
              <MultiSelectFilter label="City" selected={selectedCities} onChange={setSelectedCities} options={availableCities} icon={MapPin} disabled={selectedCountries.length === 0} />
            </div>
          </div>

          {/* Quick toggles */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-3 pt-3 border-t border-zinc-200 dark:border-white/5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={hasEmail} onChange={e => setHasEmail(e.target.checked)} className="rounded border-zinc-600 text-teal-500 focus:ring-teal-500 w-3.5 h-3.5" />
              <span className="text-xs text-zinc-400 flex items-center gap-1">
                <Mail className="w-3 h-3" /> Has Email
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={hasPhone} onChange={e => setHasPhone(e.target.checked)} className="rounded border-zinc-600 text-teal-500 focus:ring-teal-500 w-3.5 h-3.5" />
              <span className="text-xs text-zinc-400 flex items-center gap-1">
                <Phone className="w-3 h-3" /> Has Phone
              </span>
            </label>
            {(selectedIndustries.length > 0 || selectedCountries.length > 0 || selectedStates.length > 0 || selectedCities.length > 0 || localSearch || hasEmail || hasPhone) && (
              <button
                onClick={() => { 
                  setSelectedIndustries([]);
                  setSelectedCountries([]);
                  setSelectedStates([]);
                  setSelectedCities([]);
                  setLocalSearch(''); 
                  setHasEmail(false); 
                  setHasPhone(false); 
                }}
                className="text-xs text-teal-400 hover:underline ml-auto"
              >
                Clear All Filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 min-h-0 md:overflow-hidden bg-white dark:bg-[#0A0A0A] border border-zinc-200 dark:border-white/5 rounded-xl flex flex-col shadow-sm dark:shadow-none">
        {/* Desktop Table header — hidden on mobile */}
        <div className="hidden md:grid grid-cols-[40px_1.3fr_1.2fr_0.8fr_0.8fr_0.8fr_0.7fr_0.6fr] gap-2 px-4 py-2.5 border-b border-zinc-200 dark:border-white/5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          <div className="flex items-center justify-center">
            <button onClick={toggleSelectAll} className="text-zinc-400 hover:text-teal-500 transition-colors">
              {selectAll ? <CheckSquare className="w-4 h-4 text-teal-500" /> : <Square className="w-4 h-4" />}
            </button>
          </div>
          <div>Contact / Business</div>
          <div>Email</div>
          <div>Phone</div>
          <div>Industry</div>
          <div>Location</div>
          <div>Source</div>
          <div>Added</div>
        </div>

        {/* Selection Status Bar (Desktop and Mobile) */}
        {(selectedIds.size > 0 || selectAllResults) && (
          <div className="px-3 sm:px-4 py-2.5 border-b border-zinc-200 dark:border-white/5 bg-teal-500/5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 flex-1">
              <CheckSquare className="w-4 h-4 text-teal-500 shrink-0" />
              <span className="text-xs text-zinc-300 font-medium">
                {selectAllResults 
                  ? `All ${Math.min(total, 5000).toLocaleString()} matching results selected`
                  : `${selectedIds.size} lead${selectedIds.size === 1 ? '' : 's'} selected`
                }
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {!selectAllResults && total > perPage && (
                <button
                  onClick={toggleSelectAllResults}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/10 text-teal-400 border border-teal-500/20 rounded-lg text-xs font-medium hover:bg-teal-500/20 transition-colors whitespace-nowrap"
                >
                  <Database className="w-3 h-3" />
                  Select all {Math.min(total, 5000).toLocaleString()} results
                </button>
              )}
              <button
                onClick={clearAllSelections}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-zinc-400 rounded-lg text-xs font-medium hover:text-white transition-colors whitespace-nowrap"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Mobile header — select all bar */}
        <div className="md:hidden flex flex-col gap-2 px-3 py-2 border-b border-white/5">
          <div className="flex items-center justify-between">
            <button onClick={toggleSelectAll} className="flex items-center gap-2 text-xs text-zinc-400 hover:text-teal-400 transition-colors min-h-[44px]">
              {selectAll ? <CheckSquare className="w-4 h-4 text-teal-500" /> : <Square className="w-4 h-4" />}
              {selectAll ? 'Deselect Page' : 'Select Page'}
            </button>
            {selectedIds.size > 0 && (
              <span className="text-[11px] text-teal-400 font-medium">{selectedIds.size} selected</span>
            )}
          </div>
          {/* "Select All Results" button */}
          <label className="flex items-center gap-2 cursor-pointer min-h-[44px] border-t border-white/5 pt-2">
            <input 
              type="checkbox" 
              checked={selectAllResults} 
              onChange={toggleSelectAllResults}
              className="rounded border-zinc-600 text-teal-500 focus:ring-teal-500 w-4 h-4" 
            />
            <span className="text-xs text-zinc-300 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5" />
              Select all {Math.min(total, 5000).toLocaleString()} matching results
            </span>
          </label>
        </div>

        {/* Rows */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 text-teal-500 animate-spin" />
              <span className="ml-2 text-xs text-zinc-500">Loading leads...</span>
            </div>
          ) : leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
              <Database className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">No leads found</p>
              <p className="text-[11px] mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            leads.map(lead => {
              const isSelected = selectedIds.has(lead.id);
              return (
                <div key={lead.id}>
                  {/* Desktop row */}
                  <div
                    onClick={() => toggleSelect(lead.id)}
                    className={`hidden md:grid grid-cols-[40px_1.3fr_1.2fr_0.8fr_0.8fr_0.8fr_0.7fr_0.6fr] gap-2 px-4 py-2.5 border-b border-white/[0.03] text-xs cursor-pointer transition-colors ${isSelected ? 'bg-teal-500/10' : 'hover:bg-white/[0.02]'}`}
                  >
                    <div className="flex items-center justify-center">
                      {isSelected ? <CheckSquare className="w-4 h-4 text-teal-500" /> : <Square className="w-4 h-4 text-zinc-600" />}
                    </div>
                    <div className="truncate">
                      <div className="font-medium text-white truncate">{lead.contact_name || '—'}</div>
                      <div className="text-[11px] text-zinc-500 truncate">{lead.business_name || ''}</div>
                    </div>
                    <div className="truncate text-zinc-400 flex items-center gap-1">
                      {lead.email ? (
                        <>
                          <Mail className="w-3 h-3 text-teal-500 shrink-0" />
                          <span className="truncate">{lead.email}</span>
                        </>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </div>
                    <div className="truncate text-zinc-400 flex items-center gap-1">
                      {lead.phone ? (
                        <>
                          <Phone className="w-3 h-3 text-zinc-500 shrink-0" />
                          <span className="truncate">{lead.phone}</span>
                        </>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </div>
                    <div className="truncate text-zinc-400">
                      {lead.industry || lead.category || <span className="text-zinc-600">—</span>}
                    </div>
                    <div className="truncate text-zinc-400">
                      {lead.city && lead.state ? `${lead.city}, ${lead.state}` : lead.city || lead.state || <span className="text-zinc-600">—</span>}
                    </div>
                    <div className="truncate text-zinc-500 text-[11px]">{lead.source || '—'}</div>
                    <div className="text-zinc-500 text-[11px]">
                      {lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </div>
                  </div>

                  {/* Mobile card */}
                  <div
                    onClick={() => toggleSelect(lead.id)}
                    className={`md:hidden flex gap-3 px-3 py-3 border-b border-white/[0.03] cursor-pointer transition-colors min-h-[70px] ${isSelected ? 'bg-teal-500/10' : 'active:bg-white/[0.02]'}`}
                  >
                    <div className="flex items-start pt-1">
                      {isSelected ? <CheckSquare className="w-5 h-5 text-teal-500" /> : <Square className="w-5 h-5 text-zinc-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white text-sm truncate">{lead.contact_name || lead.business_name || 'Unknown'}</div>
                      {lead.contact_name && lead.business_name && (
                        <div className="text-[11px] text-zinc-500 truncate">{lead.business_name}</div>
                      )}
                      {lead.email && (
                        <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1 truncate">
                          <Mail className="w-3 h-3 text-teal-500 shrink-0" />
                          <span className="truncate">{lead.email}</span>
                        </div>
                      )}
                      {lead.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-0.5 truncate">
                          <Phone className="w-3 h-3 text-zinc-500 shrink-0" />
                          <span className="truncate">{lead.phone}</span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        {(lead.industry || lead.category) && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded">{lead.industry || lead.category}</span>
                        )}
                        {(lead.city || lead.state) && (
                          <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                            <MapPin className="w-2.5 h-2.5" />
                            {lead.city && lead.state ? `${lead.city}, ${lead.state}` : lead.city || lead.state}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-3 sm:px-4 py-3 border-t border-zinc-200 dark:border-white/5">
            <div className="text-[11px] text-zinc-500">
              Page {page} of {totalPages}
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 sm:p-2 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-zinc-400 px-2">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 sm:p-2 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
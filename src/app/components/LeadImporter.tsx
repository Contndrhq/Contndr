import { useState, useEffect, useRef } from 'react';
import { X, Search, Download, AlertCircle, MapPin, Folder } from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { ProgressIndicator, ProgressStep } from './ProgressIndicator';

interface LeadImporterProps {
  onClose: () => void;
  onImportComplete?: () => void;
}

interface LocationSuggestion {
  place_name: string;
  center: [number, number]; // [longitude, latitude]
  text: string;
}

// Common business search queries
const SEARCH_SUGGESTIONS = [
  'Auto repair shop',
  'Car dealership',
  'Mechanic',
  'Body shop',
  'Tire shop',
  'Oil change',
  'Restaurant',
  'Cafe',
  'Coffee shop',
  'Bar',
  'Pizza restaurant',
  'Italian restaurant',
  'Mexican restaurant',
  'Fast food',
  'Bakery',
  'Hotel',
  'Gym',
  'Fitness center',
  'Yoga studio',
  'Spa',
  'Salon',
  'Barber shop',
  'Dentist',
  'Doctor',
  'Veterinarian',
  'Pet store',
  'Real estate agent',
  'Law firm',
  'Accounting firm',
  'Insurance agency',
  'Plumber',
  'Electrician',
  'Contractor',
  'Roofing company',
  'Landscaping',
  'Cleaning service',
];

export function LeadImporter({ onClose, onImportComplete }: LeadImporterProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [location, setLocation] = useState('');
  const [locationCoordinates, setLocationCoordinates] = useState(''); // Store coordinates separately
  const [limit, setLimit] = useState(50); // Increased default from 20 to 50
  const [importing, setImporting] = useState(false);
  const [importSteps, setImportSteps] = useState<ProgressStep[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedBrand, setSelectedBrand] = useState<'roadr' | 'sourcr'>('sourcr'); // Default to Sourcr
  const [searchAllUSA, setSearchAllUSA] = useState(false);
  
  // Group selection
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  
  // New group creation
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  
  // Autocomplete states
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  
  const searchInputRef = useRef<HTMLInputElement>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const searchSuggestionsRef = useRef<HTMLDivElement>(null);
  const locationSuggestionsRef = useRef<HTMLDivElement>(null);

  // Load groups on mount
  useEffect(() => {
    loadGroups();
  }, []);

  async function loadGroups() {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-groups`,
        { headers }
      );

      if (response.ok) {
        const data = await response.json();
        setGroups(data.groups || []);
      }
    } catch (error) {
      console.error('Error loading groups:', error);
    }
  }

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchSuggestionsRef.current && !searchSuggestionsRef.current.contains(event.target as Node) && 
          searchInputRef.current && !searchInputRef.current.contains(event.target as Node)) {
        setShowSearchSuggestions(false);
      }
      if (locationSuggestionsRef.current && !locationSuggestionsRef.current.contains(event.target as Node) && 
          locationInputRef.current && !locationInputRef.current.contains(event.target as Node)) {
        setShowLocationSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter search suggestions
  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      const filtered = SEARCH_SUGGESTIONS.filter(s => 
        s.toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 8);
      setSearchSuggestions(filtered);
    } else {
      setSearchSuggestions([]);
    }
  }, [searchQuery]);

  // Fetch location suggestions from Mapbox
  useEffect(() => {
    const fetchLocationSuggestions = async () => {
      if (location.trim().length < 2) {
        setLocationSuggestions([]);
        return;
      }

      setLoadingLocations(true);
      try {
        const headers = await getAuthHeaders();
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/mapbox/geocode?query=${encodeURIComponent(location)}`,
          {
            headers,
          }
        );

        if (response.ok) {
          const data = await response.json();
          setLocationSuggestions(data.features || []);
        }
      } catch (err) {
        console.error('Error fetching location suggestions:', err);
      } finally {
        setLoadingLocations(false);
      }
    };

    const debounceTimer = setTimeout(fetchLocationSuggestions, 300);
    return () => clearTimeout(debounceTimer);
  }, [location]);

  async function handleImport() {
    if (!searchQuery || (!location && !searchAllUSA)) {
      setError('Please enter both business type and location');
      return;
    }

    setImporting(true);
    setError('');
    setSuccess('');
    setResults([]);
    
    // Initialize progress steps
    setImportSteps([
      { id: 'discover', label: 'Finding Businesses', status: 'loading', description: `Searching for ${limit} businesses matching "${searchQuery}" in ${location}` },
      { id: 'scrape', label: 'Getting Contact Info', status: 'pending', description: 'Extracting email addresses from websites' },
      { id: 'import', label: 'Importing Leads', status: 'pending', description: 'Saving leads to your account' },
    ]);

    try {
      const headers = await getAuthHeaders();

      // Step 1: Discover leads from SerpAPI
      const discoverResponse = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/discover`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: searchQuery,
            location: locationCoordinates || location, // Use coordinates if available, otherwise text
            limit,
          }),
        }
      );

      if (!discoverResponse.ok) {
        const errorData = await discoverResponse.json();
        setImportSteps(prev => prev.map(s => 
          s.id === 'discover' 
            ? { ...s, status: 'error', errorMessage: errorData.error || 'Failed to discover leads' }
            : s
        ));
        throw new Error(errorData.error || 'Failed to discover leads');
      }

      const discoverData = await discoverResponse.json();

      if (!discoverData.success || !discoverData.leads || discoverData.leads.length === 0) {
        setImportSteps(prev => prev.map(s => 
          s.id === 'discover' 
            ? { ...s, status: 'error', errorMessage: 'No leads found with valid email addresses' }
            : s
        ));
        setError('No leads found with valid email addresses. Try a different search or location.');
        setImporting(false);
        return;
      }

      // Complete discovery step
      setImportSteps(prev => prev.map(s => 
        s.id === 'discover' 
          ? { ...s, status: 'complete' }
          : s.id === 'scrape'
          ? { ...s, status: 'complete', description: `Found ${discoverData.leads.length} businesses with verified emails` }
          : s
      ));

      setResults(discoverData.leads);

      // Start import step
      setImportSteps(prev => prev.map(s => 
        s.id === 'import' 
          ? { ...s, status: 'loading', description: `Saving ${discoverData.leads.length} leads...` }
          : s
      ));

      // Step 2: Import discovered leads into database
      const importResponse = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/import`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            leads: discoverData.leads,
            org_id: null, // Will use default org
            group_id: selectedGroupId || null, // Add group_id if selected
            brand: selectedBrand, // Add brand tag
          }),
        }
      );

      if (!importResponse.ok) {
        const errorData = await importResponse.json();
        
        setImportSteps(prev => prev.map(s => 
          s.id === 'import' 
            ? { ...s, status: 'error', errorMessage: errorData.error || 'Failed to import leads' }
            : s
        ));
        
        // Check if error is related to missing brand column
        if (errorData.details && errorData.details.includes('column "brand"')) {
          throw new Error('Database migration required: Please run the latest schema migration to add the "brand" column. Go to Database Setup and run the migration script.');
        }
        
        throw new Error(errorData.error || 'Failed to import leads');
      }

      const importData = await importResponse.json();
      
      // Complete import step
      setImportSteps(prev => prev.map(s => 
        s.id === 'import' 
          ? { ...s, status: 'complete' }
          : s
      ));
      
      // Build a success message that surfaces both how many landed AND how
      // many were dropped because the emails would have bounced. Silent skips
      // were the old failure mode: users saw "imported 500" but the CSV had
      // 700 rows because 200 silently bounced — now they know up front.
      const parts: string[] = [`Successfully imported ${importData.total} leads`];
      if (importData.duplicates > 0) {
        parts.push(`${importData.duplicates} duplicate${importData.duplicates === 1 ? '' : 's'} skipped`);
      }
      if (importData.verification_skipped > 0) {
        parts.push(`${importData.verification_skipped} skipped: emails would bounce (saving your sending reputation)`);
      }
      if (importData.verification_risky > 0) {
        parts.push(`${importData.verification_risky} flagged as risky (role-based or weak signal — review before sending)`);
      }
      setSuccess(parts.join('. ') + '.');

      // Call the callback if provided
      if (onImportComplete) {
        onImportComplete();
      }

      // Auto-close after 4s so the user has time to read the verification
      // summary if it's long. Plain successes still feel fast.
      const closeDelay = (importData.verification_skipped > 0 || importData.verification_risky > 0) ? 4000 : 2000;
      setTimeout(() => {
        onClose();
      }, closeDelay);

    } catch (err: any) {
      console.error('Error importing leads:', err);
      
      // Try to get more detailed error info
      let errorMessage = err.message || 'Failed to import leads';
      
      if (errorMessage.includes('SerpAPI') || errorMessage.includes('discovery')) {
        errorMessage += ' - Please verify your lead discovery service key is configured correctly and has available credits.';
      }
      
      setError(errorMessage);
    } finally {
      setImporting(false);
    }
  }

  async function createGroup() {
    if (!newGroupName.trim()) {
      setError('Please enter a group name');
      return;
    }

    setCreatingGroup(true);
    setError('');
    
    try {
      const headers = await getAuthHeaders();

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-groups`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: newGroupName,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to create group');
        throw new Error(errorData.error || 'Failed to create group');
      }

      const groupData = await response.json();
      
      // Add new group to the list
      setGroups(prev => [...prev, groupData.group]);
      
      // Select the new group
      setSelectedGroupId(groupData.group.id);
      
      // Close the create group form
      setShowCreateGroup(false);
      
      setSuccess(`Successfully created group "${newGroupName}"!`);
      
      // Auto-close after 2 seconds on success
      setTimeout(() => {
        setSuccess('');
      }, 2000);

    } catch (err: any) {
      console.error('Error creating group:', err);
      
      // Try to get more detailed error info
      let errorMessage = err.message || 'Failed to create group';
      
      setError(errorMessage);
    } finally {
      setCreatingGroup(false);
    }
  }

  return (
    <div className="p-6">
      <button
        onClick={onClose}
        className="absolute right-6 p-2 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors z-10"
        style={{ top: 'max(env(safe-area-inset-top, 24px), 24px)' }}
      >
        <X className="w-5 h-5" />
      </button>

      <div className="mb-6">
        <h2 className="text-zinc-900 dark:text-white">Discover Leads</h2>
        <p className="text-zinc-500 dark:text-zinc-400 mt-1">
          Search for businesses and automatically find their contact information
        </p>
      </div>

      {/* Progress Indicator - Show when importing */}
      {importing && importSteps.length > 0 && (
        <div className="mb-6">
          <ProgressIndicator 
            steps={importSteps}
            title="Discovering Leads"
            subtitle="Finding and verifying business contacts..."
          />
        </div>
      )}

      {/* Search Form */}
      <div className="space-y-4">
        {/* Brand Selection - Prominent at the top */}
        <div>
          <label className="block text-zinc-700 dark:text-zinc-300 mb-2">
            Target Brand
          </label>
          <div className="flex items-center gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
            <button
              type="button"
              onClick={() => setSelectedBrand('roadr')}
              className={`flex-1 px-4 py-2.5 rounded-md text-[14px] font-medium transition-all ${
                selectedBrand === 'roadr'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              Roadr
              <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Auto repair shops</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedBrand('sourcr')}
              className={`flex-1 px-4 py-2.5 rounded-md text-[14px] font-medium transition-all ${
                selectedBrand === 'sourcr'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              Sourcr
              <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Web/app dev clients</span>
            </button>
          </div>
          <p className="text-zinc-500 dark:text-zinc-400 text-[13px] mt-1.5">
            Tag these leads for {selectedBrand === 'roadr' ? 'Roadr (auto shops)' : 'Sourcr (web/app clients)'}
          </p>
        </div>

        <div className="relative">
          <label className="block text-zinc-700 dark:text-zinc-300 mb-2">
            <Search className="w-4 h-4 inline mr-1.5" />
            Search Query
          </label>
          <input
            type="text"
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
              setShowSearchSuggestions(true);
            }}
            onFocus={() => setShowSearchSuggestions(true)}
            placeholder="e.g., auto repair shop"
            className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 text-[14px]"
            onKeyPress={e => e.key === 'Enter' && !importing && handleImport()}
            ref={searchInputRef}
          />
          {showSearchSuggestions && searchSuggestions.length > 0 && (
            <div
              className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg shadow-lg"
              ref={searchSuggestionsRef}
            >
              {searchSuggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="w-full text-left px-4 py-2.5 text-[14px] text-zinc-900 dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  onClick={() => {
                    setSearchQuery(suggestion);
                    setShowSearchSuggestions(false);
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <label className="block text-zinc-700 dark:text-zinc-300 mb-2">
            <MapPin className="w-4 h-4 inline mr-1.5" />
            Location
          </label>
          <input
            type="text"
            value={location}
            disabled={searchAllUSA}
            onChange={e => {
              setLocation(e.target.value);
              setShowLocationSuggestions(true);
            }}
            onFocus={() => !searchAllUSA && setShowLocationSuggestions(true)}
            placeholder={searchAllUSA ? "United States (Entire Country)" : "Start typing a city or address..."}
            className={`w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 text-[14px] ${
              searchAllUSA ? 'opacity-70 bg-zinc-50 dark:bg-zinc-800 cursor-not-allowed' : ''
            }`}
            onKeyPress={e => e.key === 'Enter' && !importing && handleImport()}
            ref={locationInputRef}
          />
          {showLocationSuggestions && (locationSuggestions.length > 0 || loadingLocations) && (
            <div
              className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg shadow-lg"
              ref={locationSuggestionsRef}
            >
              {loadingLocations && (
                <div className="px-4 py-3 text-[13px] text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-zinc-400 border-t-transparent"></div>
                  <span>Searching locations...</span>
                </div>
              )}
              {!loadingLocations && locationSuggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="w-full text-left px-4 py-2.5 text-[14px] text-zinc-900 dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors border-b border-zinc-100 dark:border-zinc-800 last:border-0"
                  onClick={() => {
                    // Show location name in the UI, store coordinates for the backend
                    const [lng, lat] = suggestion.center;
                    setLocation(suggestion.place_name); // Display the readable location
                    setLocationCoordinates(`@${lat},${lng},15z`); // Store coordinates for backend
                    setShowLocationSuggestions(false);
                  }}
                >
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-zinc-400 dark:text-zinc-500 flex-shrink-0 mt-0.5" />
                    <span>{suggestion.place_name}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 mt-2 ml-1">
            <input
              type="checkbox"
              id="searchAllUSA"
              checked={searchAllUSA}
              onChange={(e) => {
                setSearchAllUSA(e.target.checked);
                if (e.target.checked) {
                  setLocation('United States');
                  setLocationCoordinates('');
                  setShowLocationSuggestions(false);
                } else {
                  setLocation('');
                }
              }}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 accent-zinc-900 dark:accent-white bg-white dark:bg-zinc-900 cursor-pointer"
            />
            <label htmlFor="searchAllUSA" className="text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
              Search entire United States (Broad search)
            </label>
          </div>
        </div>

        <div>
          <label className="block text-zinc-700 dark:text-zinc-300 mb-2">Number of Leads</label>
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 text-[14px]"
          >
            <option value={10}>10 leads</option>
            <option value={20}>20 leads (Recommended)</option>
            <option value={40}>40 leads</option>
            <option value={60}>60 leads</option>
            <option value={100}>100 leads (Maximum)</option>
          </select>
          <p className="text-zinc-500 dark:text-zinc-400 text-[13px] mt-1.5">
            We verify and enrich email addresses for quality. 100 lead maximum to prevent timeout.
          </p>
        </div>

        {/* Group Selection - Always visible */}
        <div className="p-4 border-2 border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-950">
          <div className="flex items-center justify-between mb-3">
            <label className="block text-zinc-900 dark:text-white font-medium">
              <Folder className="w-4 h-4 inline mr-1.5" />
              Save to Group (Recommended)
            </label>
            {!showCreateGroup && (
              <button
                onClick={() => setShowCreateGroup(true)}
                className="text-[#1ED4A7] dark:text-[#1ED4A7] text-[13px] font-medium hover:underline"
              >
                + New Group
              </button>
            )}
          </div>

          {!showCreateGroup && groups.length === 0 && (
            <div className="text-zinc-600 dark:text-zinc-400 text-[13px] mb-3">
              No groups yet. Create one to organize your leads!
            </div>
          )}

          {!showCreateGroup && groups.length > 0 && (
            <>
              <select
                value={selectedGroupId}
                onChange={e => setSelectedGroupId(e.target.value)}
                className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 text-[14px] mb-2"
              >
                <option value="">Don't add to a group</option>
                {groups.map(group => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </>
          )}

          {showCreateGroup && (
            <div className="space-y-3">
              <input
                type="text"
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                placeholder="e.g., Miami Investor Leads, SF Seed VCs..."
                className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 text-[14px]"
                onKeyPress={e => e.key === 'Enter' && !creatingGroup && createGroup()}
              />
              <div className="flex gap-2">
                <button
                  onClick={createGroup}
                  disabled={creatingGroup || !newGroupName.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[#1ED4A7] dark:bg-[#1ED4A7] text-white dark:text-zinc-900 rounded-lg hover:bg-[#1ED4A7]/90 dark:hover:bg-[#1ED4A7]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-[13px] font-medium"
                >
                  <Folder className="w-4 h-4" />
                  <span>{creatingGroup ? 'Creating...' : 'Create Group'}</span>
                </button>
                <button
                  onClick={() => {
                    setShowCreateGroup(false);
                    setNewGroupName('');
                  }}
                  className="px-4 py-2 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-[13px] font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <p className="text-zinc-600 dark:text-zinc-400 text-[12px] mt-2">
            💡 Groups help you organize leads by campaign (e.g., "SF Angels", "NYC Early-Stage VCs") so you can select them all at once when creating campaigns.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-lg">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-800 dark:text-red-200 text-[14px]">{error}</p>
          </div>
        )}

        {success && (
          <div className="flex items-start gap-2 p-4 bg-[#1ED4A7]/10 dark:bg-[#1ED4A7]/10 border border-[#1ED4A7]/30 dark:border-[#1ED4A7]/30 rounded-lg animate-fade-in">
            <Download className="w-5 h-5 text-[#1ED4A7] dark:text-[#1ED4A7] flex-shrink-0 mt-0.5" />
            <p className="text-[#1ED4A7] dark:text-[#1ED4A7] text-[14px]">{success}</p>
          </div>
        )}

        {results.length > 0 && !success && (
          <div className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4">
            <p className="text-zinc-900 dark:text-zinc-100 text-[14px] mb-3">
              <strong>Found {results.length} businesses:</strong>
            </p>
            <div className="max-h-40 overflow-y-auto space-y-2">
              {results.slice(0, 5).map((lead, idx) => (
                <div key={idx} className="text-zinc-600 dark:text-zinc-400 text-[13px]">
                  • {lead.business_name} {lead.city ? `- ${lead.city}` : ''}
                </div>
              ))}
              {results.length > 5 && (
                <div className="text-zinc-500 dark:text-zinc-400 text-[13px] italic">
                  ...and {results.length - 5} more
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <button
            onClick={onClose}
            className="px-6 py-2.5 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-[14px] font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={importing || !searchQuery.trim() || !location.trim()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-[14px] font-medium"
          >
            <Search className="w-4 h-4" />
            <span>{importing ? 'Searching...' : 'Search & Import Leads'}</span>
          </button>
        </div>
      </div>

      {/* Examples */}
      <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
        <h3 className="text-zinc-700 dark:text-zinc-300 mb-3 text-[15px]">Example Searches</h3>
        <div className="space-y-2">
          <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3">
            <p className="text-zinc-700 dark:text-zinc-300 text-[13px] mb-1"><strong>For Roadr (auto shops):</strong></p>
            <p className="text-zinc-600 dark:text-zinc-400 text-[13px]">Query: "auto repair shop" | Location: "Miami, FL"</p>
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3">
            <p className="text-zinc-700 dark:text-zinc-300 text-[13px] mb-1"><strong>For Sourcr (restaurants):</strong></p>
            <p className="text-zinc-600 dark:text-zinc-400 text-[13px]">Query: "restaurant" | Location: "Austin, TX"</p>
          </div>
        </div>
      </div>
    </div>
  );
}
import { useState, useEffect } from 'react';
import { 
  Phone, 
  Plus, 
  Settings, 
  PhoneIncoming,
  PhoneOutgoing,
  Mic,
  Key,
  RefreshCw,
  X,
  Edit2,
  Trash2,
  CheckCircle2,
  Search,
  Loader2
} from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { fmtUSDCents } from '../lib/format';
import { TelnyxApiKeySetup } from './TelnyxApiKeySetup';

interface PhoneNumber {
  id: string;
  phone_number: string;
  friendly_name: string;
  brand: 'roadr' | 'sourcr' | 'both';
  direction: 'outbound' | 'inbound' | 'both';
  recording_enabled: boolean;
  transfer_number?: string;
  telnyx_number_id?: string;
  status: 'active' | 'inactive';
  created_at: string;
}

interface TelnyxConfig {
  api_key_configured: boolean;
  account_status: 'active' | 'inactive' | 'not_configured';
  balance?: number;
  phone_numbers_count: number;
}

export function TelnyxPhoneNumbers({ onClose }: { onClose: () => void }) {
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [telnyxConfig, setTelnyxConfig] = useState<TelnyxConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddNumber, setShowAddNumber] = useState(false);
  const [showApiKeySetup, setShowApiKeySetup] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      let configData: any = null;
      
      const configRes = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/config`,
        { headers }
      );
      
      if (configRes.ok) {
        configData = await configRes.json();
        setTelnyxConfig(configData.config);
      }

      const numbersRes = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/numbers`,
        { headers }
      );
      
      if (numbersRes.ok) {
        const numbersData = await numbersRes.json();
        const validNumbers = (numbersData.numbers || []).filter((n: any) => n !== null && n !== undefined);
        setPhoneNumbers(validNumbers);
        
        if (configData?.config?.api_key_configured && validNumbers.length === 0) {
          await syncNumbersFromTelnyx(headers);
        }
      }
    } catch (error) {
      console.error('Error loading Telnyx data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function syncNumbersFromTelnyx(headers?: any) {
    setSyncing(true);
    try {
      if (!headers) headers = await getAuthHeaders();
      
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/numbers/sync`,
        { method: 'POST', headers }
      );
      
      if (res.ok) await loadData();
    } catch (error) {
      console.error('Error syncing numbers:', error);
    } finally {
      setSyncing(false);
    }
  }

  async function searchAvailableNumbers(areaCode: string) {
    setSearching(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/search-numbers?area_code=${areaCode}`,
        { headers }
      );
      
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.numbers || []);
      }
    } catch (error) {
      console.error('Error searching numbers:', error);
    } finally {
      setSearching(false);
    }
  }

  async function purchaseNumber(phoneNumber: string) {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/purchase-number`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ phone_number: phoneNumber })
        }
      );
      
      if (res.ok) {
        await loadData();
        setShowAddNumber(false);
        setSearchResults([]);
      }
    } catch (error) {
      console.error('Error purchasing number:', error);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 sm:h-64">
        <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
      </div>
    );
  }

  if (!telnyxConfig?.api_key_configured || showApiKeySetup) {
    return <TelnyxApiKeySetup onComplete={() => { setShowApiKeySetup(false); loadData(); }} />;
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4 sm:mb-5">
        <div className="min-w-0">
          <h1 className="text-base sm:text-xl font-bold tracking-tight text-zinc-900 dark:text-white">Phone Numbers</h1>
          <p className="text-[10px] sm:text-xs text-zinc-500 mt-0.5">Manage numbers for AI calls</p>
        </div>
        
        <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
          {telnyxConfig?.balance !== undefined && (
            <div className="hidden xs:flex items-center px-2 sm:px-2.5 py-1 sm:py-1.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-[10px] sm:text-xs">
              <span className="text-zinc-500 mr-1.5">Bal:</span>
              <span className="font-semibold text-zinc-900 dark:text-white tabular-nums">{fmtUSDCents(telnyxConfig.balance)}</span>
            </div>
          )}
          <button
            onClick={() => setShowApiKeySetup(true)}
            className="p-1.5 sm:p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            title="API Settings"
          >
            <Key className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
          </button>
          <button
            onClick={() => syncNumbersFromTelnyx()}
            disabled={syncing}
            className="p-1.5 sm:p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
            title="Sync Numbers"
          >
            <RefreshCw className={`w-3.5 sm:w-4 h-3.5 sm:h-4 ${syncing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
          </button>
        </div>
      </div>

      {/* Mobile balance row */}
      {telnyxConfig?.balance !== undefined && (
        <div className="xs:hidden flex items-center px-2.5 py-1.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-[10px] mb-3 w-fit">
          <span className="text-zinc-500 mr-1.5">Balance:</span>
          <span className="font-semibold text-zinc-900 dark:text-white tabular-nums">{fmtUSDCents(telnyxConfig.balance)}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {phoneNumbers.length === 0 ? (
          <div className="text-center py-10 sm:py-14 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Phone className="w-5 h-5 sm:w-6 sm:h-6 text-zinc-500" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white mb-1">No phone numbers</h3>
            <p className="text-xs text-zinc-500 mb-4">Purchase a number to start making calls</p>
            <button
              onClick={() => setShowAddNumber(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-900 text-white dark:bg-white dark:text-black rounded-lg text-xs sm:text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Number
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                onClick={() => setShowAddNumber(true)}
                className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 bg-zinc-900 text-white dark:bg-white dark:text-black rounded-lg text-xs sm:text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Number
              </button>
            </div>
            <div className="grid gap-2 sm:gap-3">
              {phoneNumbers.map(number => (
                <PhoneNumberCard key={number.id} number={number} onUpdate={loadData} />
              ))}
            </div>
          </div>
        )}
      </div>

      {showAddNumber && (
        <AddNumberModal
          onClose={() => { setShowAddNumber(false); setSearchResults([]); }}
          onSearch={searchAvailableNumbers}
          onPurchase={purchaseNumber}
          searchResults={searchResults}
          searching={searching}
        />
      )}
    </div>
  );
}

export default TelnyxPhoneNumbers;

function PhoneNumberCard({ number, onUpdate }: { number: PhoneNumber; onUpdate: () => void }) {
  const [editing, setEditing] = useState(false);
  const [friendlyName, setFriendlyName] = useState(number.friendly_name);

  async function updateNumber() {
    try {
      const headers = await getAuthHeaders();
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/numbers/${number.id}`,
        { method: 'PUT', headers, body: JSON.stringify({ friendly_name: friendlyName }) }
      );
      setEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Error updating number:', error);
    }
  }

  async function deleteNumber() {
    if (!confirm(`Delete ${number.phone_number}?`)) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/telnyx/numbers/${number.id}`,
        { method: 'DELETE', headers }
      );
      onUpdate();
    } catch (error) {
      console.error('Error deleting number:', error);
    }
  }

  return (
    <div className="p-3 sm:p-4 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 sm:w-9 sm:h-9 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg flex items-center justify-center text-zinc-500 flex-shrink-0">
            <Phone className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
          </div>
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                type="text"
                value={friendlyName}
                onChange={(e) => setFriendlyName(e.target.value)}
                className="w-full px-2 py-1 border border-zinc-300 dark:border-zinc-700 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                autoFocus
              />
            ) : (
              <h3 className="text-xs sm:text-sm font-medium text-zinc-900 dark:text-white truncate">{number.friendly_name}</h3>
            )}
            <p className="text-[10px] sm:text-xs text-zinc-500 font-mono truncate">{number.phone_number}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* Tags - hidden on very small screens */}
          <div className="hidden xs:flex gap-1">
            <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded text-[9px] sm:text-[10px] font-medium text-zinc-500 dark:text-zinc-400 capitalize">{number.brand}</span>
            <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded text-[9px] sm:text-[10px] font-medium text-zinc-500 dark:text-zinc-400 capitalize">{number.direction}</span>
          </div>
          
          {editing ? (
            <div className="flex gap-1">
              <button onClick={updateNumber} className="px-2 py-1 text-[10px] font-medium text-[#1ED4A7] bg-[#1ED4A7]/10 rounded-lg hover:bg-[#1ED4A7]/20 transition-colors">Save</button>
              <button onClick={() => setEditing(false)} className="px-2 py-1 text-[10px] font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-200 dark:bg-zinc-800 rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors">Cancel</button>
            </div>
          ) : (
            <div className="flex gap-0.5">
              <button onClick={() => setEditing(true)} className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
                <Edit2 className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
              </button>
              <button onClick={deleteNumber} className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                <Trash2 className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile tags row */}
      <div className="xs:hidden flex gap-1 mt-2 pl-[42px]">
        <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded text-[9px] font-medium text-zinc-500 dark:text-zinc-400 capitalize">{number.brand}</span>
        <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded text-[9px] font-medium text-zinc-500 dark:text-zinc-400 capitalize">{number.direction}</span>
      </div>
    </div>
  );
}

function AddNumberModal({ onClose, onSearch, onPurchase, searchResults, searching }: { onClose: () => void, onSearch: (areaCode: string) => void, onPurchase: (phoneNumber: string) => void, searchResults: any[], searching: boolean }) {
  const [areaCode, setAreaCode] = useState('');

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/30 dark:bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-t-2xl sm:rounded-xl w-full sm:max-w-md shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex justify-between items-center px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-white">Add Number</h2>
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
            <X className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Search input */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Area code (e.g. 415)"
              value={areaCode}
              onChange={(e) => setAreaCode(e.target.value)}
              className="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs sm:text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 outline-none focus:border-zinc-300 dark:focus:border-zinc-700 transition-colors"
              maxLength={3}
            />
            <button
              onClick={() => onSearch(areaCode)}
              disabled={searching || areaCode.length < 3}
              className="px-3 sm:px-4 py-2 bg-zinc-900 text-white dark:bg-white dark:text-black rounded-lg text-xs sm:text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">Search</span>
            </button>
          </div>

          {/* Results */}
          <div className="max-h-52 sm:max-h-60 overflow-y-auto space-y-1.5">
            {searchResults.map((num) => (
              <div key={num.phone_number} className="flex justify-between items-center p-2.5 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/50 rounded-lg">
                <span className="font-mono text-xs sm:text-sm text-zinc-900 dark:text-white">{num.phone_number}</span>
                <button
                  onClick={() => onPurchase(num.phone_number)}
                  className="px-2.5 py-1 bg-zinc-900 text-white dark:bg-white dark:text-black rounded-lg text-[10px] sm:text-xs font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
                >
                  Buy
                </button>
              </div>
            ))}
            {searchResults.length === 0 && !searching && (
              <p className="text-center text-xs text-zinc-500 py-6">Enter an area code to search</p>
            )}
            {searching && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
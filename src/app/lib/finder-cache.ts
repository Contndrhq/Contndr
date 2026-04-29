// ══════════════════════════════════════════════════════════════════════════
// Finder Cache — localStorage persistence for Lead Finder & Creator Finder
// Survives page refresh. Scoped by cache key. Auto-clears on new search.
// ══════════════════════════════════════════════════════════════════════════

const PREFIX = 'contndr.finder.';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h TTL

interface CacheEnvelope<T> {
  ts: number;
  data: T;
}

/** Save finder data to localStorage. Silently fails if storage is full. */
export function saveFinderCache<T>(key: string, data: T): void {
  try {
    const envelope: CacheEnvelope<T> = { ts: Date.now(), data };
    const json = JSON.stringify(envelope);
    // Safety: don't store >3MB to avoid localStorage quota issues
    if (json.length > 3_000_000) {
      console.warn(`[finder-cache] Skipping save for "${key}" — payload too large (${(json.length / 1024).toFixed(0)}KB)`);
      return;
    }
    localStorage.setItem(`${PREFIX}${key}`, json);
  } catch (err) {
    console.warn(`[finder-cache] Failed to save "${key}":`, err);
  }
}

/** Load finder data from localStorage. Returns null if missing/expired/corrupt. */
export function loadFinderCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    const envelope: CacheEnvelope<T> = JSON.parse(raw);
    // Expire stale caches
    if (Date.now() - envelope.ts > MAX_AGE_MS) {
      localStorage.removeItem(`${PREFIX}${key}`);
      return null;
    }
    return envelope.data;
  } catch {
    return null;
  }
}

/** Clear a specific finder cache. */
export function clearFinderCache(key: string): void {
  try {
    localStorage.removeItem(`${PREFIX}${key}`);
  } catch { /* ignore */ }
}

/** Clear all finder caches. */
export function clearAllFinderCaches(): void {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// ── Cache keys ──
export const CACHE_KEYS = {
  CREATOR_FINDER: 'creator-finder',
  LEAD_FINDER_PEOPLE: 'lead-finder-people',
  LEAD_FINDER_COMPANIES: 'lead-finder-companies',
  SEARCH_HISTORY: 'search-history',
} as const;

// ── Search History ──
export interface SearchHistoryEntry {
  id: string;
  params: {
    companyName: string;
    location: string;
    keywords: string;
    industries: string[];
    employeeRanges: string[];
  };
  resultCount: number;
  timestamp: number;
}

const MAX_HISTORY = 10;

/** Add a search to history. Deduplicates by param fingerprint. */
export function addSearchHistory(entry: Omit<SearchHistoryEntry, 'id'>): void {
  const history = getSearchHistory();
  const fingerprint = JSON.stringify(entry.params);
  const id = btoa(fingerprint).slice(0, 16);
  // Remove existing entry with same fingerprint
  const filtered = history.filter(h => h.id !== id);
  // Prepend new entry
  filtered.unshift({ ...entry, id });
  // Cap at MAX_HISTORY
  const capped = filtered.slice(0, MAX_HISTORY);
  saveFinderCache(CACHE_KEYS.SEARCH_HISTORY, capped);
}

/** Get search history (newest first). */
export function getSearchHistory(): SearchHistoryEntry[] {
  return loadFinderCache<SearchHistoryEntry[]>(CACHE_KEYS.SEARCH_HISTORY) || [];
}

/** Remove a single history entry. */
export function removeSearchHistoryEntry(id: string): void {
  const history = getSearchHistory().filter(h => h.id !== id);
  saveFinderCache(CACHE_KEYS.SEARCH_HISTORY, history);
}
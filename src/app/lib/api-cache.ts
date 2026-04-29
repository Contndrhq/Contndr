/**
 * High-performance API cache with stale-while-revalidate, request deduplication,
 * and prefetching support. Designed for premium perceived speed.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

type CacheEntry<T = any> = {
  data: T;
  timestamp: number;
  staleAt: number;
  expiresAt: number;
};

type InFlightRequest = Promise<any>;

interface CacheOptions {
  /** Time in ms before data is considered stale (serves from cache while revalidating) */
  staleTime?: number;
  /** Time in ms before data is completely expired and must be refetched */
  cacheTime?: number;
  /** Unique cache key */
  key: string;
}

const DEFAULT_STALE_TIME = 30_000;   // 30 seconds
const DEFAULT_CACHE_TIME = 300_000;  // 5 minutes

// ─── Stats tracking for dev tools ────────────────────────────────────
interface CacheStatsCounters {
  hits: number;
  staleHits: number;
  misses: number;
  revalidations: number;
  invalidations: number;
  prefetches: number;
  errors: number;
}

export interface CacheEventLog {
  timestamp: number;
  type: 'hit' | 'stale' | 'miss' | 'revalidate' | 'invalidate' | 'prefetch' | 'error' | 'set';
  key: string;
  detail?: string;
}

const MAX_EVENT_LOG = 200;

class ApiCache {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, InFlightRequest>();
  private subscribers = new Map<string, Set<(data: any) => void>>();
  private _counters: CacheStatsCounters = { hits: 0, staleHits: 0, misses: 0, revalidations: 0, invalidations: 0, prefetches: 0, errors: 0 };
  private _eventLog: CacheEventLog[] = [];
  private _statsSubscribers = new Set<() => void>();

  private logEvent(type: CacheEventLog['type'], key: string, detail?: string) {
    this._eventLog.push({ timestamp: Date.now(), type, key, detail });
    if (this._eventLog.length > MAX_EVENT_LOG) {
      this._eventLog = this._eventLog.slice(-MAX_EVENT_LOG);
    }
    // Notify stats subscribers (for dev tools re-render)
    this._statsSubscribers.forEach(fn => fn());
  }

  /** Subscribe to stats changes (for dev tools panel) */
  onStatsChange(callback: () => void): () => void {
    this._statsSubscribers.add(callback);
    return () => { this._statsSubscribers.delete(callback); };
  }

  /**
   * Get cached data if available and not expired
   */
  get<T>(key: string): { data: T; isStale: boolean } | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return {
      data: entry.data as T,
      isStale: now > entry.staleAt,
    };
  }

  /**
   * Set cache data
   */
  set<T>(key: string, data: T, options?: { staleTime?: number; cacheTime?: number }): void {
    const now = Date.now();
    const staleTime = options?.staleTime ?? DEFAULT_STALE_TIME;
    const cacheTime = options?.cacheTime ?? DEFAULT_CACHE_TIME;

    this.cache.set(key, {
      data,
      timestamp: now,
      staleAt: now + staleTime,
      expiresAt: now + cacheTime,
    });

    // Notify subscribers
    const subs = this.subscribers.get(key);
    if (subs) {
      subs.forEach(fn => fn(data));
    }

    this.logEvent('set', key);
  }

  /**
   * Invalidate a cache key or keys matching a prefix
   */
  invalidate(keyOrPrefix: string): void {
    this._counters.invalidations++;
    this.logEvent('invalidate', keyOrPrefix);
    if (keyOrPrefix.endsWith('*')) {
      const prefix = keyOrPrefix.slice(0, -1);
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.delete(keyOrPrefix);
    }
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  /**
   * Deduplicated fetch — if an identical request is in-flight, returns the same promise.
   * Implements stale-while-revalidate: returns stale data immediately while fetching fresh data in background.
   */
  async fetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: { staleTime?: number; cacheTime?: number }
  ): Promise<T> {
    const cached = this.get<T>(key);

    // Fresh cache hit — return immediately
    if (cached && !cached.isStale) {
      this._counters.hits++;
      this.logEvent('hit', key);
      return cached.data;
    }

    // Stale cache hit — return stale data and revalidate in background
    if (cached && cached.isStale) {
      this._counters.staleHits++;
      this.logEvent('stale', key, 'Serving stale, revalidating');
      // Trigger background revalidation (deduped)
      if (!this.inflight.has(key)) {
        this._counters.revalidations++;
        this.logEvent('revalidate', key);
        const revalidation = fetcher()
          .then(data => {
            this.set(key, data, options);
            return data;
          })
          .catch(err => {
            this._counters.errors++;
            this.logEvent('error', key, err.message);
            // Suppress expected errors in background revalidation — stale data is already served.
            const msg = (err?.message || '').toLowerCase();
            const isSilent = msg.includes('not authenticated') || msg.includes('session expired') || msg.includes('unauthorized') || msg.includes('failed to fetch') || msg.includes('load failed') || msg.includes('network error') || msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted');
            if (!isSilent) {
              console.warn(`[API_CACHE] Background revalidation failed for ${key}:`, err.message);
            }
            // Keep stale data on error
            return cached.data;
          })
          .finally(() => {
            this.inflight.delete(key);
          });
        this.inflight.set(key, revalidation);
      }
      return cached.data;
    }

    // No cache — deduplicate the request
    this._counters.misses++;
    this.logEvent('miss', key);
    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const request = fetcher()
      .then(data => {
        this.set(key, data, options);
        return data;
      })
      .catch(err => {
        this._counters.errors++;
        this.logEvent('error', key, err.message);
        throw err;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, request);
    return request;
  }

  /**
   * Prefetch data for a key (fire-and-forget, no await needed)
   */
  prefetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: { staleTime?: number; cacheTime?: number }
  ): void {
    const cached = this.get(key);
    if (cached && !cached.isStale) return; // Already fresh

    // Don't prefetch if already in-flight
    if (this.inflight.has(key)) return;

    this._counters.prefetches++;
    this.logEvent('prefetch', key);

    const request = fetcher()
      .then(data => {
        this.set(key, data, options);
        return data;
      })
      .catch(err => {
        // Prefetch is best-effort — silently ignore network/auth errors to avoid console spam
        const msg = err?.message?.toLowerCase() || '';
        const isExpected = msg.includes('failed to fetch') || msg.includes('load failed') || msg.includes('network error') || msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted') || msg.includes('not authenticated') || msg.includes('session expired') || msg.includes('unauthorized') || msg.includes('prefetch failed');
        if (!isExpected) {
          console.warn(`[API_CACHE] Prefetch failed for ${key}:`, err.message);
        }
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, request);
  }

  /**
   * Subscribe to cache updates for a key
   */
  subscribe(key: string, callback: (data: any) => void): () => void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)!.add(callback);
    return () => {
      this.subscribers.get(key)?.delete(callback);
    };
  }

  /**
   * Get cache stats for debugging
   */
  stats() {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      age: Math.round((now - entry.timestamp) / 1000),
      isStale: now > entry.staleAt,
      isExpired: now > entry.expiresAt,
      ttl: Math.max(0, Math.round((entry.expiresAt - now) / 1000)),
    }));

    return {
      entries: this.cache.size,
      inflight: this.inflight.size,
      counters: { ...this._counters },
      hitRate: this._counters.hits + this._counters.staleHits + this._counters.misses > 0
        ? Math.round(((this._counters.hits + this._counters.staleHits) / (this._counters.hits + this._counters.staleHits + this._counters.misses)) * 100)
        : 0,
      entryDetails: entries,
      eventLog: [...this._eventLog].reverse().slice(0, 50),
      subscribers: Array.from(this.subscribers.entries()).map(([k, v]) => ({ key: k, count: v.size })),
    };
  }

  /** Reset counters (for dev tools) */
  resetCounters(): void {
    this._counters = { hits: 0, staleHits: 0, misses: 0, revalidations: 0, invalidations: 0, prefetches: 0, errors: 0 };
    this._eventLog = [];
    this._statsSubscribers.forEach(fn => fn());
  }
}

// Singleton instance
export const apiCache = new ApiCache();

// Expose for debugging in dev
if (typeof window !== 'undefined') {
  (window as any).__apiCache = apiCache;
}

// ─── React Hook: useApiCache ────────────────────────────────────────
// Provides stale-while-revalidate semantics inside any component.
// Returns { data, loading, error, refetch }.

interface UseApiCacheOptions {
  /** Milliseconds before the cached value is considered stale (default 30 s) */
  staleTime?: number;
  /** Milliseconds before the cached value is completely evicted (default 5 min) */
  cacheTime?: number;
  /** Set false to defer fetching until a dependency is ready */
  enabled?: boolean;
}

export function useApiCache<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: UseApiCacheOptions = {}
): { data: T | null; loading: boolean; error: Error | null; refetch: () => void } {
  const { staleTime, cacheTime, enabled = true } = options;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Seed state from cache synchronously so the first render already has data
  const [data, setData] = useState<T | null>(() => {
    if (!key) return null;
    const cached = apiCache.get<T>(key);
    return cached ? cached.data : null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!key) return false;
    const cached = apiCache.get<T>(key);
    return !cached; // only loading if nothing in cache
  });
  const [error, setError] = useState<Error | null>(null);

  const doFetch = useCallback(async () => {
    if (!key || !enabled) return;
    try {
      setError(null);
      const result = await apiCache.fetch<T>(key, fetcherRef.current, { staleTime, cacheTime });
      setData(result);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [key, enabled, staleTime, cacheTime]);

  useEffect(() => {
    if (!key || !enabled) return;

    // If we have fresh cache we can skip the fetch entirely
    const cached = apiCache.get<T>(key);
    if (cached && !cached.isStale) {
      setData(cached.data);
      setLoading(false);
      return;
    }

    // Show stale data immediately, then revalidate
    if (cached) {
      setData(cached.data);
      setLoading(false);
    } else {
      setLoading(true);
    }

    doFetch();

    // Subscribe to background revalidation updates
    const unsub = apiCache.subscribe(key, (newData: T) => {
      setData(newData);
    });
    return unsub;
  }, [key, enabled, doFetch]);

  const refetch = useCallback(() => {
    if (key) {
      apiCache.invalidate(key);
      setLoading(true);
      doFetch();
    }
  }, [key, doFetch]);

  return { data, loading, error, refetch };
}
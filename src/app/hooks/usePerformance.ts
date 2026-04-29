import { useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * Debounce hook - delays execution until user stops typing/interacting
 * Perfect for search inputs, form validation, API calls
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = React.useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Debounced callback - only executes after delay of inactivity
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 300
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<NodeJS.Timeout>();
  
  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]);
}

/**
 * Throttle hook - limits execution to once per delay period
 * Perfect for scroll handlers, resize handlers
 */
export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 300
): (...args: Parameters<T>) => void {
  const lastRun = useRef(Date.now());
  const timeoutRef = useRef<NodeJS.Timeout>();
  
  return useCallback((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastRun = now - lastRun.current;
    
    if (timeSinceLastRun >= delay) {
      callback(...args);
      lastRun.current = now;
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      timeoutRef.current = setTimeout(() => {
        callback(...args);
        lastRun.current = Date.now();
      }, delay - timeSinceLastRun);
    }
  }, [callback, delay]);
}

/**
 * Request deduplication - prevents multiple identical API calls
 */
const requestCache = new Map<string, Promise<any>>();

export function useDedupedRequest<T>(
  key: string,
  requestFn: () => Promise<T>,
  enabled: boolean = true
): { execute: () => Promise<T>; clear: () => void } {
  const execute = useCallback(async () => {
    if (!enabled) return requestFn();
    
    // Return existing promise if request is in flight
    if (requestCache.has(key)) {
      return requestCache.get(key)!;
    }
    
    // Create new request
    const promise = requestFn().finally(() => {
      // Remove from cache when complete
      requestCache.delete(key);
    });
    
    requestCache.set(key, promise);
    return promise;
  }, [key, requestFn, enabled]);
  
  const clear = useCallback(() => {
    requestCache.delete(key);
  }, [key]);
  
  return { execute, clear };
}

/**
 * Intersection Observer hook - lazy load images/components when visible
 */
export function useIntersectionObserver(
  ref: React.RefObject<Element>,
  options: IntersectionObserverInit = {}
): boolean {
  const [isIntersecting, setIsIntersecting] = React.useState(false);
  
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting);
      },
      {
        threshold: 0.1,
        ...options,
      }
    );
    
    observer.observe(element);
    
    return () => {
      observer.disconnect();
    };
  }, [ref, options.threshold, options.root, options.rootMargin]);
  
  return isIntersecting;
}

/**
 * Idle callback hook - execute non-critical work during idle time
 */
export function useIdleCallback(callback: () => void, deps: React.DependencyList = []) {
  useEffect(() => {
    if (typeof requestIdleCallback === 'undefined') {
      // Fallback for browsers without requestIdleCallback
      const timeout = setTimeout(callback, 100);
      return () => clearTimeout(timeout);
    }
    
    const id = requestIdleCallback(callback, { timeout: 1000 });
    return () => cancelIdleCallback(id);
  }, deps);
}

/**
 * Previous value hook - useful for comparing with previous render
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  
  useEffect(() => {
    ref.current = value;
  }, [value]);
  
  return ref.current;
}

/**
 * Mount detection - execute only on mount, not on updates
 */
export function useMount(callback: () => void | (() => void)) {
  const mountRef = useRef(false);
  
  useEffect(() => {
    if (!mountRef.current) {
      mountRef.current = true;
      return callback();
    }
  }, []);
}

// Fix missing React import
import React from 'react';

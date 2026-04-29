import { memo } from 'react';

/**
 * Deep comparison function for React.memo
 * Use sparingly - shallow comparison is usually sufficient and faster
 */
export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  
  if (keysA.length !== keysB.length) return false;
  
  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  
  return true;
}

/**
 * Shallow comparison for props (default React.memo behavior)
 */
export function shallowEqual(a: any, b: any): boolean {
  if (a === b) return true;
  
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) {
    return false;
  }
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  
  if (keysA.length !== keysB.length) return false;
  
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  
  return true;
}

/**
 * Memoize component with deep comparison
 * Use for components with complex props that change frequently
 */
export function memoDeep<T extends React.ComponentType<any>>(Component: T): T {
  return memo(Component, deepEqual) as T;
}

/**
 * Memoize component with shallow comparison (default)
 * Use for most components - faster than deep comparison
 */
export function memoShallow<T extends React.ComponentType<any>>(Component: T): T {
  return memo(Component, shallowEqual) as T;
}

/**
 * Memoize component with custom comparison
 */
export function memoCustom<T extends React.ComponentType<any>>(
  Component: T,
  propsAreEqual: (prev: any, next: any) => boolean
): T {
  return memo(Component, propsAreEqual) as T;
}

/**
 * Create a memoized selector function for deriving data
 * Similar to reselect but simpler
 */
export function createSelector<TInput, TOutput>(
  selector: (input: TInput) => TOutput
): (input: TInput) => TOutput {
  let lastInput: TInput | undefined;
  let lastOutput: TOutput | undefined;
  
  return (input: TInput): TOutput => {
    if (input === lastInput) {
      return lastOutput!;
    }
    
    lastInput = input;
    lastOutput = selector(input);
    return lastOutput;
  };
}

/**
 * Memoize expensive computations
 */
export function memoize<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => TResult
): (...args: TArgs) => TResult {
  const cache = new Map<string, TResult>();
  
  return (...args: TArgs): TResult => {
    const key = JSON.stringify(args);
    
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    
    const result = fn(...args);
    cache.set(key, result);
    
    // Limit cache size to prevent memory leaks
    if (cache.size > 100) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    
    return result;
  };
}

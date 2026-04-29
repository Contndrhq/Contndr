/**
 * Production-safe logging utility
 * Automatically strips console.logs in production builds
 */

const IS_PRODUCTION = import.meta.env.PROD;
const IS_DEV = import.meta.env.DEV;

// Enable specific log levels even in production (for critical errors)
const ALWAYS_LOG_LEVELS = new Set(['error', 'warn']);

class Logger {
  private enabled: boolean;

  constructor() {
    this.enabled = IS_DEV || Boolean(localStorage.getItem('debug'));
  }

  log(...args: any[]) {
    if (this.enabled || !IS_PRODUCTION) {
      console.log(...args);
    }
  }

  info(...args: any[]) {
    if (this.enabled || !IS_PRODUCTION) {
      console.info(...args);
    }
  }

  warn(...args: any[]) {
    console.warn(...args); // Always log warnings
  }

  error(...args: any[]) {
    console.error(...args); // Always log errors
  }

  debug(...args: any[]) {
    if (this.enabled) {
      console.debug(...args);
    }
  }

  group(label: string) {
    if (this.enabled || !IS_PRODUCTION) {
      console.group(label);
    }
  }

  groupEnd() {
    if (this.enabled || !IS_PRODUCTION) {
      console.groupEnd();
    }
  }

  table(data: any) {
    if (this.enabled || !IS_PRODUCTION) {
      console.table(data);
    }
  }

  time(label: string) {
    if (this.enabled || !IS_PRODUCTION) {
      console.time(label);
    }
  }

  timeEnd(label: string) {
    if (this.enabled || !IS_PRODUCTION) {
      console.timeEnd(label);
    }
  }

  // Enable debug mode at runtime
  enableDebug() {
    this.enabled = true;
    localStorage.setItem('debug', '1');
  }

  // Disable debug mode at runtime
  disableDebug() {
    this.enabled = false;
    localStorage.removeItem('debug');
  }
}

// Export singleton instance
export const logger = new Logger();

// For backwards compatibility, also export as default
export default logger;

// Helper to measure performance
export function measurePerformance<T>(
  label: string,
  fn: () => T
): T {
  if (!IS_PRODUCTION) {
    const start = performance.now();
    const result = fn();
    const end = performance.now();
    logger.log(`[PERF] ${label}: ${(end - start).toFixed(2)}ms`);
    return result;
  }
  return fn();
}

// Helper for async performance measurement
export async function measurePerformanceAsync<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!IS_PRODUCTION) {
    const start = performance.now();
    const result = await fn();
    const end = performance.now();
    logger.log(`[PERF] ${label}: ${(end - start).toFixed(2)}ms`);
    return result;
  }
  return fn();
}

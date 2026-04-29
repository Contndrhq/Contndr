/**
 * Enhanced fetch utilities with better error handling
 */

export class FetchError extends Error {
  constructor(
    message: string,
    public status?: number,
    public statusText?: string,
    public url?: string
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

/**
 * Fetch with timeout and better error messages
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 10000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new FetchError(
        `Request timed out after ${timeout}ms`,
        undefined,
        'Timeout',
        url
      );
    }

    if (error.message.includes('Failed to fetch')) {
      throw new FetchError(
        'Network error - check your internet connection or the server may be down',
        undefined,
        'Network Error',
        url
      );
    }

    throw new FetchError(
      error.message || 'Unknown fetch error',
      undefined,
      'Unknown',
      url
    );
  }
}

/**
 * Check if error is a network connectivity issue
 */
export function isNetworkError(error: any): boolean {
  if (!error) return false;
  
  const errorStr = error.message?.toLowerCase() || '';
  
  return (
    errorStr.includes('failed to fetch') ||
    errorStr.includes('network error') ||
    errorStr.includes('timeout') ||
    errorStr.includes('connection') ||
    error.name === 'AbortError' ||
    error.name === 'TimeoutError'
  );
}

/**
 * Get user-friendly error message
 */
export function getFriendlyErrorMessage(error: any): string {
  if (!error) return 'An unknown error occurred';

  if (isNetworkError(error)) {
    return 'Unable to connect to the server. Please check your internet connection.';
  }

  if (error instanceof FetchError) {
    if (error.status === 401) {
      return 'Session expired. Please sign in again.';
    }
    if (error.status === 403) {
      return 'You do not have permission to access this resource.';
    }
    if (error.status === 404) {
      return 'The requested resource was not found.';
    }
    if (error.status === 500) {
      return 'Server error. Please try again later.';
    }
    if (error.status && error.status >= 400) {
      return `Error: ${error.statusText || error.message}`;
    }
  }

  return error.message || 'An unexpected error occurred';
}

/**
 * Retry fetch with exponential backoff
 * Retries on network errors AND 5xx server errors (502, 503, 504)
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit & { timeout?: number; retries?: number } = {}
): Promise<Response> {
  const { retries = 3, timeout = 10000, ...fetchOptions } = options;
  
  let lastError: any;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetchWithTimeout(url, { ...fetchOptions, timeout });
      
      // Retry on transient server errors (502, 503, 504)
      if ((response.status === 502 || response.status === 503 || response.status === 504) && i < retries - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 5000);
        console.warn(`[FETCH] Got ${response.status} from ${url}, retrying in ${delay}ms (${i + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      return response;
    } catch (error) {
      lastError = error;
      
      // Don't retry on auth errors
      if (error instanceof FetchError && error.status === 401) {
        throw error;
      }
      
      // If it's the last retry, throw
      if (i === retries - 1) {
        throw error;
      }
      
      // Wait before retrying (exponential backoff)
      const delay = Math.min(1000 * Math.pow(2, i), 5000);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      console.log(`[FETCH] Retry ${i + 1}/${retries} for ${url}`);
    }
  }
  
  throw lastError;
}
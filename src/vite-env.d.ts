// Build-time constants injected by vite.config.ts via `define`.
// Surfaced on window.__contndr_build so support can ask a customer to read
// it from the browser console: `window.__contndr_build`.
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

declare global {
  interface Window {
    __contndr_build?: { sha: string; built_at: string };
  }
}

export {};

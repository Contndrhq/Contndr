// Rebuild: 2026-03-19T12:30 — CurrencyProvider auth fix + loading screen optimization
// Rebuild: 2026-03-19T13:00 — Final auth check cleanup + silenced unnecessary logs
import '../styles/globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Cache-bust marker: forces Vite to re-evaluate module graph after landing page deletion
const _BUILD_ID = '2026-03-19T13:00-final-auth-cleanup' as const;

// SEO: Final safety net — override any noindex tags that slipped past the
// synchronous inline script in index.html (e.g. tags injected after DOMContentLoaded)
const enforceIndexable = () => {
  document.querySelectorAll('meta[name="robots"], meta[http-equiv="X-Robots-Tag"]').forEach((tag) => {
    const content = tag.getAttribute('content');
    if (content && content.includes('noindex')) {
      console.log('[SEO] Overriding noindex meta tag:', tag.id || '(no id)');
      tag.setAttribute('content', 'index, follow');
    }
  });
};

// Run immediately and after a tick (covers async platform scripts)
enforceIndexable();
setTimeout(enforceIndexable, 0);
setTimeout(enforceIndexable, 500);

// Global error handler for unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('[UNHANDLED PROMISE REJECTION]:', event.reason);
  
  // Provide a user-friendly error message
  if (event.reason?.message?.includes('Failed to fetch')) {
    console.error('[NETWORK] Network error detected. Check your connection or server status.');
  }
  
  // Prevent the default error handler from showing the error in console
  // (we've already logged it with better context)
  event.preventDefault();
});

// Global error handler for uncaught errors
window.addEventListener('error', (event) => {
  console.error('[UNCAUGHT ERROR]:', event.error);
});

// Mount React app
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
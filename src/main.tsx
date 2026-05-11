
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import { ErrorBoundary } from "./app/components/ErrorBoundary.tsx";
  import "./styles/index.css";

  // Build stamp for support escalations. Customer can read this from the
  // browser console so we know exactly which deploy they're on.
  if (typeof window !== "undefined") {
    window.__contndr_build = { sha: __BUILD_SHA__, built_at: __BUILD_TIME__ };
  }

  // Top-level ErrorBoundary so any unhandled render throw becomes a recoverable
  // "Try again" screen instead of a blank white page that requires a hard refresh.
  createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );

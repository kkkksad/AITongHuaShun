import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "./hooks/useTheme";
import { I18nProvider } from "./i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { shouldRetryQuery } from "./lib/apiError";
import {
  clearChunkRecoveryAttempt,
  lazyWithChunkRecovery,
  recoverFromChunkLoadError,
} from "./lib/chunkRecovery";
import "./styles/index.css";
import "./styles/trading-strategies.css";

const App = lazyWithChunkRecovery(() => import("./App"));

function PageLoader() {
  return (
    <div className="page-loader">
      <div className="page-loader-spinner" />
      <span>加载中…</span>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: shouldRetryQuery,
      retryDelay: (attemptIndex) => Math.min(750 * 2 ** attemptIndex, 3_000),
      staleTime: 30_000,
    },
  },
});

async function unregisterDevelopmentServiceWorkers(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

// Register service worker for PWA offline support. In dev, unregister it so
// stale cached JS/CSS cannot mask the current Vite build.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    clearChunkRecoveryAttempt(window.sessionStorage);
    if (import.meta.env.DEV) {
      unregisterDevelopmentServiceWorkers()
        .then(() => {
          console.info("[KAIROS PWA] Service Worker disabled in development.");
        })
        .catch((err) => {
          console.warn("[KAIROS PWA] Service Worker cleanup failed:", err);
        });
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        console.log("[KAIROS PWA] Service Worker registered:", reg.scope);
      })
      .catch((err) => {
        console.warn("[KAIROS PWA] Service Worker registration failed:", err);
      });
  });
}

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  recoverFromChunkLoadError({
    error: new Error("vite:preloadError"),
    storage: window.sessionStorage,
    pageKey: window.location.href,
    reload: () => window.location.reload(),
  });
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <I18nProvider>
            <BrowserRouter>
              <Suspense fallback={<PageLoader />}>
                <App />
              </Suspense>
            </BrowserRouter>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

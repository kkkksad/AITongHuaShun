import { useCallback, useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useI18n } from "../i18n";

// ── Types ────────────────────────────────────────────────────
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// ── Component ────────────────────────────────────────────────
export function PwaInstallPrompt() {
  const { t } = useI18n();
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Delay showing the prompt
      setTimeout(() => setVisible(true), 3000);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Check if previously dismissed this session
    const saved = sessionStorage.getItem("kairos_pwa_dismissed");
    if (saved) setDismissed(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setDismissed(true);
    sessionStorage.setItem("kairos_pwa_dismissed", "1");
  }, []);

  if (!visible || dismissed || !deferredPrompt) return null;

  return (
    <div className="pwa-install-banner" role="alert">
      <div className="pwa-install-content">
        <Download size={20} className="pwa-install-icon" />
        <div>
          <strong>{t("pwa.install.title")}</strong>
          <p>{t("pwa.install.desc")}</p>
        </div>
      </div>
      <div className="pwa-install-actions">
        <button
          className="btn btn-primary btn-sm"
          onClick={handleInstall}
          type="button"
        >
          {t("pwa.install.button")}
        </button>
        <button
          aria-label={t("pwa.install.dismiss")}
          className="pwa-install-dismiss"
          onClick={handleDismiss}
          type="button"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}

// ── Offline Banner ────────────────────────────────────────────
export function OfflineBanner() {
  const { t } = useI18n();
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="offline-banner" role="alert">
      <span>{t("pwa.offline")}</span>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

const UPDATE_INTERVAL_MS = 60 * 60 * 1000; // 60 min

export function ReloadPrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, r) {
      setRegistration(r);
    },
  });

  const checkForUpdate = useCallback(() => {
    if (!registration) return;
    registration.update().catch(() => {});
  }, [registration]);

  // visibilitychange + online + setInterval
  useEffect(() => {
    if (!registration) return;

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };
    const onOnline = () => checkForUpdate();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    const id = setInterval(checkForUpdate, UPDATE_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      clearInterval(id);
    };
  }, [registration, checkForUpdate]);

  // React Router navigation
  const { pathname } = useLocation();
  const prevPathname = useRef(pathname);
  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      checkForUpdate();
    }
  }, [pathname, checkForUpdate]);

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="flex items-center gap-3 bg-primary text-primary-foreground px-4 py-3 rounded-lg shadow-lg">
        <RefreshCw className="w-4 h-4 shrink-0" />
        <span className="text-sm font-medium">新しいバージョンがあります</span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => updateServiceWorker(true)}
          className="h-7 text-xs font-bold"
        >
          更新
        </Button>
      </div>
    </div>
  );
}

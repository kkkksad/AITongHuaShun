import { useEffect, useRef, type RefObject } from "react";

/** Complete each route navigation once, after its lazy content is mounted. */
export function useNavigationFocus(
  mainRef: RefObject<HTMLElement | null>,
  navigationKey?: string,
  targetId?: string,
) {
  const initialKey = useRef(navigationKey);
  const completedKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    const currentMain = mainRef.current;
    if (!currentMain || !navigationKey || completedKey.current === navigationKey) return;
    const main = currentMain;
    const shouldFocus = completedKey.current !== undefined || navigationKey !== initialKey.current;
    // Preserve initial deep-link scrolling without moving focus on page load.
    if (!targetId && !shouldFocus) {
      completedKey.current = navigationKey;
      return;
    }

    let frame: number | undefined;
    const observer = new MutationObserver(schedule);

    function schedule() {
      if (frame !== undefined) return;
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        const target = targetId ? document.getElementById(targetId) : main;
        // LazyFallback owns .page-loader; data query refreshes do not use it.
        if (!target || !main.contains(target) || main.querySelector(".page-loader")) return;
        completedKey.current = navigationKey;
        observer.disconnect();
        const focused = document.activeElement;
        // Routed tablists already move focus to their selected tab.
        if (!targetId && focused && main.contains(focused) &&
          focused.getAttribute("role") === "tab" &&
          focused.getAttribute("aria-selected") === "true") return;
        target.scrollIntoView?.({ behavior: "smooth", block: "start" });
        if (shouldFocus) target.focus({ preventScroll: true });
      });
    }

    observer.observe(main, { childList: true, subtree: true });
    schedule();
    return () => {
      observer.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [mainRef, navigationKey, targetId]);
}

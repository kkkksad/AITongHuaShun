import { useEffect, useRef, useState, type ReactNode } from "react";

interface ViewportDeferredProps {
  children: ReactNode;
  minHeight?: number;
  rootMargin?: string;
}

export function ViewportDeferred({
  children,
  minHeight = 320,
  rootMargin = "200px 0px",
}: ViewportDeferredProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (isVisible) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setIsVisible(true);
      observer.disconnect();
    }, { rootMargin });
    const element = containerRef.current;
    if (element) observer.observe(element);
    const revealWhenPassed = () => {
      if (!element) return;
      const prefetchDistance = Number.parseFloat(rootMargin) || 0;
      if (element.getBoundingClientRect().top <= window.innerHeight + prefetchDistance) {
        setIsVisible(true);
        observer.disconnect();
      }
    };
    window.addEventListener("scroll", revealWhenPassed, { passive: true });
    window.addEventListener("resize", revealWhenPassed);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", revealWhenPassed);
      window.removeEventListener("resize", revealWhenPassed);
    };
  }, [isVisible, rootMargin]);

  return (
    <div
      className={`viewport-deferred${isVisible ? " is-visible" : ""}`}
      ref={containerRef}
      style={{ minHeight }}
    >
      {isVisible ? children : <div aria-hidden="true" className="viewport-deferred-placeholder" />}
    </div>
  );
}

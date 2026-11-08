import { useRouterState } from "@tanstack/react-router";
import { useLayoutEffect, useRef, type ReactNode } from "react";

const ENTER_CLASS = "sb-page-enter-item";
const ENTER_ANIMATION = "sb-page-element-enter";
const CANDIDATES = [
  "[data-page-enter]",
  ".sb-hero",
  ".sb-page-banner",
  ".sb-stats > article",
  ".sb-panel",
  ".sb-monitor-strip",
  '.sb-page [aria-label^="Controles do monitoramento"]',
  ".sb-page > section",
  ".sb-page > .grid > article",
  ".sb-client-row",
  ".sb-mode",
  ".sb-page section > ul > li",
  '.sb-page [role="tabpanel"] > .space-y-3 > section',
].join(",");

type PreviousDelay = { value: string; priority: string };

/** Animate existing elements only; never key or remount the page subtree. */
export function PageEntrance({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const container = useRef<HTMLDivElement>(null);

  // AdminLayout is client-rendered. Mark the new elements before first paint
  // so they do not briefly appear fully visible and then restart at opacity 0.
  useLayoutEffect(() => {
    const current = container.current;
    if (!current) return;
    const node = current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;

    // data-lite also covers many phones: give them a shorter entrance rather
    // than silently disabling the user's requested page transitions.
    const lite = document.documentElement.hasAttribute("data-lite");
    node.dataset.entryMotion = lite ? "lite" : "full";
    const limit = lite ? 12 : 18;
    const stagger = lite ? 24 : 32;
    const maxDelay = lite ? 120 : 180;
    const seen = new WeakSet<HTMLElement>();
    const active = new Map<HTMLElement, PreviousDelay>();
    const pending = new Set<HTMLElement>();
    let started = 0;
    let frame = 0;
    let disposed = false;
    let observing = true;

    function finish(element: HTMLElement) {
      const previous = active.get(element);
      if (!previous) return;
      active.delete(element);
      element.classList.remove(ENTER_CLASS);
      if (previous.value) {
        element.style.setProperty("--sb-entry-delay", previous.value, previous.priority);
      } else {
        element.style.removeProperty("--sb-entry-delay");
      }
    }

    function animateElements(roots: Iterable<HTMLElement>) {
      if (disposed || reducedMotion.matches || started >= limit) return;
      const candidates = new Set<HTMLElement>();
      for (const root of roots) {
        if (root.closest('[role="log"]')) continue;
        if (root.matches(CANDIDATES)) candidates.add(root);
        for (const child of root.querySelectorAll<HTMLElement>(CANDIDATES)) {
          candidates.add(child);
          if (candidates.size >= 64) break;
        }
        if (candidates.size >= 64) break;
      }
      let batchIndex = 0;
      for (const element of candidates) {
        if (started >= limit) break;
        if (seen.has(element) || !node.contains(element) || element.closest('[role="log"]')) {
          continue;
        }
        // Rows and statistic cards enter separately, without stacking a second
        // fade/transform on their enclosing list or summary container.
        if (
          element.matches(".sb-stats") ||
          element.querySelector(":scope > ul > li, :scope > article, .sb-client-row, .sb-mode") ||
          element.parentElement?.closest(`.${ENTER_CLASS}`)
        ) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.top > window.innerHeight + 80 || rect.bottom < 0) {
          continue;
        }
        seen.add(element);
        active.set(element, {
          value: element.style.getPropertyValue("--sb-entry-delay"),
          priority: element.style.getPropertyPriority("--sb-entry-delay"),
        });
        element.style.setProperty(
          "--sb-entry-delay",
          `${Math.min(batchIndex * stagger, maxDelay)}ms`,
        );
        element.classList.add(ENTER_CLASS);
        batchIndex += 1;
        started += 1;
      }
    }

    function onAnimationFinished(event: AnimationEvent) {
      if (event.animationName === ENTER_ANIMATION && event.target instanceof HTMLElement) {
        finish(event.target);
      }
    }
    node.addEventListener("animationend", onAnimationFinished);
    node.addEventListener("animationcancel", onAnimationFinished);
    animateElements([node]);

    // Only first-arriving DOM elements during the short loading window count.
    // Text updates (clock), log entries and user filtering never retrigger it.
    const observer = new MutationObserver((records) => {
      if (!observing || started >= limit) return;
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (added instanceof HTMLElement && !added.closest('[role="log"]')) {
            pending.add(added);
            if (pending.size >= 32) break;
          }
        }
        if (pending.size >= 32) break;
      }
      if (!pending.size || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const roots = [...pending];
        pending.clear();
        animateElements(roots);
        if (started >= limit) stopObserving();
      });
    });
    function stopObserving() {
      observing = false;
      observer.disconnect();
      pending.clear();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
    if (started < limit) observer.observe(node, { childList: true, subtree: true });
    const loadingWindow = window.setTimeout(stopObserving, 4000);
    const stopForInteraction = () => stopObserving();
    node.addEventListener("pointerdown", stopForInteraction, { once: true, capture: true });
    node.addEventListener("keydown", stopForInteraction, { once: true, capture: true });
    const stopForReducedMotion = () => {
      if (!reducedMotion.matches) return;
      stopObserving();
      for (const element of active.keys()) finish(element);
    };
    reducedMotion.addEventListener("change", stopForReducedMotion);

    return () => {
      disposed = true;
      stopObserving();
      window.clearTimeout(loadingWindow);
      for (const element of active.keys()) finish(element);
      delete node.dataset.entryMotion;
      node.removeEventListener("animationend", onAnimationFinished);
      node.removeEventListener("animationcancel", onAnimationFinished);
      node.removeEventListener("pointerdown", stopForInteraction, true);
      node.removeEventListener("keydown", stopForInteraction, true);
      reducedMotion.removeEventListener("change", stopForReducedMotion);
    };
  }, [pathname]);

  return (
    <div ref={container} className="sb-page-entrance">
      {children}
    </div>
  );
}

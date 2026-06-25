// Resizable + split-aware width for the task drawer (desktop only).
//
// The drawer is a right-side Sheet whose width the user drags via a handle on its
// LEFT edge: dragging left widens, dragging right narrows. The chosen width is
// clamped to a sane range, persisted to localStorage, and — past a threshold —
// flips the inner layout into a two-pane split (task on the left, discussion on
// the right). On coarse pointers / narrow viewports we disable resize entirely
// and fall back to the Sheet's default full-width behavior.
//
// Pure helpers (clamp / split / storage) are exported separately so they can be
// unit-tested without rendering React.
import { useCallback, useEffect, useRef, useState } from 'react';

// localStorage key for the persisted drawer width (px).
export const DRAWER_WIDTH_STORAGE_KEY = 'pf-task-drawer-width';

// Default width when nothing is persisted — matches the previous fixed
// `sm:max-w-[900px]`, so first-time users see no visual change.
export const DRAWER_DEFAULT_WIDTH = 900;

// Lower clamp: below this the two columns / property rows get unusably cramped.
export const DRAWER_MIN_WIDTH = 480;

// Upper clamp is viewport-relative: never wider than 96vw, and never beyond
// 1400px on very wide monitors (a full-screen drawer stops feeling like a panel).
export const DRAWER_MAX_WIDTH_HARD = 1400;
export const DRAWER_MAX_VIEWPORT_RATIO = 0.96;

// Split threshold: once the drawer is at least ~half the viewport (capped at
// 860px so it also triggers on smaller laptops) switch to the two-pane layout.
export const DRAWER_SPLIT_VIEWPORT_RATIO = 0.5;
export const DRAWER_SPLIT_CAP = 860;

/** Upper bound for the drawer width given the current viewport width. */
export function drawerMaxWidth(viewportWidth: number): number {
  return Math.min(DRAWER_MAX_WIDTH_HARD, Math.round(viewportWidth * DRAWER_MAX_VIEWPORT_RATIO));
}

/**
 * Clamp a desired width into [DRAWER_MIN_WIDTH, drawerMaxWidth(viewport)].
 * Tolerates NaN/garbage (e.g. corrupted localStorage) by falling back to the
 * default width before clamping. The max never drops below the min, so on tiny
 * viewports the min wins.
 */
export function clampDrawerWidth(width: number, viewportWidth: number): number {
  const max = Math.max(DRAWER_MIN_WIDTH, drawerMaxWidth(viewportWidth));
  const desired = Number.isFinite(width) ? width : DRAWER_DEFAULT_WIDTH;
  return Math.min(max, Math.max(DRAWER_MIN_WIDTH, Math.round(desired)));
}

/**
 * Whether the drawer should render its two-pane split layout at this width.
 * True once width >= min(viewport * 0.5, 860).
 */
export function computeIsSplit(width: number, viewportWidth: number): boolean {
  const threshold = Math.min(viewportWidth * DRAWER_SPLIT_VIEWPORT_RATIO, DRAWER_SPLIT_CAP);
  return width >= threshold;
}

/** Read the persisted width (px) or null if absent/unparsable. */
export function readStoredWidth(): number | null {
  try {
    const raw = localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY);
    if (raw === null) return null;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Persist the chosen width (px). Swallows storage errors (private mode/quota). */
export function writeStoredWidth(width: number): void {
  try {
    localStorage.setItem(DRAWER_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    /* localStorage unavailable — width still applies in-memory for this session */
  }
}

function viewport(): number {
  return typeof window === 'undefined' ? DRAWER_DEFAULT_WIDTH : window.innerWidth;
}

export type ResizableWidth = {
  /** Current clamped width in px. */
  readonly width: number;
  /** True while the user is actively dragging the handle (gate transitions off). */
  readonly dragging: boolean;
  /** True when the layout should be the two-pane split. */
  readonly isSplit: boolean;
  /** pointerdown handler to attach to the drag handle. */
  readonly onHandlePointerDown: (e: React.PointerEvent<HTMLElement>) => void;
};

/**
 * Drawer width state + drag interaction.
 *
 * @param enabled  When false (mobile/coarse pointer, or drawer closed) the hook
 *                 is inert: no listeners, dragging stays false, callers fall back
 *                 to the default full-width Sheet. `width`/`isSplit` are still
 *                 returned (harmless) but the consumer ignores them when disabled.
 * @param open     Re-clamp + restore from storage each time the drawer opens
 *                 (viewport may have changed since last open).
 */
export function useResizableWidth(enabled: boolean, open: boolean): ResizableWidth {
  const [width, setWidth] = useState<number>(() =>
    clampDrawerWidth(readStoredWidth() ?? DRAWER_DEFAULT_WIDTH, viewport()),
  );
  const [dragging, setDragging] = useState(false);
  const [vw, setVw] = useState<number>(() => viewport());

  // On open (and when enabling), restore persisted width and re-clamp to the
  // current viewport — the window may have been resized while the drawer was shut.
  useEffect(() => {
    if (!open) return;
    const nextVw = viewport();
    setVw(nextVw);
    setWidth(clampDrawerWidth(readStoredWidth() ?? DRAWER_DEFAULT_WIDTH, nextVw));
  }, [open]);

  // Recompute split + re-clamp on window resize (keeps both layouts honest when
  // the user resizes the browser with the drawer open).
  useEffect(() => {
    if (!enabled) return undefined;
    const onResize = (): void => {
      const nextVw = viewport();
      setVw(nextVw);
      setWidth((w) => clampDrawerWidth(w, nextVw));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [enabled]);

  // Drag bookkeeping kept in a ref so the move/up listeners read fresh values
  // without re-subscribing on every width change.
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      if (!enabled) return;
      e.preventDefault();
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      const nextVw = viewport();
      setVw(nextVw);
      dragRef.current = { startX: e.clientX, startWidth: width };
      setDragging(true);

      const onMove = (ev: PointerEvent): void => {
        const d = dragRef.current;
        if (!d) return;
        // Handle is on the LEFT edge of a right-anchored panel: moving the
        // pointer left (smaller clientX) must WIDEN the drawer → subtract delta.
        const delta = ev.clientX - d.startX;
        setWidth(clampDrawerWidth(d.startWidth - delta, nextVw));
      };
      const onUp = (): void => {
        dragRef.current = null;
        setDragging(false);
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onUp);
        // Persist the final width (read latest via functional setState).
        setWidth((w) => {
          writeStoredWidth(w);
          return w;
        });
      };

      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onUp);
    },
    [enabled, width],
  );

  return {
    width,
    dragging: enabled && dragging,
    isSplit: enabled && computeIsSplit(width, vw),
    onHandlePointerDown,
  };
}

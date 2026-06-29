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

// Upper clamp is viewport-relative. По задаче 16 — тянуть можно «до какого угодно размера»,
// поэтому жёсткого потолка в px больше нет: только доля вьюпорта (почти во всю ширину).
export const DRAWER_MAX_VIEWPORT_RATIO = 0.99;

// Ширина левой панели (px) — когда левый край окна доезжает до неё, шлём событие
// «свернуть сайдбар» (AppShell слушает). Должна совпадать с grid-cols в AppShell.
export const SIDEBAR_WIDTH = 270;

// Доля вьюпорта, после которой отпускание ручки = «развернуть на весь экран» → страница.
export const DRAWER_EDGE_RATIO = 0.97;

// Split threshold: switch to the two-pane layout only when the drawer is clearly
// wide — at least ~62% of the viewport, capped at 1024px. Below this the drawer
// stays a single stacked column (task → comments), so comments are always visible.
export const DRAWER_SPLIT_VIEWPORT_RATIO = 0.62;
export const DRAWER_SPLIT_CAP = 1024;

/** Upper bound for the drawer width given the current viewport width (доля вьюпорта). */
export function drawerMaxWidth(viewportWidth: number): number {
  return Math.round(viewportWidth * DRAWER_MAX_VIEWPORT_RATIO);
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
  /** Current clamped width in px (when maximized — the viewport-max width). */
  readonly width: number;
  /** True while the user is actively dragging the handle (gate transitions off). */
  readonly dragging: boolean;
  /** True when the layout should be the two-pane split. */
  readonly isSplit: boolean;
  /** True when the drawer is expanded to full (max) width. */
  readonly maximized: boolean;
  /** Toggle the full-width (fullscreen) state. */
  readonly toggleMaximized: () => void;
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
export function useResizableWidth(
  enabled: boolean,
  open: boolean,
  // Вызывается на отпускании ручки, если окно дотянули почти до края (≈весь экран) —
  // консьюмер открывает задачу отдельной страницей (как кнопка «развернуть»).
  onDragToEdge?: () => void,
): ResizableWidth {
  const [width, setWidth] = useState<number>(() =>
    clampDrawerWidth(readStoredWidth() ?? DRAWER_DEFAULT_WIDTH, viewport()),
  );
  const [dragging, setDragging] = useState(false);
  // Один раз за перетаскивание шлём «свернуть сайдбар», когда левый край доехал до него.
  const reachedSidebarRef = useRef(false);
  // Свежий onDragToEdge без переподписки слушателей.
  const onDragToEdgeRef = useRef(onDragToEdge);
  useEffect(() => {
    onDragToEdgeRef.current = onDragToEdge;
  }, [onDragToEdge]);
  // «Развернуть на весь экран» — окно растягивается на максимум (drawerMaxWidth).
  // Не персистится: каждое открытие стартует в обычной ширине.
  const [maximized, setMaximized] = useState(false);
  const [vw, setVw] = useState<number>(() => viewport());

  // On open (and when enabling), restore persisted width and re-clamp to the
  // current viewport — the window may have been resized while the drawer was shut.
  useEffect(() => {
    if (!open) return;
    const nextVw = viewport();
    setVw(nextVw);
    setWidth(clampDrawerWidth(readStoredWidth() ?? DRAWER_DEFAULT_WIDTH, nextVw));
    setMaximized(false);
  }, [open]);

  const toggleMaximized = useCallback((): void => {
    setMaximized((m) => !m);
  }, []);

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
      // Ручной ресайз выходит из fullscreen-режима.
      setMaximized(false);
      reachedSidebarRef.current = false;
      dragRef.current = { startX: e.clientX, startWidth: width };
      setDragging(true);

      const onMove = (ev: PointerEvent): void => {
        const d = dragRef.current;
        if (!d) return;
        // Handle is on the LEFT edge of a right-anchored panel: moving the
        // pointer left (smaller clientX) must WIDEN the drawer → subtract delta.
        const delta = ev.clientX - d.startX;
        const newWidth = clampDrawerWidth(d.startWidth - delta, nextVw);
        // Левый край окна = nextVw - newWidth. Доехал до сайдбара → один раз просим
        // AppShell свернуть панель (освобождаем место под окно).
        if (nextVw - newWidth <= SIDEBAR_WIDTH && !reachedSidebarRef.current) {
          reachedSidebarRef.current = true;
          window.dispatchEvent(new CustomEvent('pf:drawer-over-sidebar'));
        }
        setWidth(newWidth);
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
        setWidth((w) => {
          // Дотянули почти до края (≈весь экран) → открыть отдельной страницей
          // (как кнопка «развернуть»). Почти-полную ширину НЕ персистим.
          if (w >= nextVw * DRAWER_EDGE_RATIO && onDragToEdgeRef.current) {
            onDragToEdgeRef.current();
            return w;
          }
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

  // В fullscreen окно растягивается почти на весь вьюпорт (96vw, без жёсткого потолка
  // 1400 — это осознанный «во весь экран»); split в этом режиме всегда включён.
  const effectiveWidth =
    enabled && maximized ? Math.round(vw * DRAWER_MAX_VIEWPORT_RATIO) : width;

  return {
    width: effectiveWidth,
    dragging: enabled && dragging,
    isSplit: enabled && (maximized || computeIsSplit(effectiveWidth, vw)),
    maximized: enabled && maximized,
    toggleMaximized,
    onHandlePointerDown,
  };
}

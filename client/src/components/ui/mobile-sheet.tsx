import * as React from 'react';
import { canDragSheetFrom, shouldDismissSheet } from '@/lib/mobileSheetGesture';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';

export function useMobileSheet(enabled = true): boolean {
  return (
    useMediaQuery(
      '(max-width: 767px), (max-width: 1023px) and (max-height: 500px) and (pointer: coarse)',
    ) && enabled
  );
}

export const MobileSurfaceContext = React.createContext(false);

/**
 * Visual-viewport geometry for sheets, kept in memory by app-wide listeners. A sheet reads it
 * from here on mount instead of from the DOM: reading visualViewport / innerHeight right after
 * React inserts the sheet forces a synchronous layout of the whole page, and writing the
 * variables then restyles the entire sheet a second time — together about a third of the
 * main-thread cost of opening a task on a phone.
 */
type SheetViewport = { height: number; layoutHeight: number; keyboard: number };
let sheetViewport: SheetViewport | null = null;
const sheetViewportListeners = new Set<() => void>();

function measureSheetViewport(): SheetViewport {
  const viewport = window.visualViewport;
  const layoutHeight = window.innerHeight;
  const height = viewport?.height ?? layoutHeight;
  return { height, layoutHeight, keyboard: Math.max(0, layoutHeight - height - (viewport?.offsetTop ?? 0)) };
}

function watchSheetViewport(listener: () => void): () => void {
  if (!sheetViewport) {
    sheetViewport = measureSheetViewport();
    const update = (): void => {
      sheetViewport = measureSheetViewport();
      for (const notify of sheetViewportListeners) notify();
    };
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
  }
  sheetViewportListeners.add(listener);
  return () => {
    sheetViewportListeners.delete(listener);
  };
}

/** Starts the viewport cache while the page is idle, so even the first sheet opens without a forced layout. */
export function warmSheetViewport(): void {
  if (typeof window === 'undefined' || sheetViewport) return;
  const warm = (): void => watchSheetViewport(() => {})();
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(warm, { timeout: 2000 });
  else setTimeout(warm, 300);
}

/** Keeps Radix in charge of focus, dismissal and draft/confirmation guards. */
export function useMobileSheetSurface(
  enabled: boolean,
  forwardedRef?: React.Ref<HTMLDivElement>,
) {
  const [node, setNode] = React.useState<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const ref = React.useCallback(
    (element: HTMLDivElement | null) => {
      setNode(element);
      if (typeof forwardedRef === 'function') forwardedRef(element);
      else if (forwardedRef) forwardedRef.current = element;
    },
    [forwardedRef],
  );

  React.useEffect(() => {
    if (!enabled || !node) return;
    let written: string | null = null;
    const resize = (): void => {
      const { height, layoutHeight, keyboard } = sheetViewport!;
      // An untouched viewport (no keyboard, no zoom) is exactly the CSS fallback (100dvh, 0px):
      // the variables stay unset, and opening the sheet costs no extra restyle.
      const key = keyboard < 1 && Math.abs(layoutHeight - height) < 1 ? '' : `${height}/${keyboard}`;
      if (key === written) return;
      written = key;
      if (!key) {
        node.style.removeProperty('--pf-sheet-viewport');
        node.style.removeProperty('--pf-sheet-keyboard');
        return;
      }
      node.style.setProperty('--pf-sheet-viewport', `${height}px`);
      node.style.setProperty('--pf-sheet-keyboard', `${keyboard}px`);
    };
    const unwatchViewport = watchSheetViewport(resize);
    resize();
    // Some legacy forms scroll the dialog itself rather than an inner body.
    const keepHandleVisible = (): void => {
      closeRef.current?.style.setProperty(
        '--pf-sheet-handle-scroll',
        `${node.scrollTop}px`,
      );
    };
    node.addEventListener('scroll', keepHandleVisible, { passive: true });

    let gesture: {
      x: number;
      y: number;
      lastY: number;
      time: number;
      velocity: number;
      distance: number;
      dragging: boolean;
    } | null = null;
    let suppressClickUntil = 0;
    const start = (target: EventTarget | null, x: number, y: number): void => {
      const surfaces = document.querySelectorAll(
        '[data-pf-mobile-sheet="true"][data-state="open"]',
      );
      if (
        surfaces[surfaces.length - 1] !== node ||
        !(target instanceof Element) ||
        !canDragSheetFrom(target, node)
      )
        return;
      if (
        !target.closest('[data-pf-sheet-handle]') &&
        window.getSelection()?.isCollapsed === false
      )
        return;
      gesture = {
        x,
        y,
        lastY: y,
        time: performance.now(),
        velocity: 0,
        distance: 0,
        dragging: false,
      };
    };
    const move = (x: number, y: number, event: Event): void => {
      if (!gesture) return;
      const dx = x - gesture.x;
      const dy = y - gesture.y;
      if (!gesture.dragging) {
        if ((Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) || dy < -8) {
          gesture = null;
          return;
        }
        if (dy < 8 || Math.abs(dy) <= Math.abs(dx)) return;
        gesture.dragging = true;
        node.setAttribute('data-pf-sheet-interacted', '');
        node.setAttribute('data-pf-sheet-dragging', '');
      }
      if (event.cancelable) event.preventDefault();
      const now = performance.now();
      gesture.velocity = (y - gesture.lastY) / Math.max(1, now - gesture.time);
      gesture.time = now;
      gesture.lastY = y;
      gesture.distance = Math.max(0, dy);
      node.style.setProperty('--pf-sheet-y', `${gesture.distance}px`);
    };
    const finish = (cancelled: boolean, event?: Event): void => {
      const current = gesture;
      gesture = null;
      node.removeAttribute('data-pf-sheet-dragging');
      if (!current?.dragging) return;
      if (event?.cancelable) event.preventDefault();
      // A finger held still must not retain the velocity of an earlier movement.
      const velocity =
        performance.now() - current.time > 100 ? 0 : current.velocity;
      const dismiss =
        !cancelled &&
        shouldDismissSheet(current.distance, velocity, node.clientHeight);
      if (dismiss) {
        // The sheet stays exactly where the finger let it go until it is closed, and the
        // exit animation starts from that point. Resetting --pf-sheet-y here first made the
        // open sheet glide back up for a frame before the close re-rendered it: a fast swipe
        // flashed the whole sheet («мигает», «открывается сверху»).
        node.style.setProperty('--pf-sheet-release-y', `${current.distance}px`);
        node.setAttribute('data-pf-sheet-dragging', '');
        closeRef.current?.click();
        // A controlled form may reject dismissal: then glide back and forget the offset.
        requestAnimationFrame(() => {
          if (node.dataset.state !== 'open') return;
          node.removeAttribute('data-pf-sheet-dragging');
          node.style.setProperty('--pf-sheet-release-y', '0px');
          node.style.setProperty('--pf-sheet-y', '0px');
        });
      } else {
        node.style.setProperty('--pf-sheet-release-y', '0px');
        node.style.setProperty('--pf-sheet-y', '0px');
      }
      suppressClickUntil = performance.now() + 400;
    };
    const touchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) {
        finish(true);
        return;
      }
      start(e.target, e.touches[0].clientX, e.touches[0].clientY);
    };
    const touchMove = (e: TouchEvent): void => {
      if (e.touches.length !== 1) {
        finish(true);
        return;
      }
      move(e.touches[0].clientX, e.touches[0].clientY, e);
    };
    const touchEnd = (e: TouchEvent): void => finish(false, e);
    const touchCancel = (): void => finish(true);
    const pointerDown = (e: PointerEvent): void => {
      if (
        e.pointerType !== 'mouse' ||
        e.button !== 0 ||
        !(e.target instanceof Element) ||
        !e.target.closest('[data-pf-sheet-handle]')
      )
        return;
      start(e.target, e.clientX, e.clientY);
    };
    const pointerMove = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse') move(e.clientX, e.clientY, e);
    };
    const pointerUp = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse') finish(false);
    };
    const click = (e: MouseEvent): void => {
      if (e.detail > 0 && performance.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    // A surface kept mounted between close and reopen must not come back at the offset it
    // was swiped away from.
    const stateObserver = new MutationObserver(() => {
      if (node.dataset.state !== 'open' || gesture) return;
      node.removeAttribute('data-pf-sheet-dragging');
      node.style.setProperty('--pf-sheet-y', '0px');
      node.style.setProperty('--pf-sheet-release-y', '0px');
    });
    stateObserver.observe(node, { attributes: true, attributeFilter: ['data-state'] });
    node.addEventListener('touchstart', touchStart, { passive: true });
    node.addEventListener('touchmove', touchMove, { passive: false });
    node.addEventListener('touchend', touchEnd, { passive: false });
    node.addEventListener('touchcancel', touchCancel);
    node.addEventListener('pointerdown', pointerDown);
    document.addEventListener('pointermove', pointerMove);
    document.addEventListener('pointerup', pointerUp);
    node.addEventListener('click', click, true);
    return () => {
      stateObserver.disconnect();
      unwatchViewport();
      node.removeEventListener('scroll', keepHandleVisible);
      node.removeEventListener('touchstart', touchStart);
      node.removeEventListener('touchmove', touchMove);
      node.removeEventListener('touchend', touchEnd);
      node.removeEventListener('touchcancel', touchCancel);
      node.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('pointermove', pointerMove);
      document.removeEventListener('pointerup', pointerUp);
      node.removeEventListener('click', click, true);
      node.removeAttribute('data-pf-sheet-dragging');
      node.removeAttribute('data-pf-sheet-interacted');
      node.style.removeProperty('--pf-sheet-y');
    };
  }, [enabled, node]);

  return { ref, closeRef };
}

export const MobileSheetHandle = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function MobileSheetHandle(props, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      data-pf-sheet-handle=""
      className="pf-sheet-handle"
      aria-label="Закрыть окно"
    >
      <span aria-hidden="true" />
    </button>
  );
});

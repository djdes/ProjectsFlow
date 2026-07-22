// Протяжка мышью в режиме выделения: зажал на карточке, провёл — все карточки, через
// которые прошёл указатель, попадают в выбор.
//
// Approach: "paint over cards", not a rubber-band rectangle. The board is a row of
// independently scrolling columns with sticky headers and a horizontal scroller, so a
// viewport rectangle would have to be intersected against constantly-moving geometry.
// Painting resolves the card under the pointer via `document.elementFromPoint` on every
// move, which stays correct no matter how the board scrolls underneath. A fast pointer
// that jumps over intermediate cards is compensated by filling the range between the
// previous and the current card *inside the same column* (see `idsBetween`), so the
// gesture never leaves holes.
//
// dnd-kit interplay: in selection mode `KanbanCard` passes `disabled: true` to
// `useSortable` AND does not spread `attributes`/`listeners`, so no dnd-kit sensor is
// attached to the card at all — the pointer stream is ours exclusively. Outside of
// selection mode this hook is disabled, so dragging cards works exactly as before.
//
// Touch is intentionally excluded (mouse/pen only): on a phone a press-and-drag is how
// the user scrolls the column, and hijacking it would break the board.

import { useEffect, useRef } from 'react';

// Card DOM nodes carry data-pf-task-id (see KanbanCard) — that is how a gesture resolves
// "which card is under the pointer" without touching React state.
const CARD_ATTR = 'data-pf-task-id';

// Travel before a press becomes a drag. Below it the press stays a plain click, so the
// existing click-to-toggle (with shift/ctrl modifiers) is untouched.
const DRAG_THRESHOLD_PX = 6;

// Edge autoscroll: how close to the edge scrolling starts and its max per-frame step.
// Deliberately small — the board must glide, not jump.
const EDGE_ZONE_PX = 72;
const MAX_SCROLL_STEP_PX = 13;

export type DragSelectOptions = {
  // Режим выделения активен. false — хук полностью пассивен (drag карточек как обычно).
  enabled: boolean;
  // Visual order of card ids, one array per column. Used to fill gaps on fast drags.
  orderedGroups: () => readonly (readonly string[])[];
  // Selection snapshot at press time — Escape restores exactly this.
  getSelection: () => ReadonlySet<string>;
  // Add these ids to the selection (painting is additive).
  onPaint: (ids: readonly string[]) => void;
  // Escape during the gesture — roll the whole gesture back.
  onRestore: (snapshot: ReadonlySet<string>) => void;
};

// Ids between `from` and `to` inclusive, inside whichever column holds both. If they
// live in different columns (or one is unknown) only the target is returned — a
// cross-column drag paints what it actually passed over instead of sweeping whole columns.
export function idsBetween(
  groups: readonly (readonly string[])[],
  from: string | null,
  to: string,
): readonly string[] {
  if (from === null || from === to) return [to];
  for (const group of groups) {
    const a = group.indexOf(from);
    const b = group.indexOf(to);
    if (a === -1 || b === -1) continue;
    return a <= b ? group.slice(a, b + 1) : group.slice(b, a + 1);
  }
  return [to];
}

function cardIdAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  if (!(el instanceof Element)) return null;
  return el.closest(`[${CARD_ATTR}]`)?.getAttribute(CARD_ATTR) ?? null;
}

// Nearest ancestor that actually scrolls vertically. null ⇒ the page itself scrolls.
function findVerticalScroller(el: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = el.parentElement;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (
      /(?:auto|scroll|overlay)/u.test(overflowY) &&
      current.scrollHeight > current.clientHeight + 1
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

type Gesture = {
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  startId: string;
  lastId: string | null;
  started: boolean;
  snapshot: ReadonlySet<string>;
  scroller: HTMLElement | null;
  raf: number | null;
};

export function useDragSelect(options: DragSelectOptions): {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
} {
  // Options are re-created on every render; keeping them in a ref lets the document-level
  // listeners read fresh values without re-subscribing.
  const optsRef = useRef(options);
  // Sync after commit, not during render: handlers only run from user events, which are
  // always later than the effect that refreshed the snapshot.
  useEffect(() => {
    optsRef.current = options;
  });
  const gestureRef = useRef<Gesture | null>(null);
  // Stable teardown, shared by pointerup / pointercancel / Escape / unmount.
  const endRef = useRef<() => void>(() => {});

  useEffect(() => () => endRef.current(), []);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>): void => {
    if (!optsRef.current.enabled) return;
    // Touch is left to the browser (column scrolling); pen behaves like a mouse.
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    if (e.button !== 0) return;
    if (gestureRef.current) return;
    const target = e.target instanceof Element ? e.target.closest(`[${CARD_ATTR}]`) : null;
    const startId = target?.getAttribute(CARD_ATTR);
    if (!startId || !(target instanceof HTMLElement)) return;

    const gesture: Gesture = {
      startX: e.clientX,
      startY: e.clientY,
      pointerX: e.clientX,
      pointerY: e.clientY,
      startId,
      lastId: null,
      started: false,
      snapshot: optsRef.current.getSelection(),
      scroller: findVerticalScroller(target),
      raf: null,
    };
    gestureRef.current = gesture;

    const paintAtPointer = (): void => {
      const id = cardIdAt(gesture.pointerX, gesture.pointerY);
      if (id === null || id === gesture.lastId) return;
      optsRef.current.onPaint(idsBetween(optsRef.current.orderedGroups(), gesture.lastId, id));
      gesture.lastId = id;
    };

    // Gentle edge autoscroll: speed ramps with how deep into the edge zone the pointer
    // is, applied in small per-frame steps so the board glides instead of jerking.
    const tick = (): void => {
      if (gestureRef.current !== gesture || !gesture.started) return;
      const scroller = gesture.scroller;
      const rect = scroller?.getBoundingClientRect();
      const top = rect?.top ?? 0;
      const bottom = rect?.bottom ?? window.innerHeight;
      let step = 0;
      if (gesture.pointerY < top + EDGE_ZONE_PX) {
        const depth = Math.min(1, (top + EDGE_ZONE_PX - gesture.pointerY) / EDGE_ZONE_PX);
        step = -Math.max(1, Math.round(depth * MAX_SCROLL_STEP_PX));
      } else if (gesture.pointerY > bottom - EDGE_ZONE_PX) {
        const depth = Math.min(1, (gesture.pointerY - (bottom - EDGE_ZONE_PX)) / EDGE_ZONE_PX);
        step = Math.max(1, Math.round(depth * MAX_SCROLL_STEP_PX));
      }
      if (step !== 0) {
        if (scroller) scroller.scrollTop += step;
        else window.scrollBy(0, step);
        // The board moved under a stationary pointer — a different card is there now.
        paintAtPointer();
      }
      gesture.raf = requestAnimationFrame(tick);
    };

    const onMove = (ev: PointerEvent): void => {
      if (gestureRef.current !== gesture) return;
      gesture.pointerX = ev.clientX;
      gesture.pointerY = ev.clientY;
      if (!gesture.started) {
        const dx = ev.clientX - gesture.startX;
        const dy = ev.clientY - gesture.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        gesture.started = true;
        // Selecting text while sweeping across cards looks broken — suppress it.
        document.body.style.userSelect = 'none';
        optsRef.current.onPaint([gesture.startId]);
        gesture.lastId = gesture.startId;
        gesture.raf = requestAnimationFrame(tick);
      }
      paintAtPointer();
    };

    const end = (): void => {
      if (gestureRef.current !== gesture) return;
      gestureRef.current = null;
      if (gesture.raf !== null) cancelAnimationFrame(gesture.raf);
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      endRef.current = () => {};
    };

    // A finished drag must not also fire the card's click handler (it would toggle the
    // card the gesture started on right back off). The listener is one-shot and is torn
    // down on the next macrotask in case no click follows at all.
    const swallowNextClick = (): void => {
      const swallow = (ev: MouseEvent): void => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      document.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);
    };

    const onUp = (): void => {
      const dragged = gesture.started;
      end();
      if (dragged) swallowNextClick();
    };

    const onCancel = (): void => {
      const dragged = gesture.started;
      const snapshot = gesture.snapshot;
      end();
      if (dragged) optsRef.current.onRestore(snapshot);
    };

    // Capture phase on window: fires before the board's own Escape handler (which exits
    // selection mode entirely) and stops it — Escape during a sweep cancels only the sweep.
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return;
      if (!gesture.started) {
        end();
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      onCancel();
    };

    endRef.current = end;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
  };

  return { onPointerDown };
}

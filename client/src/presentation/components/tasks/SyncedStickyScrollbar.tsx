import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

function setSyncedPosition(element: HTMLElement, left: number, pending: WeakMap<HTMLElement, number>): void {
  if (element.scrollLeft === left) return;
  element.scrollLeft = left;
  // Read the actual position: the browser can clamp it after a resize.
  pending.set(element, element.scrollLeft);
}

function isSyncedScroll(element: HTMLElement, pending: WeakMap<HTMLElement, number>): boolean {
  const expected = pending.get(element);
  if (expected !== undefined && element.scrollLeft === expected) return true;
  pending.delete(element);
  return false;
}

/** A native horizontal scrollbar pinned to the page's vertical scrollport. */
export function SyncedStickyScrollbar({
  target,
  ctrlWheel = false,
  className,
}: {
  target: HTMLElement | null;
  ctrlWheel?: boolean;
  className?: string;
}): React.ReactElement | null {
  const trackRef = useRef<HTMLDivElement>(null);
  const pendingScrolls = useRef(new WeakMap<HTMLElement, number>());
  const [size, setSize] = useState({ scrollWidth: 0, clientWidth: 0 });

  useLayoutEffect(() => {
    if (!target) return;
    const pending = pendingScrolls.current;

    const measure = (): void => {
      const { scrollWidth, clientWidth } = target;
      setSize(previous => (
        previous.scrollWidth === scrollWidth && previous.clientWidth === clientWidth
          ? previous
          : { scrollWidth, clientWidth }
      ));
    };
    const syncTrack = (): void => {
      // Scroll events arrive asynchronously. An echo of our own write must not
      // move the thumb back while the user is already dragging it further.
      if (isSyncedScroll(target, pending)) return;
      const track = trackRef.current;
      if (track) setSyncedPosition(track, target.scrollLeft, pending);
    };

    // Observe columns too: collapsing one changes scrollWidth without resizing the row.
    const ro = new ResizeObserver(measure);
    const observeSizes = (): void => {
      ro.disconnect();
      ro.observe(target);
      for (const child of Array.from(target.children)) ro.observe(child);
      measure();
    };
    observeSizes();
    const mo = new MutationObserver(observeSizes);
    mo.observe(target, { childList: true, subtree: true });

    const onWheel = (event: WheelEvent): void => {
      if (!ctrlWheel || !event.ctrlKey || event.defaultPrevented
        || target.scrollWidth <= target.clientWidth + 1) return;
      const delta = event.deltaY || event.deltaX;
      if (!delta) return;
      // Ctrl + wheel normally zooms Chrome; only the overflowing queue owns this gesture.
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientWidth : 1;
      target.scrollLeft += delta * unit;
    };
    target.addEventListener('scroll', syncTrack, { passive: true });
    if (ctrlWheel) target.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', observeSizes);
    const track = trackRef.current;
    return () => {
      pending.delete(target);
      if (track) pending.delete(track);
      ro.disconnect();
      mo.disconnect();
      target.removeEventListener('scroll', syncTrack);
      target.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', observeSizes);
    };
  }, [target, ctrlWheel]);

  // The track may mount after measuring overflow. Restore its position in that commit.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (target && track) setSyncedPosition(track, target.scrollLeft, pendingScrolls.current);
  }, [target, size]);

  const onTrackScroll = (): void => {
    const track = trackRef.current;
    if (track && isSyncedScroll(track, pendingScrolls.current)) return;
    if (target && track && target.scrollLeft !== track.scrollLeft) {
      setSyncedPosition(target, track.scrollLeft, pendingScrolls.current);
    }
  };

  if (!target || size.scrollWidth <= size.clientWidth + 1) return null;

  return (
    <div
      className={cn(
        'pointer-events-none sticky inset-be-0 z-20 -mbs-2 hidden sm:flex sm:justify-end',
        className,
      )}
      aria-hidden
    >
      <div
        ref={trackRef}
        data-pf-sticky-hscroll
        onScroll={onTrackScroll}
        className="pointer-events-auto max-w-full shrink-0 overflow-x-auto overflow-y-hidden"
        style={{ width: size.clientWidth }}
      >
        <div style={{ width: size.scrollWidth, height: 1 }} />
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useScrollEdges } from '@/presentation/components/tasks/inbox/useScrollEdges';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

// Flags for `.pf-fade-x` (globals.css): which edges of a sideways ribbon still hide content.
// For rows that already own their element (a toolbar with its own handlers) — spread the
// result onto it; otherwise use <EdgeFadeScroller>.
export type EdgeFadeProps = { 'data-fade-start'?: ''; 'data-fade-end'?: '' };

export function useEdgeFade(): readonly [(element: HTMLElement | null) => void, EdgeFadeProps] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const { back, forward } = useScrollEdges(element);
  const fadeProps: EdgeFadeProps = {
    ...(back ? { 'data-fade-start': '' as const } : {}),
    ...(forward ? { 'data-fade-end': '' as const } : {}),
  };
  return [setElement, fadeProps] as const;
}

// A row that scrolls sideways without a scrollbar and dissolves at the edge that hides
// content, so a cut-off item reads as «there is more», not as a clipped layout.
export function EdgeFadeScroller({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  const [attach, fadeProps] = useEdgeFade();
  return (
    <div
      ref={attach}
      {...fadeProps}
      {...rest}
      className={cn('pf-fade-x pf-scrollbar-hide overflow-x-auto overscroll-x-contain', className)}
    >
      {children}
    </div>
  );
}

// Width the edge buttons take over the ribbon (2.75rem = 44px touch target).
const STEPPER_PX = 44;

// Items of the ribbon's single row (children of its first child) that the end edge cuts —
// fully or partly — counting the stepper button that covers the end.
function hiddenAfter(scroller: HTMLElement, stepper: HTMLElement | null): { count: number; first: Element | null } {
  const row = scroller.firstElementChild;
  if (!row) return { count: 0, first: null };
  // The button's own left edge: the scroll box sticks out 4px (-m-1 p-1 for focus rings),
  // so «box right − button width» missed an item hidden in those 4px.
  const edge = stepper ? stepper.getBoundingClientRect().left : scroller.getBoundingClientRect().right - STEPPER_PX;
  let count = 0;
  let first: Element | null = null;
  for (const item of Array.from(row.children)) {
    const box = item.getBoundingClientRect();
    if (box.width === 0 || box.right <= edge + 1) continue;
    count += 1;
    first ??= item;
  }
  return { count, first };
}

// The number of cut-off items, kept current on scroll and on size/content changes.
function useHiddenAfterCount(
  scroller: HTMLElement | null,
  forward: boolean,
  stepper: RefObject<HTMLButtonElement | null>,
): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!scroller || !forward) {
      setCount(0);
      return;
    }
    let frame = 0;
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCount(hiddenAfter(scroller, stepper.current).count));
    };
    measure();
    scroller.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(scroller);
    if (scroller.firstElementChild) ro?.observe(scroller.firstElementChild);
    // «+9» → «+12» widens the button and moves its edge.
    if (stepper.current) ro?.observe(stepper.current);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [scroller, forward, stepper]);
  return count;
}

// 36px on touch screens, 28px next to the 28px chips of the desktop row (hit area +4px).
const STEPPER_CLASS =
  'pointer-events-auto relative inline-flex h-9 md:h-7 md:text-meta shrink-0 items-center justify-center gap-0.5 rounded-full border border-border bg-raised text-ui font-semibold tabular-nums text-foreground shadow-float transition-colors hover:bg-hover active:bg-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary after:absolute after:-inset-1 after:content-[""]';

// A sideways ribbon with explicit steppers at the edges that hide content: «+N ›» at the end
// (N — how many items are cut off) and «‹» at the start. A fade alone did not read as «swipe
// for more» on a phone: the last item could end right at the screen edge, and in the dark
// theme the dissolving sliver is barely visible. Swiping still works; the buttons page the
// ribbon so the first cut-off item lands at the start.
export function SteppedRibbon({
  className,
  controlsClassName = 'inset-be-0',
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  // Vertical box of the edge buttons inside the ribbon: the whole height by default; `h-11`
  // centres them on a 44px row of avatars whose names hang below.
  controlsClassName?: string;
}): React.ReactElement {
  const { animations } = useMotion();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const { back, forward } = useScrollEdges(scroller);
  const stepperRef = useRef<HTMLButtonElement>(null);
  const hidden = useHiddenAfterCount(scroller, forward, stepperRef);
  const behavior: ScrollBehavior = animations ? 'smooth' : 'auto';
  const pageForward = useCallback(() => {
    if (!scroller) return;
    const { first } = hiddenAfter(scroller, stepperRef.current);
    // Room at the start after paging: the «‹» button (mouse layouts) or just the start fade.
    const startRoom = window.matchMedia?.('(min-width: 768px)').matches ? STEPPER_PX : 28;
    const left = first
      ? first.getBoundingClientRect().left - scroller.getBoundingClientRect().left - startRoom
      : scroller.clientWidth - 2 * STEPPER_PX;
    scroller.scrollBy({ left: Math.max(left, STEPPER_PX), behavior });
  }, [scroller, behavior]);
  const pageBack = useCallback(() => {
    scroller?.scrollBy({ left: -(scroller.clientWidth - 2 * STEPPER_PX), behavior });
  }, [scroller, behavior]);
  return (
    <div className={cn('relative min-w-0', className)}>
      <div
        ref={setScroller}
        {...(back ? { 'data-fade-start': '', 'data-stepper-start': '' } : {})}
        {...(forward ? { 'data-fade-end': '', 'data-stepper-end': '' } : {})}
        {...rest}
        // p-1 -m-1: room for the focus ring, which the scroll box would clip.
        className="pf-fade-x pf-scrollbar-hide -m-1 overflow-x-auto overscroll-x-contain p-1"
      >
        {children}
      </div>
      {/* «‹» — only with a mouse (from 768px): on a phone the ribbon is swiped back, and on
          320–393px the button left room for no whole person between «‹» and «+N ›». */}
      {back && (
        <div className={cn('pointer-events-none absolute inset-bs-0 start-0 hidden items-center md:flex', controlsClassName)}>
          <button type="button" onClick={pageBack} aria-label="Листать назад" title="Листать назад" className={cn(STEPPER_CLASS, 'w-9 md:w-7')}>
            <ChevronLeft aria-hidden className="size-4" />
          </button>
        </div>
      )}
      {forward && (
        <div className={cn('pointer-events-none absolute inset-bs-0 end-0 flex items-center', controlsClassName)}>
          <button
            ref={stepperRef}
            type="button"
            onClick={pageForward}
            aria-label={hidden > 0 ? `Ещё ${hidden} — листать вперёд` : 'Листать вперёд'}
            title="Листать вперёд"
            className={cn(STEPPER_CLASS, 'min-w-9 pe-1.5 ps-2 md:min-w-7 md:pe-1 md:ps-1.5')}
          >
            {hidden > 0 && <span>+{hidden}</span>}
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

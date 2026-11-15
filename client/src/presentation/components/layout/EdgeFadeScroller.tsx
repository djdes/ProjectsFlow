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
  const edge = scroller.getBoundingClientRect().right - Math.max(stepper?.offsetWidth ?? 0, STEPPER_PX);
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
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [scroller, forward, stepper]);
  return count;
}

const STEPPER_CLASS =
  'pointer-events-auto relative inline-flex h-9 shrink-0 items-center justify-center gap-0.5 rounded-full border border-border bg-raised text-ui font-semibold tabular-nums text-foreground shadow-float transition-colors hover:bg-hover active:bg-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary after:absolute after:-inset-1 after:content-[""]';

// A sideways ribbon with explicit steppers at the edges that hide content: «+N ›» at the end
// (N — how many items are cut off) and «‹» at the start. A fade alone did not read as «swipe
// for more» on a phone: the last item could end right at the screen edge, and in the dark
// theme the dissolving sliver is barely visible. Swiping still works; the buttons page the
// ribbon so the first cut-off item lands at the start.
export function SteppedRibbon({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  const { animations } = useMotion();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const { back, forward } = useScrollEdges(scroller);
  const stepperRef = useRef<HTMLButtonElement>(null);
  const hidden = useHiddenAfterCount(scroller, forward, stepperRef);
  const behavior: ScrollBehavior = animations ? 'smooth' : 'auto';
  const pageForward = useCallback(() => {
    if (!scroller) return;
    const { first } = hiddenAfter(scroller, stepperRef.current);
    const left = first
      ? first.getBoundingClientRect().left - scroller.getBoundingClientRect().left - STEPPER_PX
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
      {back && (
        <div className="pointer-events-none absolute inset-bs-0 inset-be-0 start-0 flex items-center">
          <button type="button" onClick={pageBack} aria-label="Листать назад" title="Листать назад" className={cn(STEPPER_CLASS, 'w-9')}>
            <ChevronLeft aria-hidden className="size-4" />
          </button>
        </div>
      )}
      {forward && (
        <div className="pointer-events-none absolute inset-bs-0 inset-be-0 end-0 flex items-center">
          <button
            ref={stepperRef}
            type="button"
            onClick={pageForward}
            aria-label={hidden > 0 ? `Ещё ${hidden} — листать вперёд` : 'Листать вперёд'}
            title="Листать вперёд"
            className={cn(STEPPER_CLASS, 'min-w-9 pe-1.5 ps-2')}
          >
            {hidden > 0 && <span>+{hidden}</span>}
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

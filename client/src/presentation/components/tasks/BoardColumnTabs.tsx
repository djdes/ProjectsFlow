import { useEffect, useRef, useState, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { boxIn, LiquidIndicator, type IndicatorBox } from '@/lib/liquidIndicator';
import { useEdgeFade } from '@/presentation/components/layout/EdgeFadeScroller';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { RollingNumber } from '@/presentation/components/motion/RollingNumber';

export type BoardColumnTab = {
  readonly status: string;
  readonly label: string;
  readonly count: number;
};

type Props = {
  columns: readonly BoardColumnTab[];
  // Горизонтальный скроллер ряда колонок доски (data-pf-kanban-scroll).
  scrollerRef: RefObject<HTMLDivElement | null>;
  className?: string;
};

// Найти колонку статуса в ряду доски (атрибут ставит KanbanColumn).
function findColumn(scroller: HTMLElement, status: string): HTMLElement | null {
  return scroller.querySelector<HTMLElement>(`[data-pf-column-status="${status}"]`);
}

/**
 * Навигация по колонкам доски на телефоне: ряд «Черновики 3 · Воркер 5 · Готово 12».
 *
 * На узком экране колонка занимает почти всю ширину, и доска листается свайпом по одной
 * колонке: было не видно, сколько колонок всего и где ты сейчас, а чтобы добраться до
 * «Готово», приходилось листать через все. Чип текущей колонки подсвечен (следим за
 * прокруткой ряда), тап по чипу — прокрутка к его колонке. На sm+ не показываем: там
 * колонки видны рядом.
 */
export function BoardColumnTabs({ columns, scrollerRef, className }: Props): React.ReactElement | null {
  const { animations } = useMotion();
  const stripRef = useRef<HTMLDivElement>(null);
  // Подсветка текущей колонки — жидкий индикатор: пока доску листают пальцем, он идёт за
  // прокруткой напрямую, перетекая между чипами пропорционально (lerp), а когда доска встала —
  // садится на чип пружиной с той скоростью, с какой ехал (lib/liquidIndicator).
  const pillRef = useRef<HTMLSpanElement>(null);
  const [attachFade, fadeProps] = useEdgeFade();
  const [active, setActive] = useState<string | null>(columns[0]?.status ?? null);
  const statusesKey = columns.map((c) => c.status).join('|');

  // Текущая колонка — та, чей центр ближе всего к центру видимой части ряда.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    let settleTimer = 0;
    // Движок живёт вместе с этим эффектом: смена набора колонок перемонтирует ряд чипов.
    let engine: LiquidIndicator | null = null;
    const chipBox = (status: string): IndicatorBox | null => {
      const strip = stripRef.current;
      const chip = strip?.querySelector<HTMLElement>(`[data-pf-tab-status="${status}"]`);
      return strip && chip ? boxIn(strip, chip) : null;
    };
    const measure = (): void => {
      const box = scroller.getBoundingClientRect();
      const center = box.left + box.width / 2;
      let best: string | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      const centers: { status: string; center: number }[] = [];
      for (const status of statusesKey.split('|')) {
        const column = findColumn(scroller, status);
        if (!column) continue;
        const rect = column.getBoundingClientRect();
        if (rect.width === 0) continue;
        const columnCenter = rect.left + rect.width / 2;
        centers.push({ status, center: columnCenter });
        const distance = Math.abs(columnCenter - center);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = status;
        }
      }
      if (best) setActive(best);
      const pill = pillRef.current;
      if (!pill || centers.length === 0 || !best) return;
      engine ??= new LiquidIndicator(pill);
      const liquid = engine;
      // Положение между соседними колонками → положение между их чипами.
      centers.sort((a, b) => a.center - b.center);
      let index = centers.findIndex((c) => c.center > center) - 1;
      if (index < 0) index = centers[0]!.center > center ? 0 : centers.length - 1;
      const from = centers[index]!;
      const to = centers[Math.min(centers.length - 1, index + 1)]!;
      const t = to === from ? 0 : Math.max(0, Math.min(1, (center - from.center) / (to.center - from.center)));
      const a = chipBox(from.status);
      const b = chipBox(to.status);
      if (!a || !b) return;
      const lerped: IndicatorBox = {
        left: a.left + (b.left - a.left) * t,
        top: a.top + (b.top - a.top) * t,
        width: a.width + (b.width - a.width) * t,
        height: a.height + (b.height - a.height) * t,
      };
      pill.style.opacity = '1';
      if (!liquid.box) liquid.jump(lerped);
      else liquid.follow(lerped);
      // Доска встала — садимся на ближайший чип пружиной с накопленной скоростью.
      window.clearTimeout(settleTimer);
      const settleOn = best;
      settleTimer = window.setTimeout(() => {
        const target = chipBox(settleOn);
        if (target) liquid.release(target);
      }, 120);
    };
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      engine?.destroy();
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [scrollerRef, statusesKey]);

  // Держим подсвеченный чип в видимой части ряда чипов. Двигаем только сам ряд, а не
  // scrollIntoView: тот прокрутил бы и страницу, если ряд уехал за верх экрана.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !active) return;
    const chip = strip.querySelector<HTMLElement>(`[data-pf-tab-status="${active}"]`);
    if (!chip) return;
    const box = strip.getBoundingClientRect();
    const rect = chip.getBoundingClientRect();
    if (rect.left < box.left) strip.scrollLeft -= box.left - rect.left + 16;
    else if (rect.right > box.right) strip.scrollLeft += rect.right - box.right + 16;
  }, [active]);

  if (columns.length < 2) return null;

  const goTo = (status: string): void => {
    const scroller = scrollerRef.current;
    const column = scroller ? findColumn(scroller, status) : null;
    if (!scroller || !column) return;
    const box = scroller.getBoundingClientRect();
    const rect = column.getBoundingClientRect();
    // Ставим колонку по центру — туда же её магнитит snap-center ряда.
    scroller.scrollTo({
      left: scroller.scrollLeft + rect.left - box.left - (box.width - rect.width) / 2,
      behavior: animations ? 'smooth' : 'auto',
    });
    setActive(status);
  };

  return (
    <nav aria-label="Колонки доски" className={className}>
      <div
        ref={(element) => {
          stripRef.current = element;
          attachFade(element);
        }}
        {...fadeProps}
        // Ряд листается вбок сам по себе; полосу прокрутки не показываем, а край, за
        // которым ещё есть колонки, растворяется (pf-fade-x).
        className="pf-fade-x pf-scrollbar-hide relative isolate flex gap-1.5 overflow-x-auto overscroll-x-contain pbe-2"
        data-pf-no-edge-swipe
      >
        <span
          ref={pillRef}
          aria-hidden
          className="pointer-events-none absolute start-0 top-0 rounded-md border border-primary bg-primary-soft opacity-0"
        />
        {columns.map((column) => {
          const current = column.status === active;
          return (
            <button
              key={column.status}
              type="button"
              data-pf-tab-status={column.status}
              aria-current={current ? 'true' : undefined}
              onClick={() => goTo(column.status)}
              className={cn(
                // Чип дизайна C4 — тот же, что у чипов срока во «Входящих» (DueFilterChips):
                // рамка border-border, радиус 6px, счётчик серым; текущий — bg-primary-soft и
                // акцентная рамка. Высота 40px — тач-цель телефона.
                // Подсветку текущего чипа рисует общий жидкий индикатор (выше), у чипа — подпись.
                'relative z-[1] inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-sm transition-colors',
                current
                  ? 'border-transparent font-medium text-foreground'
                  : 'border-border text-muted-foreground hover:bg-hover hover:text-foreground',
              )}
            >
              <span>{column.label}</span>
              <RollingNumber value={column.count} className="text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

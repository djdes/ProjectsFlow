import { useEffect, useRef, useState, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

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
  const [active, setActive] = useState<string | null>(columns[0]?.status ?? null);
  const statusesKey = columns.map((c) => c.status).join('|');

  // Текущая колонка — та, чей центр ближе всего к центру видимой части ряда.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const measure = (): void => {
      const box = scroller.getBoundingClientRect();
      const center = box.left + box.width / 2;
      let best: string | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const status of statusesKey.split('|')) {
        const column = findColumn(scroller, status);
        if (!column) continue;
        const rect = column.getBoundingClientRect();
        if (rect.width === 0) continue;
        const distance = Math.abs(rect.left + rect.width / 2 - center);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = status;
        }
      }
      if (best) setActive(best);
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
        ref={stripRef}
        // Ряд листается вбок сам по себе; полосу прокрутки не показываем.
        className="pf-scrollbar-hide flex gap-1.5 overflow-x-auto overscroll-x-contain pbe-2"
        data-pf-no-edge-swipe
      >
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
                'inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-sm transition-colors',
                current
                  ? 'border-primary bg-primary-soft font-medium text-foreground'
                  : 'border-border text-muted-foreground hover:bg-hover hover:text-foreground',
              )}
            >
              <span>{column.label}</span>
              <span className="tabular-nums text-muted-foreground">{column.count}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { useCompletedToday } from '@/presentation/hooks/CompletedTodayProvider';

// Галочка нарисована вручную, а не взята из lucide: обводку с dasharray можно «прочертить»
// от начала к концу — именно этот жест и делает пилюлю живой в момент закрытия задачи.
// pathLength=1 нормирует длину, поэтому dasharray не зависит от размеров viewBox.
function DrawnCheck({ draw }: { draw: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" aria-hidden>
      <path
        d="M4 10.8 L8.2 15 L16 5.6"
        pathLength={1}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('stroke-current', draw && 'animate-[pf-check-draw_520ms_ease-out]')}
        style={{ strokeDasharray: 1 }}
      />
    </svg>
  );
}

// Мотивационный счётчик «выполнено сегодня» — плавающая пилюля в правом верхнем углу.
//
// Пустое состояние специально тихое (серое, без акцента): цифра 0 не должна выглядеть
// достижением. С первой закрытой задачей пилюля «просыпается» в зелёный — тот же зелёный,
// которым доска помечает готовые карточки.
export function CompletedTodayPill(): React.ReactElement | null {
  const { count, celebrationKey } = useCompletedToday();
  const { animations } = useMotion();
  const [pop, setPop] = useState(false);

  // Перезапуск анимации по ключу: сбрасываем класс на кадр, иначе повторное закрытие
  // задачи не проигрывает её заново (класс уже висит).
  useEffect(() => {
    if (celebrationKey === 0 || !animations) return;
    setPop(false);
    const raf = requestAnimationFrame(() => setPop(true));
    const off = window.setTimeout(() => setPop(false), 700);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(off);
    };
  }, [celebrationKey, animations]);

  if (count === null) return null;
  const lit = count > 0;

  return (
    <div
      // Ниже строки верхнего хрома (44px): там у страниц свои кнопки справа — хлебные крошки,
      // «Поделиться», ⋯ — и пилюля легла бы прямо на них. safe-area: в PWA на iPhone правый
      // и верхний инсеты иначе уводят её под вырез. z-40 — ПОД диалогами (z-50).
      className="pointer-events-none fixed right-[calc(0.75rem+env(safe-area-inset-right))] top-[calc(3.25rem+env(safe-area-inset-top))] z-40"
    >
      <div
        title={`Сегодня выполнено задач: ${count}`}
        className={cn(
          'pointer-events-auto relative flex select-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums shadow-sm backdrop-blur-sm transition-colors duration-300',
          lit
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'border-border bg-background/80 text-muted-foreground',
          pop && 'animate-[pf-pill-pop_620ms_cubic-bezier(0.34,1.56,0.64,1)]',
        )}
      >
        {/* Кольцо-всплеск: расходится от пилюли ровно один раз на закрытие. */}
        {pop && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full border border-emerald-500/60 animate-[pf-pill-ring_620ms_ease-out_forwards]"
          />
        )}
        <DrawnCheck draw={pop} />
        <span className="leading-none">{count}</span>
      </div>
    </div>
  );
}

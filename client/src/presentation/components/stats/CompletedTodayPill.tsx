import { Check } from 'lucide-react';
import { useCompletedToday } from '@/presentation/hooks/CompletedTodayProvider';
import { rankFor } from './ranks';

// Счётчик «выполнено сегодня»: галочка и число. Раньше это был ранг-бейдж с трассами,
// HUD-скобками, реактором, бегущей сеткой и залпом частиц на каждую закрытую задачу —
// по просьбе владельца оставлена простая плашка без единой анимации.
//
// Цвет ранга сохранён: он ничего не стоит, не двигается и показывает, что счёт растёт.
// Понадобится один нейтральный цвет — достаточно убрать style ниже.
export function CompletedTodayPill(): React.ReactElement | null {
  const { count } = useCompletedToday();
  if (count === null) return null;

  const rank = rankFor(count);

  return (
    <div
      // Ниже строки верхнего хрома (44px): там у страниц свои кнопки справа — хлебные крошки,
      // «Поделиться», ⋯ — и плашка легла бы прямо на них. safe-area: в PWA на iPhone инсеты
      // иначе уводят её под вырез. z-40 — ПОД диалогами (z-50).
      className="pointer-events-none fixed right-[calc(1rem+env(safe-area-inset-right))] top-[calc(3.25rem+env(safe-area-inset-top))] z-40"
    >
      <span
        className="pointer-events-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums shadow-sm"
        style={{ backgroundColor: rank.c1, color: rank.ink }}
        title={`Сегодня выполнено задач: ${count}`}
      >
        <Check className="size-3.5 shrink-0" strokeWidth={3} aria-hidden />
        {count}
      </span>
    </div>
  );
}

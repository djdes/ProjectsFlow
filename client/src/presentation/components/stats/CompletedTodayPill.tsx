import { Check } from 'lucide-react';
import { useCompletedToday } from '@/presentation/hooks/CompletedTodayProvider';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { rankFor } from './ranks';
import { cn } from '@/lib/utils';

// Счётчик «выполнено сегодня»: галочка и число. Раньше это был ранг-бейдж с трассами,
// HUD-скобками, реактором, бегущей сеткой и залпом частиц на каждую закрытую задачу —
// по просьбе владельца оставлена простая плашка без единой анимации.
//
// Цвет ранга сохранён: он ничего не стоит, не двигается и показывает, что счёт растёт.
// Понадобится один нейтральный цвет — достаточно убрать style ниже.
//
// Плашка всегда стоит в потоке строки, где её показывают: на мобиле — в шапке приложения,
// на десктопе — в строке крошек страницы (HeaderCompletedTodayPill). Раньше на десктопе она
// висела fixed в правом верхнем углу поверх страниц и закрывала их кнопки (обложку проекта,
// плашку «Код подключён»).
export function CompletedTodayPill({ className }: { className?: string }): React.ReactElement | null {
  const { count } = useCompletedToday();
  if (count === null) return null;

  const rank = rankFor(count);

  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm font-semibold tabular-nums',
        className,
      )}
      style={{ backgroundColor: rank.c1, color: rank.ink }}
      title={`Сегодня выполнено задач: ${count}`}
      aria-label={`Сегодня выполнено задач: ${count}`}
      data-pf-completed-today
    >
      <Check className="size-3.5 shrink-0" strokeWidth={3} aria-hidden />
      {count}
    </span>
  );
}

// Счётчик в строке крошек страницы — только на десктопе: на мобиле он уже есть в шапке
// приложения (AppShell), второй экземпляр рядом был бы дублем.
export function HeaderCompletedTodayPill({ className }: { className?: string }): React.ReactElement | null {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  if (!isDesktop) return null;
  return <CompletedTodayPill className={className} />;
}

import { CircleCheck } from 'lucide-react';
import { useCompletedToday } from '@/presentation/hooks/CompletedTodayProvider';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

// Счётчик «выполнено сегодня»: галочка, число и подпись. Цвет — зелёный «Готово», тот же,
// что у статуса и кнопки «Принять» (дизайн C4: цвет = смысл). Раньше плашка меняла тон по
// «рангу» (число закрытых за день) — в единой палитре разноцветный счётчик спорил бы со
// статусами, поэтому оставлен один смысловой цвет.
//
// Плашка всегда стоит в потоке строки, где её показывают: на мобиле — в шапке приложения,
// на десктопе — в строке крошек страницы (HeaderCompletedTodayPill). Раньше на десктопе она
// висела fixed в правом верхнем углу поверх страниц и закрывала их кнопки (обложку проекта,
// плашку «Код подключён»).
export function CompletedTodayPill({
  className,
  withLabel = false,
}: {
  className?: string;
  // Подпись «сделано сегодня» рядом с числом — в шапке страницы на десктопе, где место есть.
  withLabel?: boolean;
}): React.ReactElement | null {
  const { count } = useCompletedToday();
  if (count === null) return null;

  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-done-soft px-2 text-ui font-semibold text-done-ink dark:bg-transparent dark:px-1 dark:text-done',
        className,
      )}
      title={`Сегодня выполнено задач: ${count}`}
      aria-label={`Сегодня выполнено задач: ${count}`}
      data-pf-completed-today
    >
      <CircleCheck className="size-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
      <span className="tabular-nums">{count}</span>
      {withLabel && <span className="font-medium">сделано сегодня</span>}
    </span>
  );
}

// Счётчик в строке крошек страницы — только на десктопе: на мобиле он уже есть в шапке
// приложения (AppShell), второй экземпляр рядом был бы дублем.
export function HeaderCompletedTodayPill({ className }: { className?: string }): React.ReactElement | null {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  if (!isDesktop) return null;
  return <CompletedTodayPill className={className} withLabel />;
}

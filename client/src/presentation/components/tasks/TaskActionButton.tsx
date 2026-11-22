import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

// Быстрые действия карточки задачи (удалить, выполнено, взять в работу, воркеру, вернуть):
// одна коробка, один размер глифа, одна толщина линии — на десктопе 24px/14px в плашке по
// наведению, на телефоне 40px/18px в ряду под текстом (.pf-task-action в globals.css).
// Раньше рядом стояли залитый треугольник, тонкая галка 14px и корзина 16px разного веса.
//
// Иконки — геометрия lucide (тот же набор, что во всём приложении), но собраны вручную,
// чтобы у каждой была своя «живая» часть: крышка корзины приоткрывается, галка
// прорисовывается заново, стрелки и треугольник подаются вперёд, «вернуть» проворачивается
// назад, у робота качается антенна. Движение — только при prefers-reduced-motion:
// no-preference (правило good-css), смена цвета — для всех.

export type TaskActionIconName = 'trash' | 'check' | 'undo' | 'rotate' | 'play' | 'arrow' | 'worker';
export type TaskActionTone = 'neutral' | 'danger' | 'done' | 'manual' | 'primary';

export function TaskActionIcon({
  name,
  className,
}: {
  name: TaskActionIconName;
  className?: string;
}): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      data-pf-ai={name}
      className={cn('pf-ai', className)}
    >
      {name === 'trash' && (
        <>
          <g className="pf-ai-lid">
            <path d="M3 6h18" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </g>
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </>
      )}
      {name === 'check' && <path className="pf-ai-draw" pathLength={1} d="M20 6 9 17l-5-5" />}
      {name === 'undo' && (
        <g className="pf-ai-spin">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
        </g>
      )}
      {name === 'rotate' && (
        <g className="pf-ai-spin">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </g>
      )}
      {name === 'play' && (
        // Скруглённый треугольник lucide: уже смещён к острию — оптически по центру коробки.
        <path className="pf-ai-nudge" d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
      )}
      {name === 'arrow' && (
        <g className="pf-ai-nudge">
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </g>
      )}
      {name === 'worker' && (
        <>
          <path className="pf-ai-antenna" d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path className="pf-ai-eyes" d="M15 13v2" />
          <path className="pf-ai-eyes" d="M9 13v2" />
        </>
      )}
    </svg>
  );
}

// Класс кнопки-действия — для триггеров, которые рендерит чужой компонент (меню воркера).
export function taskActionClass(className?: string): string {
  return cn('pf-task-action', className);
}

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: TaskActionIconName;
  label: string;
  tone?: TaskActionTone;
};

// Нажатие не проваливается в карточку (не открывает её) и не стартует перетаскивание.
export const TaskActionButton = forwardRef<HTMLButtonElement, ButtonProps>(function TaskActionButton(
  { icon, label, tone = 'neutral', className, onClick, onPointerDown, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      data-tone={tone}
      {...rest}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown?.(e);
      }}
      className={taskActionClass(className)}
    >
      <TaskActionIcon name={icon} />
    </button>
  );
});

import * as React from 'react';

import { cn } from '@/lib/utils';

// Лёгкий прогресс-бар (без Radix-зависимости): заполняемая полоска по `value` 0..100.
// Анимация ширины — мягкая; gate под reduced-motion обеспечивает глобальный
// `.reduce-motion` (MotionProvider убирает transition'ы на уровне CSS).
interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Прогресс в процентах (0..100). Значения вне диапазона зажимаются. */
  value: number;
  /** Класс заполняющей полоски — для смены цвета (напр. amber/destructive при низком остатке). */
  indicatorClassName?: string;
}

export function Progress({
  value,
  className,
  indicatorClassName,
  ...props
}: ProgressProps): React.ReactElement {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <div
        className={cn('h-full rounded-full bg-primary transition-[width] duration-200 ease-out', indicatorClassName)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

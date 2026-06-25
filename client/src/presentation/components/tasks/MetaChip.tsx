import * as React from 'react';
import { Plus, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

// Единый Notion-style «+ чип» для рядов свойств под заголовком задачи (см. план Phase 0/0.7).
// Пустое состояние: muted + иконка Plus/поля. Заполненное: ink + значение.
// META_CHIP_CLASS экспортируется, чтобы навешивать тот же вид на триггеры пикеров
// (DeadlinePicker / PrioritySelect / RalphModeSelect), которые принимают className.

export const META_CHIP_CLASS =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-xs ' +
  'text-muted-foreground transition-colors hover:bg-hover hover:text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50';

export const META_CHIP_FILLED_CLASS = 'text-foreground';

interface MetaChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  label: React.ReactNode;
  /** Свойство заполнено — текст становится ink-цветом, иконка Plus не показывается. */
  filled?: boolean;
  /** Показывать Plus в пустом состоянии, если иконка не задана. */
  showPlusWhenEmpty?: boolean;
}

export const MetaChip = React.forwardRef<HTMLButtonElement, MetaChipProps>(function MetaChip(
  { icon: Icon, label, filled = false, showPlusWhenEmpty = true, className, ...props },
  ref,
) {
  const LeadIcon: LucideIcon | undefined = Icon ?? (showPlusWhenEmpty && !filled ? Plus : undefined);
  return (
    <button
      ref={ref}
      type="button"
      className={cn(META_CHIP_CLASS, filled && META_CHIP_FILLED_CLASS, className)}
      {...props}
    >
      {LeadIcon ? <LeadIcon className="size-3.5 shrink-0" aria-hidden /> : null}
      <span className="truncate">{label}</span>
    </button>
  );
});

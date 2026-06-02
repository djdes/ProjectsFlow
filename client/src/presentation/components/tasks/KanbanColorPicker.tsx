import { Check } from 'lucide-react';
import { KANBAN_COLORS, type KanbanColor } from '@/domain/kanban/KanbanSettings';
import { KANBAN_COLOR_CLASSES, KANBAN_COLOR_LABELS } from './kanbanColors';
import { cn } from '@/lib/utils';

type Props = {
  value: KanbanColor;
  onChange: (color: KanbanColor) => void;
  // Показывать ли свотч «По умолчанию» (сброс к глобальному/встроенному цвету).
  includeDefault?: boolean;
  className?: string;
};

// Сетка свотчей цветов (палитра Notion). Используется и в меню колонки, и в профиле.
export function KanbanColorPicker({
  value,
  onChange,
  includeDefault = true,
  className,
}: Props): React.ReactElement {
  const colors = includeDefault
    ? KANBAN_COLORS
    : KANBAN_COLORS.filter((c) => c !== 'default');

  return (
    <div className={cn('grid grid-cols-5 gap-1.5', className)}>
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={KANBAN_COLOR_LABELS[c]}
          aria-label={KANBAN_COLOR_LABELS[c]}
          aria-pressed={value === c}
          className={cn(
            'grid size-7 place-items-center rounded-full border border-border/40 transition',
            KANBAN_COLOR_CLASSES[c].dot,
            value === c
              ? 'ring-2 ring-foreground/40 ring-offset-1 ring-offset-background'
              : 'hover:scale-110',
          )}
        >
          {value === c && <Check className="size-3.5 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]" />}
        </button>
      ))}
    </div>
  );
}

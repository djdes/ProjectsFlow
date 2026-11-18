import { ChevronDown, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { PROPERTY_CARET_CLASS } from './PropertyRow';
import { RUN_MODE_META, RUN_MODES, type RunMode } from '@/domain/task/Task';

// Селектор режима запуска воркера (spec 2026-11-17 §5): «Обычное изменение» / «Полный
// прогон». Тот же вид, что RalphModeSelect: двустрочные пункты (label + описание).
// Используется в форме создания задачи и в ряду свойств окна задачи.
export function RunModeSelect({
  value,
  onChange,
  disabled,
  className,
  variant = 'outline',
  iconOnly = false,
}: {
  value: RunMode;
  onChange: (next: RunMode) => void;
  disabled?: boolean;
  className?: string;
  variant?: 'outline' | 'ghost';
  // Компактный квадрат для тулбара композера: иконка, режим — в title/aria-label.
  iconOnly?: boolean;
}): React.ReactElement {
  const meta = RUN_MODE_META[value];
  const inPropertyRow = (className ?? '').includes('justify-start');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={variant}
          disabled={disabled}
          aria-label={`Режим запуска: ${meta.label}`}
          title={meta.description}
          className={cn(iconOnly ? 'justify-center' : inPropertyRow ? '' : 'w-full justify-between', 'font-normal', className)}
        >
          {iconOnly ? (
            <Rocket aria-hidden="true" className={cn('size-4 shrink-0', value === 'full' ? 'text-primary' : 'opacity-70')} />
          ) : (
            <span className="truncate">{meta.label}</span>
          )}
          {!disabled && !iconOnly && (
            <ChevronDown className={inPropertyRow ? PROPERTY_CARET_CLASS : 'size-4 shrink-0 opacity-60'} />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[280px]">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as RunMode)}>
          {RUN_MODES.map((mode) => {
            const m = RUN_MODE_META[mode];
            return (
              <DropdownMenuRadioItem key={mode} value={mode} className="items-start py-2 pe-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{m.label}</span>
                  <span className="text-2xs leading-snug text-muted-foreground">{m.description}</span>
                </div>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

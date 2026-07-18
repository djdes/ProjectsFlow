import { cn } from '@/lib/utils';
import {
  SCHEDULE_DAY_OPTIONS,
  type ScheduleDay,
} from '@/domain/digest/ScheduleDays';

type Props = {
  value: readonly ScheduleDay[];
  onChange: (value: ScheduleDay[]) => void;
  disabled?: boolean;
  className?: string;
};

export function ScheduleDayPicker({
  value,
  onChange,
  disabled = false,
  className,
}: Props): React.ReactElement {
  const toggle = (day: ScheduleDay): void => {
    if (disabled) return;
    if (value.includes(day)) {
      // A schedule without any day is ambiguous, so the final selected day stays on.
      if (value.length === 1) return;
      onChange(value.filter((item) => item !== day));
      return;
    }
    const selected = new Set([...value, day]);
    onChange(
      SCHEDULE_DAY_OPTIONS.map((option) => option.value).filter((item) => selected.has(item)),
    );
  };

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      role="group"
      aria-label="Дни отправки"
    >
      {SCHEDULE_DAY_OPTIONS.map((option) => {
        const active = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => toggle(option.value)}
            className={cn(
              'h-8 min-w-9 rounded-md border px-2 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

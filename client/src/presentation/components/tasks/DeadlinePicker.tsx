import { CalendarClock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  value: string | null;          // 'YYYY-MM-DD' или null
  onChange: (next: string | null) => void;
  disabled?: boolean;
  className?: string;
};

// Native <input type="date"> + кнопка очистки (×). Значение хранится как
// строка 'YYYY-MM-DD' — формат браузера и формат сервера совпадают, никаких
// преобразований. null = «не задано», input value = ''.
export function DeadlinePicker({
  value,
  onChange,
  disabled,
  className,
}: Props): React.ReactElement {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs',
        disabled && 'opacity-60',
        className,
      )}
    >
      <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        // bg-transparent чтобы наследовать tone (light/dark)
        className="border-0 bg-transparent text-xs focus:outline-none disabled:opacity-60"
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={() => onChange(null)}
          className="size-5 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label="Очистить срок"
          title="Очистить срок"
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}

import { useRef } from 'react';
import { CalendarClock, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  value: string | null;          // 'YYYY-MM-DD' или null
  onChange: (next: string | null) => void;
  disabled?: boolean;
  className?: string;
  // Icon-only режим для композеров: иконка календаря, дата появляется рядом только когда задана.
  iconOnly?: boolean;
};

// Краткий формат для кнопки: «27 май» / «27 май 2026» (если другой год).
function formatShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// Дедлайн в виде ghost-кнопки (как PrioritySelect/RalphModeSelect): иконка + label
// + chevron. По клику открывается нативный календарь через input.showPicker().
// Когда дата выбрана — справа от кнопки появляется крестик-очистка.
//
// Скрытый <input type="date"> остаётся в DOM (sr-only) — это нужно для:
//   1) onChange ловит выбранную дату;
//   2) showPicker() требует чтобы элемент был "connected to DOM" и НЕ display:none.
export function DeadlinePicker({
  value,
  onChange,
  disabled,
  className,
  iconOnly = false,
}: Props): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = (): void => {
    const inp = inputRef.current;
    if (!inp || disabled) return;
    // Современные браузеры — Chrome/Edge 99+, FF 101+, Safari 16.4+.
    // Старые — fallback на focus(), который НЕ откроет picker, но даст возможность
    // ввести руками (input всё равно видим экранному читалке через sr-only).
    if (typeof inp.showPicker === 'function') {
      try {
        inp.showPicker();
      } catch {
        // Некоторые контексты (sandboxed iframe) запрещают — игнорим.
      }
    } else {
      inp.focus();
    }
  };

  const label = value ? formatShort(value) : 'Дедлайн';

  return (
    <span className="inline-flex items-center">
      <Button
        type="button"
        variant="ghost"
        size={iconOnly && !value ? 'icon' : 'sm'}
        disabled={disabled}
        onClick={openPicker}
        className={cn(
          iconOnly ? 'shrink-0 gap-1.5 text-xs' : 'h-7 gap-1.5 px-2 text-xs',
          value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          className,
        )}
        title={value ? `Срок: ${value}` : 'Выбрать срок выполнения'}
        aria-label={value ? `Срок: ${value}` : 'Срок выполнения'}
      >
        <CalendarClock className={iconOnly ? 'size-4' : 'size-3.5'} />
        {(!iconOnly || value !== null) && label}
        {!iconOnly && <ChevronDown className="size-3" />}
      </Button>
      {value && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          className="ml-0.5 grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
          aria-label="Очистить срок"
          title="Очистить срок"
        >
          <X className="size-3" />
        </button>
      )}
      <input
        ref={inputRef}
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        // sr-only: position:absolute + clip-path — input остаётся в DOM, не
        // display:none (иначе showPicker() кинет ошибку), но визуально скрыт.
        className="sr-only"
        tabIndex={-1}
        aria-label="Срок выполнения"
      />
    </span>
  );
}

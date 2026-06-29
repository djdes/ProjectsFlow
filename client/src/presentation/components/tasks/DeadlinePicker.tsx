import { useRef } from 'react';
import { CalendarClock, CalendarDays, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type Props = {
  value: string | null;          // 'YYYY-MM-DD' или null
  onChange: (next: string | null) => void;
  disabled?: boolean;
  className?: string;
  // Icon-only режим для композеров: иконка календаря, дата появляется рядом только когда задана.
  iconOnly?: boolean;
  // Текст в пустом состоянии. Если не задан — в ряду свойств «Выбрать…», иначе «Дедлайн».
  emptyLabel?: string;
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

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Быстрые шаблоны срока, считаются от локального «сегодня». Конец недели = воскресенье
// (неделя пн–вс), конец месяца = последний день текущего месяца.
function buildPresets(): { readonly label: string; readonly iso: string }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = (n: number): Date => {
    const r = new Date(today);
    r.setDate(r.getDate() + n);
    return r;
  };
  const dow = today.getDay(); // 0=вс … 6=сб
  const endOfWeek = add(dow === 0 ? 0 : 7 - dow);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return [
    { label: 'Сегодня', iso: toISO(today) },
    { label: 'Завтра', iso: toISO(add(1)) },
    { label: 'Послезавтра', iso: toISO(add(2)) },
    { label: 'До конца недели', iso: toISO(endOfWeek) },
    { label: 'До конца месяца', iso: toISO(endOfMonth) },
  ];
}

// Дедлайн в виде ghost-кнопки. По клику — dropdown с быстрыми шаблонами (Сегодня/Завтра/…)
// и пунктом «Выбрать дату…», который открывает нативный календарь через input.showPicker().
// Скрытый <input type="date"> остаётся в DOM (sr-only) — showPicker() требует connected & не display:none.
export function DeadlinePicker({
  value,
  onChange,
  disabled,
  className,
  iconOnly = false,
  emptyLabel,
}: Props): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  // Ряд свойств задачи (TaskDrawer) передаёт PROPERTY_VALUE_CLASS с `justify-start` —
  // там кнопка-значение без ведущей иконки и с плейсхолдером «Выбрать…». В композерах
  // и bulk-баре (icon/обычный вид) оставляем календарь и «Дедлайн».
  const inPropertyRow = (className ?? '').includes('justify-start');

  const openNativePicker = (): void => {
    const inp = inputRef.current;
    if (!inp || disabled) return;
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

  const placeholder = emptyLabel ?? (inPropertyRow ? 'Выбрать…' : 'Дедлайн');
  const label = value ? formatShort(value) : placeholder;
  // Ведущую иконку прячем только в ряду свойств (не в icon-only/обычном виде).
  const showLeadingIcon = iconOnly || !inPropertyRow;

  return (
    <span className="inline-flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={iconOnly && !value ? 'icon' : 'sm'}
            disabled={disabled}
            className={cn(
              iconOnly ? 'shrink-0 gap-1.5 text-xs' : 'h-7 gap-1.5 px-2 text-xs',
              className,
              value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            title={value ? `Срок: ${value}` : 'Выбрать срок выполнения'}
            aria-label={value ? `Срок: ${value}` : 'Срок выполнения'}
          >
            {showLeadingIcon && <CalendarClock className={iconOnly ? 'size-4' : 'size-3.5'} />}
            {(!iconOnly || value !== null) && label}
            {!iconOnly && <ChevronDown className="size-3" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          {buildPresets().map((p) => (
            <DropdownMenuItem key={p.label} onSelect={() => onChange(p.iso)}>
              {p.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openNativePicker()}>
            <CalendarDays className="size-4" />
            Выбрать дату…
          </DropdownMenuItem>
          {value && (
            <DropdownMenuItem
              onSelect={() => onChange(null)}
              className="text-destructive focus:text-destructive"
            >
              <X className="size-4" />
              Очистить срок
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={inputRef}
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        // sr-only: остаётся в DOM (не display:none, иначе showPicker() кинет ошибку), но скрыт.
        className="sr-only"
        tabIndex={-1}
        aria-label="Срок выполнения"
      />
    </span>
  );
}

import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DueKind } from '../assignedGrouping';

// Мелкие детали шапки и доски «Входящих» (дизайн C4 «Одна доска»): поиск, чипы срока,
// заголовок очереди с листанием. Без состояния и без dnd — только вид и клавиатура;
// данные и решения остаются в AssignedToMeBlock.

// Поиск по задачам «Входящих». «/» с любого места страницы ставит курсор в поле (если
// человек не печатает в другом поле), Esc очищает. Фильтрует карточки на месте.
export function InboxSearch({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <label className={cn('relative flex items-center', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute start-2.5 size-3.5 text-muted-foreground"
      />
      <input
        ref={inputRef}
        type="search"
        aria-label="Найти задачу"
        placeholder="Найти задачу"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
        className="h-11 w-full rounded-md border border-input bg-field pe-9 ps-8 text-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/80 focus-visible:border-primary/70 focus-visible:ring-[3px] focus-visible:ring-primary/20 sm:h-8 sm:text-ui [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          aria-label="Очистить поиск"
          className="absolute end-1.5 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd
          aria-hidden
          className="pointer-events-none absolute end-2 hidden h-[18px] min-w-[18px] place-items-center rounded border border-border px-1 text-2xs text-muted-foreground sm:grid"
        >
          /
        </kbd>
      )}
    </label>
  );
}

const DUE_CHIPS: ReadonlyArray<{ key: Exclude<DueKind, 'future'>; label: string; dot: string }> = [
  { key: 'late', label: 'Просрочено', dot: 'bg-destructive' },
  { key: 'today', label: 'Сегодня', dot: 'bg-today' },
  { key: 'none', label: 'Без срока', dot: 'bg-muted-foreground/60' },
];

// Чипы срока: один выбранный за раз, повторный клик снимает. Точка — смысл срока, тем же
// цветом, что и срок на карточке; число — сколько задач подпадёт (уже с учётом поиска).
export function DueFilterChips({
  value,
  onChange,
  counts,
}: {
  value: DueKind | null;
  onChange: (value: DueKind | null) => void;
  counts: Readonly<Record<Exclude<DueKind, 'future'>, number>>;
}): React.ReactElement {
  return (
    <div role="group" aria-label="Срок" className="flex flex-wrap items-center gap-1.5">
      {DUE_CHIPS.map((chip) => {
        const on = value === chip.key;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : chip.key)}
            className={cn(
              'inline-flex h-10 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors sm:h-[26px] sm:text-meta',
              on
                ? 'border-primary bg-primary-soft text-foreground'
                : 'border-border text-muted-foreground hover:bg-hover hover:text-foreground',
            )}
          >
            <span aria-hidden className={cn('size-1.5 rounded-full', chip.dot)} />
            {chip.label}
            <span className="tabular-nums text-muted-foreground">{counts[chip.key]}</span>
          </button>
        );
      })}
    </div>
  );
}

// Заголовок очереди над колонками: точка-«очередь» синим (цвет статуса «в очереди»),
// название по текущей группировке, число карточек и листание ряда колонок вбок.
export function QueueHeader({
  label,
  count,
  onScroll,
  canScrollBack,
  canScrollForward,
}: {
  label: string;
  count: string;
  onScroll: (direction: -1 | 1) => void;
  canScrollBack: boolean;
  canScrollForward: boolean;
}): React.ReactElement {
  return (
    <div className="flex h-7 items-center gap-2 px-0.5">
      <span aria-hidden className="size-3 rounded-full border-[2.4px] border-primary" />
      <h2 className="text-ui font-semibold">{label}</h2>
      <span className="text-meta tabular-nums text-muted-foreground">{count}</span>
      <span className="flex-1" />
      {/* Листание — для мыши: на тач-экранах ряд листается пальцем. */}
      <div className="hidden items-center gap-1 sm:flex">
        <button
          type="button"
          aria-label="Листать влево"
          disabled={!canScrollBack}
          onClick={() => onScroll(-1)}
          className="grid size-[26px] place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Листать вправо"
          disabled={!canScrollForward}
          onClick={() => onScroll(1)}
          className="grid size-[26px] place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// Иконка статуса «Вручную»: наполовину залитый круг — «начато, делаю сам».
export function ManualIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-3.5 shrink-0', className)}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  );
}

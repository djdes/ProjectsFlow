import { useEffect, useRef } from 'react';
import { Check, ChevronLeft, ChevronRight, Play, Search, ShieldCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCardSwipe } from '@/presentation/hooks/useCardSwipe';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
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
  autoFocus = false,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
  // Телефон: поле появляется по кнопке-лупе и сразу получает фокус.
  autoFocus?: boolean;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
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
        id={id}
        type="search"
        aria-label="Поиск по проектам и задачам"
        placeholder="Проект или текст задачи"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
        className="h-11 min-w-0 w-full rounded-md border border-input bg-field pe-11 ps-8 text-base transition-colors placeholder:text-muted-foreground/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:h-8 md:pe-9 md:text-ui [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          aria-label="Очистить поиск"
          className="absolute end-0 grid size-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground active:bg-active md:end-1 md:size-6"
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
  wrap = true,
}: {
  value: DueKind | null;
  onChange: (value: DueKind | null) => void;
  counts: Readonly<Record<Exclude<DueKind, 'future'>, number>>;
  // false — одна строка (на телефоне лента листается вбок, а не переносится).
  wrap?: boolean;
}): React.ReactElement {
  return (
    <div
      role="group"
      aria-label="Срок"
      className={cn('flex items-center gap-1.5', wrap ? 'flex-wrap' : 'shrink-0 flex-nowrap')}
    >
      {DUE_CHIPS.map((chip) => {
        const on = value === chip.key;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : chip.key)}
            className={cn(
              'inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-sm transition-colors sm:h-[26px] sm:text-meta',
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

// Переключатель разделов «Входящих» на телефоне: «В работе» (решить и делаю) и «Очередь».
// На узком экране две колонки рядом не помещаются, а стопкой «В работе» уводит очередь далеко
// вниз — поэтому один раздел за раз, с числом задач в каждом. Липнет к верху при прокрутке.
export type InboxSection = 'now' | 'queue';

export function InboxSectionSwitch({
  value,
  onChange,
  nowCount,
  queueCount,
  nowAttention,
  className,
}: {
  value: InboxSection;
  onChange: (value: InboxSection) => void;
  nowCount: number;
  queueCount: number;
  // В «В работе» есть сданная работа, которую ждут решения, — фиолетовая точка на разделе.
  nowAttention: boolean;
  className?: string;
}): React.ReactElement {
  const item = (key: InboxSection, label: string, count: number, attention = false): React.ReactElement => {
    const on = value === key;
    return (
      <button
        type="button"
        data-pf-inbox-section-switch={key}
        aria-pressed={on}
        onClick={() => onChange(key)}
        className={cn(
          'relative flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 text-ui whitespace-nowrap transition-colors active:bg-active',
          on
            ? 'bg-background font-semibold text-foreground shadow-[0_1px_2px_oklch(16.84%_0_none/0.12)] dark:bg-raised dark:shadow-none'
            : 'font-medium text-muted-foreground',
        )}
      >
        {label}
        <span className="tabular-nums text-muted-foreground">{count}</span>
        {attention && (
          <span aria-hidden className="size-1.5 rounded-full bg-approval" />
        )}
      </button>
    );
  };
  return (
    <div
      role="group"
      aria-label="Раздел"
      className={cn('flex rounded-lg bg-foreground/[0.06] p-0.5 dark:border dark:border-border dark:bg-panel', className)}
    >
      {item('now', 'В работе', nowCount, nowAttention)}
      {item('queue', 'Очередь', queueCount)}
    </div>
  );
}

// Свайп карточки вправо на тач-экране — «дальше по процессу» (из очереди в работу, из
// «Вручную» в готово или на утверждение, на полке приёмки — принять). Под карточкой
// проступает подложка с действием цветом его статуса; за порогом она становится плотной —
// отпустите, и действие выполнится. Мышью жест не срабатывает: на десктопе есть плашка.
export type SwipeAction = {
  readonly label: string;
  readonly tone: 'manual' | 'done' | 'approval';
  readonly onCommit: () => void;
};

const SWIPE_TONE: Record<SwipeAction['tone'], { readonly soft: string; readonly armed: string }> = {
  manual: { soft: 'bg-manual-soft text-manual-ink', armed: 'bg-manual text-background' },
  done: { soft: 'bg-done-soft text-done-ink', armed: 'bg-done text-background' },
  approval: { soft: 'bg-approval-soft text-approval-ink', armed: 'bg-approval text-background' },
};

// Функция, а не таблица элементов: JSX на уровне модуля исполнялся бы при импорте (в том
// числе в node-тестах, где нет React-рантайма).
function swipeIcon(tone: SwipeAction['tone']): React.ReactElement {
  if (tone === 'manual') return <Play className="size-3.5 fill-current" />;
  if (tone === 'done') return <Check className="size-4" strokeWidth={2.6} />;
  return <ShieldCheck className="size-4" />;
}

export function SwipeToAct({
  action,
  disabled = false,
  children,
}: {
  action: SwipeAction;
  disabled?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const { animations } = useMotion();
  const { ref, offset, armed } = useCardSwipe({ disabled, onCommit: action.onCommit });
  const tone = SWIPE_TONE[action.tone];
  return (
    // data-pf-no-edge-swipe — свайп карточки не должен открывать боковое меню. Обрезаем
    // уехавшую карточку только во время жеста: в покое её свечение (непрочитанная,
    // срочная) должно выходить за край.
    <div
      ref={ref}
      data-pf-no-edge-swipe
      className={cn('relative rounded-lg', offset > 0 && 'overflow-hidden')}
    >
      {offset > 0 && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center gap-1.5 rounded-lg ps-3 text-meta font-semibold transition-colors duration-150',
            armed ? tone.armed : tone.soft,
          )}
        >
          {swipeIcon(action.tone)}
          {action.label}
        </div>
      )}
      <div
        className="relative"
        style={{
          transform: offset > 0 ? `translateX(${offset}px)` : undefined,
          // Возврат на место — только когда палец отпущен и анимации не выключены.
          transition: offset === 0 && animations ? 'transform 180ms ease-out' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}

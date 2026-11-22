import { useEffect, useRef } from 'react';
import { AtSign, CalendarClock, Check, ChevronLeft, ChevronRight, MessagesSquare, Play, Search, ShieldCheck, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCardSwipe } from '@/presentation/hooks/useCardSwipe';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import type { DueKind } from '../assignedGrouping';
import { useScrollEdges } from './useScrollEdges';

// Мелкие детали шапки и доски «Входящих» (дизайн C4 «Одна доска»): поиск, чипы срока,
// заголовок очереди с листанием. Без dnd и данных — вид, клавиатура и края прокрутки;
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
        className="h-11 min-w-0 w-full text-ellipsis rounded-md border border-input bg-field pe-11 ps-8 text-base transition-colors placeholder:text-muted-foreground/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:h-8 md:pe-9 md:text-ui [&::-webkit-search-cancel-button]:hidden"
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

// tint — подложка чипа, когда в нём есть задачи: просроченные красным, на сегодня — цветом
// срока «сегодня» (цвет = смысл). Раньше три одинаковых серых рамки с точкой-пикселем:
// «Просрочено 3» читалось так же спокойно, как «Без срока 0».
const DUE_CHIPS: ReadonlyArray<{ key: Exclude<DueKind, 'future'>; label: string; dot: string; tint: string | null }> = [
  { key: 'late', label: 'Просрочено', dot: 'bg-destructive', tint: 'border-transparent bg-destructive-soft text-destructive' },
  { key: 'today', label: 'Сегодня', dot: 'bg-today', tint: 'border-transparent bg-today/[0.12] text-today' },
  { key: 'none', label: 'Без срока', dot: 'bg-muted-foreground/60', tint: null },
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
      // Телефон (wrap=false): чипы своей ширины в ленте, которая листается вбок. Три равные
      // колонки рядом с «@» и «комментариями» не вмещали «Просрочено 11» — подпись вылезала
      // за край чипа и обрезалась (жалоба владельца 22.11).
      className={cn('items-center gap-1.5', wrap ? 'flex flex-wrap' : 'flex w-max')}
    >
      {DUE_CHIPS.map((chip) => {
        const on = value === chip.key;
        const count = counts[chip.key];
        const tinted = !on && count > 0 && chip.tint !== null;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : chip.key)}
            data-pf-due-tinted={tinted ? '' : undefined}
            className={cn(
              'inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-meta transition-colors active:bg-active md:min-h-7 md:gap-1 md:px-2.5',
              on
                ? 'border-primary bg-primary-soft text-foreground'
                : tinted
                  ? cn(chip.tint, 'font-medium')
                  : cn(
                      // Телефон — мягкая подложка без рамки: рамок в шапке и так четыре ряда.
                      'border-border text-muted-foreground hover:bg-hover hover:text-foreground max-md:border-transparent max-md:bg-panel',
                      count === 0 && 'text-muted-foreground/75',
                    ),
            )}
          >
            <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', chip.dot, count === 0 && !on && 'opacity-50')} />
            {chip.label}
            <span
              className={cn('shrink-0 tabular-nums', tinted ? 'font-semibold' : 'text-muted-foreground')}
              data-pf-due-count={chip.key}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// «Ответить»: только задачи, где мне адресовали комментарий, а я ещё не ответил. Отдельно
// от чипов срока — это другой вопрос к списку («кто меня ждёт», а не «что горит»).
export function ReplyFilterChip({
  active,
  count,
  onToggle,
}: {
  active: boolean;
  count: number;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Ответить: ${count}`}
      title="Задачи, где вам адресовали комментарий, а вы ещё не ответили"
      onClick={onToggle}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-2 text-meta transition-colors active:bg-active md:min-h-7 md:px-2.5',
        active
          ? 'border-approval bg-approval-soft text-foreground'
          : 'border-border text-muted-foreground hover:bg-hover hover:text-foreground',
      )}
    >
      <AtSign aria-hidden className="size-3.5 shrink-0 text-approval-ink" />
      <span className="max-sm:hidden">Ответить</span>
      <span className="shrink-0 tabular-nums text-muted-foreground" data-pf-reply-count>{count}</span>
    </button>
  );
}

// «Только из групп»: задачи, поставленные в рабочих Telegram-группах (groupOrigin, db/190).
export function GroupFilterChip({
  active,
  count,
  onToggle,
}: {
  active: boolean;
  count: number;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Только из групп: ${count}`}
      title="Только задачи, поставленные в рабочих Telegram-группах"
      onClick={onToggle}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-2 text-meta transition-colors active:bg-active md:min-h-7 md:px-2.5',
        active
          ? 'border-primary bg-accent text-foreground'
          : 'border-border text-muted-foreground hover:bg-hover hover:text-foreground',
      )}
    >
      <MessagesSquare aria-hidden className="size-3.5 shrink-0" />
      <span className="max-sm:hidden">Только из групп</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

// Заголовок очереди над колонками: точка-«очередь» синим (цвет статуса «в очереди»),
// название по текущей группировке, число карточек и листание ряда колонок вбок.
export function QueueHeader({
  label,
  count,
  onScroll,
  scrollTarget,
}: {
  label: string;
  count: string;
  onScroll: (direction: -1 | 1) => void;
  // Ряд колонок: по нему шапка сама гасит кнопки ‹ › у краёв.
  scrollTarget: HTMLElement | null;
}): React.ReactElement {
  const { back: canScrollBack, forward: canScrollForward } = useScrollEdges(scrollTarget);
  return (
    <div className="flex h-7 items-center gap-2 px-0.5">
      <span aria-hidden className="size-3 shrink-0 rounded-full border-[2.4px] border-primary" />
      {/* Узкий ряд очереди (планшет с панелью) — название в одну строку с «…», а не
          столбиком «Очередь / по / проектам». */}
      <h2 className="min-w-0 truncate text-ui font-semibold">{label}</h2>
      <span className="shrink-0 text-meta tabular-nums text-muted-foreground">{count}</span>
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

// Иконка статуса «В работе»: наполовину залитый круг — «начато, делаю сам».
export function ManualIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-3.5 shrink-0', className)}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  );
}

// Переключатель разделов «Входящих» на телефоне: «В работе» (решить и делаю) и «Очередь».
// Подпись раньше была «Сейчас» — непонятно, что внутри (22.11 переименовано).
// На узком экране две колонки рядом не помещаются, а стопкой «В работе» уводит очередь далеко
// вниз — поэтому один раздел за раз, с числом задач в каждом. Липнет к верху при прокрутке.
export type InboxSection = 'now' | 'queue';

export function InboxSectionSwitch({
  value,
  onChange,
  nowCount,
  queueCount,
  nowAttention,
  pending = false,
  className,
}: {
  value: InboxSection;
  onChange: (value: InboxSection) => void;
  nowCount: number;
  queueCount: number;
  /** Раздел ещё строится — у выбранной кнопки крутится индикатор вместо числа. */
  pending?: boolean;
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
          // ≤359px рядом стоят поиск, фильтры и выделение — подписи мельче и плотнее.
          'relative flex min-h-0 min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 text-ui whitespace-nowrap transition-colors active:bg-active max-[359px]:gap-0.5 max-[359px]:px-1 max-[359px]:text-2xs',
          on
            ? 'bg-background font-semibold text-foreground shadow-[0_1px_2px_oklch(16.84%_0_none/0.12)] dark:bg-raised dark:shadow-none'
            : 'font-medium text-muted-foreground',
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        {/* Число и индикатор в одной ячейке фиксированной ширины: подпись не сдвигается. */}
        <span className="grid shrink-0 place-items-center tabular-nums text-muted-foreground">
          <span className={cn('col-start-1 row-start-1', on && pending && 'invisible')}>{count}</span>
          {on && pending && <Loader2 aria-label="Загрузка" className="col-start-1 row-start-1 size-3.5 motion-safe:animate-spin" />}
        </span>
        {attention && (
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-approval" />
        )}
      </button>
    );
  };
  return (
    <div
      role="group"
      aria-label="Раздел"
      className={cn('flex h-12 rounded-lg bg-foreground/[0.06] p-0.5 dark:bg-panel', className)}
    >
      {item('now', 'В работе', nowCount, nowAttention)}
      {item('queue', 'Очередь', queueCount)}
    </div>
  );
}

// Свайп карточки вправо на тач-экране — «дальше по процессу» (из очереди в работу, из
// «В работе» в готово или на утверждение, на полке приёмки — принять). Под карточкой
// проступает подложка с действием цветом его статуса; за порогом она становится плотной —
// отпустите, и действие выполнится. Мышью жест не срабатывает: на десктопе есть плашка.
export type SwipeAction = {
  readonly label: string;
  readonly tone: 'manual' | 'done' | 'approval' | 'snooze';
  readonly onCommit: () => void;
};

const SWIPE_TONE: Record<SwipeAction['tone'], { readonly soft: string; readonly armed: string }> = {
  manual: { soft: 'bg-manual-soft text-manual-ink', armed: 'bg-manual text-background' },
  done: { soft: 'bg-done-soft text-done-ink', armed: 'bg-done text-background' },
  approval: { soft: 'bg-approval-soft text-approval-ink', armed: 'bg-approval text-background' },
  // «Отложить» — цветом срока «сегодня»: жест про срок, а не про статус.
  snooze: { soft: 'bg-today/[0.12] text-today', armed: 'bg-today text-background' },
};

// Функция, а не таблица элементов: JSX на уровне модуля исполнялся бы при импорте (в том
// числе в node-тестах, где нет React-рантайма).
function swipeIcon(tone: SwipeAction['tone']): React.ReactElement {
  if (tone === 'manual') return <Play className="size-3.5 fill-current" />;
  if (tone === 'snooze') return <CalendarClock className="size-4" />;
  if (tone === 'done') return <Check className="size-4" strokeWidth={2.6} />;
  return <ShieldCheck className="size-4" />;
}

export function SwipeToAct({
  action,
  back = null,
  disabled = false,
  children,
}: {
  // Свайп вправо — «дальше по процессу».
  action: SwipeAction | null;
  // Свайп влево — «отложить» (срок).
  back?: SwipeAction | null;
  disabled?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const { animations } = useMotion();
  const { ref, offset, armed } = useCardSwipe({
    disabled,
    onCommit: action?.onCommit ?? null,
    onCommitBack: back?.onCommit ?? null,
  });
  const shown = offset > 0 ? action : offset < 0 ? back : null;
  const tone = shown ? SWIPE_TONE[shown.tone] : null;
  return (
    // data-pf-no-edge-swipe — свайп карточки не должен открывать боковое меню. Обрезаем
    // уехавшую карточку только во время жеста: в покое её свечение (непрочитанная,
    // срочная) должно выходить за край.
    <div
      ref={ref}
      data-pf-no-edge-swipe
      className={cn('relative rounded-lg', offset !== 0 && 'overflow-hidden')}
    >
      {shown && tone && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center gap-1.5 rounded-lg text-meta font-semibold transition-colors duration-150',
            // Подпись — с той стороны, откуда уехала карточка.
            offset > 0 ? 'ps-3' : 'justify-end pe-3',
            armed ? tone.armed : tone.soft,
          )}
        >
          {swipeIcon(shown.tone)}
          {shown.label}
        </div>
      )}
      <div
        className="relative"
        style={{
          transform: offset !== 0 ? `translateX(${offset}px)` : undefined,
          // Возврат на место — только когда палец отпущен и анимации не выключены.
          transition: offset === 0 && animations ? 'transform 180ms ease-out' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Кастомные свойства задач (db/109, Notion custom properties): хук данных +
// ячейки-редакторы по типам + заголовок колонки + пункты «Новое свойство» для «+».
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlignLeft,
  ArrowLeftToLine,
  ArrowRightToLine,
  AtSign,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  Copy,
  Hash,
  Link as LinkIcon,
  List,
  Phone,
  Repeat2,
  Search,
  Tags,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import {
  TASK_PROPERTY_TYPES,
  TASK_PROPERTY_TYPE_LABELS,
  type TaskProperty,
  type TaskPropertyOption,
  type TaskPropertyType,
} from '@/domain/task/TaskProperty';
import { useContainer } from '@/infrastructure/di/container';
import { PROJECT_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';
import { RULE_COLOR_DOT, type ViewRuleColor } from './viewShared';

export const PROPERTY_TYPE_ICONS: Record<TaskPropertyType, LucideIcon> = {
  text: AlignLeft,
  number: Hash,
  select: List,
  multi_select: Tags,
  date: Calendar,
  checkbox: CheckSquare,
  url: LinkIcon,
  phone: Phone,
  email: AtSign,
};

// Пилюля опции select/multi_select — те же цвета, что у условного цвета строк.
const OPTION_PILL: Record<string, string> = {
  red: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-300',
  gray: 'bg-muted text-muted-foreground',
};
const OPTION_COLOR_CYCLE: ViewRuleColor[] = [
  'blue',
  'green',
  'orange',
  'purple',
  'pink',
  'red',
  'yellow',
  'gray',
];

export type UseTaskPropertiesResult = {
  properties: TaskProperty[];
  valueFor: (taskId: string, propertyId: string) => string;
  setValue: (taskId: string, propertyId: string, value: string) => void;
  createProperty: (type: TaskPropertyType, name?: string) => void;
  renameProperty: (propertyId: string, name: string) => void;
  addOption: (property: TaskProperty, label: string) => Promise<TaskPropertyOption | null>;
  removeProperty: (propertyId: string) => void;
  // Notion-меню заголовка: дубликат рядом с исходным; вставка нового «Текст» слева/справа.
  duplicateProperty: (property: TaskProperty) => void;
  insertProperty: (anchor: TaskProperty, side: 'left' | 'right') => void;
  changeType: (propertyId: string, type: TaskPropertyType) => void;
};

// Данные свойств проекта: load + SSE-рефетч + оптимистичный setValue.
export function useTaskProperties(projectId: string): UseTaskPropertiesResult {
  const { taskPropertyRepository } = useContainer();
  const [properties, setProperties] = useState<TaskProperty[]>([]);
  const [values, setValues] = useState<ReadonlyMap<string, string>>(() => new Map());

  const refetch = useCallback(async (): Promise<void> => {
    try {
      const res = await taskPropertyRepository.list(projectId);
      setProperties(res.properties);
      setValues(new Map(res.values.map((v) => [`${v.taskId}:${v.propertyId}`, v.value])));
    } catch {
      // Тихо: таблица работает и без кастомных свойств.
    }
  }, [taskPropertyRepository, projectId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChanged = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId !== projectId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refetch(), 400);
    };
    window.addEventListener(PROJECT_CHANGED_EVENT, onChanged);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(PROJECT_CHANGED_EVENT, onChanged);
    };
  }, [projectId, refetch]);

  const valueFor = (taskId: string, propertyId: string): string =>
    values.get(`${taskId}:${propertyId}`) ?? '';

  const setValue = (taskId: string, propertyId: string, value: string): void => {
    const key = `${taskId}:${propertyId}`;
    const prev = values.get(key) ?? '';
    setValues((m) => new Map(m).set(key, value));
    taskPropertyRepository.setValue(projectId, taskId, propertyId, value).catch((e: unknown) => {
      setValues((m) => new Map(m).set(key, prev));
      toast.error(`Не удалось: ${(e as Error).message}`);
    });
  };

  const createProperty = (type: TaskPropertyType, name?: string): void => {
    void taskPropertyRepository
      .create(projectId, { name: name?.trim() || TASK_PROPERTY_TYPE_LABELS[type], type })
      .then((p) => setProperties((prev) => [...prev, p]))
      .catch((e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`));
  };

  const renameProperty = (propertyId: string, name: string): void => {
    setProperties((prev) => prev.map((p) => (p.id === propertyId ? { ...p, name } : p)));
    taskPropertyRepository.update(projectId, propertyId, { name }).catch((e: unknown) => {
      toast.error(`Не удалось: ${(e as Error).message}`);
      void refetch();
    });
  };

  // «Изменить тип» (Notion Change type): значения-строки интерпретируются по-новому.
  const changeType = (propertyId: string, type: TaskPropertyType): void => {
    setProperties((prev) => prev.map((p) => (p.id === propertyId ? { ...p, type } : p)));
    taskPropertyRepository.update(projectId, propertyId, { type }).catch((e: unknown) => {
      toast.error(`Не удалось: ${(e as Error).message}`);
      void refetch();
    });
  };

  const addOption = async (
    property: TaskProperty,
    label: string,
  ): Promise<TaskPropertyOption | null> => {
    const option: TaskPropertyOption = {
      id: crypto.randomUUID(),
      label,
      color: OPTION_COLOR_CYCLE[property.options.length % OPTION_COLOR_CYCLE.length]!,
    };
    const options = [...property.options, option];
    try {
      const updated = await taskPropertyRepository.update(projectId, property.id, { options });
      setProperties((prev) => prev.map((p) => (p.id === property.id ? updated : p)));
      return option;
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
      return null;
    }
  };

  const removeProperty = (propertyId: string): void => {
    setProperties((prev) => prev.filter((p) => p.id !== propertyId));
    taskPropertyRepository.remove(projectId, propertyId).catch((e: unknown) => {
      toast.error(`Не удалось: ${(e as Error).message}`);
      void refetch();
    });
  };

  // Создать свойство и поставить его на index в текущем порядке: сервер кладёт в
  // конец, затем PATCH'ами переприсваиваем позиции 1..N всем сдвинувшимся.
  const createAt = async (
    input: { name: string; type: TaskPropertyType; options?: TaskPropertyOption[] },
    index: number,
  ): Promise<void> => {
    try {
      const created = await taskPropertyRepository.create(projectId, input);
      const next = [...properties];
      next.splice(Math.min(index, next.length), 0, created);
      setProperties(next);
      for (let i = 0; i < next.length; i++) {
        const want = i + 1;
        if (next[i]!.position !== want) {
          await taskPropertyRepository.update(projectId, next[i]!.id, { position: want });
        }
      }
      setProperties(next.map((p, i) => ({ ...p, position: i + 1 })));
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
      void refetch();
    }
  };

  const duplicateProperty = (property: TaskProperty): void => {
    const idx = properties.findIndex((p) => p.id === property.id);
    void createAt(
      {
        name: `${property.name} (копия)`.slice(0, 64),
        type: property.type,
        options: property.options,
      },
      idx + 1,
    );
  };

  const insertProperty = (anchor: TaskProperty, side: 'left' | 'right'): void => {
    const idx = properties.findIndex((p) => p.id === anchor.id);
    void createAt(
      { name: TASK_PROPERTY_TYPE_LABELS.text, type: 'text' },
      side === 'left' ? idx : idx + 1,
    );
  };

  return {
    properties,
    valueFor,
    setValue,
    createProperty,
    renameProperty,
    addOption,
    removeProperty,
    duplicateProperty,
    insertProperty,
    changeType,
  };
}

// Заголовок кастомной колонки: клик/ПКМ = Notion-меню — инпут имени сверху,
// «Изменить тип ▸», Дублировать / Вставить слева-справа / Удалить; resize-ручка
// на правой кромке.
export function PropertyHeaderCell({
  property,
  onRename,
  onRemove,
  onDuplicate,
  onInsert,
  onChangeType,
  onResizeStart,
  colKey,
  dropSide = null,
  onColDragStart,
  consumeColDragged,
}: {
  property: TaskProperty;
  onRename: (name: string) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  onInsert?: (side: 'left' | 'right') => void;
  onChangeType?: (type: TaskPropertyType) => void;
  onResizeStart?: (e: React.MouseEvent) => void;
  // Drag-перестановка колонки (Notion) — см. HeaderCell в TableView.
  colKey?: string;
  dropSide?: 'left' | 'right' | null;
  onColDragStart?: (e: React.PointerEvent) => void;
  consumeColDragged?: () => boolean;
}): React.ReactElement {
  const [name, setName] = useState(property.name);
  // ПКМ по заголовку открывает то же меню, что и клик (Notion).
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setName(property.name), [property.name]);
  const Icon = PROPERTY_TYPE_ICONS[property.type];
  const commit = (): void => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== property.name) onRename(trimmed);
    else setName(property.name);
  };
  return (
    <div
      data-colkey={colKey}
      className={cn(
        'relative flex min-w-0 border-b border-l border-t',
        dropSide === 'left' && 'shadow-[inset_2px_0_0_hsl(var(--primary))]',
        dropSide === 'right' && 'shadow-[inset_-2px_0_0_hsl(var(--primary))]',
      )}
    >
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(o) => {
          if (!o) commit();
          setMenuOpen(o);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuOpen(true);
            }}
            // Drag колонки: pointerdown стартует трекинг (Radix-открытие гасится),
            // клик без движения открывает меню.
            onPointerDown={
              onColDragStart
                ? (e) => {
                    if (e.button !== 0) return;
                    onColDragStart(e);
                    e.preventDefault();
                  }
                : undefined
            }
            onClick={
              onColDragStart
                ? () => {
                    if (consumeColDragged?.()) return;
                    setMenuOpen(true);
                  }
                : undefined
            }
            className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
            <span className="truncate">{property.name}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[13rem]">
          {/* Имя свойства редактируется прямо в меню (Notion). stopPropagation:
              иначе Radix-typeahead перехватывает буквы. */}
          <div className="flex items-center gap-1.5 px-1 pb-1.5 pt-0.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-md border text-muted-foreground">
              <Icon className="size-3.5" />
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  commit();
                  setMenuOpen(false);
                }
              }}
              aria-label="Имя свойства"
              className="h-7 w-full min-w-0 rounded-md bg-accent/60 px-2 text-sm outline-none ring-primary/40 focus:ring-2"
            />
          </div>
          {onChangeType && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <Repeat2 className="size-4 text-muted-foreground" />
                Изменить тип
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[11rem]">
                {TASK_PROPERTY_TYPES.map((t) => {
                  const TIcon = PROPERTY_TYPE_ICONS[t];
                  return (
                    <DropdownMenuItem key={t} className="gap-2" onSelect={() => onChangeType(t)}>
                      <TIcon className="size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1">{TASK_PROPERTY_TYPE_LABELS[t]}</span>
                      {property.type === t && <Check className="size-3.5 text-primary" />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {onDuplicate && (
            <DropdownMenuItem className="gap-2" onSelect={onDuplicate}>
              <Copy className="size-4" />
              Дублировать свойство
            </DropdownMenuItem>
          )}
          {onInsert && (
            <>
              <DropdownMenuItem className="gap-2" onSelect={() => onInsert('left')}>
                <ArrowLeftToLine className="size-4" />
                Вставить слева
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" onSelect={() => onInsert('right')}>
                <ArrowRightToLine className="size-4" />
                Вставить справа
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-destructive focus:text-destructive"
            onSelect={onRemove}
          >
            <Trash2 className="size-4" />
            Удалить свойство
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Ручка resize на правой кромке (Notion). */}
      {onResizeStart && (
        <div
          role="separator"
          aria-label={`Изменить ширину колонки ${property.name}`}
          onMouseDown={onResizeStart}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -right-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize rounded transition-colors hover:bg-primary/40"
        />
      )}
    </div>
  );
}

// Содержимое попапа «Новое свойство» (Notion add property): инпут имени сверху,
// «Выбрать тип» с поиском, сетка типов 2 колонки с иконками.
export function NewPropertyForm({
  onCreate,
}: {
  onCreate: (type: TaskPropertyType, name?: string) => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [typeQuery, setTypeQuery] = useState('');
  const q = typeQuery.trim().toLowerCase();
  const types = TASK_PROPERTY_TYPES.filter(
    (t) => !q || TASK_PROPERTY_TYPE_LABELS[t].toLowerCase().includes(q),
  );
  return (
    <div className="w-72">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Введите имя свойства…"
        aria-label="Имя свойства"
        className="mb-1.5 h-8 w-full rounded-md bg-accent/60 px-2 text-sm outline-none ring-primary/40 placeholder:text-muted-foreground/60 focus:ring-2"
      />
      <div className="flex items-center justify-between px-1 pb-1">
        <p className="text-[11px] font-medium text-muted-foreground">Выбрать тип</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={typeQuery}
            onChange={(e) => setTypeQuery(e.target.value)}
            aria-label="Поиск типа"
            className="h-6 w-24 rounded bg-accent/60 pl-6 pr-1.5 text-[11px] outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-0.5">
        {types.map((t) => {
          const Icon = PROPERTY_TYPE_ICONS[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => onCreate(t, name)}
              className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-accent/60"
            >
              <Icon className="size-4 text-muted-foreground" />
              {TASK_PROPERTY_TYPE_LABELS[t]}
            </button>
          );
        })}
        {types.length === 0 && (
          <p className="col-span-2 px-2 py-3 text-center text-xs text-muted-foreground">
            Ничего не найдено
          </p>
        )}
      </div>
    </div>
  );
}

function optionById(property: TaskProperty, id: string): TaskPropertyOption | undefined {
  return property.options.find((o) => o.id === id);
}

function parseMulti(value: string): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

// Инпут «Создать опцию» в низу меню селекта.
function CreateOptionInput({
  onCreate,
}: {
  onCreate: (label: string) => void;
}): React.ReactElement {
  const [label, setLabel] = useState('');
  return (
    <input
      value={label}
      onChange={(e) => setLabel(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && label.trim()) {
          onCreate(label.trim());
          setLabel('');
        }
      }}
      placeholder="Создать опцию…"
      aria-label="Создать опцию"
      className="mx-1 mb-1 w-[calc(100%-0.5rem)] rounded bg-accent/60 px-2 py-1 text-xs outline-none placeholder:text-muted-foreground/60"
    />
  );
}

// Ячейка значения кастомного свойства: рендер + редактор по типу.
export function PropertyValueCell({
  property,
  value,
  onChange,
  onAddOption,
}: {
  property: TaskProperty;
  value: string;
  onChange: (value: string) => void;
  onAddOption: (label: string) => Promise<TaskPropertyOption | null>;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // text / number / url / date / phone / email — клик = инлайн-инпут на всю ячейку.
  if (
    property.type === 'text' ||
    property.type === 'number' ||
    property.type === 'url' ||
    property.type === 'date' ||
    property.type === 'phone' ||
    property.type === 'email'
  ) {
    const commit = (): void => {
      setEditing(false);
      if (draft !== value) onChange(draft);
    };
    const inputType =
      property.type === 'date'
        ? 'date'
        : property.type === 'number'
          ? 'number'
          : property.type === 'phone'
            ? 'tel'
            : property.type === 'email'
              ? 'email'
              : 'text';
    if (editing) {
      return (
        <div className="relative border-b border-l">
          {/* Notion: редактор раскрывается ПОВЕРХ ячейки — шире её и с тенью,
              текст растёт вниз не двигая строки. Enter — коммит (Shift+Enter —
              перенос строки в тексте), Esc — отмена. */}
          <div className="absolute left-0 top-0 z-30 w-[max(100%,17rem)] overflow-hidden rounded-sm bg-popover shadow-[0_0_0_1px_rgba(15,15,15,0.06),0_3px_6px_rgba(15,15,15,0.12),0_9px_24px_rgba(15,15,15,0.2)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_3px_6px_rgba(0,0,0,0.5)]">
            {property.type === 'text' ? (
              <textarea
                autoFocus
                rows={1}
                value={draft}
                ref={(el) => {
                  if (el) {
                    el.style.height = 'auto';
                    el.style.height = `${el.scrollHeight}px`;
                  }
                }}
                onChange={(e) => {
                  setDraft(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    commit();
                  }
                  if (e.key === 'Escape') {
                    setDraft(value);
                    setEditing(false);
                  }
                }}
                aria-label={property.name}
                className="block w-full resize-none bg-transparent px-2.5 py-1.5 text-sm outline-none"
              />
            ) : (
              <input
                ref={inputRef}
                autoFocus
                type={inputType}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') {
                    setDraft(value);
                    setEditing(false);
                  }
                }}
                aria-label={property.name}
                className="w-full min-w-0 bg-transparent px-2.5 py-1.5 text-sm outline-none"
              />
            )}
          </div>
          {/* Держит высоту строки под оверлеем. */}
          <div className="min-h-8" aria-hidden />
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="min-w-0 border-b border-l px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/40"
      >
        {value ? (
          property.type === 'url' ? (
            <span className="truncate text-primary underline-offset-2 hover:underline">{value}</span>
          ) : (
            <span className="block truncate">{value}</span>
          )
        ) : (
          <span className="text-muted-foreground/0">—</span>
        )}
      </button>
    );
  }

  if (property.type === 'checkbox') {
    return (
      <div className="flex items-center border-b border-l px-2 py-1.5">
        <input
          type="checkbox"
          checked={value === '1'}
          onChange={(e) => onChange(e.target.checked ? '1' : '')}
          aria-label={property.name}
          className="size-4 cursor-pointer accent-primary"
        />
      </div>
    );
  }

  // select / multi_select — меню опций + «Создать опцию…».
  const multi = property.type === 'multi_select';
  const selectedIds = multi ? parseMulti(value) : value ? [value] : [];
  const toggle = (optionId: string): void => {
    if (multi) {
      const next = selectedIds.includes(optionId)
        ? selectedIds.filter((x) => x !== optionId)
        : [...selectedIds, optionId];
      onChange(next.length ? JSON.stringify(next) : '');
    } else {
      onChange(value === optionId ? '' : optionId);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 flex-wrap items-center gap-1 border-b border-l px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
        >
          {selectedIds.length === 0 ? (
            <ChevronDown className="size-3.5 text-muted-foreground/0" />
          ) : (
            selectedIds.map((oid) => {
              const opt = optionById(property, oid);
              if (!opt) return null;
              return (
                <span
                  key={oid}
                  className={cn(
                    'inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-xs',
                    OPTION_PILL[opt.color] ?? OPTION_PILL['gray'],
                  )}
                >
                  {opt.label}
                </span>
              );
            })
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[11rem]">
        {property.options.map((o) => (
          <DropdownMenuItem
            key={o.id}
            className="gap-2"
            // Мультиселект не закрывает меню при выборе (как в Notion).
            onSelect={(e) => {
              if (multi) e.preventDefault();
              toggle(o.id);
            }}
          >
            <span className={cn('size-2 rounded-full', RULE_COLOR_DOT[o.color as ViewRuleColor] ?? RULE_COLOR_DOT.gray)} />
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {selectedIds.includes(o.id) && <span className="text-xs text-primary">✓</span>}
          </DropdownMenuItem>
        ))}
        {property.options.length > 0 && <DropdownMenuSeparator />}
        <CreateOptionInput
          onCreate={(label) => {
            void onAddOption(label).then((opt) => {
              if (opt) toggle(opt.id);
            });
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

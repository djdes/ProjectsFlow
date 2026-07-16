// Кастомные свойства задач (db/109, Notion custom properties): хук данных +
// ячейки-редакторы по типам + заголовок колонки + пункты «Новое свойство» для «+».
import { useCallback, useEffect, useRef, useState } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlignLeft,
  ArrowDown,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUp,
  AtSign,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Hash,
  Link as LinkIcon,
  List,
  ListFilter,
  Phone,
  Repeat2,
  Rows3,
  Search,
  Tags,
  Trash2,
  Users,
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
import { ConfirmDeleteDialog } from '../ConfirmDeleteDialog';
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
  person: Users,
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
  // Карта `${taskId}:${propertyId}` → value: зависимость для memo (фильтр/сорт
  // по значениям пересчитываются при их изменении).
  values: ReadonlyMap<string, string>;
  // Участники проекта (для person-свойств); пусто, пока их нет.
  members: PropertyMember[];
  valueFor: (taskId: string, propertyId: string) => string;
  setValue: (taskId: string, propertyId: string, value: string) => void;
  createProperty: (type: TaskPropertyType, name?: string) => Promise<TaskProperty | null>;
  renameProperty: (propertyId: string, name: string) => void;
  addOption: (property: TaskProperty, label: string) => Promise<TaskPropertyOption | null>;
  removeProperty: (propertyId: string) => void;
  // Notion-меню заголовка: дубликат рядом с исходным; вставка нового «Текст» слева/справа.
  duplicateProperty: (property: TaskProperty) => void;
  insertProperty: (anchor: TaskProperty, side: 'left' | 'right') => void;
  changeType: (propertyId: string, type: TaskPropertyType) => void;
};

// Участник для person-свойства (значение = userId).
export type PropertyMember = { id: string; displayName: string; avatarUrl: string | null };

// Данные свойств проекта: load + SSE-рефетч + оптимистичный setValue.
export function useTaskProperties(projectId: string): UseTaskPropertiesResult {
  const { taskPropertyRepository, projectRepository } = useContainer();
  const [properties, setProperties] = useState<TaskProperty[]>([]);
  const [values, setValues] = useState<ReadonlyMap<string, string>>(() => new Map());
  // Участники проекта — лениво, только если есть person-свойство.
  const [members, setMembers] = useState<PropertyMember[]>([]);
  const hasPerson = properties.some((p) => p.type === 'person');
  useEffect(() => {
    if (!hasPerson) return;
    let alive = true;
    projectRepository
      .listMembers(projectId)
      .then((list) => {
        if (alive)
          setMembers(
            list.map((m) => ({
              id: m.userId,
              displayName: m.user.displayName,
              avatarUrl: m.user.avatarUrl ?? null,
            })),
          );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hasPerson, projectId, projectRepository]);

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

  const createProperty = async (
    type: TaskPropertyType,
    name?: string,
  ): Promise<TaskProperty | null> => {
    try {
      const property = await taskPropertyRepository.create(projectId, {
        name: name?.trim() || TASK_PROPERTY_TYPE_LABELS[type],
        type,
      });
      setProperties((prev) => [...prev, property]);
      return property;
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
      return null;
    }
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
    values,
    members,
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
  onResizeBy,
  colKey,
  dropSide = null,
  onColDragStart,
  consumeColDragged,
  sorted = null,
  onSort,
  filterOptions,
  grouped = false,
  onToggleGroup,
  onHide,
  openMenu,
  onOpenMenuClosed,
}: {
  property: TaskProperty;
  onRename: (name: string) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  onInsert?: (side: 'left' | 'right') => void;
  onChangeType?: (type: TaskPropertyType) => void;
  onResizeStart?: (e: React.MouseEvent) => void;
  onResizeBy?: (delta: number) => void;
  // Drag-перестановка колонки (Notion) — см. HeaderCell в TableView.
  colKey?: string;
  dropSide?: 'left' | 'right' | null;
  onColDragStart?: (e: React.PointerEvent) => void;
  consumeColDragged?: () => boolean;
  // Notion-меню: сортировка ↑↓ (null = убрать), Фильтр ▸ (чекбоксы значений),
  // «Группировать» (только select).
  sorted?: 'asc' | 'desc' | null;
  onSort?: (dir: 'asc' | 'desc' | null) => void;
  filterOptions?: { id: string; label: string; checked: boolean; onToggle: () => void }[];
  grouped?: boolean;
  onToggleGroup?: () => void;
  // «Скрыть в отображении» (Notion Hide in view).
  onHide?: () => void;
  // Только что созданная колонка сразу прокручивается в видимую область и открывает
  // собственное меню.
  openMenu?: boolean;
  onOpenMenuClosed?: () => void;
}): React.ReactElement {
  const [name, setName] = useState(property.name);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  // ПКМ по заголовку открывает то же меню, что и клик (Notion).
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setName(property.name), [property.name]);
  useEffect(() => {
    if (!openMenu) return;
    setMenuOpen(true);
  }, [openMenu]);
  const Icon = PROPERTY_TYPE_ICONS[property.type];
  const commit = (): void => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== property.name) onRename(trimmed);
    else setName(property.name);
  };
  return (
    <div
      role="columnheader"
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
      data-colkey={colKey}
      className={cn(
        'relative flex h-12 min-w-0 border-b border-l bg-muted/25',
        dropSide === 'left' && 'shadow-[inset_2px_0_0_hsl(var(--primary))]',
        dropSide === 'right' && 'shadow-[inset_-2px_0_0_hsl(var(--primary))]',
      )}
    >
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(o) => {
          if (!o) commit();
          setMenuOpen(o);
          if (!o && openMenu) onOpenMenuClosed?.();
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
            className="flex h-12 min-w-0 flex-1 items-center gap-2 px-4 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
            <span className="truncate">{property.name}</span>
            {sorted === 'asc' && <ArrowUp className="size-3 shrink-0" />}
            {sorted === 'desc' && <ArrowDown className="size-3 shrink-0" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className={openMenu ? 'w-auto p-1.5' : 'min-w-[13rem]'}
        >
          {openMenu ? (
            <NewPropertyForm
              initialName={property.name}
              currentType={property.type}
              onNameChange={setName}
              onCreate={(type, nextName) => {
                const trimmed = nextName?.trim();
                if (trimmed && trimmed !== property.name) onRename(trimmed);
                if (type !== property.type) onChangeType?.(type);
                setMenuOpen(false);
                onOpenMenuClosed?.();
              }}
            />
          ) : (
            <>
          {/* Имя свойства редактируется прямо в меню (Notion). stopPropagation:
              иначе Radix-typeahead перехватывает буквы. */}
          <div className="flex items-center gap-1.5 px-1 pb-1.5 pt-0.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-md border text-muted-foreground">
              <Icon className="size-3.5" />
            </span>
            <input
              autoFocus
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
          {/* Notion: сортировка ↑↓ / Фильтр ▸ / Группировать — прямо в меню колонки. */}
          {onSort && (
            <>
              <DropdownMenuItem className="gap-2" onSelect={() => onSort(sorted === 'asc' ? null : 'asc')}>
                <ArrowUp className="size-4" />
                По возрастанию
                {sorted === 'asc' && <span className="ml-auto text-xs text-primary">✓</span>}
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" onSelect={() => onSort(sorted === 'desc' ? null : 'desc')}>
                <ArrowDown className="size-4" />
                По убыванию
                {sorted === 'desc' && <span className="ml-auto text-xs text-primary">✓</span>}
              </DropdownMenuItem>
            </>
          )}
          {filterOptions && filterOptions.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <ListFilter className="size-4 text-muted-foreground" />
                Фильтр
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[11rem]">
                {filterOptions.map((o) => (
                  <DropdownMenuItem
                    key={o.id || '∅'}
                    className="gap-2"
                    // Мультивыбор не закрывает меню (как фильтры Notion).
                    onSelect={(e) => {
                      e.preventDefault();
                      o.onToggle();
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.checked && <span className="text-xs text-primary">✓</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {onToggleGroup && (
            <DropdownMenuItem className="gap-2" onSelect={onToggleGroup}>
              <Rows3 className="size-4" />
              {grouped ? 'Разгруппировать' : 'Группировать'}
            </DropdownMenuItem>
          )}
          {onHide && (
            <DropdownMenuItem className="gap-2" onSelect={onHide}>
              <EyeOff className="size-4" />
              Скрыть в отображении
            </DropdownMenuItem>
          )}
          {(onSort ?? filterOptions ?? onToggleGroup ?? onHide) && <DropdownMenuSeparator />}
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
            onSelect={() => setRemoveConfirmOpen(true)}
          >
            <Trash2 className="size-4" />
            Удалить свойство
          </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Ручка resize на правой кромке (Notion). */}
      {onResizeStart && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={`Изменить ширину колонки ${property.name}`}
          onMouseDown={onResizeStart}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            onResizeBy?.(e.key === 'ArrowLeft' ? -16 : 16);
          }}
          className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize rounded transition-colors hover:bg-primary/40 focus-visible:bg-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
      )}
      <ConfirmDeleteDialog
        open={removeConfirmOpen}
        onOpenChange={setRemoveConfirmOpen}
        taskLabel={null}
        title="Удалить свойство?"
        description={`Столбец «${property.name}» и все его значения будут удалены безвозвратно.`}
        onConfirm={() => {
          onRemove();
          setRemoveConfirmOpen(false);
        }}
      />
    </div>
  );
}

// Содержимое попапа «Новое свойство» (Notion add property): инпут имени сверху,
// «Выбрать тип» с поиском, сетка типов 2 колонки с иконками.
export function NewPropertyForm({
  onCreate,
  fullWidth = false,
  initialName = '',
  currentType,
  onNameChange,
}: {
  onCreate: (type: TaskPropertyType, name?: string) => void;
  // В полноэкранной панели «Новое свойство» — на всю ширину (не фикс 18rem попапа).
  fullWidth?: boolean;
  initialName?: string;
  currentType?: TaskPropertyType;
  onNameChange?: (name: string) => void;
}): React.ReactElement {
  const [name, setName] = useState(initialName);
  const [typeQuery, setTypeQuery] = useState('');
  // Поиск типа: по умолчанию иконка, по клику раскрывается в поле (Notion Search types).
  const [searchOpen, setSearchOpen] = useState(false);
  const q = typeQuery.trim().toLowerCase();
  const types = TASK_PROPERTY_TYPES.filter(
    (t) => !q || TASK_PROPERTY_TYPE_LABELS[t].toLowerCase().includes(q),
  );
  return (
    <div className={fullWidth ? 'w-full' : 'w-72'}>
      <input
        autoFocus
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          onNameChange?.(e.target.value);
        }}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !currentType) return;
          e.preventDefault();
          onCreate(currentType, name);
        }}
        placeholder="Введите имя свойства…"
        aria-label="Имя свойства"
        className="mb-4 h-11 w-full rounded-[10px] border bg-background px-3 text-sm outline-none ring-primary/40 placeholder:text-muted-foreground/60 focus:ring-2"
      />
      <div className="flex items-center justify-between gap-2 px-0.5 pb-1.5">
        <p className="shrink-0 text-[11px] font-medium text-muted-foreground">Выбрать тип</p>
        {/* Иконка-лупа → раскрывается в поле поиска (плавно). Схлопывается на blur,
            если пусто. */}
        {searchOpen ? (
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <input
              autoFocus
              value={typeQuery}
              onChange={(e) => setTypeQuery(e.target.value)}
              onBlur={() => {
                if (!typeQuery.trim()) setSearchOpen(false);
              }}
              placeholder="Поиск типа…"
              aria-label="Поиск типа"
              className="h-11 w-full rounded-[10px] border bg-background pl-8 pr-3 text-sm outline-none ring-primary/40 placeholder:text-muted-foreground/60 focus:ring-2"
            />
          </div>
        ) : (
          <button
            type="button"
            aria-label="Поиск типа"
            onClick={() => setSearchOpen(true)}
            className="grid size-11 shrink-0 place-items-center rounded-[10px] text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="size-3.5" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-0.5">
        {types.map((t) => {
          const Icon = PROPERTY_TYPE_ICONS[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => onCreate(t, name)}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                currentType === t && 'bg-accent/60 text-foreground',
              )}
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

// «Видимость свойств» (Notion Property visibility): поиск, секции «В таблице» /
// «Скрыто в таблице», глазок-тоггл у каждой строки, «Скрыть все» / «Показать все».
// items — ВСЕ колонки в текущем порядке (стандартные + кастомные), key ViewColumn|`p:<id>`.
export type VisibilityItem = { key: string; label: string; icon: React.ReactNode };

// Строка панели видимости: ⋮⋮ (drag-реордер видимых), иконка, имя, глазок.
function VisibilityRow({
  item,
  isHidden,
  onToggle,
  draggable,
}: {
  item: VisibilityItem;
  isHidden: boolean;
  onToggle: () => void;
  draggable: boolean;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    disabled: !draggable,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group/vrow flex items-center gap-1.5 rounded-md px-1 py-1 text-sm transition-colors hover:bg-accent/50',
        isDragging && 'z-10 bg-accent shadow-sm',
      )}
    >
      {draggable ? (
        <button
          type="button"
          aria-label={`Переместить ${item.label}`}
          {...attributes}
          {...listeners}
          className="grid size-4 shrink-0 cursor-grab place-items-center rounded text-muted-foreground/40 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3" />
        </button>
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      )}
      <span className="text-muted-foreground/70">{item.icon}</span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <button
        type="button"
        aria-label={isHidden ? `Показать ${item.label}` : `Скрыть ${item.label}`}
        onClick={onToggle}
        className="grid size-6 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
      >
        {isHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

export function PropertyVisibilityPanel({
  items,
  hidden,
  onToggle,
  onSetHidden,
  onReorder,
}: {
  items: VisibilityItem[];
  hidden: readonly string[];
  onToggle: (key: string) => void;
  onSetHidden?: (keys: string[]) => void;
  // Drag за ⋮⋮ в секции «В таблице» — новый порядок ВИДИМЫХ колонок (colOrder).
  onReorder?: (orderedShownKeys: string[]) => void;
}): React.ReactElement {
  const [query, setQuery] = useState('');
  const q = query.trim().toLocaleLowerCase('ru');
  const match = (it: VisibilityItem): boolean => !q || it.label.toLocaleLowerCase('ru').includes(q);
  const shown = items.filter((it) => !hidden.includes(it.key) && match(it));
  const hiddenItems = items.filter((it) => hidden.includes(it.key) && match(it));
  // Drag отключаем при активном поиске (порядок отфильтрованного списка ≠ colOrder).
  const dragEnabled = Boolean(onReorder) && q.length === 0;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const row = (it: VisibilityItem, isHidden: boolean): React.ReactElement => (
    <VisibilityRow
      key={it.key}
      item={it}
      isHidden={isHidden}
      onToggle={() => onToggle(it.key)}
      draggable={!isHidden && dragEnabled}
    />
  );
  return (
    <div className="flex w-72 flex-col gap-1">
      <div className="relative px-0.5">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск свойства…"
          aria-label="Поиск свойства"
          className="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-sm outline-none ring-primary/40 placeholder:text-muted-foreground/60 focus:ring-2"
        />
      </div>
      {/* «Название» всегда видно (Notion: Name нельзя скрыть). */}
      {(!q || 'название'.includes(q)) && (
        <div className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm">
          <span className="font-mono text-[11px] leading-none text-muted-foreground/70">Aa</span>
          <span className="min-w-0 flex-1 truncate">Название</span>
          <Eye className="mr-1.5 size-3.5 text-muted-foreground/30" />
        </div>
      )}
      {shown.length > 0 && (
        <>
          <div className="flex items-center justify-between px-1.5 pt-1">
            <p className="text-[11px] font-medium text-muted-foreground">В таблице</p>
            {onSetHidden && (
              <button
                type="button"
                onClick={() => onSetHidden(items.map((it) => it.key))}
                className="text-[11px] text-primary transition-opacity hover:opacity-70"
              >
                Скрыть все
              </button>
            )}
          </div>
          {dragEnabled ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => {
                const { active, over } = e;
                if (!over || active.id === over.id) return;
                const keys = shown.map((it) => it.key);
                const from = keys.indexOf(String(active.id));
                const to = keys.indexOf(String(over.id));
                if (from < 0 || to < 0) return;
                onReorder?.(arrayMove(keys, from, to));
              }}
            >
              <SortableContext items={shown.map((it) => it.key)} strategy={verticalListSortingStrategy}>
                {shown.map((it) => row(it, false))}
              </SortableContext>
            </DndContext>
          ) : (
            shown.map((it) => row(it, false))
          )}
        </>
      )}
      {hiddenItems.length > 0 && (
        <>
          <div className="flex items-center justify-between px-1.5 pt-1">
            <p className="text-[11px] font-medium text-muted-foreground">Скрыто в таблице</p>
            {onSetHidden && (
              <button
                type="button"
                onClick={() => onSetHidden([])}
                className="text-[11px] text-primary transition-opacity hover:opacity-70"
              >
                Показать все
              </button>
            )}
          </div>
          {hiddenItems.map((it) => row(it, true))}
        </>
      )}
      {shown.length === 0 && hiddenItems.length === 0 && (
        <p className="px-2 py-3 text-center text-xs text-muted-foreground">Ничего не найдено</p>
      )}
    </div>
  );
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
  members = [],
  dataCell,
  onCellMouseEnter,
  rangeClass,
}: {
  property: TaskProperty;
  value: string;
  onChange: (value: string) => void;
  onAddOption: (label: string) => Promise<TaskPropertyOption | null>;
  // Участники проекта — для person-свойства (value = userId).
  members?: PropertyMember[];
  // Excel-выделение (Notion): помечаем клетку data-cell, ловим наведение при протяжке
  // и подсвечиваем диапазон. Ячейка-«выборка» (select/person) участвует наравне со
  // стандартными — первый клик выделяет (gate в строке гасит открытие выпадашки).
  dataCell?: string;
  onCellMouseEnter?: () => void;
  rangeClass?: string | null;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Общие для всех веток атрибуты выделения (data-cell + наведение при протяжке).
  const selAttrs = { 'data-cell': dataCell, onMouseEnter: onCellMouseEnter };

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
        <div role="gridcell" {...selAttrs} className={cn('relative min-h-[52px] border-b border-l', rangeClass)}>
          {/* Notion: редактор раскрывается ПОВЕРХ ячейки РОВНО по её ширине (w-full),
              текст растёт вниз не двигая строки. Тонкая рамка + мягкая тень как в
              Notion (не «плавающий» широкий бокс). Enter — коммит (Shift+Enter —
              перенос строки в тексте), Esc — отмена. */}
          <div className="absolute -left-px -top-px z-30 w-[calc(100%+1px)] overflow-hidden rounded-[3px] bg-popover shadow-[0_0_0_1px_rgba(15,15,15,0.12),0_3px_12px_rgba(15,15,15,0.16)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_3px_12px_rgba(0,0,0,0.5)]">
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
          <div className="min-h-[52px]" aria-hidden />
        </div>
      );
    }
    return (
      <button
        {...selAttrs}
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className={cn(
          'relative min-h-[52px] min-w-0 border-b border-l px-4 py-2 text-left text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          rangeClass,
        )}
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
      <div role="gridcell" {...selAttrs} className={cn('relative flex min-h-[52px] items-center border-b border-l px-4 py-2', rangeClass)}>
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

  // person (Notion Person): выбор участника проекта, значение = userId.
  if (property.type === 'person') {
    const current = members.find((m) => m.id === value);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            {...selAttrs}
            type="button"
            className={cn(
              'relative flex min-h-[52px] min-w-0 items-center gap-2 border-b border-l px-4 py-2 text-left text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              rangeClass,
            )}
          >
            {current ? (
              <>
                <span className="grid size-4 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/15 text-[9px] font-semibold text-primary">
                  {current.avatarUrl ? (
                    <img src={current.avatarUrl} alt="" className="size-full object-cover" />
                  ) : (
                    current.displayName.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="truncate">{current.displayName}</span>
              </>
            ) : (
              // Пустое значение — чистая клетка (Notion).
              <span className="size-4" aria-hidden />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[12rem]">
          {members.map((m) => (
            <DropdownMenuItem
              key={m.id}
              className="gap-2"
              onSelect={() => onChange(value === m.id ? '' : m.id)}
            >
              <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                {m.avatarUrl ? (
                  <img src={m.avatarUrl} alt="" className="size-full object-cover" />
                ) : (
                  m.displayName.slice(0, 1).toUpperCase()
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
              {value === m.id && <span className="text-xs text-primary">✓</span>}
            </DropdownMenuItem>
          ))}
          {members.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">Участники загружаются…</p>
          )}
          {value && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-muted-foreground" onSelect={() => onChange('')}>
                Убрать
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
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
          {...selAttrs}
          type="button"
          className={cn(
            'relative flex min-h-[52px] min-w-0 flex-wrap items-center gap-1 border-b border-l px-4 py-2 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            rangeClass,
          )}
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

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  CircleDot,
  Clock,
  EyeOff,
  FileText,
  Flag,
  GripVertical,
  ListFilter,
  Loader2,
  MoreHorizontal,
  PanelRight,
  Plus,
  RefreshCw,
  Snowflake,
  Trash2,
  User,
  WifiOff,
  WrapText,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { TaskProperty } from '@/domain/task/TaskProperty';
import { TASK_PRIORITIES } from '@/domain/task/Task';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import { VISIBLE_KANBAN_STATUSES } from '@/domain/kanban/KanbanSettings';
import { useContainer } from '@/infrastructure/di/container';
import { useTasks } from '@/presentation/hooks/useTasks';
import {
  PROPERTY_TYPE_ICONS,
  PropertyHeaderCell,
  PropertyValueCell,
  PropertyVisibilityPanel,
  useTaskProperties,
  type UseTaskPropertiesResult,
} from './customProperties';
import { useBulkTaskActions, type BulkResult } from '@/presentation/hooks/useBulkTaskActions';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { STATUS_LABEL } from '../statusLabels';
import { DeadlineBadge } from '../DeadlineBadge';
import { AssigneeTaskButton } from '../AssigneeTaskButton';
import { TaskCreatedValue } from '../TaskCreatedValue';
import { type TaskDrawerState } from '../TaskDrawer';
import { ymd, startOfDay, addDays } from '../assignedGrouping';
import type { ViewCreateRequest } from './ProjectBoardViews';
import { SelectedBar } from './SelectedBar';
import { splitTitleBody } from '@/lib/taskTitleBody';
import {
  NewTaskRow,
  PRIORITY_PILL,
  STATUS_DOT,
  STATUS_PILL,
  VIEW_CALC_LABELS,
  VIEW_COLUMN_LABELS,
  ViewTaskDrawer,
  applyViewSort,
  buildTreeRows,
  groupKeyFor,
  groupLabelFor,
  type StandardGrouping,
  hasActiveFilters,
  matchesFilters,
  rowColorFor,
  taskMenuEntries,
  isUntitledTask,
  taskTitle,
  type TreeRow,
  type TableViewState,
  type ViewCalc,
  type ViewColorRule,
  type ViewColumn,
  type ViewFilters,
  type ViewGrouping,
  type ViewSort,
  type ViewSortKey,
} from './viewShared';
import { ContextEntries, DropdownEntries, type MenuEntry } from './menuEntries';
import { ConfirmDeleteDialog } from '../ConfirmDeleteDialog';
import {
  navigateTableRange,
  primaryPointerActivatesCell,
  rangeBounds,
  rowsForContextMenu,
  type TableCellRange,
  type TableNavigationKey,
} from './tableSelection';

type Props = {
  projectId: string;
  projectName?: string;
  memberCount?: number;
  filters: ViewFilters;
  onFiltersChange: (patch: Partial<ViewFilters>) => void;
  sort: ViewSort | null;
  onSortChange: (s: ViewSort | null) => void;
  // Скрытые колонки: ViewColumn | `p:<propertyId>`.
  hiddenCols: string[];
  onToggleCol: (c: string) => void;
  tableState: TableViewState;
  onTableState: (patch: Partial<TableViewState>) => void;
  grouping: ViewGrouping | null;
  // Меню select-колонки: «Группировать по этому свойству» (Notion Group).
  onGroupingChange?: (g: ViewGrouping | null) => void;
  colorRules: ViewColorRule[];
  createRequest: ViewCreateRequest | null;
  // «Скрыть все»/«Показать все» в панели «Видимость свойств».
  onSetHiddenCols?: (keys: string[]) => void;
  // Открытая правая панель уже резервирует 496px в родительском rail; таблица не должна
  // заходить отрицательным правым отступом в 16px gutter перед панелью.
  sidePanelOpen?: boolean;
  canEdit?: boolean;
};

// Ширины колонок; сетка собирается из видимых (скрытие свойств — как в Notion).
const COLUMN_WIDTH: Record<ViewColumn, string> = {
  status: '8.5rem',
  priority: '8rem',
  deadline: '8.5rem',
  assignee: '11rem',
  created: '19rem',
};
const ALL_COLUMNS: readonly ViewColumn[] = ['status', 'priority', 'deadline', 'assignee', 'created'];
const TABLE_NAVIGATION_KEYS = new Set<TableNavigationKey>([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

// Сортируемое свойство колонки (у «Ответственного» сортировки нет).
const COLUMN_SORT_KEY: Partial<Record<ViewColumn, ViewSortKey>> = {
  status: 'status',
  priority: 'priority',
  deadline: 'deadline',
  created: 'created',
};

// Формат «Создано» (Notion Created time): «12 июл. 2026 г., 21:41».
const CREATED_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// === Табличный вид доски (Notion-style) ===
// Notion-таблица: слева в «поле» строки при hover — чекбокс и «+»; в ячейке названия при
// hover — кнопка «Открыть»; клик по пустому месту ячейки выделяет её синей рамкой (Esc
// снимает); статус/приоритет/срок/ответственный редактируются прямо в ячейках; выбранные
// строки — плавающая панель действий сверху.
export function TableView({
  projectId,
  projectName,
  memberCount,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  hiddenCols,
  onToggleCol,
  tableState,
  onTableState,
  grouping,
  onGroupingChange,
  colorRules,
  createRequest,
  onSetHiddenCols,
  sidePanelOpen = false,
  canEdit = true,
}: Props): React.ReactElement {
  const tasksApi = useTasks(projectId);
  const { tasks, loading, error, create, update, move, remove, refetch } = tasksApi;
  const { taskTemplateRepository } = useContainer();
  // Кастомные свойства (db/109): колонки после стандартных, «+» в шапке создаёт новое.
  const customProps = useTaskProperties(projectId);
  const [creatingProperty, setCreatingProperty] = useState(false);
  const [propertyPendingScrollId, setPropertyPendingScrollId] = useState<string | null>(null);
  const [openPropertyMenuId, setOpenPropertyMenuId] = useState<string | null>(null);

  // Sticky-шапка колонок: top = высота sticky-стека страницы (крошки + плашки +
  // строка вкладок); гор. скролл тела транслируется в шапку (refs ниже).
  const tableRootRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const headScrollRef = useRef<HTMLDivElement | null>(null);
  const [headerTop, setHeaderTop] = useState(0);
  useEffect(() => {
    const els = ['pf-project-crumbs', 'pf-sticky-banners']
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const measure = (): void => setHeaderTop(els.reduce((s, el) => s + el.offsetHeight, 0));
    measure();
    const ro = new ResizeObserver(measure);
    els.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, []);
  const { user } = useCurrentUser();
  const isShared = (memberCount ?? 0) > 1;
  const [drawer, setDrawer] = useState<TaskDrawerState | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [retrying, setRetrying] = useState(false);
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [liveMessage, setLiveMessage] = useState('');
  const urlSortHydratedRef = useRef(false);
  const skipNextUrlSortSyncRef = useRef(false);
  const [deleteIntent, setDeleteIntent] = useState<
    { kind: 'single'; task: Task } | { kind: 'bulk'; ids: string[] } | null
  >(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Выделение ячеек как в Excel (Notion): mousedown — якорь, drag по ячейкам — диапазон.
  // Координаты: row — индекс в rows, col — 0 (название) или индекс в visibleCols + 1.
  const [selRange, setSelRange] = useState<TableCellRange | null>(null);
  const selDragging = useRef(false);
  // Контекстное меню и выбор строк — отдельный слой состояния. Первый левый клик
  // вне открытого меню только закрывает его; выбранные строки остаются до следующего
  // клика, как в Notion.
  const contextMenuOpenRef = useRef(false);
  const contextMenuDismissClickRef = useRef(false);
  const handleContextMenuOpenChange = (open: boolean): void => {
    contextMenuOpenRef.current = open;
  };
  const preserveContextMenuSelection = (): boolean => {
    if (!contextMenuOpenRef.current && !contextMenuDismissClickRef.current) return false;
    contextMenuDismissClickRef.current = true;
    window.setTimeout(() => {
      contextMenuDismissClickRef.current = false;
    }, 0);
    return true;
  };
  const consumeContextMenuDismissClick = (): boolean => {
    const consume = contextMenuDismissClickRef.current;
    contextMenuDismissClickRef.current = false;
    return consume;
  };
  const bulk = useBulkTaskActions({ projectId, update, move, remove, refetch });

  // Ставим защитный флаг в capture-фазе раньше Radix DismissableLayer. Поэтому даже
  // если меню успеет закрыться между pointerdown и mousedown, первый внешний клик
  // не снимет строки и не активирует лежащий под меню control.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0 || !contextMenuOpenRef.current) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          '[data-radix-popper-content-wrapper], [role="menu"], [role="menuitem"]',
        )
      )
        return;
      contextMenuDismissClickRef.current = true;
      window.setTimeout(() => {
        contextMenuDismissClickRef.current = false;
      }, 0);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  useEffect(() => {
    const markOnline = (): void => setOnline(true);
    const markOffline = (): void => setOnline(false);
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

  // Сортировка является частью адреса вида: ссылку можно скопировать, а остальные query-параметры
  // (например, открытая задача) при этом сохраняются.
  useEffect(() => {
    if (urlSortHydratedRef.current) return;
    urlSortHydratedRef.current = true;
    const raw = new URL(window.location.href).searchParams.get('sort');
    const match = raw?.match(/^(title|status|priority|deadline|created|p:[^:]+):(asc|desc)$/);
    if (!match) return;
    const parsed = { key: match[1] as ViewSortKey, dir: match[2] as 'asc' | 'desc' };
    if (sort?.key === parsed.key && sort.dir === parsed.dir) return;
    skipNextUrlSortSyncRef.current = true;
    onSortChange(parsed);
  }, [onSortChange, sort]);

  useEffect(() => {
    if (!urlSortHydratedRef.current) return;
    if (skipNextUrlSortSyncRef.current) {
      skipNextUrlSortSyncRef.current = false;
      return;
    }
    const url = new URL(window.location.href);
    if (sort) url.searchParams.set('sort', `${sort.key}:${sort.dir}`);
    else url.searchParams.delete('sort');
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(window.history.state, '', next);
  }, [sort]);

  // Пустота значения кастомного свойства (multi_select '[]' — тоже пусто).
  const propValueEmpty = (raw: string, type: TaskProperty['type']): boolean => {
    if (!raw) return true;
    if (type === 'multi_select') {
      try {
        return (JSON.parse(raw) as string[]).length === 0;
      } catch {
        return true;
      }
    }
    return false;
  };

  const rows = useMemo(() => {
    let list = tasks.filter((t) => matchesFilters(t, filters));
    // Фильтры по кастомным свойствам (Notion): select/multi_select — id опций,
    // checkbox — '1'/''. Применяются только здесь (значения есть у таблицы).
    for (const [pid, wanted] of Object.entries(filters.props ?? {})) {
      if (!wanted || wanted.length === 0) continue;
      const prop = customProps.properties.find((p) => p.id === pid);
      if (!prop) continue;
      list = list.filter((t) => {
        const raw = customProps.valueFor(t.id, pid);
        if (prop.type === 'multi_select') {
          try {
            const ids = raw ? (JSON.parse(raw) as string[]) : [];
            return wanted.some((w) => ids.includes(w));
          } catch {
            return false;
          }
        }
        if (prop.type === 'checkbox') return wanted.includes(raw === '1' ? '1' : '');
        return wanted.includes(raw);
      });
    }
    const sorted = applyViewSort(list, sort);
    // Сортировка по кастомному свойству: пустые всегда в конец (как стандартные).
    if (sort && sort.key.startsWith('p:')) {
      const pid = sort.key.slice(2);
      const prop = customProps.properties.find((p) => p.id === pid);
      const optLabel = (id: string): string => prop?.options.find((o) => o.id === id)?.label ?? '';
      const keyOf = (t: Task): { empty: boolean; num: number; str: string } => {
        const raw = customProps.valueFor(t.id, pid);
        if (!prop || propValueEmpty(raw, prop.type)) return { empty: true, num: 0, str: '' };
        switch (prop.type) {
          case 'number':
            return { empty: false, num: parseFloat(raw) || 0, str: '' };
          case 'checkbox':
            return { empty: false, num: raw === '1' ? 1 : 0, str: '' };
          case 'select':
            return { empty: false, num: 0, str: optLabel(raw) };
          case 'multi_select': {
            try {
              const ids = JSON.parse(raw) as string[];
              return { empty: ids.length === 0, num: 0, str: ids.map(optLabel).join(', ') };
            } catch {
              return { empty: true, num: 0, str: '' };
            }
          }
          case 'person':
            return {
              empty: false,
              num: 0,
              str: customProps.members.find((m) => m.id === raw)?.displayName ?? raw,
            };
          default:
            return { empty: false, num: 0, str: raw };
        }
      };
      const numeric = prop?.type === 'number' || prop?.type === 'checkbox';
      const mul = sort.dir === 'asc' ? 1 : -1;
      sorted.sort((a, b) => {
        const ka = keyOf(a);
        const kb = keyOf(b);
        if (ka.empty !== kb.empty) return ka.empty ? 1 : -1;
        const cmp = numeric ? ka.num - kb.num : ka.str.localeCompare(kb.str, 'ru');
        return cmp * mul || a.position - b.position;
      });
    }
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, filters, sort, customProps.properties, customProps.values]);

  // Группировка (Notion Group by): порядок групп — по первому появлению в rows
  // (rows уже отсортированы по статусу/позиции или пользовательской сортировке).
  // `p:<id>` — группировка по select-свойству (ключ = id опции | 'none').
  const groupProp = grouping?.startsWith('p:')
    ? customProps.properties.find((p) => p.id === grouping.slice(2))
    : undefined;
  const groups = useMemo(() => {
    if (!grouping) return null;
    const map = new Map<string, Task[]>();
    for (const t of rows) {
      const key = groupProp
        ? customProps.valueFor(t.id, groupProp.id) || 'none'
        : groupKeyFor(t, grouping as StandardGrouping);
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return [...map.entries()].map(([key, tasks_]) => ({ key, tasks: tasks_ }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, grouping, groupProp]);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = (key: string): void =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const visibleCols = useMemo(
    () => ALL_COLUMNS.filter((c) => !hiddenCols.includes(c)),
    [hiddenCols],
  );


  // Подменю «Фильтр» в меню заголовка колонки (чекбоксы значений — как в Notion).
  const filterEntriesFor = (col: ViewColumn): MenuEntry[] | undefined => {
    if (col === 'status') {
      return VISIBLE_KANBAN_STATUSES.map((s) => ({
        kind: 'item' as const,
        label: STATUS_LABEL[s],
        dotClass: STATUS_DOT[s],
        checked: filters.statuses.includes(s),
        onSelect: () =>
          onFiltersChange({
            statuses: filters.statuses.includes(s)
              ? filters.statuses.filter((x) => x !== s)
              : [...filters.statuses, s],
          }),
      }));
    }
    if (col === 'priority') {
      return TASK_PRIORITIES.map((p) => ({
        kind: 'item' as const,
        label: PRIORITY_META[p].label,
        dotClass: PRIORITY_META[p].dotColor,
        checked: filters.priorities.includes(p),
        onSelect: () =>
          onFiltersChange({
            priorities: filters.priorities.includes(p)
              ? filters.priorities.filter((x) => x !== p)
              : [...filters.priorities, p],
          }),
      }));
    }
    if (col === 'deadline') {
      return (
        [
          ['has', 'Есть срок'],
          ['none', 'Без срока'],
          ['overdue', 'Просрочено'],
        ] as const
      ).map(([d, label]) => ({
        kind: 'item' as const,
        label,
        checked: filters.due === d,
        onSelect: () => onFiltersChange({ due: filters.due === d ? null : d }),
      }));
    }
    return undefined;
  };
  // Единый ПОРЯДОК колонок (Notion: drag за заголовок): стандартные + кастомные
  // по сохранённому colOrder; отсутствующие — в конце в дефолтном порядке.
  const orderedKeys = useMemo<string[]>(() => {
    const avail: string[] = [
      ...visibleCols,
      ...customProps.properties
        .filter((p) => !hiddenCols.includes(`p:${p.id}`))
        .map((p) => `p:${p.id}`),
    ];
    const saved = (tableState.colOrder ?? []).filter((k) => avail.includes(k));
    const missing = avail.filter((k) => !saved.includes(k));
    return [...saved, ...missing];
  }, [visibleCols, customProps.properties, tableState.colOrder, hiddenCols]);
  const propByKey = (k: string): TaskProperty | undefined =>
    customProps.properties.find((p) => `p:${p.id}` === k);

  // Notion: «+» не открывает пустую форму отдельно от таблицы. Сначала появляется
  // реальная текстовая колонка, затем таблица плавно доезжает до её заголовка и
  // открывает меню новой колонки для имени/типа. Повторный клик во время запроса
  // игнорируется, чтобы один жест не создавал несколько одинаковых свойств.
  const createPropertyFromHeader = async (): Promise<void> => {
    if (!canEdit) return;
    if (creatingProperty) return;
    // Сдвигаем содержимое таблицы влево (scroll вправо до упора) сразу по клику,
    // ещё до ответа сервера. После появления новой колонки эффект ниже повторит
    // доводку до нового максимума и откроет её меню.
    bodyScrollRef.current?.scrollTo({
      left: bodyScrollRef.current.scrollWidth,
      behavior: 'smooth',
    });
    headScrollRef.current?.scrollTo({
      left: headScrollRef.current.scrollWidth,
      behavior: 'smooth',
    });
    setCreatingProperty(true);
    try {
      const property = await customProps.createProperty('text', 'Новое свойство');
      if (!property) return;
      const key = `p:${property.id}`;
      onTableState({ colOrder: [...orderedKeys, key] });
      setPropertyPendingScrollId(property.id);
    } finally {
      setCreatingProperty(false);
    }
  };

  useEffect(() => {
    if (!propertyPendingScrollId) return;
    if (!customProps.properties.some((property) => property.id === propertyPendingScrollId)) return;
    let secondFrame = 0;
    let openTimer = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        bodyScrollRef.current?.scrollTo({
          left: bodyScrollRef.current.scrollWidth,
          behavior: 'smooth',
        });
        openTimer = window.setTimeout(() => {
          setOpenPropertyMenuId(propertyPendingScrollId);
          setPropertyPendingScrollId(null);
        }, 180);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      if (openTimer) window.clearTimeout(openTimer);
    };
  }, [customProps.properties, propertyPendingScrollId]);

  // Все колонки для панели «Видимость свойств» — в ПОРЯДКЕ таблицы (orderedKeys),
  // затем скрытые; drag за ⋮⋮ в панели переставляет colOrder.
  const visibilityItems = useMemo(() => {
    const itemFor = (k: string): { key: string; label: string; icon: React.ReactNode } => {
      const prop = customProps.properties.find((p) => `p:${p.id}` === k);
      if (prop) {
        const Icon = PROPERTY_TYPE_ICONS[prop.type];
        return { key: k, label: prop.name, icon: <Icon className="size-3.5" /> };
      }
      const c = k as ViewColumn;
      return { key: k, label: VIEW_COLUMN_LABELS[c], icon: <ColumnIcon col={c} /> };
    };
    const all = [
      ...ALL_COLUMNS.map((c) => c as string),
      ...customProps.properties.map((p) => `p:${p.id}`),
    ];
    const orderedAll = [...orderedKeys, ...all.filter((k) => !orderedKeys.includes(k))];
    return orderedAll.map(itemFor);
  }, [orderedKeys, customProps.properties]);

  // Хвост-филлер справа (Notion): разделитель после последней колонки, границы строк
  // продолжаются до края. Ширины колонок — resize drag'ом за границу заголовка.
  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: [
        // Gutter hover-контролов («+»/⋮⋮/чекбокс) — sticky-колонка, закреплена при
        // горизонтальном скролле (Notion).
        'var(--pf-table-gutter, 3.5rem)',
        // ФИКСИРОВАННАЯ ширина (Notion): НИКОГДА не по контенту. В w-max контейнере
        // (sticky-freeze) minmax(...,1fr) считался бы по max-content — одна задача
        // с длинным неразрывным названием раздувала колонку на тысячи px, и грид
        // строк переставал совпадать с шапкой («клетки исчезли»).
        tableState.colWidths.title ? `${tableState.colWidths.title}px` : '16rem',
        ...orderedKeys.map((k) =>
          tableState.colWidths[k]
            ? `${tableState.colWidths[k]}px`
            : k.startsWith('p:')
              ? '180px'
              : COLUMN_WIDTH[k as ViewColumn],
        ),
        // Хвост-филлер до правого края окна (Notion): границы строк тянутся до конца.
        'minmax(6rem,1fr)',
      ].join(' '),
    }),
    [orderedKeys, tableState.colWidths],
  );
  const tableScrollStorageKey = useMemo(() => {
    const viewId =
      typeof window === 'undefined'
        ? 'default'
        : new URL(window.location.href).searchParams.get('view') ?? 'default';
    return `pf:table-scroll:${projectId}:${viewId}`;
  }, [projectId]);
  const rememberTableScroll = (left: number): void => {
    try {
      sessionStorage.setItem(tableScrollStorageKey, String(Math.max(0, Math.round(left))));
    } catch {
      // Private browsing/storage policies must not break table scrolling.
    }
  };
  useEffect(() => {
    if (loading) return;
    let saved = 0;
    try {
      saved = Number.parseInt(sessionStorage.getItem(tableScrollStorageKey) ?? '0', 10) || 0;
    } catch {
      saved = 0;
    }
    if (saved <= 0) return;
    const frame = window.requestAnimationFrame(() => {
      if (bodyScrollRef.current) bodyScrollRef.current.scrollLeft = saved;
      if (headScrollRef.current) headScrollRef.current.scrollLeft = saved;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, tableScrollStorageKey]);

  // Drag-перестановка колонок за заголовок (Notion): свой pointer-драг — старт
  // после 8px, синяя линия-индикатор на границе вставки, click без движения
  // по-прежнему открывает меню колонки (Radix pointerdown-open гасится).
  const [colDropIdx, setColDropIdx] = useState<number | null>(null);
  const colDragRef = useRef<{ key: string; startX: number; moved: boolean } | null>(null);
  const headGridRef = useRef<HTMLDivElement | null>(null);
  const startColDrag = (key: string) => (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    colDragRef.current = { key, startX: e.clientX, moved: false };
    const move = (ev: PointerEvent): void => {
      const st = colDragRef.current;
      if (!st) return;
      if (!st.moved) {
        if (Math.abs(ev.clientX - st.startX) < 8) return;
        st.moved = true;
      }
      const cells = Array.from(
        headGridRef.current?.querySelectorAll('[data-colkey]') ?? [],
      ) as HTMLElement[];
      let idx = cells.length;
      for (let i = 0; i < cells.length; i++) {
        const r = cells[i]!.getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) {
          idx = i;
          break;
        }
      }
      setColDropIdx(idx);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const st = colDragRef.current;
      setColDropIdx((drop) => {
        if (st?.moved && drop !== null) {
          const without = orderedKeys.filter((k) => k !== st.key);
          const beforeCount = orderedKeys.slice(0, drop).filter((k) => k !== st.key).length;
          const next = [...without];
          next.splice(beforeCount, 0, st.key);
          onTableState({ colOrder: next });
        }
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // Клик сразу после drag'а не должен открывать меню колонки.
  const consumeColDragged = (): boolean => {
    const moved = colDragRef.current?.moved ?? false;
    colDragRef.current = null;
    return moved;
  };

  // Resize колонки (Notion): mousedown на правой кромке заголовка → drag.
  // key: 'title' | ViewColumn | `p:<propertyId>` (кастомные свойства).
  const startResize = (key: string, e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const cell = (e.currentTarget as HTMLElement).parentElement;
    if (!cell) return;
    const startX = e.clientX;
    const startW = cell.getBoundingClientRect().width;
    const onMove = (ev: MouseEvent): void => {
      const w = Math.round(Math.min(600, Math.max(96, startW + ev.clientX - startX)));
      onTableState({ colWidths: { ...tableState.colWidths, [key]: w } });
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Клавиатурный эквивалент resize из контракта: стрелки меняют ширину ровно на 16px.
  const resizeBy = (key: string, delta: number): void => {
    const fallback =
      key === 'title'
        ? 256
        : key.startsWith('p:')
          ? 180
          : Math.round(Number.parseFloat(COLUMN_WIDTH[key as ViewColumn]) * 16);
    const current = tableState.colWidths[key] ?? fallback;
    const width = Math.min(600, Math.max(96, current + delta));
    onTableState({ colWidths: { ...tableState.colWidths, [key]: width } });
    setLiveMessage(`Ширина колонки изменена: ${width} пикселей.`);
  };

  // Inline-редактирование названия по клику в ячейку (Notion: клик = правка, открыть — OPEN).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editPendingId, setEditPendingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const editPendingRef = useRef<string | null>(null);
  const moveSelectionDown = (task: Task): void => {
    const idx = rows.findIndex((t) => t.id === task.id);
    if (idx >= 0 && idx + 1 < rows.length) {
      const c = { row: idx + 1, col: 0 };
      setSelRange({ a: c, h: c });
    }
  };
  const commitEdit = async (task: Task, moveDown = false): Promise<void> => {
    if (!canEdit) return;
    if (editPendingRef.current === task.id) return;
    const title = editValue.trim();
    if (!title) {
      setEditError('Название задачи не может быть пустым.');
      return;
    }
    if (title === taskTitle(task)) {
      setEditingId(null);
      setEditError(null);
      if (moveDown) moveSelectionDown(task);
      return;
    }
    const { body } = splitTitleBody(task.description ?? '');
    editPendingRef.current = task.id;
    setEditPendingId(task.id);
    setEditError(null);
    try {
      await update(task.id, { description: body ? `${title}\n${body}` : title });
      setEditingId(null);
      setLiveMessage(`Название задачи «${title}» сохранено.`);
      if (moveDown) moveSelectionDown(task);
    } catch (e) {
      const message = (e as Error).message || 'Неизвестная ошибка';
      setEditError(`Не удалось сохранить название: ${message}`);
      toast.error(`Не удалось: ${message}`);
    } finally {
      editPendingRef.current = null;
      setEditPendingId(null);
    }
  };
  // Enter в редакторе названия — как в Excel: коммит и выделение клетки ниже.
  const commitEditAndMoveDown = (task: Task): void => {
    void commitEdit(task, true);
  };

  // Excel type-to-edit: при единственной выделенной клетке названия печать сразу
  // начинает ввод (замещая), Enter открывает редактор с текущим значением.
  useEffect(() => {
    if (!canEdit || !selRange || editingId) return;
    const single =
      selRange.a.row === selRange.h.row && selRange.a.col === selRange.h.col;
    if (!single || selRange.a.col !== 0) return;
    const onKey = (e: KeyboardEvent): void => {
      // По e.target, не activeElement: React флашит эффекты синхронно на keydown,
      // и Enter из inline-редактора доходит до свежеподписанного слушателя, когда
      // сам input уже размонтирован (activeElement=body) — target же остаётся INPUT.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))
        return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      )
        return;
      const task = rows[selRange.a.row];
      if (!task) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        setEditingId(task.id);
        setEditValue(taskTitle(task));
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setEditingId(task.id);
        setEditValue(e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, selRange, rows, editingId]);

  useEffect(() => {
    if (!selRange || editingId) return;
    const single =
      selRange.a.row === selRange.h.row && selRange.a.col === selRange.h.col;
    if (!single || selRange.h.col === 0) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== 'F2' && event.key !== ' ') return;
      const target = event.target as HTMLElement | null;
      if (!target || !tableRootRef.current?.contains(target)) return;
      if (target.closest('button, input, textarea, [role="menu"]')) return;
      const task = rows[selRange.h.row];
      const key = orderedKeys[selRange.h.col - 1];
      if (!task || !key) return;
      const rowElement = Array.from(
        tableRootRef.current.querySelectorAll<HTMLElement>('[data-pf-task-id]'),
      ).find((element) => element.dataset.pfTaskId === task.id);
      const cell = Array.from(
        rowElement?.querySelectorAll<HTMLElement>('[data-cell]') ?? [],
      ).find((element) => element.dataset.cell === key);
      const control = cell?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [role="button"]:not([aria-disabled="true"])',
      );
      if (!control) return;
      event.preventDefault();
      control.focus({ preventScroll: true });
      if (control instanceof HTMLInputElement) {
        control.click();
      } else {
        control.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingId, orderedKeys, rows, selRange]);

  // «+» слева от строки (Notion): inline-строка ввода СРАЗУ ПОД текущей (Alt+клик — над).
  // asSub — создание ПОДЗАДАЧИ под якорем (db/107); parentId — родитель цепочки
  // подзадач (следующие сиблинги после Enter).
  const [insertAt, setInsertAt] = useState<{
    taskId: string;
    above: boolean;
    asSub?: boolean;
    parentId?: string;
  } | null>(null);
  // Enter коммитит строку и СРАЗУ открывает ввод следующей ниже (Notion/канбан);
  // Esc или пустой ввод закрывают цепочку.
  const submitInsert = async (anchor: Task, above: boolean, title: string, asSub = false): Promise<void> => {
    if (!canEdit) return;
    const name = title.trim();
    if (!name) {
      setInsertAt(null);
      return;
    }
    try {
      // Notion: Enter создаёт задачу, закрывает ввод и ВЫДЕЛЯЕТ клетку названия
      // строки ниже созданной (вставка в середине) — не открывает новый ввод.
      if (asSub) {
        const parentId = insertAt?.parentId ?? anchor.id;
        const created = await create({
          description: name,
          status: anchor.status,
          parentTaskId: parentId,
          afterTaskId: anchor.id,
        });
        setExpandedTasks((prev) => new Set(prev).add(parentId));
        setInsertAt(null);
        setPendingSelect({ id: created.id, below: true });
      } else if (above) {
        const idx = rows.findIndex((t) => t.id === anchor.id);
        const prev = rows[idx - 1];
        const created = await create({ description: name, status: anchor.status });
        await move(created.id, {
          targetStatus: anchor.status,
          beforeTaskId: prev && prev.status === anchor.status ? prev.id : null,
          afterTaskId: anchor.id,
        });
        setInsertAt(null);
        setPendingSelect({ id: created.id, below: true });
      } else {
        const created = await create({ description: name, status: anchor.status, afterTaskId: anchor.id });
        setInsertAt(null);
        setPendingSelect({ id: created.id, below: true });
      }
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
      setInsertAt(null);
    }
  };

  // Отложенное выделение созданной строки: ждём, пока она появится в rows после
  // рефетча. below=true — выделяем строку ПОД созданной (Notion), false — саму.
  const [pendingSelect, setPendingSelect] = useState<{ id: string; below: boolean } | null>(null);
  useEffect(() => {
    if (!pendingSelect) return;
    const idx = rows.findIndex((t) => t.id === pendingSelect.id);
    if (idx < 0) return;
    const row = pendingSelect.below && idx + 1 < rows.length ? idx + 1 : idx;
    const c = { row, col: 0 };
    setSelRange({ a: c, h: c });
    setPendingSelect(null);
  }, [rows, pendingSelect]);

  // Дерево подзадач (Notion sub-items): активен без группировки; свёрнуто по умолчанию.
  const [expandedTasks, setExpandedTasks] = useState<ReadonlySet<string>>(() => new Set());
  const toggleExpand = (id: string): void =>
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Drag «⋮⋮» — ручной порядок строк (Notion). Активен без пользовательской сортировки.
  const canReorder = sort === null;
  const [dragTask, setDragTask] = useState<Task | null>(null);

  // Только что перемещённая строка выделена синим, пока юзер не кликнет (как на канбане).
  const [recentlyMovedId, setRecentlyMovedId] = useState<string | null>(null);
  useEffect(() => {
    if (!recentlyMovedId) return;
    const clear = (): void => setRecentlyMovedId(null);
    const t = window.setTimeout(
      () => document.addEventListener('pointerdown', clear, { once: true }),
      0,
    );
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', clear);
    };
  }, [recentlyMovedId]);
  // PointerSensor (не Mouse!): мы гасим pointerdown preventDefault'ом против Radix-меню,
  // а это отменяет синтезированные mouse-события — MouseSensor не стартовал бы.
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const handleRowDragEnd = (e: DragEndEvent): void => {
    if (!canEdit) return;
    setDragTask(null);
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || overId === activeId) return;
    const overIdx = rows.findIndex((t) => t.id === overId);
    if (overIdx < 0) return;
    const over = rows[overIdx]!;
    const prev = rows[overIdx - 1];
    if (prev?.id === activeId && prev.status === over.status) return; // уже на месте
    void move(activeId, {
      targetStatus: over.status,
      beforeTaskId: prev && prev.status === over.status ? prev.id : null,
      afterTaskId: over.id,
    })
      .then(() => setRecentlyMovedId(activeId))
      .catch((err: unknown) => toast.error(`Не удалось: ${(err as Error).message}`));
  };

  // Notion: перемещённая строка сразу получает выделение ячейки названия.
  useEffect(() => {
    if (!recentlyMovedId) return;
    const idx = rows.findIndex((t) => t.id === recentlyMovedId);
    if (idx < 0) return;
    const c = { row: idx, col: 0 };
    setSelRange({ a: c, h: c });
  }, [recentlyMovedId, rows]);

  // Shift+клик по чекбоксу — выделение диапазона (Notion).
  const lastCheckedRef = useRef<number | null>(null);
  const toggleWithRange = (idx: number, shift: boolean): void => {
    const id = rows[idx]!.id;
    if (shift && lastCheckedRef.current !== null) {
      const [a, b] = [Math.min(lastCheckedRef.current, idx), Math.max(lastCheckedRef.current, idx)];
      setSelected((prevSel) => {
        const next = new Set(prevSel);
        for (let i = a; i <= b; i++) next.add(rows[i]!.id);
        return next;
      });
    } else {
      toggleSelected(id);
    }
    lastCheckedRef.current = idx;
  };

  // «Создать» из тулбара вью: открыть окно новой задачи в выбранной колонке.
  // С шаблоном (db/108) — задача создаётся сразу, без окна (Notion Templates).
  useEffect(() => {
    if (!createRequest || !canEdit) return;
    const tpl = createRequest.template;
    if (tpl) {
      void create({
        description: tpl.description || tpl.name,
        status: tpl.status,
        priority: tpl.priority,
        icon: tpl.icon,
      })
        .then(() => toast.success(`Создано из шаблона «${tpl.name}»`))
        .catch((e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`));
    } else {
      setDrawer({ mode: 'create', status: createRequest.status });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest, canEdit]);

  // Esc снимает выделение ячеек; mouseup завершает протяжку диапазона.
  useEffect(() => {
    if (!selRange) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelRange(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selRange]);
  useEffect(() => {
    const up = (): void => {
      selDragging.current = false;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // Клик вне таблицы сбрасывает выбор, кроме клика, которым закрывается открытое
  // контекстное меню: он только закрывает слой, а следующий клик уже снимает выбор.
  // Порталы других меню/диалогов/панели «Выбрано» тоже не меняют контекст таблицы.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (tableRootRef.current?.contains(t)) return;
      if (contextMenuOpenRef.current || contextMenuDismissClickRef.current) return;
      if (
        t.closest(
          '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="menuitem"], #pf-views-tabs-row',
        )
      )
        return;
      setSelected((prev) => (prev.size > 0 ? new Set() : prev));
      setSelRange((prev) => (prev ? null : prev));
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  const colIndexOf = (k: string): number =>
    k === 'title' ? 0 : orderedKeys.indexOf(k) + 1;
  const cellDown = (row: number, k: string, rightButton = false): void => {
    // ПКМ по выделенному диапазону превращает диапазон ячеек в выбранные строки.
    // ПКМ вне диапазона выбирает только строку под курсором. Сам диапазон после
    // открытия меню больше не нужен, а выбор строк сохраняется после закрытия меню.
    if (rightButton) {
      const id = rows[row]?.id;
      if (!id) return;
      if (selRange) {
        const col = colIndexOf(k);
        const ids = rowsForContextMenu(
          selRange,
          row,
          col,
          rows.map((task) => task.id),
        );
        setSelRange(null);
        setSelected(new Set(ids));
        return;
      }
      if (!selected.has(id)) setSelected(new Set([id]));
      return;
    }

    // Любой обычный левый клик после диапазона/выбора строк сначала снимает выбор
    // и проходит в редактор нажатой ячейки. Он не создаёт новый диапазон и не требует
    // второго клика для изменения статуса, срока, участника или другого свойства.
    if (primaryPointerActivatesCell(selRange, selected.size)) {
      selDragging.current = false;
      setSelRange(null);
      setSelected(new Set());
      return;
    }
    selDragging.current = true;
    const c = { row, col: colIndexOf(k) };
    setSelRange({ a: c, h: c });
  };
  const cellEnter = (row: number, k: string): void => {
    if (!selDragging.current) return;
    // Протяжка не должна выделять текст под курсором.
    document.getSelection()?.removeAllRanges();
    setSelRange((prev) => (prev ? { a: prev.a, h: { row, col: colIndexOf(k) } } : prev));
  };
  // Стиль ячейки в диапазоне: одиночная — синяя рамка с уголком (как раньше),
  // диапазон — заливка Excel-style.
  const rangeClassFor = (row: number, k: string): string | null => {
    if (!selRange) return null;
    const c = colIndexOf(k);
    const { firstRow: r1, lastRow: r2, firstCol: c1, lastCol: c2 } =
      rangeBounds(selRange);
    if (row < r1 || row > r2 || c < c1 || c > c2) return null;
    const single = r1 === r2 && c1 === c2;
    if (single)
      return 'ring-2 ring-inset ring-primary/70 after:pointer-events-none after:absolute after:-bottom-[3px] after:-right-[3px] after:size-1.5 after:rounded-[1px] after:bg-primary';
    return cn(
      'bg-primary/10',
      row === selRange.a.row && c === selRange.a.col && 'ring-2 ring-inset ring-primary/70',
    );
  };

  useEffect(() => {
    if (!selRange || editingId) return;
    const onKey = (event: KeyboardEvent): void => {
      if (!TABLE_NAVIGATION_KEYS.has(event.key as TableNavigationKey)) return;
      const target = event.target as HTMLElement | null;
      if (!target || !tableRootRef.current?.contains(target)) return;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
        return;
      event.preventDefault();
      setSelected(new Set());
      setSelRange((current) =>
        current
          ? navigateTableRange(
              current,
              event.key as TableNavigationKey,
              rows.length,
              orderedKeys.length + 1,
              {
                extend: event.shiftKey,
                edge: event.ctrlKey || event.metaKey,
                pageSize: 10,
              },
            )
          : current,
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingId, orderedKeys.length, rows.length, selRange]);

  useEffect(() => {
    if (!selRange) return;
    const task = rows[selRange.h.row];
    const key = selRange.h.col === 0 ? 'title' : orderedKeys[selRange.h.col - 1];
    if (!task || !key) return;
    const frame = window.requestAnimationFrame(() => {
      const rowElement = Array.from(
        tableRootRef.current?.querySelectorAll<HTMLElement>('[data-pf-task-id]') ?? [],
      ).find((element) => element.dataset.pfTaskId === task.id);
      const cell = Array.from(
        rowElement?.querySelectorAll<HTMLElement>('[data-cell]') ?? [],
      ).find((element) => element.dataset.cell === key);
      if (!cell) return;
      cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const focusTarget = cell.matches('button, input, [tabindex]')
        ? cell
        : cell.querySelector<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
      if (focusTarget) focusTarget.focus({ preventScroll: true });
      else {
        cell.tabIndex = -1;
        cell.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [orderedKeys, rows, selRange]);


  const toggleSelected = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = rows.length > 0 && rows.every((t) => selected.has(t.id));
  const toggleAll = (): void => {
    if (!canEdit) return;
    setSelected(allSelected ? new Set() : new Set(rows.map((t) => t.id)));
  };

  const selectedIds = rows.filter((t) => selected.has(t.id)).map((t) => t.id);

  const reportBulk = (label: string) => (res: BulkResult) => {
    if (res.failed > 0) {
      const message = `${label}: выполнено ${res.ok} из ${res.ok + res.failed}.`;
      toast.error(message);
      setLiveMessage(message);
    } else setLiveMessage(`${label}: изменено задач — ${res.ok}.`);
    setSelected(new Set());
    setSelRange(null);
  };

  const retryLoad = async (): Promise<void> => {
    if (retrying) return;
    setRetrying(true);
    try {
      await refetch();
      setLiveMessage('Запрос обновления таблицы завершён.');
    } finally {
      setRetrying(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteIntent || deleteBusy) return;
    setDeleteBusy(true);
    try {
      if (deleteIntent.kind === 'single') {
        const title = taskTitle(deleteIntent.task);
        await remove(deleteIntent.task.id);
        toast.success('Задача удалена');
        setLiveMessage(`Задача «${title}» удалена.`);
      } else {
        const result = await bulk.remove(deleteIntent.ids);
        reportBulk('Удаление')(result);
      }
      setDeleteIntent(null);
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setDeleteBusy(false);
    }
  };

  // ПКМ по одной из НЕСКОЛЬКИХ выбранных строк — bulk-меню над всеми (Notion):
  // статус/приоритет/срок для всех + «Удалить N задач».
  const bulkMenuEntries = (): MenuEntry[] => {
    const n = selectedIds.length;
    return [
      {
        kind: 'sub',
        label: 'Статус',
        icon: CircleDot,
        items: VISIBLE_KANBAN_STATUSES.map((s) => ({
          kind: 'item' as const,
          label: STATUS_LABEL[s],
          onSelect: () => void bulk.moveToColumn(selectedIds, s).then(reportBulk('Статус')),
        })),
      },
      {
        kind: 'sub',
        label: 'Приоритет',
        icon: Flag,
        items: [
          ...TASK_PRIORITIES.map((p) => ({
            kind: 'item' as const,
            label: PRIORITY_META[p].label,
            onSelect: () => void bulk.setPriority(selectedIds, p).then(reportBulk('Приоритет')),
          })),
          {
            kind: 'item' as const,
            label: 'Без приоритета',
            onSelect: () => void bulk.setPriority(selectedIds, null).then(reportBulk('Приоритет')),
          },
        ],
      },
      {
        kind: 'sub',
        label: 'Срок',
        icon: CalendarDays,
        items: [
          {
            kind: 'item' as const,
            label: 'Сегодня',
            onSelect: () =>
              void bulk.setDeadline(selectedIds, ymd(startOfDay(new Date()))).then(reportBulk('Срок')),
          },
          {
            kind: 'item' as const,
            label: 'Завтра',
            onSelect: () =>
              void bulk
                .setDeadline(selectedIds, ymd(addDays(startOfDay(new Date()), 1)))
                .then(reportBulk('Срок')),
          },
          {
            kind: 'item' as const,
            label: 'Убрать срок',
            onSelect: () => void bulk.setDeadline(selectedIds, null).then(reportBulk('Срок')),
          },
        ],
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: `Удалить ${n} задач${n % 10 === 1 && n % 100 !== 11 ? 'у' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'и' : ''}`,
        icon: Trash2,
        destructive: true,
        onSelect: () => setDeleteIntent({ kind: 'bulk', ids: [...selectedIds] }),
      },
    ];
  };

  if (loading) {
    return (
      <div
        role="grid"
        aria-busy="true"
        aria-live="polite"
        aria-label="Загрузка таблицы задач"
        aria-rowcount={7}
        aria-colcount={orderedKeys.length + 3}
        className={cn(
          '-ml-2 overflow-hidden bg-background sm:-ml-8 lg:-ml-16',
          '[--pf-table-gutter:6rem] sm:[--pf-table-gutter:3.5rem]',
          sidePanelOpen ? 'mr-0' : '-mr-2 sm:-mr-8 lg:-mr-16',
        )}
      >
        <span className="sr-only">Загружаем таблицу задач…</span>
        <div role="row" className="grid h-12" style={gridStyle} aria-hidden>
          {Array.from({ length: orderedKeys.length + 3 }, (_, index) => (
            <div
              key={index}
              role="columnheader"
              className={cn(
                'animate-pulse border-b bg-muted/55 motion-reduce:animate-none',
                index > 1 && 'border-l',
              )}
            />
          ))}
        </div>
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            role="row"
            className="grid h-[52px]"
            style={gridStyle}
            aria-hidden
          >
            {Array.from({ length: orderedKeys.length + 3 }, (_, cellIndex) => (
              <div
                key={cellIndex}
                role="gridcell"
                className={cn(
                  'animate-pulse border-b bg-muted/30 motion-reduce:animate-none',
                  cellIndex > 1 && 'border-l',
                )}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (error && tasks.length === 0) {
    return (
      <div
        className={cn(
          '-ml-2 overflow-hidden bg-background sm:-ml-8 lg:-ml-16',
          '[--pf-table-gutter:6rem] sm:[--pf-table-gutter:3.5rem]',
          sidePanelOpen ? 'mr-0' : '-mr-2 sm:-mr-8 lg:-mr-16',
        )}
      >
        <div className="grid h-12" style={gridStyle} aria-hidden>
          {Array.from({ length: orderedKeys.length + 3 }, (_, index) => (
            <div
              key={index}
              className={cn('border-b bg-muted/25', index > 1 && 'border-l')}
            />
          ))}
        </div>
        <div
          role="alert"
          className="flex min-h-44 flex-col items-center justify-center gap-3 border-b border-destructive/30 bg-destructive/5 px-6 py-8 text-center"
        >
          <p className="text-sm text-destructive">Не удалось загрузить таблицу: {error}</p>
          <button
            type="button"
            onClick={() => void retryLoad()}
            disabled={retrying}
            className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border bg-background px-4 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
          >
            {retrying ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="size-4" />}
            Повторить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={tableRootRef}
      aria-busy={retrying}
      className={cn(
        '-ml-2 flex min-h-0 flex-1 flex-col bg-background sm:-ml-8 lg:-ml-16',
        '[--pf-table-gutter:6rem] sm:[--pf-table-gutter:3.5rem]',
        sidePanelOpen ? 'mr-0' : '-mr-2 sm:-mr-8 lg:-mr-16',
      )}
    >
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </span>
      {!online && (
        <div role="status" className="flex min-h-11 items-center gap-2 border-b border-amber-300/60 bg-amber-50 px-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
          <WifiOff className="size-4 shrink-0" />
          Нет сети. Последние загруженные данные доступны; изменения можно повторить после подключения.
        </div>
      )}
      {error && (
        <div role="alert" className="flex min-h-11 items-center gap-3 border-b border-destructive/30 bg-destructive/5 px-3 text-sm text-destructive">
          <span className="min-w-0 flex-1 truncate">Не удалось обновить таблицу: {error}</span>
          <button
            type="button"
            onClick={() => void retryLoad()}
            disabled={retrying}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2 font-medium hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60 [@media(hover:none)]:min-h-11"
          >
            {retrying ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="size-4" />}
            Повторить
          </button>
        </div>
      )}
      <DndContext
        sensors={canEdit ? dndSensors : []}
        collisionDetection={pointerWithin}
        onDragStart={(e) => setDragTask(rows.find((t) => t.id === String(e.active.id)) ?? null)}
        onDragEnd={handleRowDragEnd}
        onDragCancel={() => setDragTask(null)}
      >
      <div
        role="grid"
        aria-label={`Задачи проекта${projectName ? ` «${projectName}»` : ''}`}
        aria-rowcount={rows.length + 3}
        aria-colcount={orderedKeys.length + 3}
        className="contents"
      >
      {/* Sticky-шапка колонок (Notion): липнет под строкой вкладок при вертикальном
          скролле; горизонтальный скролл синхронизируется с телом (onScroll ниже). */}
      <div
        className="pf-sticky-surface sticky z-20 bg-background"
        style={{ top: headerTop }}
      >
        {/* Шапка скроллится и ЮЗЕРОМ (колесо/трекпад над ней), скроллбар скрыт;
            синхронизация двусторонняя (равные значения не зацикливают onScroll). */}
        <div
          ref={headScrollRef}
          onScroll={(e) => {
            if (bodyScrollRef.current)
              bodyScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
            rememberTableScroll(e.currentTarget.scrollLeft);
          }}
          data-pf-table-scroll="header"
          className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
        {/* w-max: контейнер (и грид-строки в нём) растягивается на ПОЛНУЮ ширину
            колонок — иначе грид переполняет собственный бокс и sticky-«Название»
            не хватает слака внутри containing block (колонка уезжает при скролле). */}
        <div className="w-max min-w-full">
          {/* Шапка таблицы: иконка типа свойства + название; клик по заголовку —
              меню колонки (сортировка ↑↓, скрыть свойство), как в Notion. Границы —
              на ячейках, НЕ на контейнере: зона контролов слева чистая. */}
          <div
            ref={headGridRef}
            role="row"
            aria-rowindex={1}
            className="group/head relative grid h-12 text-sm text-muted-foreground"
            style={gridStyle}
          >
            {/* Gutter шапки с «выбрать все». Sticky — только когда «Название»
                закреплено; иначе едет вместе с таблицей (Notion: без freeze таблица
                скроллится целиком). */}
            <div
              role="columnheader"
              aria-colindex={1}
              className={cn(
                'group/gutter flex h-12 items-center justify-end bg-background pr-4',
                tableState.freezeTitle && 'sticky left-0 z-30',
              )}
            >
              <label className="grid size-11 place-items-center sm:size-4">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={!canEdit}
                  aria-label="Выбрать все"
                  className={cn(
                    'size-3.5 cursor-pointer accent-primary transition-opacity disabled:cursor-default',
                    !canEdit && 'invisible',
                    allSelected || selected.size > 0
                      ? 'opacity-100'
                      : 'opacity-0 group-hover/gutter:opacity-100',
                  )}
                />
              </label>
            </div>
            <HeaderCell
              label="Название"
              iconNode={
                <span className="font-mono text-[11px] leading-none text-muted-foreground/70">Aa</span>
              }
              sortKey="title"
              sort={sort}
              onSortChange={onSortChange}
              extraEntries={canEdit ? [
                { kind: 'separator' },
                {
                  kind: 'item',
                  label: 'Переносить текст',
                  icon: WrapText,
                  checked: tableState.wrapTitle,
                  onSelect: () => onTableState({ wrapTitle: !tableState.wrapTitle }),
                },
                {
                  kind: 'item',
                  label: 'Закрепить колонку',
                  icon: Snowflake,
                  checked: tableState.freezeTitle,
                  onSelect: () => onTableState({ freezeTitle: !tableState.freezeTitle }),
                },
              ] : undefined}
              frozen={tableState.freezeTitle}
              onResizeStart={canEdit ? (e) => startResize('title', e) : undefined}
              onResizeBy={canEdit ? (delta) => resizeBy('title', delta) : undefined}
              ariaColIndex={2}
              first
            />
            {/* Колонки в едином порядке orderedKeys (drag за заголовок — Notion). */}
            {orderedKeys.map((k, i) => {
              const prop = propByKey(k);
              const dropSide =
                colDropIdx === i ? ('left' as const) : colDropIdx === orderedKeys.length && i === orderedKeys.length - 1 ? ('right' as const) : null;
              if (prop) {
                const propKey = k as `p:${string}`;
                const selectedVals = filters.props?.[prop.id] ?? [];
                const togglePropFilter = (val: string): void => {
                  const next = selectedVals.includes(val)
                    ? selectedVals.filter((x) => x !== val)
                    : [...selectedVals, val];
                  onFiltersChange({ props: { ...(filters.props ?? {}), [prop.id]: next } });
                };
                return (
                  <PropertyHeaderCell
                    key={k}
                    property={prop}
                    ariaColIndex={i + 3}
                    onRename={canEdit ? (name) => customProps.renameProperty(prop.id, name) : undefined}
                    onRemove={canEdit ? () => customProps.removeProperty(prop.id) : undefined}
                    onDuplicate={canEdit ? () => customProps.duplicateProperty(prop) : undefined}
                    onInsert={canEdit ? (side) => customProps.insertProperty(prop, side) : undefined}
                    onChangeType={canEdit ? (t) => customProps.changeType(prop.id, t) : undefined}
                    onResizeStart={canEdit ? (e) => startResize(k, e) : undefined}
                    onResizeBy={canEdit ? (delta) => resizeBy(k, delta) : undefined}
                    colKey={k}
                    dropSide={dropSide}
                    onColDragStart={canEdit ? startColDrag(k) : undefined}
                    consumeColDragged={consumeColDragged}
                    // Notion-меню колонки: сортировка ↑↓ / Фильтр ▸ / Группировать.
                    sorted={sort?.key === propKey ? sort.dir : null}
                    onSort={(dir) =>
                      dir === null ? onSortChange(null) : onSortChange({ key: propKey, dir })
                    }
                    filterOptions={
                      prop.type === 'select' || prop.type === 'multi_select'
                        ? prop.options.map((o) => ({
                            id: o.id,
                            label: o.label,
                            checked: selectedVals.includes(o.id),
                            onToggle: () => togglePropFilter(o.id),
                          }))
                        : prop.type === 'checkbox'
                          ? [
                              {
                                id: '1',
                                label: 'Отмечено',
                                checked: selectedVals.includes('1'),
                                onToggle: () => togglePropFilter('1'),
                              },
                              {
                                id: '',
                                label: 'Не отмечено',
                                checked: selectedVals.includes(''),
                                onToggle: () => togglePropFilter(''),
                              },
                            ]
                          : prop.type === 'person'
                            ? customProps.members.map((m) => ({
                                id: m.id,
                                label: m.displayName,
                                checked: selectedVals.includes(m.id),
                                onToggle: () => togglePropFilter(m.id),
                              }))
                            : undefined
                    }
                    grouped={grouping === propKey}
                    onToggleGroup={
                      prop.type === 'select' && onGroupingChange
                        ? () => onGroupingChange(grouping === propKey ? null : propKey)
                        : undefined
                    }
                    onHide={canEdit ? () => onToggleCol(k) : undefined}
                    openMenu={openPropertyMenuId === prop.id}
                    onOpenMenuClosed={() =>
                      setOpenPropertyMenuId((current) => (current === prop.id ? null : current))
                    }
                  />
                );
              }
              const c = k as ViewColumn;
              return (
                <HeaderCell
                  key={k}
                  label={VIEW_COLUMN_LABELS[c]}
                  ariaColIndex={i + 3}
                  iconNode={<ColumnIcon col={c} />}
                  sortKey={COLUMN_SORT_KEY[c] ?? null}
                  sort={sort}
                  onSortChange={onSortChange}
                  onHide={canEdit ? () => onToggleCol(c) : undefined}
                  filterEntries={filterEntriesFor(c)}
                  onResizeStart={canEdit ? (e) => startResize(c, e) : undefined}
                  onResizeBy={canEdit ? (delta) => resizeBy(c, delta) : undefined}
                  colKey={k}
                  dropSide={dropSide}
                  onColDragStart={canEdit ? startColDrag(k) : undefined}
                  consumeColDragged={consumeColDragged}
                />
              );
            })}
            <div
              role="columnheader"
              aria-colindex={orderedKeys.length + 3}
              className="h-12 border-b border-l bg-muted/25"
              aria-label="Действия таблицы"
            />
            {/* Хвост шапки (Notion): «+» сразу создаёт колонку, плавно доводит
                горизонтальный scroller до неё и открывает её меню; «⋯» —
                «Видимость свойств» (глазки/поиск/Скрыть все). */}
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
              <button
                type="button"
                aria-label="Добавить свойство"
                title={canEdit ? 'Добавить свойство' : 'Недостаточно прав для добавления свойства'}
                onClick={() => void createPropertyFromHeader()}
                disabled={!canEdit || creatingProperty}
                className="grid size-10 place-items-center rounded-[10px] text-muted-foreground/70 transition-[background-color,color,transform] hover:bg-accent hover:text-foreground active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none"
              >
                {creatingProperty ? (
                  <Loader2 className="size-[18px] animate-spin motion-reduce:animate-none" />
                ) : (
                  <Plus className="size-[18px]" />
                )}
              </button>
              {canEdit && <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Видимость свойств"
                    title="Видимость свойств"
                    className="grid size-10 place-items-center rounded-[10px] text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MoreHorizontal className="size-[18px]" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-auto p-2">
                  <p className="px-1 pb-1.5 text-sm font-semibold">Видимость свойств</p>
                  <PropertyVisibilityPanel
                    items={visibilityItems}
                    hidden={hiddenCols}
                    onToggle={onToggleCol}
                    onSetHidden={onSetHiddenCols}
                    onReorder={(keys) => onTableState({ colOrder: keys })}
                  />
                </PopoverContent>
              </Popover>}
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* Тело таблицы: full-bleed гор. скролл (Notion) — колонки уезжают под края
          страницы; scrollLeft транслируется в шапку. */}
      <div
        ref={bodyScrollRef}
        onScroll={(e) => {
          if (headScrollRef.current)
            headScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
          rememberTableScroll(e.currentTarget.scrollLeft);
        }}
        data-pf-table-scroll="body"
        className="overflow-x-auto overscroll-x-contain"
      >
        {/* w-max min-w-full — см. комментарий у шапки (sticky-freeze «Название»). */}
        <div className="w-max min-w-full">
          {(grouping && groups
            ? // При группировке дерево отключено — плоские строки внутри групп.
              (groups.flatMap((g) => {
                const sample = g.tasks[0];
                return [
                  <div
                    key={`__group-${g.key}`}
                    className="flex items-center gap-1.5 px-1 pb-1 pt-3"
                  >
                    <button
                      type="button"
                      aria-label={collapsedGroups.has(g.key) ? 'Развернуть группу' : 'Свернуть группу'}
                      onClick={() => toggleGroup(g.key)}
                      className="grid size-11 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground sm:size-5"
                    >
                      <ChevronDown
                        className={cn('size-3.5 transition-transform', collapsedGroups.has(g.key) && '-rotate-90')}
                      />
                    </button>
                    <span className="text-sm font-medium">
                      {groupProp
                        ? g.key === 'none'
                          ? 'Без значения'
                          : (groupProp.options.find((o) => o.id === g.key)?.label ?? g.key)
                        : groupLabelFor(g.key, grouping as StandardGrouping, sample)}
                    </span>
                    <span className="text-xs text-muted-foreground">{g.tasks.length}</span>
                    {canEdit && grouping !== 'assignee' && (
                      <button
                        type="button"
                        aria-label="Создать задачу в группе"
                        title="Создать задачу в группе"
                        onClick={() =>
                          setDrawer({
                            mode: 'create',
                            status: grouping === 'status' ? (g.key as Task['status']) : 'backlog',
                          })
                        }
                        className="grid size-11 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground sm:size-5"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    )}
                  </div>,
                  ...(collapsedGroups.has(g.key)
                    ? []
                    : g.tasks.map((t) => ({ task: t, depth: 0, hasChildren: false }))),
                ];
              }) as (React.ReactElement | TreeRow)[])
            : buildTreeRows(rows, expandedTasks)
          ).map((item) => {
            if (!(typeof item === 'object' && 'task' in item)) return item;
            const { task, depth, hasChildren } = item as TreeRow;
            const idx = rows.indexOf(task);
            return (
            <Fragment key={task.id}>
              {insertAt?.taskId === task.id && insertAt.above && !insertAt.asSub && (
                <InsertRow
                  gridStyle={gridStyle}
                  onSubmit={(title) => void submitInsert(task, true, title)}
                  onCancel={() => setInsertAt(null)}
                />
              )}
              <TableRow
                task={task}
                gridStyle={gridStyle}
                orderedKeys={orderedKeys}
                customProps={customProps}
                depth={depth}
                hasChildren={hasChildren}
                expanded={expandedTasks.has(task.id)}
                onToggleExpand={() => toggleExpand(task.id)}
                wrapTitle={tableState.wrapTitle}
                dndEnabled={canEdit && canReorder}
                canEdit={canEdit}
                recentlyMoved={recentlyMovedId === task.id}
                rowColor={rowColorFor(task, colorRules)}
                frozenTitle={tableState.freezeTitle}
                editing={editingId === task.id}
                editPending={editPendingId === task.id}
                editError={editingId === task.id ? editError : null}
                editValue={editValue}
                onEditValue={setEditValue}
                onStartEdit={() => {
                  if (!canEdit) {
                    setDrawer({ mode: 'edit', task });
                    return;
                  }
                  setEditingId(task.id);
                  setEditValue(taskTitle(task));
                  setEditError(null);
                }}
                onCommitEdit={() => void commitEdit(task)}
                onCommitEnter={() => commitEditAndMoveDown(task)}
                onCancelEdit={() => {
                  if (editPendingId === task.id) return;
                  setEditingId(null);
                  setEditError(null);
                }}
                selected={selected.has(task.id)}
                anySelected={selected.size > 0}
                bulkEntries={
                  canEdit && selected.size > 1 && selected.has(task.id) ? bulkMenuEntries() : undefined
                }
                rowIdx={idx}
                onCellDown={cellDown}
                onCellEnter={cellEnter}
                rangeClassFor={rangeClassFor}
                selectionActive={selRange !== null || selected.size > 0}
                onContextMenuOpenChange={handleContextMenuOpenChange}
                preserveContextMenuSelection={preserveContextMenuSelection}
                consumeContextMenuDismissClick={consumeContextMenuDismissClick}
                onToggleSelected={(shift) => toggleWithRange(idx, shift)}
                onOpen={() => setDrawer({ mode: 'edit', task })}
                onCreateBelow={(above) => setInsertAt({ taskId: task.id, above })}
                onAddSub={() => setInsertAt({ taskId: task.id, above: false, asSub: true })}
                onSaveTemplate={() =>
                  void taskTemplateRepository
                    .create(projectId, {
                      name: taskTitle(task).slice(0, 64),
                      description: task.description ?? '',
                      status: task.status,
                      priority: task.priority,
                      icon: task.icon,
                    })
                    .then(() => toast.success('Шаблон сохранён — доступен в меню «Создать ▾»'))
                    .catch((e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`))
                }
                onStatus={(s) =>
                  void move(task.id, { targetStatus: s, beforeTaskId: null, afterTaskId: null }).catch(
                    (e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`),
                  )
                }
                onPriority={(p) =>
                  void update(task.id, { priority: p }).catch((e: unknown) =>
                    toast.error(`Не удалось: ${(e as Error).message}`),
                  )
                }
                onDeadline={(d) =>
                  void update(task.id, { deadline: d }).catch((e: unknown) =>
                    toast.error(`Не удалось: ${(e as Error).message}`),
                  )
                }
                onStartDate={(d) =>
                  void update(task.id, { startDate: d }).catch((e: unknown) =>
                    toast.error(`Не удалось: ${(e as Error).message}`),
                  )
                }
                onDuplicate={() =>
                  void create({
                    description: task.description ?? '',
                    status: task.status,
                    deadline: task.deadline ?? undefined,
                    priority: task.priority ?? undefined,
                  }).catch((e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`))
                }
                onDelete={() => setDeleteIntent({ kind: 'single', task })}
                currentUserId={user?.id ?? null}
                projectId={projectId}
                onChanged={() => void refetch()}
              />
              {insertAt?.taskId === task.id && !insertAt.above && (
                <InsertRow
                  // key: после Enter цепочка переезжает под созданную строку — новый
                  // инстанс с чистым вводом.
                  key={`ins-${task.id}`}
                  gridStyle={gridStyle}
                  // Цепочка подзадач (parentId задан и якорь — прошлая подзадача):
                  // следующий сиблинг на том же уровне; первая подзадача — глубже якоря.
                  indent={
                    insertAt.asSub && (!insertAt.parentId || insertAt.parentId === task.id)
                      ? (depth + 1) * 20
                      : depth * 20
                  }
                  onSubmit={(title) => void submitInsert(task, false, title, insertAt.asSub)}
                  onCancel={() => setInsertAt(null)}
                />
              )}
            </Fragment>
            );
          })}

          {rows.length === 0 && (
            <p role="status" aria-live="polite" className="py-6 pl-[var(--pf-table-gutter)] pr-2 text-sm text-muted-foreground">
              {filters.query || hasActiveFilters(filters)
                ? 'Под фильтр ничего не попадает.'
                : 'Задач пока нет.'}
            </p>
          )}

          {/* pl-14 — под gutter контролов: «Новая задача» на уровне колонки названия,
              граница — только под контентной частью (Notion). */}
          {/* Notion New page: компактная строка 28px; Enter создаёт, закрывает ввод
              и выделяет клетку названия созданной строки. */}
          {canEdit && (
            <div role="row" className="pl-[var(--pf-table-gutter)]">
              <div className="flex h-[52px] items-center border-b">
                <NewTaskRow
                  create={async (input) => {
                    const created = await create(input);
                    setPendingSelect({ id: created.id, below: false });
                    return created;
                  }}
                  closeOnSubmit
                  className="w-full"
                />
              </div>
            </div>
          )}
          {/* Строка подсчётов (Notion Calculate): «Всего» под названием; под каждой
              колонкой — свой подсчёт по клику (появляется при наведении). */}
          <div role="row" className="group/calc grid" style={gridStyle}>
            {/* Пустая ячейка под sticky-gutter контролов. */}
            <div aria-hidden />
            <p className="px-2 pt-1.5 text-[11px] text-muted-foreground/60">
              Всего: {rows.length}
            </p>
            {orderedKeys.map((k) => {
              const prop = propByKey(k);
              return prop ? (
                <PropCalcCell
                  key={k}
                  property={prop}
                  rows={rows}
                  valueFor={customProps.valueFor}
                  value={tableState.calc[k]}
                  onChange={(v) => onTableState({ calc: { ...tableState.calc, [k]: v } })}
                />
              ) : (
                <CalcCell
                  key={k}
                  col={k as ViewColumn}
                  rows={rows}
                  value={tableState.calc[k]}
                  onChange={(v) =>
                    onTableState({ calc: { ...tableState.calc, [k]: v } })
                  }
                />
              );
            })}
            <div aria-hidden />
          </div>
        </div>
      </div>

      </div>

      {/* Призрак перетаскиваемой строки. */}
      <DragOverlay dropAnimation={null}>
        {dragTask ? (
          <div className="pointer-events-none max-w-[16rem] truncate rounded-md border bg-card px-2 py-1 text-sm font-medium shadow-lg ring-1 ring-primary/20">
            {taskTitle(dragTask)}
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>

      <ViewTaskDrawer
        state={drawer}
        onClose={() => setDrawer(null)}
        projectId={projectId}
        projectName={projectName}
        isShared={isShared}
        tasksApi={tasksApi}
        canEdit={canEdit}
      />

      {/* Плавающая панель выбранных — поверх строки вкладок (Notion). ТОЛЬКО от
          чекбоксов строк: Excel-диапазон — визуальное выделение, не выбор. */}
      {canEdit && selectedIds.length > 0 && (
        <SelectedBar
          count={selectedIds.length}
          onExit={() => setSelected(new Set())}
          onStatus={(s) => void bulk.moveToColumn(selectedIds, s).then(reportBulk('Статус'))}
          onPriority={(p) => void bulk.setPriority(selectedIds, p).then(reportBulk('Приоритет'))}
          onDeadline={(d) => void bulk.setDeadline(selectedIds, d).then(reportBulk('Срок'))}
          onDelete={() => setDeleteIntent({ kind: 'bulk', ids: [...selectedIds] })}
        />
      )}

      <ConfirmDeleteDialog
        open={deleteIntent !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleteIntent(null);
        }}
        taskLabel={deleteIntent?.kind === 'single' ? taskTitle(deleteIntent.task) : null}
        title={deleteIntent?.kind === 'bulk' ? 'Удалить выбранные задачи?' : undefined}
        description={
          deleteIntent?.kind === 'bulk'
            ? `${deleteIntent.ids.length} задач будут удалены безвозвратно.`
            : undefined
        }
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

// Заголовок колонки: клик — меню (сортировка ↑↓, скрыть свойство). Стрелка в заголовке
// показывает активную сортировку по этой колонке.
function HeaderCell({
  label,
  iconNode,
  ariaColIndex,
  sortKey,
  sort,
  onSortChange,
  onHide,
  filterEntries,
  extraEntries,
  onResizeStart,
  onResizeBy,
  first = false,
  frozen = false,
  colKey,
  dropSide = null,
  onColDragStart,
  consumeColDragged,
}: {
  label: string;
  iconNode: React.ReactNode;
  ariaColIndex: number;
  sortKey: ViewSortKey | null;
  sort: ViewSort | null;
  onSortChange: (s: ViewSort | null) => void;
  onHide?: () => void;
  filterEntries?: MenuEntry[];
  extraEntries?: MenuEntry[];
  onResizeStart?: (e: React.MouseEvent) => void;
  onResizeBy?: (delta: number) => void;
  first?: boolean;
  frozen?: boolean;
  // Drag-перестановка колонки (Notion): pointerdown стартует трекинг у родителя,
  // клик без движения открывает меню (consumeColDragged гасит клик после drag'а).
  colKey?: string;
  dropSide?: 'left' | 'right' | null;
  onColDragStart?: (e: React.PointerEvent) => void;
  consumeColDragged?: () => boolean;
}): React.ReactElement {
  const sorted = sortKey !== null && sort?.key === sortKey ? sort.dir : null;
  const entries: MenuEntry[] = [
    ...(filterEntries
      ? ([
          { kind: 'sub', label: 'Фильтр', icon: ListFilter, items: filterEntries },
          { kind: 'separator' },
        ] as MenuEntry[])
      : []),
    ...(sortKey !== null
      ? ([
          {
            kind: 'item',
            label: 'По возрастанию',
            icon: ArrowUp,
            checked: sorted === 'asc',
            onSelect: () => onSortChange({ key: sortKey, dir: 'asc' }),
          },
          {
            kind: 'item',
            label: 'По убыванию',
            icon: ArrowDown,
            checked: sorted === 'desc',
            onSelect: () => onSortChange({ key: sortKey, dir: 'desc' }),
          },
          ...(sorted !== null
            ? ([
                {
                  kind: 'item',
                  label: 'Убрать сортировку',
                  muted: true,
                  onSelect: () => onSortChange(null),
                },
              ] as MenuEntry[])
            : []),
        ] as MenuEntry[])
      : []),
    ...(extraEntries ?? []),
    ...(onHide
      ? ([
          ...(sortKey !== null ? ([{ kind: 'separator' }] as MenuEntry[]) : []),
          { kind: 'item', label: 'Скрыть в отображении', icon: EyeOff, onSelect: onHide },
        ] as MenuEntry[])
      : []),
  ];
  // ПКМ по заголовку открывает то же меню колонки, что и клик (Notion).
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      role="columnheader"
      aria-colindex={ariaColIndex}
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : sortKey ? 'none' : undefined}
      data-colkey={colKey}
      className={cn(
        'relative flex h-12 min-w-0 border-b bg-muted/25',
        !first && 'border-l',
        // «Закрепить колонку» (Notion Freeze): липнет при горизонтальном скролле.
        frozen && 'sticky left-[var(--pf-table-gutter)] z-20 border-r bg-background',
        // Индикатор вставки при drag-переносе колонки.
        dropSide === 'left' && 'shadow-[inset_2px_0_0_hsl(var(--primary))]',
        dropSide === 'right' && 'shadow-[inset_-2px_0_0_hsl(var(--primary))]',
      )}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuOpen(true);
            }}
            // Drag колонки: pointerdown гасит Radix-открытие на pointerdown,
            // меню открывает click (если drag'а не было).
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
            {iconNode}
            <span className="truncate">{label}</span>
            {sorted === 'asc' && <ArrowUp className="size-3 shrink-0" />}
            {sorted === 'desc' && <ArrowDown className="size-3 shrink-0" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[11rem]">
          <DropdownEntries entries={entries} />
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Ручка resize на правой кромке (Notion): drag меняет ширину колонки. */}
      {onResizeStart && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={`Изменить ширину колонки ${label}`}
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
    </div>
  );
}

// Inline-строка вставки новой задачи над/под конкретной строкой (Notion «+»):
// Enter — создать, Esc/пустой blur — убрать.
function InsertRow({
  gridStyle,
  indent = 0,
  onSubmit,
  onCancel,
}: {
  gridStyle: React.CSSProperties;
  indent?: number;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [value, setValue] = useState('');
  return (
    <div role="row" style={gridStyle} className="grid min-h-[52px] border-b bg-accent/30">
      {/* Gutter без фона строки вставки. */}
      <div className="bg-background" aria-hidden />
      <div
        role="gridcell"
        className="flex min-h-[52px] items-center gap-2 px-4 py-2"
        style={indent > 0 ? { paddingLeft: 16 + indent } : undefined}
      >
        <FileText className="size-4 shrink-0 text-muted-foreground/40" />
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit(value);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          onBlur={() => (value.trim() ? onSubmit(value) : onCancel())}
          placeholder="Название задачи…"
          aria-label="Название новой задачи"
          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/50"
        />
      </div>
    </div>
  );
}

// Есть ли значение свойства у задачи (для подсчётов «Заполнено/Пусто»).
function hasValue(task: Task, col: ViewColumn): boolean {
  switch (col) {
    case 'status':
      return true;
    case 'priority':
      return task.priority !== null && task.priority !== undefined;
    case 'deadline':
      return Boolean(task.deadline);
    case 'assignee':
      return true;
    case 'created':
      return true;
  }
}

// Ячейка подсчёта под колонкой (Notion Calculate): «Подсчёт ⌄» при наведении → меню;
// выбранный подсчёт показывается всегда.
function CalcCell({
  col,
  rows,
  value,
  onChange,
}: {
  col: ViewColumn;
  rows: readonly Task[];
  value: ViewCalc | undefined;
  onChange: (v: ViewCalc | undefined) => void;
}): React.ReactElement {
  const filled = rows.filter((t) => hasValue(t, col)).length;
  const text = (v: ViewCalc): string => {
    switch (v) {
      case 'count':
        return `Всего ${rows.length}`;
      case 'notEmpty':
        return `Заполнено ${filled}`;
      case 'empty':
        return `Пусто ${rows.length - filled}`;
      case 'pctNotEmpty':
        return rows.length === 0 ? '—' : `${Math.round((filled / rows.length) * 100)}%`;
      default:
        return '—'; // sum/avg — только числовые кастомные (PropCalcCell)
    }
  };
  const entries: MenuEntry[] = [
    { kind: 'item', label: 'Нет', muted: true, onSelect: () => onChange(undefined) },
    ...(Object.keys(VIEW_CALC_LABELS) as ViewCalc[])
      .filter((v) => v !== 'sum' && v !== 'avg')
      .map((v) => ({
        kind: 'item' as const,
        label: VIEW_CALC_LABELS[v],
        checked: value === v,
        onSelect: () => onChange(v),
      })),
  ];
  return (
    <div role="gridcell" className="flex min-h-14 items-center justify-end border-l border-transparent px-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1 rounded px-1 text-[11px] transition-opacity hover:bg-accent',
              value
                ? 'text-muted-foreground'
                : 'text-muted-foreground/60 opacity-0 group-hover/calc:opacity-100',
            )}
          >
            {value ? text(value) : 'Подсчёт'}
            <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[10rem]">
          <DropdownEntries entries={entries} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ColumnIcon({ col }: { col: ViewColumn }): React.ReactElement {
  const cls = 'size-3.5 text-muted-foreground/70';
  switch (col) {
    case 'status':
      return <CircleDot className={cls} />;
    case 'priority':
      return <Flag className={cls} />;
    case 'deadline':
      return <CalendarDays className={cls} />;
    case 'assignee':
      return <User className={cls} />;
    case 'created':
      return <Clock className={cls} />;
  }
}

// Подсчёт под КАСТОМНОЙ колонкой (Notion Calculate): Всего/Заполнено/Пусто/%,
// для числового свойства — ещё Сумма/Среднее.
function PropCalcCell({
  property,
  rows,
  valueFor,
  value,
  onChange,
}: {
  property: TaskProperty;
  rows: readonly Task[];
  valueFor: (taskId: string, propertyId: string) => string;
  value: ViewCalc | undefined;
  onChange: (v: ViewCalc | undefined) => void;
}): React.ReactElement {
  const isEmpty = (raw: string): boolean => {
    if (!raw) return true;
    if (property.type === 'multi_select') {
      try {
        return (JSON.parse(raw) as string[]).length === 0;
      } catch {
        return true;
      }
    }
    return false;
  };
  const vals = rows.map((t) => valueFor(t.id, property.id));
  const filled = vals.filter((v) => !isEmpty(v)).length;
  const nums = property.type === 'number' ? vals.filter((v) => v !== '').map((v) => parseFloat(v) || 0) : [];
  const fmt = (n: number): string =>
    Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
  const text = (v: ViewCalc): string => {
    switch (v) {
      case 'count':
        return `Всего ${rows.length}`;
      case 'notEmpty':
        return `Заполнено ${filled}`;
      case 'empty':
        return `Пусто ${rows.length - filled}`;
      case 'pctNotEmpty':
        return rows.length === 0 ? '—' : `${Math.round((filled / rows.length) * 100)}%`;
      case 'sum':
        return `Сумма ${fmt(nums.reduce((s, n) => s + n, 0))}`;
      case 'avg':
        return nums.length === 0 ? '—' : `Среднее ${fmt(nums.reduce((s, n) => s + n, 0) / nums.length)}`;
    }
  };
  const available = (Object.keys(VIEW_CALC_LABELS) as ViewCalc[]).filter(
    (v) => (v !== 'sum' && v !== 'avg') || property.type === 'number',
  );
  const entries: MenuEntry[] = [
    { kind: 'item', label: 'Нет', muted: true, onSelect: () => onChange(undefined) },
    ...available.map((v) => ({
      kind: 'item' as const,
      label: VIEW_CALC_LABELS[v],
      checked: value === v,
      onSelect: () => onChange(v),
    })),
  ];
  return (
    <div role="gridcell" className="flex min-h-14 items-center justify-end border-l border-transparent px-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1 rounded px-1 text-[11px] transition-opacity hover:bg-accent',
              value
                ? 'text-muted-foreground'
                : 'text-muted-foreground/60 opacity-0 group-hover/calc:opacity-100',
            )}
          >
            {value ? text(value) : 'Подсчёт'}
            <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[10rem]">
          <DropdownEntries entries={entries} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function TableRow({
  task,
  gridStyle,
  orderedKeys,
  depth = 0,
  hasChildren = false,
  expanded = false,
  onToggleExpand,
  wrapTitle,
  dndEnabled,
  canEdit,
  recentlyMoved,
  rowColor,
  frozenTitle,
  editing,
  editPending,
  editError,
  editValue,
  onEditValue,
  onStartEdit,
  onCommitEdit,
  onCommitEnter,
  onCancelEdit,
  selected,
  anySelected,
  bulkEntries,
  rowIdx,
  onCellDown,
  onCellEnter,
  rangeClassFor,
  selectionActive,
  onContextMenuOpenChange,
  preserveContextMenuSelection,
  consumeContextMenuDismissClick,
  onToggleSelected,
  onOpen,
  onCreateBelow,
  onAddSub,
  onSaveTemplate,
  onStatus,
  onPriority,
  onDeadline,
  onStartDate,
  onDuplicate,
  onDelete,
  currentUserId,
  projectId,
  onChanged,
  customProps,
}: {
  task: Task;
  gridStyle: React.CSSProperties;
  // Порядок колонок (стандартные + `p:<id>`) — единый с шапкой (drag-reorder).
  orderedKeys: readonly string[];
  depth?: number;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  wrapTitle: boolean;
  dndEnabled: boolean;
  canEdit: boolean;
  recentlyMoved: boolean;
  rowColor: string | null;
  frozenTitle: boolean;
  editing: boolean;
  editPending: boolean;
  editError: string | null;
  editValue: string;
  onEditValue: (v: string) => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  // Enter — Excel-коммит: выделение переходит на клетку ниже.
  onCommitEnter: () => void;
  onCancelEdit: () => void;
  selected: boolean;
  anySelected: boolean;
  // ПКМ по строке из мульти-выбора: bulk-меню над всеми выбранными (Notion).
  bulkEntries?: MenuEntry[];
  rowIdx: number;
  onCellDown: (row: number, col: string, rightButton?: boolean) => void;
  onCellEnter: (row: number, col: string) => void;
  rangeClassFor: (row: number, col: string) => string | null;
  selectionActive: boolean;
  onContextMenuOpenChange: (open: boolean) => void;
  preserveContextMenuSelection: () => boolean;
  consumeContextMenuDismissClick: () => boolean;
  onToggleSelected: (shift: boolean) => void;
  onOpen: () => void;
  onCreateBelow: (above: boolean) => void;
  onAddSub: () => void;
  onSaveTemplate: () => void;
  onStatus: (s: TaskStatus) => void;
  onPriority: (p: TaskPriority | null) => void;
  onDeadline: (d: string | null) => void;
  onStartDate: (d: string | null) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  currentUserId: string | null;
  projectId: string;
  onChanged: () => void;
  customProps: UseTaskPropertiesResult;
}): React.ReactElement {
  // Дроп-зона (вставка ПЕРЕД этой строкой — синяя линия сверху) + драг за «⋮⋮».
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: task.id, disabled: !dndEnabled });
  const {
    attributes: dragAttrs,
    listeners: dragListeners,
    setNodeRef: dragRef,
    isDragging,
  } = useDraggable({ id: task.id, disabled: !dndEnabled });
  const [gripMenuOpen, setGripMenuOpen] = useState(false);
  // Ячейка помечена data-cell: mousedown ловится capture'ом на строке (см. ниже) —
  // выделение стартует с ЛЮБОГО места ячейки, включая кнопки-значения (Notion/Excel);
  // зажатая кнопка + движение по ячейкам растягивает диапазон.
  const cellProps = (
    col: ViewColumn,
  ): {
    className: string;
    role: 'gridcell';
    'aria-colindex': number;
    'data-cell': string;
    tabIndex: number;
    onMouseEnter: () => void;
  } => ({
    // Без внутренних отступов: значение-кнопка занимает ВСЮ клетку, hover
    // подсвечивает её от края до края (Notion).
    className: cn('relative flex min-h-[52px] border-b border-l', rangeClassFor(rowIdx, col)),
    role: 'gridcell',
    'aria-colindex': orderedKeys.indexOf(col) + 3,
    'data-cell': col,
    tabIndex: -1,
    onMouseEnter: () => onCellEnter(rowIdx, col),
  });

  const cellFor = (col: ViewColumn): React.ReactElement => {
    switch (col) {
      case 'status':
        return (
          <div key={col} {...cellProps('status')}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={!canEdit}
                  aria-label={`Изменить статус задачи «${taskTitle(task)}». Сейчас: ${STATUS_LABEL[task.status]}`}
                  className="flex h-full min-h-[52px] w-full items-center gap-1 px-4 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
                >
                  {/* Значение статуса — цветная пилюля (Notion select pill). */}
                  <span
                    className={cn(
                      'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5',
                      STATUS_PILL[task.status],
                    )}
                  >
                    <span className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[task.status])} />
                    <span className="truncate">{STATUS_LABEL[task.status]}</span>
                  </span>
                  <ChevronDown className="size-3 shrink-0 opacity-0 group-hover:opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[10rem]">
                {VISIBLE_KANBAN_STATUSES.map((s) => (
                  <DropdownMenuItem key={s} className="gap-2" onClick={() => onStatus(s)}>
                    <span className={cn('size-2 rounded-full', STATUS_DOT[s])} />
                    {STATUS_LABEL[s]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      case 'priority':
        return (
          <div key={col} {...cellProps('priority')}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={!canEdit}
                  aria-label={`Изменить приоритет задачи «${taskTitle(task)}»`}
                  className="flex h-full min-h-[52px] w-full items-center gap-1.5 px-4 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
                >
                  {task.priority !== null && task.priority !== undefined ? (
                    <span
                      className={cn(
                        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5',
                        PRIORITY_PILL[task.priority],
                      )}
                    >
                      <span
                        className={cn('size-2 shrink-0 rounded-full', PRIORITY_META[task.priority].dotColor)}
                      />
                      <span className="truncate">{PRIORITY_META[task.priority].label}</span>
                    </span>
                  ) : // Пустое значение — чистая ячейка (Notion): значение появляется по клику.
                  null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[10rem]">
                {TASK_PRIORITIES.map((p) => (
                  <DropdownMenuItem key={p} className="gap-2" onClick={() => onPriority(p)}>
                    <span className={cn('size-2 rounded-full', PRIORITY_META[p].dotColor)} />
                    {PRIORITY_META[p].label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-muted-foreground" onClick={() => onPriority(null)}>
                  Без приоритета
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      case 'deadline':
        return (
          <div key={col} {...cellProps('deadline')}>
            <DeadlineCell task={task} onDeadline={onDeadline} readOnly={!canEdit} />
          </div>
        );
      case 'assignee':
        return (
          <div key={col} {...cellProps('assignee')}>
            <AssigneeTaskButton
              task={task}
              onChanged={onChanged}
              projectId={projectId}
              disabled={!currentUserId || !canEdit}
              className="h-full min-h-[52px] w-full justify-start rounded-none px-4 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset"
            />
          </div>
        );
      case 'created':
        // Только чтение: создатель относится к метаданным создания, а не к назначению.
        return (
          <div key={col} {...cellProps('created')}>
            <TaskCreatedValue
              task={task}
              dateLabel={CREATED_FMT.format(task.createdAt)}
              className="min-h-[52px] w-full px-4"
            />
          </div>
        );
    }
  };

  const menuEntries: MenuEntry[] = canEdit
    ? taskMenuEntries(task, projectId, {
        onOpen,
        onStatus,
        onPriority,
        onDeadline,
        onStartDate,
        onDuplicate,
        onDelete,
        onAddSub,
        onSaveTemplate,
      })
    : [{ kind: 'item', label: 'Открыть', icon: PanelRight, onSelect: onOpen }];

  return (
    <ContextMenu onOpenChange={onContextMenuOpenChange}>
      <ContextMenuTrigger asChild>
        <div
          ref={dropRef}
          data-pf-task-id={task.id}
          role="row"
          aria-rowindex={rowIdx + 2}
          aria-selected={selected}
          aria-label={`Задача: ${taskTitle(task)}`}
          style={gridStyle}
          // Capture: якорь Excel-выделения ставится с любого места ячейки (включая
          // кнопки-значения — Notion выделяет ячейку и при открытии её редактора).
          // ПКМ тоже участвует: внутрь диапазона — выбор его строк, мимо — одной.
          onMouseDownCapture={(e) => {
            if (e.button !== 0 && e.button !== 2) return;
            if (e.button === 0 && preserveContextMenuSelection()) return;
            const cellEl = (e.target as HTMLElement).closest('[data-cell]');
            const key = cellEl?.getAttribute('data-cell');
            if (key) onCellDown(rowIdx, key as 'title' | ViewColumn, e.button === 2);
          }}
          // Пока ничего не выбрано, первый pointerdown начинает диапазон и не открывает
          // Radix-редактор. Если диапазон/строки уже выбраны, событие проходит в ячейку:
          // mousedown снимает выбор, а этот же клик сразу открывает редактор. Первый клик
          // вне открытого context menu только закрывает меню и поглощается целиком.
          onPointerDownCapture={(e) => {
            if (e.button !== 0) return;
            if (preserveContextMenuSelection()) {
              e.stopPropagation();
              return;
            }
            const cellEl = (e.target as HTMLElement).closest('[data-cell]');
            const key = cellEl?.getAttribute('data-cell');
            if (!key || key === 'title' || key === 'created') return;
            if (selectionActive) return;
            e.stopPropagation();
          }}
          onClickCapture={(e) => {
            if (!consumeContextMenuDismissClick()) return;
            e.preventDefault();
            e.stopPropagation();
          }}
          className={cn(
            // Границы — на ячейках (см. cellProps/title): зона контролов слева чистая.
            'group relative grid min-h-[52px] transition-colors hover:bg-accent/40 focus-within:bg-accent/30 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring/50',
            // Условный цвет (Notion Conditional color) — до selected/moved подсветок.
            rowColor,
            selected && 'bg-primary/5',
            isDragging && 'opacity-40',
            // Синяя линия сверху — сюда вставится перетаскиваемая строка (Notion).
            isOver && 'shadow-[inset_0_2px_0_0_hsl(var(--primary))]',
            // Только что перемещена — синее выделение до клика в стороне (как на канбане).
            recentlyMoved && 'bg-primary/5 ring-2 ring-inset ring-primary/60',
          )}
        >
      {/* Gutter строки (Notion): «+»/«⋮⋮»/чекбокс. Sticky — только при закреплённом
          «Названии»; иначе едет вместе с таблицей. Фон — на ячейке ВСЕГДА (иначе
          уезжающий текст просвечивает), прозрачность до hover — только на контролах. */}
      <div
        role="gridcell"
        aria-colindex={1}
        className={cn('bg-background', frozenTitle && 'sticky left-0 z-20')}
      >
      <div
        className={cn(
          'flex h-full items-center justify-end gap-0 pr-1 transition-opacity duration-100',
          selected || anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100',
        )}
      >
        {canEdit && (
          <button
            type="button"
            aria-label="Добавить задачу ниже (Alt — выше)"
            title="Добавить задачу ниже (Alt — выше)"
            onClick={(e) => onCreateBelow(e.altKey)}
            className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground max-sm:hidden"
          >
            <Plus className="size-3.5" />
          </button>
        )}
        <DropdownMenu open={gripMenuOpen} onOpenChange={setGripMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              ref={dragRef}
              {...dragAttrs}
              {...dragListeners}
              aria-label="Меню задачи (drag — перенос)"
              title="Меню задачи (drag — перенос)"
              onPointerDown={(e) => {
                // Гасим pointerdown-открытие Radix (иначе drag открывал бы меню);
                // dnd-kit слушает свой pointerdown из listeners выше.
                dragListeners?.onPointerDown?.(e);
                e.preventDefault();
              }}
              onClick={(e) => {
                if (e.defaultPrevented) return; // click после drag
                setGripMenuOpen(true);
              }}
              className="grid size-11 cursor-grab place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing sm:size-5"
            >
              <GripVertical className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[12rem]">
            <DropdownEntries entries={menuEntries} />
          </DropdownMenuContent>
        </DropdownMenu>
        <label className="grid size-11 place-items-center sm:size-4">
          <input
            type="checkbox"
            checked={selected}
            disabled={!canEdit}
            onChange={() => undefined}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelected(e.shiftKey);
            }}
            aria-label="Выбрать задачу"
            className={cn(
              'size-3.5 cursor-pointer accent-primary',
              !canEdit && 'invisible',
            )}
          />
        </label>
      </div>
      </div>

      {/* Название: иконка + заголовок; клик по тексту — inline-правка (Notion: клик по
          ячейке редактирует, открытие — кнопкой «ОТКРЫТЬ»). Отступ и стрелка — дерево
          подзадач (Notion sub-items). */}
      <div
        role="gridcell"
        aria-colindex={2}
        data-cell="title"
        tabIndex={-1}
        className={cn(
          'relative flex min-h-[52px] min-w-0 items-center gap-2 border-b px-4 py-2',
          // Freeze: липнет ПОСЛЕ sticky-gutter'а контролов (3.5rem).
          frozenTitle && 'sticky left-[var(--pf-table-gutter)] z-10 border-r bg-background',
          rangeClassFor(rowIdx, 'title'),
          // Редактирование: синяя рамка на ВСЮ клетку (Notion), не мини-инпут.
          editing && 'z-10 bg-background ring-2 ring-inset ring-primary/70',
        )}
        style={depth > 0 ? { paddingLeft: 16 + depth * 20 } : undefined}
        onMouseEnter={() => onCellEnter(rowIdx, 'title')}
      >
        {/* Редактирование (Notion): ТОЛЬКО текстовое поле — без иконки, стрелки
            подзадач и кнопки «Открыть». */}
        {editing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => onEditValue(e.target.value)}
            onBlur={() => {
              if (!editPending) onCommitEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommitEnter();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancelEdit();
              }
            }}
            aria-label="Название задачи"
            aria-invalid={Boolean(editError)}
            aria-errormessage={editError ? `table-title-error-${task.id}` : undefined}
            readOnly={editPending}
            className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none read-only:cursor-wait"
          />
        ) : (
          <>
            {hasChildren ? (
              <button
                type="button"
                aria-label={expanded ? 'Свернуть подзадачи' : 'Развернуть подзадачи'}
                title={expanded ? 'Свернуть подзадачи' : 'Развернуть подзадачи'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand?.();
                }}
                className="grid size-11 shrink-0 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground sm:size-4"
              >
                <ChevronDown
                  className={cn('size-3.5 transition-transform', !expanded && '-rotate-90')}
                />
              </button>
            ) : (
              depth > 0 && <span className="size-4 shrink-0" aria-hidden />
            )}
            {task.icon ? (
              <span className="grid size-4 shrink-0 place-items-center overflow-hidden">
                <ProjectIconView icon={task.icon} pixelSize={15} className="text-sm" />
              </span>
            ) : (
              <FileText className="size-4 shrink-0 text-muted-foreground/60" />
            )}
            <button
              type="button"
              onClick={onStartEdit}
              className={cn(
                'flex min-w-0 self-stretch items-center rounded-sm text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                wrapTitle ? 'whitespace-normal break-words' : 'truncate',
                // Notion: безымянная страница — серый плейсхолдер.
                isUntitledTask(task) && 'font-normal text-muted-foreground/60',
              )}
            >
              {taskTitle(task)}
            </button>
            <button
              type="button"
              onClick={onOpen}
              aria-label={`Открыть задачу «${taskTitle(task)}»`}
              className="invisible ml-auto inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border bg-card px-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground opacity-0 shadow-sm transition-[background-color,color,opacity] hover:bg-accent hover:text-foreground focus:visible focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 [@media(hover:none)]:visible [@media(hover:none)]:min-h-11 [@media(hover:none)]:opacity-100"
            >
              <PanelRight className="size-3" />
              Открыть
            </button>
          </>
        )}
        {editing && editPending && (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Сохранение" />
        )}
        {editing && editError && (
          <span id={`table-title-error-${task.id}`} className="sr-only">
            {editError}
          </span>
        )}
      </div>

      {/* Ячейки в едином порядке orderedKeys — совпадает с шапкой (drag-reorder). */}
      {orderedKeys.map((k) => {
        const prop = customProps.properties.find((p) => `p:${p.id}` === k);
        if (prop) {
          return (
            <PropertyValueCell
              key={k}
              property={prop}
              ariaColIndex={orderedKeys.indexOf(k) + 3}
              value={customProps.valueFor(task.id, prop.id)}
              onChange={(v) => customProps.setValue(task.id, prop.id, v)}
              onAddOption={(label) => customProps.addOption(prop, label)}
              members={customProps.members}
              dataCell={k}
              onCellMouseEnter={() => onCellEnter(rowIdx, k)}
              rangeClass={rangeClassFor(rowIdx, k)}
              readOnly={!canEdit}
            />
          );
        }
        return cellFor(k as ViewColumn);
      })}
      <div
        role="gridcell"
        aria-colindex={orderedKeys.length + 3}
        className="border-b border-l"
        aria-label=""
      />
        </div>
      </ContextMenuTrigger>
      {/* Правый клик по строке — контекстное меню задачи (Notion-style); по строке
          из мульти-выбора — bulk-меню над всеми выбранными.
          onCloseAutoFocus preventDefault: возврат фокуса крал бы фокус у inline-инпутов
          (вставка подзадачи/переименование), открытых из пункта меню. */}
      <ContextMenuContent
        className="min-w-[12rem]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <ContextEntries entries={bulkEntries ?? menuEntries} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Ячейка срока: чип с бейджем/«—», меню Сегодня/Завтра/Выбрать дату…/Убрать.
function DeadlineCell({
  task,
  onDeadline,
  readOnly = false,
}: {
  task: Task;
  onDeadline: (d: string | null) => void;
  readOnly?: boolean;
}): React.ReactElement {
  const dateRef = useRef<HTMLInputElement>(null);
  const openPicker = (): void => {
    const inp = dateRef.current;
    if (!inp) return;
    if (typeof inp.showPicker === 'function') {
      try {
        inp.showPicker();
      } catch {
        inp.focus();
      }
    } else inp.focus();
  };
  const today = ymd(startOfDay(new Date()));
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={readOnly}
            aria-label={`Изменить срок задачи «${taskTitle(task)}»`}
            className="flex h-full min-h-[52px] w-full items-center gap-1.5 px-4 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
          >
            {/* Пустой срок — чистая ячейка (Notion). */}
            {task.deadline ? <DeadlineBadge deadline={task.deadline} status={task.status} /> : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[10rem]">
          <DropdownMenuItem onClick={() => onDeadline(today)}>Сегодня</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDeadline(ymd(addDays(startOfDay(new Date()), 1)))}>
            Завтра
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openPicker}>Выбрать дату…</DropdownMenuItem>
          {task.deadline && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-muted-foreground" onClick={() => onDeadline(null)}>
                Убрать срок
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={dateRef}
        type="date"
        value={task.deadline ?? ''}
        onChange={(e) => e.target.value && onDeadline(e.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-label="Выбрать срок"
      />
    </>
  );
}

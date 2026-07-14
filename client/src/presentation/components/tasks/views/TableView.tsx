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
  MoreHorizontal,
  PanelRight,
  Plus,
  Snowflake,
  Trash2,
  User,
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
  NewPropertyForm,
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
  // «+» в шапке: открыть правую панель «Новое свойство» (сдвигает таблицу).
  onRequestNewProperty?: () => void;
  // «Скрыть все»/«Показать все» в панели «Видимость свойств».
  onSetHiddenCols?: (keys: string[]) => void;
  // Full-bleed: горизонтальный скролл таблицы во всю ширину окна (как канбан) —
  // колонки заезжают в отступы страницы (Notion).
  bleedNegClass?: string;
  bleedPadClass?: string;
};

// Координата ячейки для Excel-выделения: row — индекс в rows, col — 0 (название)
// или индекс видимой колонки + 1.
type CellCoord = { row: number; col: number };

// Ширины колонок; сетка собирается из видимых (скрытие свойств — как в Notion).
const COLUMN_WIDTH: Record<ViewColumn, string> = {
  status: '8.5rem',
  priority: '8rem',
  deadline: '8.5rem',
  assignee: '11rem',
  created: '19rem',
};
const ALL_COLUMNS: readonly ViewColumn[] = ['status', 'priority', 'deadline', 'assignee', 'created'];

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
  onRequestNewProperty,
  onSetHiddenCols,
  bleedNegClass = '',
  bleedPadClass = '',
}: Props): React.ReactElement {
  const tasksApi = useTasks(projectId);
  const { tasks, loading, error, create, update, move, remove, refetch } = tasksApi;
  const { taskTemplateRepository } = useContainer();
  // Кастомные свойства (db/109): колонки после стандартных, «+» в шапке создаёт новое.
  const customProps = useTaskProperties(projectId);
  const [addPropOpen, setAddPropOpen] = useState(false);

  // Sticky-шапка колонок: top = высота sticky-стека страницы (крошки + плашки +
  // строка вкладок); гор. скролл тела транслируется в шапку (refs ниже).
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const headScrollRef = useRef<HTMLDivElement | null>(null);
  const [headerTop, setHeaderTop] = useState(0);
  useEffect(() => {
    const els = ['pf-project-crumbs', 'pf-sticky-banners', 'pf-views-tabs-row']
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
  // Выделение ячеек как в Excel (Notion): mousedown — якорь, drag по ячейкам — диапазон.
  // Координаты: row — индекс в rows, col — 0 (название) или индекс в visibleCols + 1.
  const [selRange, setSelRange] = useState<{ a: CellCoord; h: CellCoord } | null>(null);
  const selDragging = useRef(false);
  const bulk = useBulkTaskActions({ projectId, update, move, remove, refetch });

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
        '3.5rem',
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
        'minmax(3rem,1fr)',
      ].join(' '),
    }),
    [orderedKeys, tableState.colWidths],
  );

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

  // Inline-редактирование названия по клику в ячейку (Notion: клик = правка, открыть — OPEN).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const commitEdit = (task: Task): void => {
    const title = editValue.trim();
    setEditingId(null);
    if (!title || title === taskTitle(task)) return;
    const { body } = splitTitleBody(task.description ?? '');
    void update(task.id, { description: body ? `${title}\n${body}` : title }).catch((e: unknown) =>
      toast.error(`Не удалось: ${(e as Error).message}`),
    );
  };
  // Enter в редакторе названия — как в Excel: коммит и выделение клетки ниже.
  const commitEditAndMoveDown = (task: Task): void => {
    commitEdit(task);
    const idx = rows.findIndex((t) => t.id === task.id);
    if (idx >= 0 && idx + 1 < rows.length) {
      const c = { row: idx + 1, col: 0 };
      setSelRange({ a: c, h: c });
    }
  };

  // Excel type-to-edit: при единственной выделенной клетке названия печать сразу
  // начинает ввод (замещая), Enter открывает редактор с текущим значением.
  useEffect(() => {
    if (!selRange || editingId) return;
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
  }, [selRange, rows, editingId]);

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
    if (!createRequest) return;
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
  }, [createRequest]);

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

  // Notion: клик В ЛЮБОЕ другое место (вне таблицы) сбрасывает и выбор строк,
  // и Excel-выделение. Порталы (меню/диалоги/панель «Выбрано» во вкладках) —
  // не сбрасывают: клики по ним — действия над выбранным.
  const tableRootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (tableRootRef.current?.contains(t)) return;
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

  const colIndexOf = (k: 'title' | ViewColumn): number =>
    k === 'title' ? 0 : orderedKeys.indexOf(k) + 1;
  const cellDown = (row: number, k: 'title' | ViewColumn, rightButton = false): void => {
    // Notion: при существующем диапазоне клик/ПКМ ВНУТРЬ него выбирает все его
    // строки (панель действий сверху); клик/ПКМ МИМО — только строку под курсором.
    if (selRange) {
      const [r1, r2] = [Math.min(selRange.a.row, selRange.h.row), Math.max(selRange.a.row, selRange.h.row)];
      const [c1, c2] = [Math.min(selRange.a.col, selRange.h.col), Math.max(selRange.a.col, selRange.h.col)];
      const multi = r1 !== r2 || c1 !== c2;
      if (multi) {
        const col = colIndexOf(k);
        const inRect = row >= r1 && row <= r2 && col >= c1 && col <= c2;
        setSelRange(null);
        setSelected(
          inRect
            ? new Set(rows.slice(r1, r2 + 1).map((t) => t.id))
            : new Set(rows[row] ? [rows[row].id] : []),
        );
        return;
      }
    }
    // ПКМ (вне диапазона): сброс прошлых выбранных и выбор строки под курсором.
    // Если строка УЖЕ в выборе — выбор сохраняется (действия над несколькими).
    // Протяжку диапазона ПКМ не начинает.
    if (rightButton) {
      const id = rows[row]?.id;
      setSelRange(null);
      if (id && !selected.has(id)) setSelected(new Set([id]));
      return;
    }
    selDragging.current = true;
    const c = { row, col: colIndexOf(k) };
    setSelRange({ a: c, h: c });
  };
  const cellEnter = (row: number, k: 'title' | ViewColumn): void => {
    if (!selDragging.current) return;
    // Протяжка не должна выделять текст под курсором.
    document.getSelection()?.removeAllRanges();
    setSelRange((prev) => (prev ? { a: prev.a, h: { row, col: colIndexOf(k) } } : prev));
  };
  // Клетка = ЕДИНСТВЕННАЯ активно-выделенная (диапазон 1×1 с якорем на ней). Нужно,
  // чтобы ПЕРВЫЙ клик по ячейке-«выборке» (статус/приоритет/срок/участник/select) её
  // ВЫДЕЛЯЛ (как в Excel), а не открывал выпадашку; редактор открывается ВТОРЫМ кликом
  // по уже выделенной (Notion). Так же с неё можно начать протяжку диапазона.
  const isCellActiveSingle = (row: number, k: 'title' | ViewColumn): boolean => {
    if (!selRange) return false;
    const single = selRange.a.row === selRange.h.row && selRange.a.col === selRange.h.col;
    return single && selRange.a.row === row && selRange.a.col === colIndexOf(k);
  };
  // Стиль ячейки в диапазоне: одиночная — синяя рамка с уголком (как раньше),
  // диапазон — заливка Excel-style.
  const rangeClassFor = (row: number, k: 'title' | ViewColumn): string | null => {
    if (!selRange) return null;
    const c = colIndexOf(k);
    const [r1, r2] = [Math.min(selRange.a.row, selRange.h.row), Math.max(selRange.a.row, selRange.h.row)];
    const [c1, c2] = [Math.min(selRange.a.col, selRange.h.col), Math.max(selRange.a.col, selRange.h.col)];
    if (row < r1 || row > r2 || c < c1 || c > c2) return null;
    const single = r1 === r2 && c1 === c2;
    if (single)
      return 'ring-2 ring-inset ring-primary/70 after:pointer-events-none after:absolute after:-bottom-[3px] after:-right-[3px] after:size-1.5 after:rounded-[1px] after:bg-primary';
    return cn(
      'bg-primary/10',
      row === selRange.a.row && c === selRange.a.col && 'ring-2 ring-inset ring-primary/70',
    );
  };


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
    setSelected(allSelected ? new Set() : new Set(rows.map((t) => t.id)));
  };

  const selectedIds = rows.filter((t) => selected.has(t.id)).map((t) => t.id);

  const reportBulk = (label: string) => (res: BulkResult) => {
    if (res.failed > 0) toast.error(`${label}: ${res.ok} из ${res.ok + res.failed}`);
    setSelected(new Set());
    setSelRange(null);
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
        onSelect: () => void bulk.remove(selectedIds).then(reportBulk('Удаление')),
      },
    ];
  };

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-muted/60" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  const innerPadClass = bleedPadClass ? 'pr-6 sm:pr-14 lg:pl-10 lg:pr-24' : 'pr-8';

  return (
    <div ref={tableRootRef} className="flex min-h-0 flex-1 flex-col">
      <DndContext
        sensors={dndSensors}
        collisionDetection={pointerWithin}
        onDragStart={(e) => setDragTask(rows.find((t) => t.id === String(e.active.id)) ?? null)}
        onDragEnd={handleRowDragEnd}
        onDragCancel={() => setDragTask(null)}
      >
      {/* Sticky-шапка колонок (Notion): липнет под строкой вкладок при вертикальном
          скролле; горизонтальный скролл синхронизируется с телом (onScroll ниже). */}
      <div
        className={cn('sticky z-20 bg-background', bleedNegClass)}
        style={{ top: headerTop }}
      >
        {/* Шапка скроллится и ЮЗЕРОМ (колесо/трекпад над ней), скроллбар скрыт;
            синхронизация двусторонняя (равные значения не зацикливают onScroll). */}
        <div
          ref={headScrollRef}
          onScroll={(e) => {
            if (bodyScrollRef.current)
              bodyScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
          className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
        {/* w-max: контейнер (и грид-строки в нём) растягивается на ПОЛНУЮ ширину
            колонок — иначе грид переполняет собственный бокс и sticky-«Название»
            не хватает слака внутри containing block (колонка уезжает при скролле). */}
        <div className={cn('w-max min-w-full', innerPadClass)}>
          {/* Шапка таблицы: иконка типа свойства + название; клик по заголовку —
              меню колонки (сортировка ↑↓, скрыть свойство), как в Notion. Границы —
              на ячейках, НЕ на контейнере: зона контролов слева чистая. */}
          <div
            ref={headGridRef}
            className="group/head relative grid text-sm text-muted-foreground"
            style={gridStyle}
          >
            {/* Gutter шапки с «выбрать все». Sticky — только когда «Название»
                закреплено; иначе едет вместе с таблицей (Notion: без freeze таблица
                скроллится целиком). */}
            <div
              className={cn(
                'flex items-center justify-end bg-background pr-2.5',
                tableState.freezeTitle && 'sticky left-0 z-30',
              )}
            >
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Выбрать все"
                className={cn(
                  'size-3.5 cursor-pointer accent-primary transition-opacity',
                  allSelected || selected.size > 0 ? 'opacity-100' : 'opacity-0 group-hover/head:opacity-100',
                )}
              />
            </div>
            <HeaderCell
              label="Название"
              iconNode={
                <span className="font-mono text-[11px] leading-none text-muted-foreground/70">Aa</span>
              }
              sortKey="title"
              sort={sort}
              onSortChange={onSortChange}
              extraEntries={[
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
              ]}
              frozen={tableState.freezeTitle}
              onResizeStart={(e) => startResize('title', e)}
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
                    onRename={(name) => customProps.renameProperty(prop.id, name)}
                    onRemove={() => customProps.removeProperty(prop.id)}
                    onDuplicate={() => customProps.duplicateProperty(prop)}
                    onInsert={(side) => customProps.insertProperty(prop, side)}
                    onChangeType={(t) => customProps.changeType(prop.id, t)}
                    onResizeStart={(e) => startResize(k, e)}
                    colKey={k}
                    dropSide={dropSide}
                    onColDragStart={startColDrag(k)}
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
                    onHide={() => onToggleCol(k)}
                  />
                );
              }
              const c = k as ViewColumn;
              return (
                <HeaderCell
                  key={k}
                  label={VIEW_COLUMN_LABELS[c]}
                  iconNode={<ColumnIcon col={c} />}
                  sortKey={COLUMN_SORT_KEY[c] ?? null}
                  sort={sort}
                  onSortChange={onSortChange}
                  onHide={() => onToggleCol(c)}
                  filterEntries={filterEntriesFor(c)}
                  onResizeStart={(e) => startResize(c, e)}
                  colKey={k}
                  dropSide={dropSide}
                  onColDragStart={startColDrag(k)}
                  consumeColDragged={consumeColDragged}
                />
              );
            })}
            <div className="border-b border-l border-t" aria-hidden />
            {/* Хвост шапки (Notion): «+» — новое свойство (правая панель со сдвигом
                таблицы, если родитель дал onRequestNewProperty; иначе попап),
                «⋯» — «Видимость свойств» (глазки/поиск/Скрыть все). */}
            <div className="absolute -right-14 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              {onRequestNewProperty ? (
                <button
                  type="button"
                  aria-label="Добавить свойство"
                  title="Добавить свойство"
                  onClick={onRequestNewProperty}
                  className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
              ) : (
                <Popover open={addPropOpen} onOpenChange={setAddPropOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Добавить свойство"
                      title="Добавить свойство"
                      className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-auto p-1.5">
                    <NewPropertyForm
                      onCreate={(t, name) => {
                        customProps.createProperty(t, name);
                        setAddPropOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Видимость свойств"
                    title="Видимость свойств"
                    className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <MoreHorizontal className="size-3.5" />
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
              </Popover>
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
        }}
        className={cn('overflow-x-auto', bleedNegClass)}
      >
        {/* w-max min-w-full — см. комментарий у шапки (sticky-freeze «Название»). */}
        <div className={cn('w-max min-w-full', innerPadClass)}>
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
                      className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
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
                    {grouping !== 'assignee' && (
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
                        className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
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
                dndEnabled={canReorder}
                recentlyMoved={recentlyMovedId === task.id}
                rowColor={rowColorFor(task, colorRules)}
                frozenTitle={tableState.freezeTitle}
                editing={editingId === task.id}
                editValue={editValue}
                onEditValue={setEditValue}
                onStartEdit={() => {
                  setEditingId(task.id);
                  setEditValue(taskTitle(task));
                }}
                onCommitEdit={() => commitEdit(task)}
                onCommitEnter={() => commitEditAndMoveDown(task)}
                onCancelEdit={() => setEditingId(null)}
                selected={selected.has(task.id)}
                anySelected={selected.size > 0}
                bulkEntries={
                  selected.size > 1 && selected.has(task.id) ? bulkMenuEntries() : undefined
                }
                rowIdx={idx}
                onCellDown={cellDown}
                onCellEnter={cellEnter}
                rangeClassFor={rangeClassFor}
                isCellActiveSingle={isCellActiveSingle}
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
                onDelete={() =>
                  void remove(task.id)
                    .then(() => toast.success('Задача удалена'))
                    .catch((e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`))
                }
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
            <p className="py-6 pl-14 pr-2 text-sm text-muted-foreground">
              {filters.query || hasActiveFilters(filters)
                ? 'Под фильтр ничего не попадает.'
                : 'Задач пока нет.'}
            </p>
          )}

          {/* pl-14 — под gutter контролов: «Новая задача» на уровне колонки названия,
              граница — только под контентной частью (Notion). */}
          {/* Notion New page: компактная строка 28px; Enter создаёт, закрывает ввод
              и выделяет клетку названия созданной строки. */}
          <div className="pl-14">
            <div className="flex h-7 items-center border-b">
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
          {/* Строка подсчётов (Notion Calculate): «Всего» под названием; под каждой
              колонкой — свой подсчёт по клику (появляется при наведении). */}
          <div className="group/calc grid" style={gridStyle}>
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
      />

      {/* Плавающая панель выбранных — поверх строки вкладок (Notion). ТОЛЬКО от
          чекбоксов строк: Excel-диапазон — визуальное выделение, не выбор. */}
      {selectedIds.length > 0 && (
        <SelectedBar
          count={selectedIds.length}
          onExit={() => setSelected(new Set())}
          onStatus={(s) => void bulk.moveToColumn(selectedIds, s).then(reportBulk('Статус'))}
          onPriority={(p) => void bulk.setPriority(selectedIds, p).then(reportBulk('Приоритет'))}
          onDeadline={(d) => void bulk.setDeadline(selectedIds, d).then(reportBulk('Срок'))}
          onDelete={() => void bulk.remove(selectedIds).then(reportBulk('Удаление'))}
        />
      )}
    </div>
  );
}

// Заголовок колонки: клик — меню (сортировка ↑↓, скрыть свойство). Стрелка в заголовке
// показывает активную сортировку по этой колонке.
function HeaderCell({
  label,
  iconNode,
  sortKey,
  sort,
  onSortChange,
  onHide,
  filterEntries,
  extraEntries,
  onResizeStart,
  first = false,
  frozen = false,
  colKey,
  dropSide = null,
  onColDragStart,
  consumeColDragged,
}: {
  label: string;
  iconNode: React.ReactNode;
  sortKey: ViewSortKey | null;
  sort: ViewSort | null;
  onSortChange: (s: ViewSort | null) => void;
  onHide?: () => void;
  filterEntries?: MenuEntry[];
  extraEntries?: MenuEntry[];
  onResizeStart?: (e: React.MouseEvent) => void;
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
      data-colkey={colKey}
      className={cn(
        'relative flex min-w-0 border-b border-t',
        !first && 'border-l',
        // «Закрепить колонку» (Notion Freeze): липнет при горизонтальном скролле.
        frozen && 'sticky left-14 z-20 border-r bg-background',
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
            className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
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
          aria-label={`Изменить ширину колонки ${label}`}
          onMouseDown={onResizeStart}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -right-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize rounded transition-colors hover:bg-primary/40"
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
    <div style={gridStyle} className="grid border-b bg-accent/30">
      {/* Gutter без фона строки вставки. */}
      <div className="bg-background" aria-hidden />
      <div
        className="flex items-center gap-1.5 px-2 py-1"
        style={indent > 0 ? { paddingLeft: 8 + indent } : undefined}
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
    <div className="flex justify-end border-l border-transparent px-1 pt-0.5">
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
    <div className="flex justify-end border-l border-transparent px-1 pt-0.5">
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
  recentlyMoved,
  rowColor,
  frozenTitle,
  editing,
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
  isCellActiveSingle,
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
  recentlyMoved: boolean;
  rowColor: string | null;
  frozenTitle: boolean;
  editing: boolean;
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
  onCellDown: (row: number, col: 'title' | ViewColumn, rightButton?: boolean) => void;
  onCellEnter: (row: number, col: 'title' | ViewColumn) => void;
  rangeClassFor: (row: number, col: 'title' | ViewColumn) => string | null;
  isCellActiveSingle: (row: number, col: 'title' | ViewColumn) => boolean;
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
    'data-cell': string;
    onMouseEnter: () => void;
  } => ({
    // Без внутренних отступов: значение-кнопка занимает ВСЮ клетку, hover
    // подсвечивает её от края до края (Notion).
    className: cn('relative flex border-b border-l', rangeClassFor(rowIdx, col)),
    'data-cell': col,
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
                  className="flex h-full min-h-8 w-full items-center gap-1 px-2 text-sm transition-colors hover:bg-accent"
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
                  className="flex h-full min-h-8 w-full items-center gap-1.5 px-2 text-sm transition-colors hover:bg-accent"
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
            <DeadlineCell task={task} onDeadline={onDeadline} />
          </div>
        );
      case 'assignee':
        return (
          <div key={col} {...cellProps('assignee')}>
            <AssigneeTaskButton
              task={task}
              onChanged={onChanged}
              projectId={projectId}
              disabled={!currentUserId}
              className="h-full min-h-8 w-full justify-start rounded-none px-2 text-sm hover:bg-accent"
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
              className="min-h-8 w-full px-2"
            />
          </div>
        );
    }
  };

  const menuEntries = taskMenuEntries(task, projectId, {
    onOpen,
    onStatus,
    onPriority,
    onDeadline,
    onStartDate,
    onDuplicate,
    onDelete,
    onAddSub,
    onSaveTemplate,
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={dropRef}
          style={gridStyle}
          // Capture: якорь Excel-выделения ставится с любого места ячейки (включая
          // кнопки-значения — Notion выделяет ячейку и при открытии её редактора).
          // ПКМ тоже участвует: внутрь диапазона — выбор его строк, мимо — одной.
          onMouseDownCapture={(e) => {
            if (e.button !== 0 && e.button !== 2) return;
            const cellEl = (e.target as HTMLElement).closest('[data-cell]');
            const key = cellEl?.getAttribute('data-cell');
            if (key) onCellDown(rowIdx, key as 'title' | ViewColumn, e.button === 2);
          }}
          // Первый левый клик по ячейке-«выборке» её ВЫДЕЛЯЕТ, а не открывает выпадашку:
          // гасим pointerdown ДО того, как он дойдёт до Radix-триггера значения (Radix
          // открывается на pointerdown). Выделение отработает на mousedown (выше). Если
          // ячейка УЖЕ активна (второй клик) — не мешаем: редактор открывается. Título/
          // created пропускаем (текст правится своим кликом / read-only), gutter (+/⋮⋮/
          // чекбокс) — вне [data-cell], его не трогаем (drag ручки-грипа не ломаем).
          onPointerDownCapture={(e) => {
            if (e.button !== 0) return;
            const cellEl = (e.target as HTMLElement).closest('[data-cell]');
            const key = cellEl?.getAttribute('data-cell');
            if (!key || key === 'title' || key === 'created') return;
            if (isCellActiveSingle(rowIdx, key as 'title' | ViewColumn)) return;
            e.stopPropagation();
          }}
          className={cn(
            // Границы — на ячейках (см. cellProps/title): зона контролов слева чистая.
            'group relative grid transition-colors hover:bg-accent/40',
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
      <div className={cn('bg-background', frozenTitle && 'sticky left-0 z-20')}>
      <div
        className={cn(
          'flex h-full items-center justify-end gap-0 pr-1 transition-opacity duration-100',
          selected || anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <button
          type="button"
          aria-label="Добавить задачу ниже (Alt — выше)"
          title="Добавить задачу ниже (Alt — выше)"
          onClick={(e) => onCreateBelow(e.altKey)}
          className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
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
              className="grid size-5 cursor-grab place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[12rem]">
            <DropdownEntries entries={menuEntries} />
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => undefined}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelected(e.shiftKey);
          }}
          aria-label="Выбрать задачу"
          className="ml-0.5 size-3.5 cursor-pointer accent-primary"
        />
      </div>
      </div>

      {/* Название: иконка + заголовок; клик по тексту — inline-правка (Notion: клик по
          ячейке редактирует, открытие — кнопкой «ОТКРЫТЬ»). Отступ и стрелка — дерево
          подзадач (Notion sub-items). */}
      <div
        data-cell="title"
        className={cn(
          'relative flex min-w-0 items-center gap-1.5 border-b px-2 py-1',
          // Freeze: липнет ПОСЛЕ sticky-gutter'а контролов (3.5rem).
          frozenTitle && 'sticky left-14 z-10 border-r bg-background',
          rangeClassFor(rowIdx, 'title'),
          // Редактирование: синяя рамка на ВСЮ клетку (Notion), не мини-инпут.
          editing && 'z-10 bg-background ring-2 ring-inset ring-primary/70',
        )}
        style={depth > 0 ? { paddingLeft: 8 + depth * 20 } : undefined}
        onMouseEnter={() => onCellEnter(rowIdx, 'title')}
      >
        {/* Редактирование (Notion): ТОЛЬКО текстовое поле — без иконки, стрелки
            подзадач и кнопки «Открыть». */}
        {editing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => onEditValue(e.target.value)}
            onBlur={onCommitEdit}
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
            className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
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
                className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
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
                'min-w-0 text-left text-sm font-medium',
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
              className="ml-auto hidden shrink-0 items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground group-hover:inline-flex"
            >
              <PanelRight className="size-3" />
              Открыть
            </button>
          </>
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
              value={customProps.valueFor(task.id, prop.id)}
              onChange={(v) => customProps.setValue(task.id, prop.id, v)}
              onAddOption={(label) => customProps.addOption(prop, label)}
              members={customProps.members}
              dataCell={k}
              onCellMouseEnter={() => onCellEnter(rowIdx, k as ViewColumn)}
              rangeClass={rangeClassFor(rowIdx, k as ViewColumn)}
            />
          );
        }
        return cellFor(k as ViewColumn);
      })}
      <div className="border-b border-l" aria-hidden />
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
}: {
  task: Task;
  onDeadline: (d: string | null) => void;
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
            className="flex h-full min-h-8 w-full items-center gap-1.5 px-2 text-sm transition-colors hover:bg-accent"
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

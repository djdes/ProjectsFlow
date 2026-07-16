import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Copy,
  Eye,
  FileText,
  Flag,
  LayoutGrid,
  Link as LinkIcon,
  List,
  ListFilter,
  Paintbrush,
  Pencil,
  Plus,
  Rows3,
  Search,
  Settings2,
  Table as TableIcon,
  Trash2,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { trackProjectAction } from '@/lib/productAnalytics';
import type { TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { TaskTemplate } from '@/domain/task/TaskTemplate';
// (TaskStatus используется в редакторе условного цвета)
import { TASK_PRIORITIES } from '@/domain/task/Task';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import { VISIBLE_KANBAN_STATUSES } from '@/domain/kanban/KanbanSettings';
import {
  BOARD_VIEW_TYPES,
  BOARD_VIEW_TYPE_LABELS,
  type BoardView,
  type BoardViewType,
} from '@/domain/project/BoardView';
import { useContainer } from '@/infrastructure/di/container';
import { PROJECT_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';
import { useRightPanelWidth } from '@/presentation/layout/rightPanelContext';
import { STATUS_LABEL } from '../statusLabels';
import { KanbanBoard } from '../KanbanBoard';
import { TableView } from './TableView';
import { ListView } from './ListView';
import { CalendarView } from './CalendarView';
import {
  EMPTY_PER_VIEW_STATE,
  RULE_COLOR_DOT,
  RULE_COLOR_LABELS,
  STATUS_DOT,
  VIEW_COLUMN_LABELS,
  VIEW_GROUPING_LABELS,
  VIEW_SORT_LABELS,
  groupingLabel,
  sortKeyLabel,
  type StandardGrouping,
  hasActiveFilters,
  perViewFromConfig,
  perViewToConfig,
  type PerViewState,
  type TableViewState,
  type ViewColorRule,
  type ViewColumn,
  type ViewDueFilter,
  type ViewFilters,
  type ViewGrouping,
  type ViewRuleColor,
  type ViewSort,
  type ViewSortKey,
} from './viewShared';
import { DropdownEntries, ContextEntries, type MenuEntry } from './menuEntries';
import {
  PROPERTY_TYPE_ICONS,
  PropertyVisibilityPanel,
  useTaskProperties,
} from './customProperties';
import { ViewsOverflowMenu } from './ViewsOverflowMenu';

export const VIEW_TYPE_ICONS: Record<BoardViewType, LucideIcon> = {
  kanban: LayoutGrid,
  table: TableIcon,
  list: List,
  calendar: Calendar,
};

// Иконка отображения: lucide-иконка типа ИЛИ кастомное эмодзи из config (Notion view icon).
export type ViewIconLike = LucideIcon | string;

export function ViewIconGlyph({
  icon,
  className,
}: {
  icon: ViewIconLike;
  className?: string;
}): React.ReactElement {
  if (typeof icon === 'string') {
    return (
      <span className={cn('grid place-items-center text-[0.95em] leading-none', className)}>
        {icon}
      </span>
    );
  }
  const Icon = icon;
  return <Icon className={className} />;
}

type Props = {
  projectId: string;
  projectName?: string;
  memberCount?: number;
  canEdit?: boolean;
  onOpenAutomation?: () => void;
  // Full-bleed классы канбана (см. KanbanBoard) — остальные виды обычной ширины.
  bleedNegClass?: string;
  bleedPadClass?: string;
};

// id неявной дефолтной вкладки «Доска» (канбан). В БД не хранится, не переименовывается
// и не удаляется — это текущая доска проекта как есть.
const DEFAULT_VIEW_ID = 'default';

// Зазор между вкладками (gap-0.5) — участвует в расчёте, сколько вкладок влезает.
const TAB_GAP = 2;

const DUE_FILTER_LABELS: Record<ViewDueFilter, string> = {
  has: 'Есть срок',
  none: 'Без срока',
  overdue: 'Просрочено',
};

// Запрос «создать задачу» из тулбара: seq растёт, вид ловит изменение и открывает окно.
// С template — задача создаётся сразу из шаблона (db/108), без окна (Notion Templates).
export type ViewCreateRequest = {
  readonly seq: number;
  readonly status: TaskStatus;
  readonly template?: TaskTemplate;
};


// === Вью доски проекта (Notion-style) ===
// Строка вкладок: «Доска» (неявный канбан) + пользовательские вью из БД, overflow — «N ещё…»,
// «+» — правая панель создания. Справа тулбар вью: фильтр / сортировка / поиск / настройки /
// синяя «Создать». Активная вью — localStorage пер-проект; `?view=<id>` в URL важнее
// (для «Скопировать ссылку на отображение»).
export function ProjectBoardViews({
  projectId,
  projectName,
  memberCount,
  canEdit = true,
  onOpenAutomation,
  bleedNegClass = '',
  bleedPadClass = '',
}: Props): React.ReactElement {
  const { boardViewRepository, taskTemplateRepository } = useContainer();
  const rightPanelWidth = useRightPanelWidth();
  const storageKey = `pf:board-view:${projectId}`;
  const [views, setViews] = useState<BoardView[] | null>(null);
  const [activeId, setActiveId] = useState<string>(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('view');
      if (fromUrl) return fromUrl;
      return localStorage.getItem(storageKey) ?? DEFAULT_VIEW_ID;
    } catch {
      return DEFAULT_VIEW_ID;
    }
  });
  const [renameTarget, setRenameTarget] = useState<BoardView | null>(null);
  // Имя дефолтной вкладки «Доска» (сама вкладка в БД не хранится) — локально на устройстве.
  const boardNameKey = `pf:board-tab-name:${projectId}`;
  const [boardName, setBoardName] = useState<string>(() => {
    try {
      return localStorage.getItem(boardNameKey) ?? 'Доска';
    } catch {
      return 'Доска';
    }
  });
  const [boardRenameOpen, setBoardRenameOpen] = useState(false);
  const renameBoard = (name: string): void => {
    setBoardName(name);
    setBoardRenameOpen(false);
    try {
      localStorage.setItem(boardNameKey, name);
    } catch {
      /* ignore */
    }
  };
  const [deleteTarget, setDeleteTarget] = useState<BoardView | null>(null);
  // 'newview' — правая панель сразу после создания вью (Notion New view → Done →
  // View settings); 'settings' — полные настройки. Новое свойство создаётся прямо
  // в таблице и открывает меню собственного заголовка.
  const [panel, setPanel] = useState<'settings' | 'newview' | null>(null);
  // Фильтры/сортировка — пер-вью, живут в памяти вкладки (смена вью не сбрасывает).
  const [perView, setPerView] = useState<Record<string, PerViewState>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [createReq, setCreateReq] = useState<ViewCreateRequest | null>(null);

  // Sticky-отступ строки вкладок: под крошками (#pf-project-crumbs) и плашками
  // (#pf-sticky-banners) страницы — их высоты динамические (баннер закрываемый).
  const [stickyTop, setStickyTop] = useState(0);
  useEffect(() => {
    const crumbs = document.getElementById('pf-project-crumbs');
    const banners = document.getElementById('pf-sticky-banners');
    const measure = (): void => {
      setStickyTop((crumbs?.offsetHeight ?? 0) + (banners?.offsetHeight ?? 0));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (crumbs) ro.observe(crumbs);
    if (banners) ro.observe(banners);
    return () => ro.disconnect();
  }, []);

  // Шаблоны задач (db/108) — пункты в шевроне «Создать ▾» (Notion Templates).
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const refetchTemplates = useCallback(async (): Promise<void> => {
    try {
      setTemplates(await taskTemplateRepository.list(projectId));
    } catch {
      // Тихо: без шаблонов «Создать» работает как обычно.
    }
  }, [taskTemplateRepository, projectId]);
  useEffect(() => {
    void refetchTemplates();
  }, [refetchTemplates]);

  const refetch = useCallback(async (): Promise<void> => {
    try {
      setViews(await boardViewRepository.list(projectId));
    } catch {
      // Тихо: без списка вью остаётся дефолтная «Доска» — страница работоспособна.
      setViews((prev) => prev ?? []);
    }
  }, [boardViewRepository, projectId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Вью — shared-состояние проекта: ловим SSE «проект изменился» (кто-то добавил/удалил).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChanged = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId !== projectId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refetch();
        void refetchTemplates();
      }, 400);
    };
    window.addEventListener(PROJECT_CHANGED_EVENT, onChanged);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(PROJECT_CHANGED_EVENT, onChanged);
    };
  }, [projectId, refetch, refetchTemplates]);

  const selectView = (id: string): void => {
    setActiveId(id);
    setSearchOpen(false);
    setCreateReq(null);
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      /* ignore */
    }
    // Синхронизируем ?view= с активной вкладкой: иначе оставшийся от «Скопировать
    // ссылку» параметр при перезагрузке перебивал бы localStorage и открывал не ту
    // вкладку. replaceState — без навигации (activeId ведём в стейте).
    try {
      const url = new URL(window.location.href);
      if (id === DEFAULT_VIEW_ID) url.searchParams.delete('view');
      else url.searchParams.set('view', id);
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      /* ignore */
    }
  };

  // Сохранённая вью удалена (нами или коллегой) → падаем на дефолтную «Доску».
  useEffect(() => {
    if (views === null || activeId === DEFAULT_VIEW_ID) return;
    if (!views.some((v) => v.id === activeId)) selectView(DEFAULT_VIEW_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, activeId]);

  const active = useMemo(
    () => (views ?? []).find((v) => v.id === activeId) ?? null,
    [views, activeId],
  );
  const activeType: BoardViewType = active?.type ?? 'kanban';
  const isKanban = activeId === DEFAULT_VIEW_ID || activeType === 'kanban';

  const state: PerViewState = perView[activeId] ?? EMPTY_PER_VIEW_STATE;
  useEffect(() => {
    const onTaskCreated = (event: Event): void => {
      const detail = (event as CustomEvent<{ projectId?: string; taskId?: string }>).detail;
      if (detail?.projectId !== projectId || !detail.taskId) return;
      window.setTimeout(() => {
        const element = document.querySelector<HTMLElement>(
          `[data-pf-task-id="${CSS.escape(detail.taskId!)}"]`,
        );
        if (!element) return;
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        const hadTabIndex = element.hasAttribute('tabindex');
        if (!hadTabIndex) element.tabIndex = -1;
        element.focus({ preventScroll: true });
        element.classList.add('pf-created-flash');
        window.setTimeout(() => {
          element.classList.remove('pf-created-flash');
          if (!hadTabIndex) element.removeAttribute('tabindex');
        }, 1800);
      }, 80);
    };
    window.addEventListener('pf:task-created', onTaskCreated);
    return () => window.removeEventListener('pf:task-created', onTaskCreated);
  }, [projectId]);
  const setTableState = (patch: Partial<TableViewState>): void =>
    setPerView((prev) => ({
      ...prev,
      [activeId]: { ...state, table: { ...state.table, ...patch } },
    }));
  const setGrouping = (grouping: ViewGrouping | null): void =>
    setPerView((prev) => ({ ...prev, [activeId]: { ...state, grouping } }));
  const setColorRules = (colorRules: ViewColorRule[]): void =>
    setPerView((prev) => ({ ...prev, [activeId]: { ...state, colorRules } }));
  const setCalendarMode = (calendarMode: 'month' | 'week'): void =>
    setPerView((prev) => ({ ...prev, [activeId]: { ...state, calendarMode } }));
  // Кастомная эмодзи-иконка вью (Notion view icon) — живёт в config, синкается как всё.
  const setViewIcon = (icon: string | null): void =>
    setPerView((prev) => ({ ...prev, [activeId]: { ...state, icon } }));

  // Гидратация пер-вью состояния из серверного config (только впервые увиденные вью —
  // локальные несохранённые правки не затираем).
  useEffect(() => {
    if (!views) return;
    setPerView((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const v of views) {
        if (!(v.id in next) && v.config) {
          next[v.id] = perViewFromConfig(v.config);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [views]);

  // Автосохранение конфига активной вью на сервер (debounce; query не сохраняем).
  const lastSavedRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!canEdit) return;
    if (activeId === DEFAULT_VIEW_ID) return;
    if (!views?.some((v) => v.id === activeId)) return;
    const st = perView[activeId];
    if (!st) return;
    const config = perViewToConfig({ ...st, filters: { ...st.filters, query: '' } });
    const json = JSON.stringify(config);
    const baseline =
      lastSavedRef.current[activeId] ??
      JSON.stringify(
        perViewToConfig(perViewFromConfig(views.find((v) => v.id === activeId)?.config ?? null)),
      );
    if (json === baseline) return;
    const t = window.setTimeout(() => {
      lastSavedRef.current[activeId] = json;
      void boardViewRepository
        .update(projectId, activeId, { config: config as Record<string, unknown> })
        .catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(t);
  }, [perView, activeId, views, boardViewRepository, projectId, canEdit]);
  const setFilters = (patch: Partial<ViewFilters>): void => {
    setPerView((prev) => ({
      ...prev,
      [activeId]: { ...state, filters: { ...state.filters, ...patch } },
    }));
    if (Object.keys(patch).some((key) => key !== 'query')) {
      trackProjectAction({ projectId, action: 'filter_tasks', result: 'success' });
    }
  };
  const setSort = (sort: ViewSort | null): void =>
    setPerView((prev) => ({ ...prev, [activeId]: { ...state, sort } }));
  // «Скрыть все» / «Показать все» в панели «Видимость свойств».
  const setHiddenCols = (keys: string[]): void =>
    setPerView((prev) => ({ ...prev, [activeId]: { ...state, hidden: keys } }));
  // col: ViewColumn | `p:<propertyId>` — кастомные колонки тоже скрываются.
  const toggleColumn = (col: string): void =>
    setPerView((prev) => ({
      ...prev,
      [activeId]: {
        ...state,
        hidden: state.hidden.includes(col)
          ? state.hidden.filter((c) => c !== col)
          : [...state.hidden, col],
      },
    }));

  const handleCreate = async (name: string, type: BoardViewType): Promise<void> => {
    if (!canEdit) {
      toast.info('Наблюдатель может просматривать проект, но не менять представления.');
      return;
    }
    try {
      const view = await boardViewRepository.create(projectId, name, type);
      setViews((prev) => [...(prev ?? []), view]);
      selectView(view.id);
      // Notion: после создания справа открывается панель «Новое отображение» (тип/имя → Done).
      setPanel('newview');
    } catch (e) {
      toast.error(`Не удалось создать отображение: ${(e as Error).message}`);
    }
  };

  // Drag-reorder вкладок в окне «ещё…»: оптимистично переставляем локально,
  // затем PATCH sortOrder только изменившимся вью.
  const handleReorder = (orderedIds: string[]): void => {
    if (!canEdit) return;
    const current = views ?? [];
    const byId = new Map(current.map((v) => [v.id, v]));
    const next = orderedIds
      .map((id, i) => {
        const v = byId.get(id);
        return v ? { ...v, sortOrder: i + 1 } : null;
      })
      .filter((v): v is BoardView => v !== null);
    setViews(next);
    for (const v of next) {
      const prev = byId.get(v.id);
      if (prev && prev.sortOrder !== v.sortOrder) {
        boardViewRepository
          .update(projectId, v.id, { sortOrder: v.sortOrder })
          .catch((e: unknown) => {
            toast.error(`Не удалось изменить порядок: ${(e as Error).message}`);
            void refetch();
          });
      }
    }
  };

  const handleUpdate = async (
    view: BoardView,
    patch: { name?: string; type?: BoardViewType },
  ): Promise<void> => {
    if (!canEdit) return;
    try {
      const updated = await boardViewRepository.update(projectId, view.id, patch);
      setViews((prev) => (prev ?? []).map((v) => (v.id === view.id ? updated : v)));
      setRenameTarget(null);
    } catch (e) {
      toast.error(`Не удалось изменить отображение: ${(e as Error).message}`);
    }
  };

  const handleDuplicate = async (view: BoardView): Promise<void> => {
    if (!canEdit) return;
    try {
      const copy = await boardViewRepository.duplicate(projectId, view.id);
      setViews((prev) => [...(prev ?? []), copy]);
      selectView(copy.id);
    } catch (e) {
      toast.error(`Не удалось дублировать: ${(e as Error).message}`);
    }
  };

  const handleDelete = async (view: BoardView): Promise<void> => {
    if (!canEdit) return;
    try {
      await boardViewRepository.remove(projectId, view.id);
      setViews((prev) => (prev ?? []).filter((v) => v.id !== view.id));
      if (activeId === view.id) selectView(DEFAULT_VIEW_ID);
      setDeleteTarget(null);
      setPanel(null);
    } catch (e) {
      toast.error(`Не удалось удалить: ${(e as Error).message}`);
    }
  };

  const copyViewLink = (view: BoardView): void => {
    const url = `${window.location.origin}${window.location.pathname}?view=${view.id}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Ссылка на отображение скопирована'))
      .catch(() => toast.error('Не удалось скопировать ссылку'));
  };

  const allViewsSorted = views ?? [];

  // Notion: вкладки занимают ВСЮ доступную ширину до тулбара. Сколько влезает —
  // меряем по невидимой строке-линейке (реплики вкладок) + ширине контейнера
  // (ResizeObserver). Влезли все — hover-«+»; нет — «ещё N…» вместо него.
  const tabsWrapRef = useRef<HTMLDivElement | null>(null);
  const tabsMeasureRef = useRef<HTMLDivElement | null>(null);
  const [fitCount, setFitCount] = useState<number>(Number.MAX_SAFE_INTEGER);
  useEffect(() => {
    const wrap = tabsWrapRef.current;
    const meas = tabsMeasureRef.current;
    if (!wrap || !meas) return;
    const recompute = (): void => {
      const avail = wrap.clientWidth;
      const kids = Array.from(meas.children) as HTMLElement[];
      // [0] «Доска», [1..n] вью, [n+1] «ещё N…», [n+2] «+»
      if (kids.length < 3) return;
      const boardW = kids[0]!.offsetWidth;
      const moreW = kids[kids.length - 2]!.offsetWidth;
      const plusW = kids[kids.length - 1]!.offsetWidth;
      const tabW = kids.slice(1, -2).map((k) => k.offsetWidth);
      const totalTabs = tabW.reduce((s, w) => s + TAB_GAP + w, 0);
      let next: number;
      if (boardW + totalTabs + TAB_GAP + plusW <= avail) {
        next = tabW.length; // влезают все + «+»
      } else {
        let used = boardW;
        next = 0;
        for (const w of tabW) {
          if (used + TAB_GAP + w + TAB_GAP + moreW <= avail) {
            used += TAB_GAP + w;
            next += 1;
          } else break;
        }
      }
      setFitCount((prev) => (prev === next ? prev : next));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(wrap);
    ro.observe(meas);
    return () => ro.disconnect();
  }, [views, boardName, perView]);

  // Overflow вкладок: первые N видимы; активная из хвоста подменяет последнюю видимую.
  const { visibleViews, hiddenViews } = useMemo(() => {
    const allViews = views ?? [];
    const limit = Math.max(0, fitCount);
    if (allViews.length <= limit) return { visibleViews: allViews, hiddenViews: [] };
    const visible = allViews.slice(0, limit);
    const hidden = allViews.slice(limit);
    const activeHiddenIdx = hidden.findIndex((v) => v.id === activeId);
    if (activeHiddenIdx >= 0 && visible.length > 0) {
      const swapped = visible[visible.length - 1]!;
      visible[visible.length - 1] = hidden[activeHiddenIdx]!;
      hidden[activeHiddenIdx] = swapped;
    }
    return { visibleViews: visible, hiddenViews: hidden };
  }, [views, activeId, fitCount]);

  const filtersActive = hasActiveFilters(state.filters);
  const chipsVisible = filtersActive || state.sort !== null;

  const requestCreate = (status: TaskStatus, template?: TaskTemplate): void =>
    setCreateReq((prev) => ({ seq: (prev?.seq ?? 0) + 1, status, template }));

  const removeTemplate = (tpl: TaskTemplate): void => {
    setTemplates((prev) => prev.filter((t) => t.id !== tpl.id));
    taskTemplateRepository.remove(projectId, tpl.id).catch((e: unknown) => {
      toast.error(`Не удалось удалить шаблон: ${(e as Error).message}`);
      void refetchTemplates();
    });
  };

  // Меню дефолтной вкладки «Доска» (виртуальная, в БД не хранится) — то же окно, что у
  // остальных вью (Notion: все вкладки равнозначны). «Показывать как» другой тип создаёт
  // новую вью этого типа; дублирование создаёт канбан-вью.
  const defaultTabMenuEntries = (): MenuEntry[] => [
    {
      kind: 'item',
      label: 'Переименовать',
      icon: Pencil,
      // setTimeout: попап нельзя открывать, пока Radix-меню не закрылось полностью —
      // его dismiss-слой и возврат фокуса тут же закроют попап.
      onSelect: () => setTimeout(() => setBoardRenameOpen(true), 150),
    },
    {
      kind: 'sub',
      label: 'Показывать как',
      icon: VIEW_TYPE_ICONS.kanban,
      items: BOARD_VIEW_TYPES.map((t) => ({
        kind: 'item' as const,
        label: BOARD_VIEW_TYPE_LABELS[t],
        icon: VIEW_TYPE_ICONS[t],
        checked: t === 'kanban',
        onSelect: () => {
          if (t !== 'kanban') void handleCreate(BOARD_VIEW_TYPE_LABELS[t], t);
        },
      })),
    },
    {
      kind: 'item',
      label: 'Скопировать ссылку',
      icon: LinkIcon,
      onSelect: () => {
        const url = `${window.location.origin}${window.location.pathname}?view=${DEFAULT_VIEW_ID}`;
        void navigator.clipboard
          .writeText(url)
          .then(() => toast.success('Ссылка на отображение скопирована'))
          .catch(() => toast.error('Не удалось скопировать ссылку'));
      },
    },
    {
      kind: 'item',
      label: 'Настроить отображение',
      icon: Settings2,
      onSelect: () => {
        selectView(DEFAULT_VIEW_ID);
        setPanel('settings');
      },
    },
    {
      kind: 'item',
      label: 'Дублировать отображение',
      icon: Copy,
      onSelect: () => void handleCreate('Доска (копия)', 'kanban'),
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Удалить отображение',
      icon: Trash2,
      destructive: true,
      // Дефолтная «Доска» — сама доска проекта, в БД как вью не хранится.
      onSelect: () => toast.error('Дефолтную вкладку «Доска» нельзя удалить'),
    },
  ];

  // Единая спека меню вкладки — рендерится и в дропдаун (клик по активной вкладке),
  // и в контекстное меню (правая кнопка мыши по любой вкладке), как в Notion.
  const tabMenuEntries = (v: BoardView): MenuEntry[] => [
    {
      kind: 'item',
      label: 'Переименовать',
      icon: Pencil,
      onSelect: () => setTimeout(() => setRenameTarget(v), 150),
    },
    {
      kind: 'sub',
      label: 'Показывать как',
      icon: VIEW_TYPE_ICONS[v.type],
      items: BOARD_VIEW_TYPES.map((t) => ({
        kind: 'item' as const,
        label: BOARD_VIEW_TYPE_LABELS[t],
        icon: VIEW_TYPE_ICONS[t],
        checked: v.type === t,
        onSelect: () => void handleUpdate(v, { type: t }),
      })),
    },
    {
      kind: 'item',
      label: 'Настроить отображение',
      icon: Settings2,
      onSelect: () => {
        selectView(v.id);
        setPanel('settings');
      },
    },
    { kind: 'item', label: 'Скопировать ссылку', icon: LinkIcon, onSelect: () => copyViewLink(v) },
    { kind: 'item', label: 'Дублировать отображение', icon: Copy, onSelect: () => void handleDuplicate(v) },
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Удалить отображение',
      icon: Trash2,
      destructive: true,
      onSelect: () => setDeleteTarget(v),
    },
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Строка вкладок + тулбар вью (Notion-style). На узком экране (как в Notion)
          ряд вкладок сворачивается в одну кнопку «Активная вью ⌄» с дропдауном.
          group/tabs — «+» новой вью появляется при наведении на строку; sticky —
          строка (и панель выделения таблицы поверх неё) видна при скролле, прилипая
          ПОД sticky-крошками и плашками страницы (динамический top, см. эффект). */}
      <div
        id="pf-views-tabs-row"
        style={{ top: stickyTop, marginRight: rightPanelWidth }}
        className={cn(
          'pf-sticky-surface group/tabs z-30 flex items-center gap-0.5 bg-background pb-1 transition-[margin] duration-300 ease-in-out motion-reduce:transition-none',
          // На канбане строку вкладок НЕ закрепляем — при скролле липнут только шапки
          // колонок (запрос). В остальных видах — как раньше (нужна для панели выбора).
          !isKanban && 'sticky',
        )}
      >
        {/* Компактный переключатель вью (узкий экран). */}
        <div className="flex min-w-0 flex-1 items-center md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex min-h-10 min-w-0 items-center gap-1.5 rounded-md bg-accent py-1 pl-2 pr-1.5 text-[13px] font-medium text-foreground sm:min-h-9"
                aria-haspopup="menu"
              >
                {(() => {
                  const Icon = VIEW_TYPE_ICONS[activeType];
                  return <Icon className="size-3.5 shrink-0" />;
                })()}
                <span className="max-w-[10rem] truncate">
                  {activeId === DEFAULT_VIEW_ID ? boardName : (active?.name ?? boardName)}
                </span>
                <ChevronDown className="size-3 shrink-0 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[13rem]">
              <DropdownMenuItem className="gap-2" onClick={() => selectView(DEFAULT_VIEW_ID)}>
                <LayoutGrid className="size-4" />
                {boardName}
              </DropdownMenuItem>
              {allViewsSorted.map((v) => (
                <DropdownMenuItem key={v.id} className="gap-2" onClick={() => selectView(v.id)}>
                  <ViewIconGlyph
                    icon={perView[v.id]?.icon ?? VIEW_TYPE_ICONS[v.type]}
                    className="size-4"
                  />
                  <span className="min-w-0 flex-1 truncate">{v.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2" onClick={() => setPanel('settings')}>
                <Settings2 className="size-4" />
                Настройки отображения
              </DropdownMenuItem>
              {canEdit && (
                <>
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() => {
                      if (active) setRenameTarget(active);
                      else setBoardRenameOpen(true);
                    }}
                  >
                    <Pencil className="size-4" />
                    Переименовать
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() =>
                      active
                        ? void handleDuplicate(active)
                        : void handleCreate('Доска (копия)', 'kanban')
                    }
                  >
                    <Copy className="size-4" />
                    Дублировать
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {BOARD_VIEW_TYPES.map((type) => {
                    const Icon = VIEW_TYPE_ICONS[type];
                    return (
                      <DropdownMenuItem
                        key={`mobile-new-${type}`}
                        className="gap-2"
                        onClick={() => void handleCreate(BOARD_VIEW_TYPE_LABELS[type], type)}
                      >
                        <Icon className="size-4" />
                        Новое: {BOARD_VIEW_TYPE_LABELS[type]}
                      </DropdownMenuItem>
                    );
                  })}
                  {active && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="gap-2 text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(active)}
                      >
                        <Trash2 className="size-4" />
                        Удалить отображение
                      </DropdownMenuItem>
                    </>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div
          ref={tabsWrapRef}
          role="tablist"
          aria-label="Отображения проекта"
          className="relative hidden min-w-0 flex-1 items-center gap-0.5 overflow-hidden md:flex"
        >
          {/* Линейка: невидимые реплики ВСЕХ вкладок + «ещё N…» + «+» — по ним
              считаем, сколько вкладок влезает до тулбара (Notion). */}
          <div
            ref={tabsMeasureRef}
            aria-hidden
            className="pointer-events-none invisible absolute left-0 top-0 flex items-center whitespace-nowrap"
          >
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md py-1 pl-2 pr-2 text-[13px] font-medium">
              <LayoutGrid className="size-3.5 shrink-0" />
              <span className="max-w-[9rem] truncate">{boardName}</span>
            </span>
            {allViewsSorted.map((v) => (
              <span
                key={v.id}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md py-1 pl-2 pr-2 text-[13px] font-medium"
              >
                <ViewIconGlyph
                  icon={perView[v.id]?.icon ?? VIEW_TYPE_ICONS[v.type]}
                  className="size-3.5 shrink-0"
                />
                <span className="max-w-[9rem] truncate">{v.name}</span>
              </span>
            ))}
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md py-1 pl-2 pr-2 text-[13px] font-medium">
              ещё {allViewsSorted.length}…
            </span>
            <span className="inline-flex size-7 shrink-0" />
          </div>
          <ViewTab
            icon={VIEW_TYPE_ICONS.kanban}
            name={boardName}
            active={activeId === DEFAULT_VIEW_ID}
            onSelect={() => selectView(DEFAULT_VIEW_ID)}
            menu={canEdit ? defaultTabMenuEntries() : undefined}
            renameOpen={boardRenameOpen}
            onRenameClose={() => setBoardRenameOpen(false)}
            onRenameSubmit={renameBoard}
          />
          {visibleViews.map((v) => (
            <ViewTab
              key={v.id}
              icon={perView[v.id]?.icon ?? VIEW_TYPE_ICONS[v.type]}
              name={v.name}
              active={activeId === v.id}
              onSelect={() => selectView(v.id)}
              menu={canEdit ? tabMenuEntries(v) : undefined}
              renameOpen={renameTarget?.id === v.id}
              onRenameClose={() => setRenameTarget(null)}
              onRenameSubmit={(name) => void handleUpdate(v, { name })}
            />
          ))}
          {/* Notion: «N ещё…» появляется только при переполнении и открывает полное
              окно вью (поиск / reorder / «…»-меню / «+ Новое отображение»); «+» тогда скрыт. */}
          {hiddenViews.length > 0 ? (
            <ViewsOverflowMenu
              views={allViewsSorted}
              boardName={boardName}
              activeId={activeId}
              defaultViewId={DEFAULT_VIEW_ID}
              onSelect={selectView}
              onReorder={handleReorder}
              menuFor={tabMenuEntries}
              boardMenu={defaultTabMenuEntries()}
              iconFor={(v) => perView[v.id]?.icon ?? VIEW_TYPE_ICONS[v.type]}
              onCreate={(t) => void handleCreate(BOARD_VIEW_TYPE_LABELS[t], t)}
              canManage={canEdit}
              label={`ещё ${hiddenViews.length}…`}
            />
          ) : canEdit ? (
            /* «+» — только при наведении на строку вкладок (Notion): попап «Начать
               с нуля», клик по типу сразу создаёт вью с именем типа. */
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Новое отображение"
                  title="Новое отображение"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/tabs:opacity-100 data-[state=open]:opacity-100"
                >
                  <Plus className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-3">
                <p className="pb-2 text-xs font-medium text-muted-foreground">Начать с нуля</p>
                <div className="grid grid-cols-4 gap-1">
                  {BOARD_VIEW_TYPES.map((t) => {
                    const Icon = VIEW_TYPE_ICONS[t];
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => void handleCreate(BOARD_VIEW_TYPE_LABELS[t], t)}
                        className="flex flex-col items-center gap-1.5 rounded-lg px-1 py-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Icon className="size-5" />
                        {BOARD_VIEW_TYPE_LABELS[t]}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>

        {/* Общий правый toolbar отображений. У канбана собственные фильтры и поиск
            находятся строкой ниже, но действия проекта/настройки/«Создать» должны
            оставаться справа так же, как в таблице. На узком экране остаются
            настройки и «Создать». */}
        <div className="flex shrink-0 items-center gap-0.5">
          <div className="md:hidden">
            <FilterMenu filters={state.filters} onChange={setFilters} active={filtersActive} />
          </div>
          <div className="hidden items-center gap-0.5 md:flex">
            <FilterMenu filters={state.filters} onChange={setFilters} active={filtersActive} />
            <SortMenu sort={state.sort} onChange={setSort} />
            {canEdit && onOpenAutomation && (
              <ToolbarIcon label="Автоматизации" onClick={onOpenAutomation}>
                <Zap className="size-4" />
              </ToolbarIcon>
            )}
            {searchOpen ? (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                  <input
                    autoFocus
                    value={state.filters.query}
                    onChange={(e) => setFilters({ query: e.target.value })}
                    onBlur={() => {
                      if (!state.filters.query) setSearchOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setFilters({ query: '' });
                        setSearchOpen(false);
                      }
                    }}
                    placeholder="Поиск…"
                    aria-label="Поиск задач"
                    className="h-7 w-36 rounded-md bg-accent/60 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/60"
                  />
                </div>
              ) : (
                <ToolbarIcon
                  label="Поиск"
                  onClick={() => setSearchOpen(true)}
                  active={state.filters.query.length > 0}
                >
                  <Search className="size-4" />
                </ToolbarIcon>
              )}
          </div>
          {(active || isKanban) && (
            <ToolbarIcon label="Настройки отображения" onClick={() => setPanel('settings')}>
              <Settings2 className="size-4" />
            </ToolbarIcon>
          )}
          {canEdit && <div className="ml-1 inline-flex overflow-hidden rounded-md">
            <Button
              size="sm"
              className="h-10 rounded-r-none px-3.5 text-sm sm:h-9 sm:text-xs"
              onClick={() => requestCreate('backlog')}
            >
              Создать
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  aria-label="Создать в колонке…"
                  className="h-10 rounded-l-none border-l border-primary-foreground/20 px-2 sm:h-9"
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[13rem]">
                {VISIBLE_KANBAN_STATUSES.map((s) => (
                  <DropdownMenuItem key={s} className="gap-2" onClick={() => requestCreate(s)}>
                    <span className={cn('size-2 rounded-full', STATUS_DOT[s])} />
                    {STATUS_LABEL[s]}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  Шаблоны
                </DropdownMenuLabel>
                {templates.length === 0 ? (
                  <div className="px-2 pb-1.5 text-xs text-muted-foreground">
                    Нет — «Сохранить как шаблон» в меню задачи
                  </div>
                ) : (
                  templates.map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      className="group/tpl gap-2"
                      onClick={() => requestCreate(t.status, t)}
                    >
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                      <button
                        type="button"
                        aria-label={`Удалить шаблон «${t.name}»`}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          removeTemplate(t);
                        }}
                        className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover/tpl:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>}
        </div>
      </div>

      {/* Строка активных фильтров/сортировки (chips, Notion-style): клик по chip —
          попап значений (чекбоксы) + «Убрать фильтр»; «+ Фильтр» добавляет следующий. */}
      {chipsVisible && (
        <div className="flex max-w-full items-center gap-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible">
          {state.sort && (
            <button
              type="button"
              onClick={() => setSort({ ...state.sort!, dir: state.sort!.dir === 'asc' ? 'desc' : 'asc' })}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 text-xs text-primary transition-colors hover:bg-primary/10"
            >
              {state.sort.dir === 'asc' ? (
                <ArrowUp className="size-3" />
              ) : (
                <ArrowDown className="size-3" />
              )}
              {sortKeyLabel(state.sort.key)}
              <X
                className="size-3 opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  setSort(null);
                }}
              />
            </button>
          )}
          {state.filters.statuses.length > 0 && (
            <FilterChipPopover
              prop="status"
              label={`Статус: ${
                state.filters.statuses.length > 2
                  ? `${state.filters.statuses.length} значения`
                  : state.filters.statuses.map((s) => STATUS_LABEL[s]).join(', ')
              }`}
              filters={state.filters}
              onChange={setFilters}
              onClear={() => setFilters({ statuses: [] })}
            />
          )}
          {state.filters.priorities.length > 0 && (
            <FilterChipPopover
              prop="priority"
              label={`Приоритет: ${
                state.filters.priorities.length > 2
                  ? `${state.filters.priorities.length} значения`
                  : state.filters.priorities.map((p) => PRIORITY_META[p].label).join(', ')
              }`}
              filters={state.filters}
              onChange={setFilters}
              onClear={() => setFilters({ priorities: [] })}
            />
          )}
          {state.filters.due !== null && (
            <FilterChipPopover
              prop="due"
              label={`Срок: ${DUE_FILTER_LABELS[state.filters.due]}`}
              filters={state.filters}
              onChange={setFilters}
              onClear={() => setFilters({ due: null })}
            />
          )}
          <AddFilterChip filters={state.filters} onChange={setFilters} />
        </div>
      )}

      {/* Активный вид. key по вью — смена вкладки пересоздаёт вид (свой useTasks/стейт).
          Панель «Настройки отображения» — В ПОТОКЕ справа (Notion): контент поджимается. */}
      <div className="flex min-h-0 flex-1 items-start gap-4">
      <div
        className="min-w-0 flex-1 transition-[width] motion-reduce:transition-none"
        style={{ transitionDuration: '240ms', transitionTimingFunction: 'cubic-bezier(.2,.8,.2,1)' }}
      >
      {isKanban ? (
        <KanbanBoard
          key={`${projectId}:${activeId}`}
          projectId={projectId}
          projectName={projectName}
          memberCount={memberCount}
          onOpenAutomation={onOpenAutomation}
          bleedNegClass={bleedNegClass}
          bleedPadClass={bleedPadClass}
          stickyHeaderTop={stickyTop}
          createRequest={createReq}
          viewFilters={state.filters}
          viewSort={state.sort}
          canEdit={canEdit}
        />
      ) : activeType === 'table' ? (
        <TableView
          key={`${projectId}:${activeId}`}
          projectId={projectId}
          projectName={projectName}
          memberCount={memberCount}
          filters={state.filters}
          onFiltersChange={setFilters}
          sort={state.sort}
          onSortChange={setSort}
          hiddenCols={state.hidden}
          onToggleCol={toggleColumn}
          tableState={state.table}
          onTableState={setTableState}
          grouping={state.grouping}
          onGroupingChange={setGrouping}
          colorRules={state.colorRules}
          createRequest={createReq}
          sidePanelOpen={panel !== null}
          onSetHiddenCols={setHiddenCols}
          canEdit={canEdit}
        />
      ) : activeType === 'list' ? (
        <ListView
          key={`${projectId}:${activeId}`}
          projectId={projectId}
          projectName={projectName}
          memberCount={memberCount}
          filters={state.filters}
          sort={state.sort}
          grouping={state.grouping}
          colorRules={state.colorRules}
          createRequest={createReq}
          canEdit={canEdit}
        />
      ) : (
        <CalendarView
          key={`${projectId}:${activeId}`}
          projectId={projectId}
          projectName={projectName}
          memberCount={memberCount}
          filters={state.filters}
          mode={state.calendarMode}
          onModeChange={setCalendarMode}
          createRequest={createReq}
          canEdit={canEdit}
        />
      )}

      </div>
      {/* Панель «Новое отображение» (Notion): сразу после создания — имя/тип → «Готово»
          открывает полные настройки вью. */}
      {panel === 'newview' && active && (
        <BoardSidePanel onClose={() => setPanel(null)}>
          <NewViewPanel
            view={active}
            projectName={projectName}
            state={state}
            onTableState={setTableState}
            onGrouping={setGrouping}
            onCalendarMode={setCalendarMode}
            onIcon={setViewIcon}
            onClose={() => setPanel(null)}
            onRename={(name) => void handleUpdate(active, { name })}
            onType={(type) => void handleUpdate(active, { type })}
            onDone={() => setPanel('settings')}
          />
        </BoardSidePanel>
      )}
      {panel === 'settings' && (active !== null || activeId === DEFAULT_VIEW_ID) && (
        <BoardSidePanel onClose={() => setPanel(null)}>
          {active ? (
            <ViewSettingsCard
              view={active}
              canEdit={canEdit}
              onClose={() => setPanel(null)}
              onRename={(name) => void handleUpdate(active, { name })}
              onType={(type) => void handleUpdate(active, { type })}
              onCopyLink={() => copyViewLink(active)}
              onDuplicate={() => void handleDuplicate(active)}
              onDelete={() => setDeleteTarget(active)}
              hidden={state.hidden}
              onToggleColumn={active.type === 'table' ? toggleColumn : undefined}
              onSetHidden={active.type === 'table' ? setHiddenCols : undefined}
              filters={state.filters}
              onFilters={setFilters}
              sort={state.sort}
              onSort={setSort}
              grouping={state.grouping}
              onGrouping={setGrouping}
              colorRules={state.colorRules}
              onColorRules={setColorRules}
            />
          ) : (
            /* Настройки дефолтной «Доски» (в БД не хранится): синтетическая вью;
               смена типа создаёт новую вью, удаление недоступно. */
            <ViewSettingsCard
              view={{
                id: DEFAULT_VIEW_ID,
                projectId,
                name: boardName,
                type: 'kanban',
                sortOrder: 0,
                config: null,
                createdAt: new Date(),
              }}
              canEdit={canEdit}
              onClose={() => setPanel(null)}
              onRename={renameBoard}
              onType={(type) => {
                if (type !== 'kanban') void handleCreate(BOARD_VIEW_TYPE_LABELS[type], type);
              }}
              onCopyLink={() => {
                const url = `${window.location.origin}${window.location.pathname}?view=${DEFAULT_VIEW_ID}`;
                void navigator.clipboard
                  .writeText(url)
                  .then(() => toast.success('Ссылка на отображение скопирована'))
                  .catch(() => toast.error('Не удалось скопировать ссылку'));
              }}
              onDuplicate={() => void handleCreate('Доска (копия)', 'kanban')}
              onDelete={() => toast.error('Дефолтную вкладку «Доска» нельзя удалить')}
              hidden={state.hidden}
              onToggleColumn={undefined}
              onSetHidden={undefined}
              filters={state.filters}
              onFilters={setFilters}
              sort={state.sort}
              onSort={setSort}
              grouping={state.grouping}
              onGrouping={setGrouping}
              colorRules={state.colorRules}
              onColorRules={setColorRules}
            />
          )}
        </BoardSidePanel>
      )}
      </div>

      {/* Подтверждение удаления вью (задачи не трогаются — удаляется только представление). */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-xs gap-3 p-5">
          <DialogHeader>
            <DialogTitle className="text-base">Удалить отображение?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            «{deleteTarget?.name}» будет удалена у всех участников. Задачи не пострадают.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && void handleDelete(deleteTarget)}
            >
              Удалить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Плавающая панель настроек (Notion View settings): карточка в правом верхнем углу
// ПОД тулбаром (не на всю высоту), СО СВОИМ скроллом (max-height + overflow-y-auto).
// Пока открыта — блокируем скролл главной страницы (<main>) и тела таблицы: двигается
// только сама панель (запрос: «нельзя скроллить таблицу и главную страницу»).
function BoardSidePanel({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactElement | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  // Desktop-позиция: под строкой вкладок; на tablet/mobile CSS разворачивает панель на весь экран.
  const [pos, setPos] = useState<{ top: number } | null>(null);
  useEffect(() => {
    const tabs = document.getElementById('pf-views-tabs-row');
    const r = tabs?.getBoundingClientRect();
    if (r) setPos({ top: Math.round(r.bottom + 6) });
    else setPos({ top: 100 });
    // Блокируем прокрутку страницы и горизонтальную прокрутку таблицы, пока панель открыта.
    const locked: Array<{ el: HTMLElement; prev: string }> = [];
    const lock = (el: HTMLElement | null): void => {
      if (!el) return;
      locked.push({ el, prev: el.style.overflow });
      el.style.overflow = 'hidden';
    };
    lock(document.querySelector('main'));
    document
      .querySelectorAll<HTMLElement>('.overflow-x-auto')
      .forEach((el) => lock(el));
    return () => locked.forEach(({ el, prev }) => (el.style.overflow = prev));
  }, []);
  // Escape закрывает верхний слой; на tablet/mobile Tab остаётся внутри полноэкранной панели.
  useEffect(() => {
    const trigger = triggerRef.current;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || window.innerWidth >= 1024) return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((node) => node.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      requestAnimationFrame(() => trigger?.isConnected && trigger.focus());
    };
  }, [onClose]);
  if (typeof document === 'undefined' || !pos) return null;
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Настройки отображения"
      style={{
        top: pos.top,
        maxHeight: `calc(100dvh - ${pos.top + 12}px)`,
        transitionDuration: '240ms',
        transitionTimingFunction: 'cubic-bezier(.2,.8,.2,1)',
      }}
      className={cn(
        'fixed inset-x-3 bottom-3 z-[60] flex flex-col overflow-y-auto overscroll-contain rounded-[20px] border bg-popover pb-[env(safe-area-inset-bottom)] shadow-2xl',
        'max-lg:!inset-0 max-lg:!top-0 max-lg:!max-h-none max-lg:rounded-none',
        'animate-in fade-in slide-in-from-right-3 motion-reduce:animate-none',
        'lg:sticky lg:inset-auto lg:z-30 lg:w-[480px] lg:shrink-0',
        'motion-reduce:transition-none',
      )}
    >
      {children}
    </div>
  );
}

// Строка-настройка с тумблером (Notion Show page icon / Wrap all content и т.п.).
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-accent/50">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

// Панель «Новое отображение» (Notion New view): сразу после создания вью — иконка типа + имя
// (autoFocus), сетка типов (клик меняет тип на лету), настройки ПОД ВЫБРАННЫЙ ТИП
// (Notion: у Table/Board/Calendar разные), «Источник», «Готово» → полные настройки.
// Набор эмодзи для пикера иконки вью (Notion Icon → Filter/Remove + сетка).
const VIEW_EMOJIS =
  '📋 📌 📊 📈 📅 🗓️ ✅ 📝 🗂️ 📁 🎯 🚀 🔥 ⚡ ⭐ 💡 🧩 🛠️ 🔧 🐛 🧪 🧭 🏷️ 📦 💼 🗃️ 🧱 🖥️ 📱 🌐 🔒 🔑 💬 👥 🕒 ⏳ 🏁 🎨 📣 💰'.split(' ');

function NewViewPanel({
  view,
  projectName,
  state,
  onTableState,
  onGrouping,
  onCalendarMode,
  onIcon,
  onClose,
  onRename,
  onType,
  onDone,
}: {
  view: BoardView;
  projectName?: string;
  state: PerViewState;
  onTableState: (patch: Partial<TableViewState>) => void;
  onGrouping: (g: ViewGrouping | null) => void;
  onCalendarMode: (m: 'month' | 'week') => void;
  onIcon: (icon: string | null) => void;
  onClose: () => void;
  onRename: (name: string) => void;
  onType: (type: BoardViewType) => void;
  onDone: () => void;
}): React.ReactElement {
  const [name, setName] = useState(view.name);
  useEffect(() => {
    setName(view.name);
    // Имя сбрасываем только при переходе на другую вью.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.id]);
  const commitName = (): void => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== view.name) onRename(trimmed);
  };
  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-card px-3 py-2.5">
        <p className="text-sm font-semibold">Новое отображение</p>
        <button
          type="button"
          aria-label="Закрыть"
          onClick={onClose}
          className="grid size-10 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:size-7"
        >
          <X className="size-4" />
        </button>
      </div>
      {/* Имя с иконкой слева — как в Notion; клик по квадратику открывает пикер
          эмодзи-иконки вью (Icon → Remove). */}
      <div className="flex items-center gap-1.5 px-3 pb-1">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Иконка отображения"
              title="Иконка отображения"
              className="grid size-8 shrink-0 place-items-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ViewIconGlyph
                icon={state.icon ?? VIEW_TYPE_ICONS[view.type]}
                className="size-4 text-base"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <div className="flex items-center justify-between pb-1.5">
              <p className="text-xs font-medium text-muted-foreground">Иконка</p>
              {state.icon && (
                <button
                  type="button"
                  onClick={() => onIcon(null)}
                  className="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  Убрать
                </button>
              )}
            </div>
            <div className="grid grid-cols-8 gap-0.5">
              {VIEW_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => onIcon(e)}
                  className={cn(
                    'grid size-7 place-items-center rounded text-base transition-colors hover:bg-accent',
                    state.icon === e && 'bg-accent ring-1 ring-primary/50',
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
          }}
          placeholder="Имя вью"
          aria-label="Имя вью"
          className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none ring-primary/30 focus:ring-2"
        />
      </div>
      <div className="grid grid-cols-2 gap-1.5 p-3 pt-2">
        {BOARD_VIEW_TYPES.map((t) => {
          const Icon = VIEW_TYPE_ICONS[t];
          const selected = view.type === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                if (!selected) onType(t);
              }}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs transition-colors',
                selected
                  ? 'border-primary text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="size-5" />
              {BOARD_VIEW_TYPE_LABELS[t]}
            </button>
          );
        })}
      </div>
      {/* Настройки выбранного типа (Notion: per-layout options). */}
      <div className="border-t px-1.5 py-1.5">
        {view.type === 'table' && (
          <>
            <ToggleRow
              label="Переносить текст"
              checked={state.table.wrapTitle}
              onChange={(v) => onTableState({ wrapTitle: v })}
            />
            <ToggleRow
              label="Закрепить название"
              checked={state.table.freezeTitle}
              onChange={(v) => onTableState({ freezeTitle: v })}
            />
          </>
        )}
        {(view.type === 'table' || view.type === 'list') && (
          <div className="flex items-center justify-between rounded-md px-1.5 py-1.5 text-sm">
            Группировка
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {state.grouping ? groupingLabel(state.grouping) : 'Нет'}
                  <ChevronRight className="size-3.5 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[10rem]">
                <DropdownMenuItem onClick={() => onGrouping(null)}>Нет</DropdownMenuItem>
                {(Object.keys(VIEW_GROUPING_LABELS) as StandardGrouping[]).map((g) => (
                  <DropdownMenuItem key={g} className="gap-2" onClick={() => onGrouping(g)}>
                    {VIEW_GROUPING_LABELS[g]}
                    {state.grouping === g && <Check className="ml-auto size-3.5 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {view.type === 'calendar' && (
          <div className="flex items-center justify-between rounded-md px-1.5 py-1.5 text-sm">
            Режим
            <div className="inline-flex overflow-hidden rounded-md border">
              {(
                [
                  ['month', 'Месяц'],
                  ['week', 'Неделя'],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onCalendarMode(m)}
                  className={cn(
                    'px-2 py-0.5 text-xs transition-colors',
                    state.calendarMode === m
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {view.type === 'kanban' && (
          <p className="px-1.5 py-1.5 text-xs text-muted-foreground">
            Канбан группируется по статусам доски.
          </p>
        )}
      </div>
      {/* Источник данных (Notion Source) — задачи этого проекта. */}
      <div className="border-t px-1.5 py-1.5">
        <div className="flex items-center justify-between rounded-md px-1.5 py-1.5 text-sm">
          <span className="text-muted-foreground">Источник</span>
          <span className="max-w-[10rem] truncate">{projectName ?? 'Проект'}</span>
        </div>
      </div>
      <div className="px-3 pb-3 pt-1">
        <Button className="w-full" onClick={onDone}>
          Готово
        </Button>
      </div>
    </div>
  );
}

// Иконка тулбара вью (Notion-style «тихая» кнопка; active — синяя подсветка).
function ToolbarIcon({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-md transition-colors hover:bg-accent sm:size-9',
        active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

// ---- Фильтры (Notion Filter by…): попап с поиском свойств → чекбоксы значений ----

type FilterProp = 'status' | 'priority' | 'due';

const FILTER_PROPS: { key: FilterProp; label: string; icon: LucideIcon }[] = [
  { key: 'status', label: 'Статус', icon: CircleDot },
  { key: 'priority', label: 'Приоритет', icon: Flag },
  { key: 'due', label: 'Срок', icon: CalendarDays },
];

// Чекбоксы значений свойства (мультивыбор, применяется сразу — как в Notion).
function FilterValueList({
  prop,
  filters,
  onChange,
}: {
  prop: FilterProp;
  filters: ViewFilters;
  onChange: (patch: Partial<ViewFilters>) => void;
}): React.ReactElement {
  const row = (
    key: string,
    label: React.ReactNode,
    checked: boolean,
    toggle: () => void,
  ): React.ReactElement => (
    <label
      key={key}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={toggle}
        className="size-3.5 cursor-pointer accent-primary"
      />
      {label}
    </label>
  );
  if (prop === 'status') {
    return (
      <div className="flex flex-col">
        {VISIBLE_KANBAN_STATUSES.map((s) =>
          row(
            s,
            <span className="flex items-center gap-2">
              <span className={cn('size-2 rounded-full', STATUS_DOT[s])} />
              {STATUS_LABEL[s]}
            </span>,
            filters.statuses.includes(s),
            () =>
              onChange({
                statuses: filters.statuses.includes(s)
                  ? filters.statuses.filter((x) => x !== s)
                  : [...filters.statuses, s],
              }),
          ),
        )}
      </div>
    );
  }
  if (prop === 'priority') {
    return (
      <div className="flex flex-col">
        {TASK_PRIORITIES.map((p: TaskPriority) =>
          row(
            String(p),
            <span className="flex items-center gap-2">
              <span className={cn('size-2 rounded-full', PRIORITY_META[p].dotColor)} />
              {PRIORITY_META[p].label}
            </span>,
            filters.priorities.includes(p),
            () =>
              onChange({
                priorities: filters.priorities.includes(p)
                  ? filters.priorities.filter((x) => x !== p)
                  : [...filters.priorities, p],
              }),
          ),
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {(Object.keys(DUE_FILTER_LABELS) as ViewDueFilter[]).map((d) =>
        row(d, DUE_FILTER_LABELS[d], filters.due === d, () =>
          onChange({ due: filters.due === d ? null : d }),
        ),
      )}
    </div>
  );
}

// Шаг выбора свойства: инпут «Фильтровать по…» + плоский список свойств (Notion).
function FilterPicker({
  filters,
  onChange,
}: {
  filters: ViewFilters;
  onChange: (patch: Partial<ViewFilters>) => void;
}): React.ReactElement {
  const [step, setStep] = useState<'pick' | FilterProp>('pick');
  const [search, setSearch] = useState('');
  if (step !== 'pick') {
    const meta = FILTER_PROPS.find((p) => p.key === step)!;
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setStep('pick')}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          {meta.label}
        </button>
        <FilterValueList prop={step} filters={filters} onChange={onChange} />
      </div>
    );
  }
  const list = FILTER_PROPS.filter((p) =>
    p.label.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')),
  );
  return (
    <div className="flex flex-col gap-1">
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Фильтровать по…"
        aria-label="Фильтровать по"
        className="w-full rounded-md border border-primary/60 bg-background px-2.5 py-1.5 text-sm outline-none ring-2 ring-primary/20"
      />
      <div className="flex flex-col">
        {list.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setStep(p.key)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
          >
            <p.icon className="size-4 text-muted-foreground/80" />
            {p.label}
          </button>
        ))}
        {list.length === 0 && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Ничего не найдено</p>
        )}
      </div>
    </div>
  );
}

// Кнопка-иконка фильтра в тулбаре → попап FilterPicker.
function FilterMenu({
  filters,
  onChange,
  active,
}: {
  filters: ViewFilters;
  onChange: (patch: Partial<ViewFilters>) => void;
  active: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Фильтр"
          title="Фильтр"
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent',
            active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <ListFilter className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        <FilterPicker key={open ? 'o' : 'c'} filters={filters} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

// «Сортировка» — попап с поиском свойств (Notion Sort by…): клик выбирает по
// возрастанию, повторный — меняет направление.
function SortMenu({
  sort,
  onChange,
}: {
  sort: ViewSort | null;
  onChange: (s: ViewSort | null) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);
  const keys = (Object.keys(VIEW_SORT_LABELS) as ViewSortKey[]).filter((k) =>
    VIEW_SORT_LABELS[k].toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Сортировка"
          title="Сортировка"
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent',
            sort ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <ArrowUpDown className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        <div className="flex flex-col gap-1">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Сортировать по…"
            aria-label="Сортировать по"
            className="w-full rounded-md border border-primary/60 bg-background px-2.5 py-1.5 text-sm outline-none ring-2 ring-primary/20"
          />
          <div className="flex flex-col">
            {keys.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() =>
                  onChange(
                    sort?.key === k
                      ? { key: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
                      : { key: k, dir: 'asc' },
                  )
                }
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                {VIEW_SORT_LABELS[k]}
                {sort?.key === k &&
                  (sort.dir === 'asc' ? (
                    <ArrowUp className="ml-auto size-3.5" />
                  ) : (
                    <ArrowDown className="ml-auto size-3.5" />
                  ))}
              </button>
            ))}
            {keys.length === 0 && (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">Ничего не найдено</p>
            )}
          </div>
          {sort && (
            <div className="border-t pt-1">
              <button
                type="button"
                onClick={() => onChange(null)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                <X className="size-3.5" />
                Убрать сортировку
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Chip активного фильтра: клик — попап значений (чекбоксы) + «Убрать фильтр» (Notion).
function FilterChipPopover({
  prop,
  label,
  filters,
  onChange,
  onClear,
}: {
  prop: FilterProp;
  label: string;
  filters: ViewFilters;
  onChange: (patch: Partial<ViewFilters>) => void;
  onClear: () => void;
}): React.ReactElement {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 text-xs text-primary transition-colors hover:bg-primary/10"
        >
          {label}
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1.5">
        <FilterValueList prop={prop} filters={filters} onChange={onChange} />
        <div className="mt-1 border-t pt-1">
          <button
            type="button"
            onClick={onClear}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="size-3.5" />
            Убрать фильтр
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// «+ Фильтр» в конце chips-строки — добавить ещё один фильтр (Notion «+ Filter»).
function AddFilterChip({
  filters,
  onChange,
}: {
  filters: ViewFilters;
  onChange: (patch: Partial<ViewFilters>) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3" />
          Фильтр
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <FilterPicker key={open ? 'o' : 'c'} filters={filters} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

// Вкладка вью (Notion-поведение):
// - клик по НЕАКТИВНОЙ — выбрать (обычная кнопка, НЕ Radix-триггер: он глушит onClick);
// - клик по АКТИВНОЙ — открыть меню (переключать её не нужно, поэтому триггер безопасен);
// - ПРАВАЯ кнопка по любой пользовательской вкладке — то же меню (ContextMenu);
// - «Переименовать» — попап с инпутом прямо у вкладки.
// У дефолтной «Доски» меню нет (она не хранится в БД).
function ViewTab({
  icon,
  name,
  active,
  onSelect,
  menu,
  renameOpen = false,
  onRenameClose,
  onRenameSubmit,
}: {
  icon: ViewIconLike;
  name: string;
  active: boolean;
  onSelect: () => void;
  menu?: MenuEntry[];
  renameOpen?: boolean;
  onRenameClose?: () => void;
  onRenameSubmit?: (name: string) => void;
}): React.ReactElement {
  const tabA11y = {
    role: 'tab' as const,
    'aria-selected': active,
    tabIndex: active ? 0 : -1,
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>): void => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = Array.from(
        event.currentTarget
          .closest('[role="tablist"]')
          ?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
      );
      if (tabs.length === 0) return;
      const current = tabs.indexOf(event.currentTarget);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[next]?.focus();
      tabs[next]?.click();
    },
  };
  const tabClass = cn(
    'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md py-1 pl-2 pr-2 text-[13px] font-medium transition-[background-color,color,box-shadow,transform] duration-150 motion-reduce:transition-none',
    active
      ? 'scale-[1.01] bg-accent text-foreground shadow-sm'
      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
  );
  const inner = (
    <>
      <ViewIconGlyph icon={icon} className="size-3.5 shrink-0" />
      <span className="max-w-[9rem] truncate">{name}</span>
    </>
  );

  // ВАЖНО: ContextMenuTrigger asChild должен оборачивать САМУ кнопку (DOM-узел), а не
  // DropdownMenu Root — Root не рендерит элемент, и onContextMenu-пропсы теряются.
  let tab: React.ReactElement;
  if (menu) {
    const btn = (
      <ContextMenuTrigger asChild>
        {active ? (
          <button type="button" aria-label="Меню вью" title="Меню вью" className={tabClass} {...tabA11y}>
            {inner}
          </button>
        ) : (
          <button type="button" onClick={onSelect} className={tabClass} {...tabA11y}>
            {inner}
          </button>
        )}
      </ContextMenuTrigger>
    );
    tab = (
      <ContextMenu>
        {active ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>{btn}</DropdownMenuTrigger>
            {/* onCloseAutoFocus preventDefault: возврат фокуса на вкладку закрывал бы
                rename-попап (focus-outside dismiss). */}
            <DropdownMenuContent
              align="start"
              className="min-w-[13rem]"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownEntries entries={menu} />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          btn
        )}
        <ContextMenuContent
          className="min-w-[13rem]"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <ContextEntries entries={menu} />
        </ContextMenuContent>
      </ContextMenu>
    );
  } else {
    tab = (
      <button type="button" onClick={onSelect} className={tabClass} {...tabA11y}>
        {inner}
      </button>
    );
  }

  if (!onRenameSubmit) return tab;
  // Rename-попап — ручной (НЕ Radix Popover): закрывающиеся Dropdown/ContextMenu своими
  // dismiss-слоями мгновенно убивали Radix-попап, открытый из их пункта меню.
  return (
    <span className="relative inline-flex shrink-0">
      {tab}
      {renameOpen && (
        <TabRenamePopup
          initial={name}
          onSubmit={onRenameSubmit}
          onClose={() => onRenameClose?.()}
        />
      )}
    </span>
  );
}

// Ручной попап переименования у вкладки: outside-click закрывает (с задержкой подписки,
// чтобы не поймать клик, открывший попап).
function TabRenamePopup({
  initial,
  onSubmit,
  onClose,
}: {
  initial: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = window.setTimeout(() => document.addEventListener('pointerdown', onDown), 250);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover p-1.5 shadow-md duration-150 animate-in fade-in zoom-in-95"
    >
      <TabRenameInput initial={initial} onSubmit={onSubmit} onClose={onClose} />
    </div>
  );
}

// Инпут переименования в попапе у вкладки (Notion Rename): Enter — сохранить, Esc — закрыть.
function TabRenameInput({
  initial,
  onSubmit,
  onClose,
}: {
  initial: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const [value, setValue] = useState(initial);
  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initial) onSubmit(trimmed);
    else onClose();
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      maxLength={64}
      aria-label="Название отображения"
      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground/30"
    />
  );
}

// Карточка «Настройки отображения» (Notion View settings): строки-пункты со значением и «›»,
// drill-down в подстраницы Вид / Свойства / Фильтр / Сортировка / Группировка / Цвет.
type SettingsPage = 'root' | 'layout' | 'props' | 'filter' | 'sort' | 'group' | 'color';

function ViewSettingsCard({
  view,
  canEdit,
  onClose,
  onRename,
  onType,
  onCopyLink,
  onDuplicate,
  onDelete,
  hidden,
  onToggleColumn,
  onSetHidden,
  filters,
  onFilters,
  sort,
  onSort,
  grouping,
  onGrouping,
  colorRules,
  onColorRules,
}: {
  view: BoardView;
  canEdit: boolean;
  onClose: () => void;
  onRename: (name: string) => void;
  onType: (t: BoardViewType) => void;
  onCopyLink: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  hidden: string[];
  onToggleColumn?: (c: string) => void;
  onSetHidden?: (keys: string[]) => void;
  filters: ViewFilters;
  onFilters: (patch: Partial<ViewFilters>) => void;
  sort: ViewSort | null;
  onSort: (s: ViewSort | null) => void;
  grouping: ViewGrouping | null;
  onGrouping: (g: ViewGrouping | null) => void;
  colorRules: ViewColorRule[];
  onColorRules: (rules: ViewColorRule[]) => void;
}): React.ReactElement {
  const [page, setPage] = useState<SettingsPage>('root');
  const [name, setName] = useState(view.name);
  // Кастомные свойства проекта — для страницы «Видимость свойств» (панель
  // смонтирована только когда открыта, лишних запросов нет).
  const cardProps = useTaskProperties(view.projectId);
  useEffect(() => setName(view.name), [view.id, view.name]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const commitName = (): void => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== view.name) onRename(trimmed);
  };
  const TypeIcon = VIEW_TYPE_ICONS[view.type];
  const filtersCount =
    (filters.statuses.length > 0 ? 1 : 0) +
    (filters.priorities.length > 0 ? 1 : 0) +
    (filters.due !== null ? 1 : 0);

  const backHeader = (title: string): React.ReactElement => (
    <button
      type="button"
      onClick={() => setPage('root')}
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
    >
      <ChevronLeft className="size-4 text-muted-foreground" />
      {title}
    </button>
  );

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-popover px-3 py-2.5">
        <p className="text-sm font-semibold">Настройки отображения</p>
        <button
          type="button"
          aria-label="Закрыть панель"
          onClick={onClose}
          className="grid size-10 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:size-7"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="p-2">
        {page === 'root' && (
          <div className="flex flex-col gap-1">
            {/* Имя вью с иконкой типа (Notion: инпут сверху панели). */}
            <div className="flex items-center gap-1.5 px-0.5 pb-1">
              <span className="grid size-8 shrink-0 place-items-center rounded-md border">
                <TypeIcon className="size-4 text-muted-foreground" />
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitName();
                  }
                }}
                maxLength={64}
                disabled={!canEdit}
                aria-label="Название отображения"
                className="h-8 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus:border-foreground/30"
              />
            </div>
            {canEdit && (
              <NavRow
                icon={TypeIcon}
                label="Вид"
                value={BOARD_VIEW_TYPE_LABELS[view.type]}
                onClick={() => setPage('layout')}
              />
            )}
            {onToggleColumn && (
              <NavRow
                icon={Eye}
                label="Видимость свойств"
                value={hidden.length > 0 ? `${hidden.length} скрыто` : 'Все'}
                onClick={() => setPage('props')}
              />
            )}
            <NavRow
              icon={ListFilter}
              label="Фильтр"
              value={filtersCount > 0 ? String(filtersCount) : undefined}
              onClick={() => setPage('filter')}
            />
            <NavRow
              icon={ArrowUpDown}
              label="Сортировка"
              value={sort ? sortKeyLabel(sort.key) : undefined}
              onClick={() => setPage('sort')}
            />
            {(view.type === 'table' || view.type === 'list') && (
              <NavRow
                icon={Rows3}
                label="Группировка"
                value={grouping ? groupingLabel(grouping) : 'Нет'}
                onClick={() => setPage('group')}
              />
            )}
            {(view.type === 'table' || view.type === 'list') && (
              <NavRow
                icon={Paintbrush}
                label="Условный цвет"
                value={colorRules.length > 0 ? String(colorRules.length) : undefined}
                onClick={() => setPage('color')}
              />
            )}
            <PanelRow icon={LinkIcon} label="Скопировать ссылку на отображение" onClick={onCopyLink} />
            {canEdit && (
              <>
                <div className="my-0.5 border-t" />
                <PanelRow icon={Copy} label="Дублировать отображение" onClick={onDuplicate} />
                <PanelRow icon={Trash2} label="Удалить отображение" onClick={onDelete} destructive />
              </>
            )}
          </div>
        )}
        {page === 'layout' && (
          <div className="flex flex-col gap-1.5">
            {backHeader('Вид')}
            <div className="grid grid-cols-2 gap-1.5 px-0.5 pb-1">
              {BOARD_VIEW_TYPES.map((t) => {
                const Icon = VIEW_TYPE_ICONS[t];
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onType(t)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs transition-colors',
                      view.type === t
                        ? 'border-primary/50 bg-primary/5 text-foreground ring-1 ring-primary/30'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="size-5" />
                    {BOARD_VIEW_TYPE_LABELS[t]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {page === 'props' && onToggleColumn && (
          <div className="flex flex-col gap-1">
            {backHeader('Видимость свойств')}
            {/* Notion Property visibility: поиск + глазки + Скрыть/Показать все. */}
            <PropertyVisibilityPanel
              items={[
                ...(Object.keys(VIEW_COLUMN_LABELS) as ViewColumn[]).map((c) => ({
                  key: c as string,
                  label: VIEW_COLUMN_LABELS[c],
                  icon: <span className="inline-block size-3.5" aria-hidden />,
                })),
                ...cardProps.properties.map((p) => {
                  const Icon = PROPERTY_TYPE_ICONS[p.type];
                  return { key: `p:${p.id}`, label: p.name, icon: <Icon className="size-3.5" /> };
                }),
              ]}
              hidden={hidden}
              onToggle={onToggleColumn}
              onSetHidden={onSetHidden}
            />
          </div>
        )}
        {page === 'filter' && (
          <div className="flex flex-col gap-1">
            {backHeader('Фильтр')}
            <FilterPicker filters={filters} onChange={onFilters} />
          </div>
        )}
        {page === 'group' && (view.type === 'table' || view.type === 'list') && (
          <div className="flex flex-col gap-1">
            {backHeader('Группировка')}
            <button
              type="button"
              onClick={() => onGrouping(null)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              Нет
              {grouping === null && <Check className="ml-auto size-3.5" />}
            </button>
            {(Object.keys(VIEW_GROUPING_LABELS) as StandardGrouping[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onGrouping(g)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                {VIEW_GROUPING_LABELS[g]}
                {grouping === g && <Check className="ml-auto size-3.5" />}
              </button>
            ))}
          </div>
        )}
        {page === 'color' && (view.type === 'table' || view.type === 'list') && (
          <div className="flex flex-col gap-1">
            {backHeader('Условный цвет')}
            <ColorRulesEditor rules={colorRules} onChange={onColorRules} />
          </div>
        )}
        {page === 'sort' && (
          <div className="flex flex-col gap-1">
            {backHeader('Сортировка')}
            {(Object.keys(VIEW_SORT_LABELS) as ViewSortKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() =>
                  onSort(
                    sort?.key === k
                      ? { key: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
                      : { key: k, dir: 'asc' },
                  )
                }
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                {VIEW_SORT_LABELS[k]}
                {sort?.key === k &&
                  (sort.dir === 'asc' ? (
                    <ArrowUp className="ml-auto size-3.5" />
                  ) : (
                    <ArrowDown className="ml-auto size-3.5" />
                  ))}
              </button>
            ))}
            {sort && (
              <>
                <div className="my-0.5 border-t" />
                <PanelRow icon={X} label="Убрать сортировку" onClick={() => onSort(null)} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Редактор правил условного цвета (Notion Conditional color): список правил
// «Свойство = Значение → Цвет» + конструктор нового правила.
function ColorRulesEditor({
  rules,
  onChange,
}: {
  rules: ViewColorRule[];
  onChange: (rules: ViewColorRule[]) => void;
}): React.ReactElement {
  const [draftProp, setDraftProp] = useState<'status' | 'priority'>('status');
  const valueLabel = (r: { prop: string; value: string }): string =>
    r.prop === 'status'
      ? (STATUS_LABEL[r.value as TaskStatus] ?? r.value)
      : (PRIORITY_META[Number(r.value) as TaskPriority]?.label ?? r.value);
  return (
    <div className="flex flex-col gap-1">
      {rules.map((r, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
          <span className={cn('size-2.5 shrink-0 rounded-full', RULE_COLOR_DOT[r.color])} />
          <span className="min-w-0 flex-1 truncate">
            {r.prop === 'status' ? 'Статус' : 'Приоритет'}: {valueLabel(r)}
          </span>
          <button
            type="button"
            aria-label="Удалить правило"
            onClick={() => onChange(rules.filter((_, j) => j !== i))}
            className="text-muted-foreground/60 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {rules.length === 0 && (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Правил нет. Строки будут окрашены по первому совпавшему правилу.
        </p>
      )}
      <div className="mt-1 border-t pt-2">
        <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Новое правило</p>
        <div className="flex gap-1 px-2 pb-1.5">
          {(['status', 'priority'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDraftProp(p)}
              className={cn(
                'rounded-md border px-2 py-1 text-xs transition-colors',
                draftProp === p
                  ? 'border-primary/50 bg-primary/5 text-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {p === 'status' ? 'Статус' : 'Приоритет'}
            </button>
          ))}
        </div>
        <div className="flex flex-col">
          {(draftProp === 'status'
            ? VISIBLE_KANBAN_STATUSES.map((s) => ({ value: s as string, label: STATUS_LABEL[s] }))
            : TASK_PRIORITIES.map((p) => ({ value: String(p), label: PRIORITY_META[p].label }))
          ).map(({ value, label }) => (
            <div key={value} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent/50">
              <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
              {(Object.keys(RULE_COLOR_DOT) as ViewRuleColor[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`${label} → ${RULE_COLOR_LABELS[c]}`}
                  title={RULE_COLOR_LABELS[c]}
                  onClick={() =>
                    onChange([
                      ...rules.filter((r) => !(r.prop === draftProp && r.value === value)),
                      { prop: draftProp, value, color: c },
                    ])
                  }
                  className={cn(
                    'size-4 shrink-0 rounded-full ring-offset-1 transition-transform hover:scale-125',
                    RULE_COLOR_DOT[c],
                  )}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Строка-пункт панели со значением справа и шевроном «›» (Notion settings row).
function NavRow({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/90 transition-colors hover:bg-accent"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground/80" />
      {label}
      <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
        {value}
        <ChevronRight className="size-3.5" />
      </span>
    </button>
  );
}

function PanelRow({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
        destructive ? 'text-destructive' : 'text-foreground/90',
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}

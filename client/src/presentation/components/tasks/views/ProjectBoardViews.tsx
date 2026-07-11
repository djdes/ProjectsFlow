import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Copy,
  Eye,
  EyeOff,
  Flag,
  LayoutGrid,
  Link as LinkIcon,
  List,
  ListFilter,
  Pencil,
  Plus,
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { TaskPriority, TaskStatus } from '@/domain/task/Task';
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
import { STATUS_LABEL } from '../statusLabels';
import { KanbanBoard } from '../KanbanBoard';
import { TableView } from './TableView';
import { ListView } from './ListView';
import { CalendarView } from './CalendarView';
import {
  EMPTY_VIEW_FILTERS,
  STATUS_DOT,
  VIEW_COLUMN_LABELS,
  VIEW_SORT_LABELS,
  hasActiveFilters,
  type ViewColumn,
  type ViewDueFilter,
  type ViewFilters,
  type ViewSort,
  type ViewSortKey,
} from './viewShared';
import { DropdownEntries, ContextEntries, type MenuEntry } from './menuEntries';

export const VIEW_TYPE_ICONS: Record<BoardViewType, LucideIcon> = {
  kanban: LayoutGrid,
  table: TableIcon,
  list: List,
  calendar: Calendar,
};

type Props = {
  projectId: string;
  projectName?: string;
  memberCount?: number;
  onOpenAutomation?: () => void;
  // Full-bleed классы канбана (см. KanbanBoard) — остальные виды обычной ширины.
  bleedNegClass?: string;
  bleedPadClass?: string;
};

// id неявной дефолтной вкладки «Доска» (канбан). В БД не хранится, не переименовывается
// и не удаляется — это текущая доска проекта как есть.
const DEFAULT_VIEW_ID = 'default';

// Сколько вкладок показываем в строке; остальные сворачиваются в «N ещё…» (Notion-style).
const MAX_VISIBLE_TABS = 4;

const DUE_FILTER_LABELS: Record<ViewDueFilter, string> = {
  has: 'Есть срок',
  none: 'Без срока',
  overdue: 'Просрочено',
};

// Запрос «создать задачу» из тулбара: seq растёт, вид ловит изменение и открывает окно.
export type ViewCreateRequest = { readonly seq: number; readonly status: TaskStatus };

type PerViewState = { filters: ViewFilters; sort: ViewSort | null; hidden: ViewColumn[] };

// === Вью доски проекта (Notion-style) ===
// Строка вкладок: «Доска» (неявный канбан) + пользовательские вью из БД, overflow — «N ещё…»,
// «+» — правая панель создания. Справа тулбар вью: фильтр / сортировка / поиск / настройки /
// синяя «Создать». Активная вью — localStorage пер-проект; `?view=<id>` в URL важнее
// (для «Скопировать ссылку на вью»).
export function ProjectBoardViews({
  projectId,
  projectName,
  memberCount,
  onOpenAutomation,
  bleedNegClass = '',
  bleedPadClass = '',
}: Props): React.ReactElement {
  const { boardViewRepository } = useContainer();
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
  const [deleteTarget, setDeleteTarget] = useState<BoardView | null>(null);
  const [panel, setPanel] = useState<'settings' | null>(null);
  // Фильтры/сортировка — пер-вью, живут в памяти вкладки (смена вью не сбрасывает).
  const [perView, setPerView] = useState<Record<string, PerViewState>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [createReq, setCreateReq] = useState<ViewCreateRequest | null>(null);

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
      timer = setTimeout(() => void refetch(), 400);
    };
    window.addEventListener(PROJECT_CHANGED_EVENT, onChanged);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(PROJECT_CHANGED_EVENT, onChanged);
    };
  }, [projectId, refetch]);

  const selectView = (id: string): void => {
    setActiveId(id);
    setSearchOpen(false);
    setCreateReq(null);
    try {
      localStorage.setItem(storageKey, id);
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

  const state: PerViewState = perView[activeId] ?? {
    filters: EMPTY_VIEW_FILTERS,
    sort: null,
    hidden: [],
  };
  const setFilters = (patch: Partial<ViewFilters>): void =>
    setPerView((prev) => ({
      ...prev,
      [activeId]: { ...state, filters: { ...state.filters, ...patch } },
    }));
  const setSort = (sort: ViewSort | null): void =>
    setPerView((prev) => ({ ...prev, [activeId]: { ...state, sort } }));
  const toggleColumn = (col: ViewColumn): void =>
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
    try {
      const view = await boardViewRepository.create(projectId, name, type);
      setViews((prev) => [...(prev ?? []), view]);
      selectView(view.id);
      setPanel(null);
    } catch (e) {
      toast.error(`Не удалось создать вью: ${(e as Error).message}`);
    }
  };

  const handleUpdate = async (
    view: BoardView,
    patch: { name?: string; type?: BoardViewType },
  ): Promise<void> => {
    try {
      const updated = await boardViewRepository.update(projectId, view.id, patch);
      setViews((prev) => (prev ?? []).map((v) => (v.id === view.id ? updated : v)));
      setRenameTarget(null);
    } catch (e) {
      toast.error(`Не удалось изменить вью: ${(e as Error).message}`);
    }
  };

  const handleDuplicate = async (view: BoardView): Promise<void> => {
    try {
      const copy = await boardViewRepository.duplicate(projectId, view.id);
      setViews((prev) => [...(prev ?? []), copy]);
      selectView(copy.id);
    } catch (e) {
      toast.error(`Не удалось дублировать: ${(e as Error).message}`);
    }
  };

  const handleDelete = async (view: BoardView): Promise<void> => {
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
      .then(() => toast.success('Ссылка на вью скопирована'))
      .catch(() => toast.error('Не удалось скопировать ссылку'));
  };

  const allViewsSorted = views ?? [];

  // Overflow вкладок: первые N видимы; активная из хвоста подменяет последнюю видимую.
  const { visibleViews, hiddenViews } = useMemo(() => {
    const allViews = views ?? [];
    const limit = MAX_VISIBLE_TABS - 1; // минус вкладка «Доска»
    if (allViews.length <= limit) return { visibleViews: allViews, hiddenViews: [] };
    const visible = allViews.slice(0, limit);
    const hidden = allViews.slice(limit);
    const activeHiddenIdx = hidden.findIndex((v) => v.id === activeId);
    if (activeHiddenIdx >= 0) {
      const swapped = visible[visible.length - 1]!;
      visible[visible.length - 1] = hidden[activeHiddenIdx]!;
      hidden[activeHiddenIdx] = swapped;
    }
    return { visibleViews: visible, hiddenViews: hidden };
  }, [views, activeId]);

  const filtersActive = hasActiveFilters(state.filters);
  const chipsVisible = !isKanban && (filtersActive || state.sort !== null);

  const requestCreate = (status: TaskStatus): void =>
    setCreateReq((prev) => ({ seq: (prev?.seq ?? 0) + 1, status }));

  // Единая спека меню вкладки — рендерится и в дропдаун (клик по активной вкладке),
  // и в контекстное меню (правая кнопка мыши по любой вкладке), как в Notion.
  const tabMenuEntries = (v: BoardView): MenuEntry[] => [
    { kind: 'item', label: 'Переименовать', icon: Pencil, onSelect: () => setRenameTarget(v) },
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
      label: 'Настроить вью',
      icon: Settings2,
      onSelect: () => {
        selectView(v.id);
        setPanel('settings');
      },
    },
    { kind: 'item', label: 'Скопировать ссылку', icon: LinkIcon, onSelect: () => copyViewLink(v) },
    { kind: 'item', label: 'Дублировать вью', icon: Copy, onSelect: () => void handleDuplicate(v) },
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Удалить вью',
      icon: Trash2,
      destructive: true,
      onSelect: () => setDeleteTarget(v),
    },
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Строка вкладок + тулбар вью (Notion-style). На узком экране (как в Notion)
          ряд вкладок сворачивается в одну кнопку «Активная вью ⌄» с дропдауном. */}
      <div className="flex items-center gap-0.5 pb-1">
        {/* Компактный переключатель вью (узкий экран). */}
        <div className="flex min-w-0 flex-1 items-center md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-accent py-1 pl-2 pr-1.5 text-[13px] font-medium text-foreground"
              >
                {(() => {
                  const Icon = VIEW_TYPE_ICONS[activeType];
                  return <Icon className="size-3.5 shrink-0" />;
                })()}
                <span className="max-w-[10rem] truncate">
                  {activeId === DEFAULT_VIEW_ID ? 'Доска' : (active?.name ?? 'Доска')}
                </span>
                <ChevronDown className="size-3 shrink-0 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[13rem]">
              <DropdownMenuItem className="gap-2" onClick={() => selectView(DEFAULT_VIEW_ID)}>
                <LayoutGrid className="size-4" />
                Доска
              </DropdownMenuItem>
              {allViewsSorted.map((v) => {
                const Icon = VIEW_TYPE_ICONS[v.type];
                return (
                  <DropdownMenuItem key={v.id} className="gap-2" onClick={() => selectView(v.id)}>
                    <Icon className="size-4" />
                    <span className="min-w-0 flex-1 truncate">{v.name}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] md:flex [&::-webkit-scrollbar]:hidden">
          <ViewTab
            icon={VIEW_TYPE_ICONS.kanban}
            name="Доска"
            active={activeId === DEFAULT_VIEW_ID}
            onSelect={() => selectView(DEFAULT_VIEW_ID)}
          />
          {visibleViews.map((v) => (
            <ViewTab
              key={v.id}
              icon={VIEW_TYPE_ICONS[v.type]}
              name={v.name}
              active={activeId === v.id}
              onSelect={() => selectView(v.id)}
              menu={tabMenuEntries(v)}
              renameOpen={renameTarget?.id === v.id}
              onRenameClose={() => setRenameTarget(null)}
              onRenameSubmit={(name) => void handleUpdate(v, { name })}
            />
          ))}
          {hiddenViews.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                >
                  ещё {hiddenViews.length}…
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[12rem]">
                {hiddenViews.map((v) => {
                  const Icon = VIEW_TYPE_ICONS[v.type];
                  return (
                    <DropdownMenuItem key={v.id} className="gap-2" onClick={() => selectView(v.id)}>
                      <Icon className="size-4" />
                      <span className="min-w-0 flex-1 truncate">{v.name}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* «+» — попап «Начать с нуля» (Notion Start from scratch): клик по типу сразу
              создаёт вью с именем типа. */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Новая вью"
                title="Новая вью"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
        </div>

        {/* Тулбар вью — только для табличного/списочного/календарного (у канбана свой).
            На узком экране (как в Notion) остаются только настройки и «Создать». */}
        {!isKanban && (
          <div className="flex shrink-0 items-center gap-0.5">
            <div className="hidden items-center gap-0.5 md:flex">
            <FilterMenu filters={state.filters} onChange={setFilters} active={filtersActive} />
            <SortMenu sort={state.sort} onChange={setSort} />
            {onOpenAutomation && (
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
            {active && (
              <ToolbarIcon label="Настройки вью" onClick={() => setPanel('settings')}>
                <Settings2 className="size-4" />
              </ToolbarIcon>
            )}
            <div className="ml-1 inline-flex overflow-hidden rounded-md">
              <Button
                size="sm"
                className="h-7 rounded-r-none px-2.5 text-xs"
                onClick={() => requestCreate('backlog')}
              >
                Создать
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    aria-label="Создать в колонке…"
                    className="h-7 rounded-l-none border-l border-primary-foreground/20 px-1.5"
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[11rem]">
                  {VISIBLE_KANBAN_STATUSES.map((s) => (
                    <DropdownMenuItem key={s} className="gap-2" onClick={() => requestCreate(s)}>
                      <span className={cn('size-2 rounded-full', STATUS_DOT[s])} />
                      {STATUS_LABEL[s]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
      </div>

      {/* Строка активных фильтров/сортировки (chips, Notion-style): клик по chip —
          попап значений (чекбоксы) + «Убрать фильтр»; «+ Фильтр» добавляет следующий. */}
      {chipsVisible && (
        <div className="flex flex-wrap items-center gap-1 pb-2">
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
              {VIEW_SORT_LABELS[state.sort.key]}
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

      {/* Активный вид. key по вью — смена вкладки пересоздаёт вид (свой useTasks/стейт). */}
      {isKanban ? (
        <KanbanBoard
          key={`${projectId}:${activeId}`}
          projectId={projectId}
          projectName={projectName}
          memberCount={memberCount}
          onOpenAutomation={onOpenAutomation}
          bleedNegClass={bleedNegClass}
          bleedPadClass={bleedPadClass}
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
          createRequest={createReq}
        />
      ) : activeType === 'list' ? (
        <ListView
          key={`${projectId}:${activeId}`}
          projectId={projectId}
          projectName={projectName}
          memberCount={memberCount}
          filters={state.filters}
          sort={state.sort}
          createRequest={createReq}
        />
      ) : (
        <CalendarView
          key={`${projectId}:${activeId}`}
          projectId={projectId}
          projectName={projectName}
          memberCount={memberCount}
          filters={state.filters}
          createRequest={createReq}
        />
      )}

      {/* Настройки вью — карточка под тулбаром справа (Notion View settings). */}
      {panel === 'settings' && active && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPanel(null)} aria-hidden />
          <div className="absolute right-0 top-9 z-40 w-80 max-w-[92vw] rounded-lg border bg-card shadow-xl duration-150 animate-in fade-in slide-in-from-top-1">
            <ViewSettingsCard
              view={active}
              onClose={() => setPanel(null)}
              onRename={(name) => void handleUpdate(active, { name })}
              onType={(type) => void handleUpdate(active, { type })}
              onCopyLink={() => copyViewLink(active)}
              onDuplicate={() => void handleDuplicate(active)}
              onDelete={() => setDeleteTarget(active)}
              hidden={state.hidden}
              onToggleColumn={active.type === 'table' ? toggleColumn : undefined}
              filters={state.filters}
              onFilters={setFilters}
              sort={state.sort}
              onSort={setSort}
            />
          </div>
        </>
      )}

      {/* Подтверждение удаления вью (задачи не трогаются — удаляется только представление). */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-xs gap-3 p-5">
          <DialogHeader>
            <DialogTitle className="text-base">Удалить вью?</DialogTitle>
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
        'inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent',
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
  icon: Icon,
  name,
  active,
  onSelect,
  menu,
  renameOpen = false,
  onRenameClose,
  onRenameSubmit,
}: {
  icon: LucideIcon;
  name: string;
  active: boolean;
  onSelect: () => void;
  menu?: MenuEntry[];
  renameOpen?: boolean;
  onRenameClose?: () => void;
  onRenameSubmit?: (name: string) => void;
}): React.ReactElement {
  const tabClass = cn(
    'inline-flex shrink-0 items-center gap-1.5 rounded-md py-1 pl-2 pr-2 text-[13px] font-medium transition-colors',
    active
      ? 'bg-accent text-foreground'
      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
  );
  const inner = (
    <>
      <Icon className="size-3.5 shrink-0" />
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
          <button type="button" aria-label="Меню вью" title="Меню вью" className={tabClass}>
            {inner}
          </button>
        ) : (
          <button type="button" onClick={onSelect} className={tabClass}>
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
            <DropdownMenuContent align="start" className="min-w-[13rem]">
              <DropdownEntries entries={menu} />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          btn
        )}
        <ContextMenuContent className="min-w-[13rem]">
          <ContextEntries entries={menu} />
        </ContextMenuContent>
      </ContextMenu>
    );
  } else {
    tab = (
      <button type="button" onClick={onSelect} className={tabClass}>
        {inner}
      </button>
    );
  }

  if (!onRenameSubmit) return tab;
  return (
    <Popover open={renameOpen} onOpenChange={(o) => !o && onRenameClose?.()}>
      <PopoverAnchor asChild>
        <span className="inline-flex shrink-0">{tab}</span>
      </PopoverAnchor>
      <PopoverContent align="start" className="w-64 p-1.5" onOpenAutoFocus={(e) => e.preventDefault()}>
        <TabRenameInput initial={name} onSubmit={onRenameSubmit} onClose={() => onRenameClose?.()} />
      </PopoverContent>
    </Popover>
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
      onBlur={submit}
      maxLength={64}
      aria-label="Название вью"
      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground/30"
    />
  );
}

// Карточка «Настройки вью» (Notion View settings): строки-пункты со значением и «›»,
// drill-down в подстраницы Вид / Свойства / Фильтр / Сортировка с «‹ Назад».
type SettingsPage = 'root' | 'layout' | 'props' | 'filter' | 'sort';

function ViewSettingsCard({
  view,
  onClose,
  onRename,
  onType,
  onCopyLink,
  onDuplicate,
  onDelete,
  hidden,
  onToggleColumn,
  filters,
  onFilters,
  sort,
  onSort,
}: {
  view: BoardView;
  onClose: () => void;
  onRename: (name: string) => void;
  onType: (t: BoardViewType) => void;
  onCopyLink: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  hidden: ViewColumn[];
  onToggleColumn?: (c: ViewColumn) => void;
  filters: ViewFilters;
  onFilters: (patch: Partial<ViewFilters>) => void;
  sort: ViewSort | null;
  onSort: (s: ViewSort | null) => void;
}): React.ReactElement {
  const [page, setPage] = useState<SettingsPage>('root');
  const [name, setName] = useState(view.name);
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
    <div className="flex max-h-[70vh] flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <p className="text-sm font-semibold">Настройки вью</p>
        <button
          type="button"
          aria-label="Закрыть панель"
          onClick={onClose}
          className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
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
                aria-label="Название вью"
                className="h-8 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus:border-foreground/30"
              />
            </div>
            <NavRow
              icon={TypeIcon}
              label="Вид"
              value={BOARD_VIEW_TYPE_LABELS[view.type]}
              onClick={() => setPage('layout')}
            />
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
              value={sort ? VIEW_SORT_LABELS[sort.key] : undefined}
              onClick={() => setPage('sort')}
            />
            <PanelRow icon={LinkIcon} label="Скопировать ссылку на вью" onClick={onCopyLink} />
            <div className="my-0.5 border-t" />
            <PanelRow icon={Copy} label="Дублировать вью" onClick={onDuplicate} />
            <PanelRow icon={Trash2} label="Удалить вью" onClick={onDelete} destructive />
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
            {(Object.keys(VIEW_COLUMN_LABELS) as ViewColumn[]).map((c) => {
              const isHidden = hidden.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => onToggleColumn(c)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/90 transition-colors hover:bg-accent"
                >
                  {VIEW_COLUMN_LABELS[c]}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {isHidden ? 'Скрыто' : 'Показано'}
                  </span>
                  {isHidden ? (
                    <EyeOff className="size-4 text-muted-foreground/70" />
                  ) : (
                    <Eye className="size-4 text-muted-foreground/70" />
                  )}
                </button>
              );
            })}
          </div>
        )}
        {page === 'filter' && (
          <div className="flex flex-col gap-1">
            {backHeader('Фильтр')}
            <FilterPicker filters={filters} onChange={onFilters} />
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

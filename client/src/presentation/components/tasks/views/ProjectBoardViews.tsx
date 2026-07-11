import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Check,
  ChevronDown,
  Copy,
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  VIEW_SORT_LABELS,
  type ViewDueFilter,
  type ViewFilters,
  type ViewSort,
  type ViewSortKey,
} from './viewShared';

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

type PerViewState = { filters: ViewFilters; sort: ViewSort | null };

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
  const [panel, setPanel] = useState<'new' | 'settings' | null>(null);
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

  const state: PerViewState = perView[activeId] ?? { filters: EMPTY_VIEW_FILTERS, sort: null };
  const setFilters = (patch: Partial<ViewFilters>): void =>
    setPerView((prev) => ({
      ...prev,
      [activeId]: { ...state, filters: { ...state.filters, ...patch } },
    }));
  const setSort = (sort: ViewSort | null): void =>
    setPerView((prev) => ({ ...prev, [activeId]: { ...state, sort } }));

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

  const filtersActive =
    state.filters.status !== null || state.filters.priority !== null || state.filters.due !== null;
  const chipsVisible = !isKanban && (filtersActive || state.sort !== null);

  const requestCreate = (status: TaskStatus): void =>
    setCreateReq((prev) => ({ seq: (prev?.seq ?? 0) + 1, status }));

  const tabMenu = (v: BoardView): React.ReactNode => (
    <>
      <DropdownMenuItem className="gap-2" onClick={() => setRenameTarget(v)}>
        <Pencil className="size-4" />
        Переименовать
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          {(() => {
            const Icon = VIEW_TYPE_ICONS[v.type];
            return <Icon className="size-4" />;
          })()}
          Показывать как
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-[11rem]">
          {BOARD_VIEW_TYPES.map((t) => {
            const Icon = VIEW_TYPE_ICONS[t];
            return (
              <DropdownMenuItem key={t} className="gap-2" onClick={() => void handleUpdate(v, { type: t })}>
                <Icon className="size-4" />
                {BOARD_VIEW_TYPE_LABELS[t]}
                {v.type === t && <Check className="ml-auto size-3.5" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem className="gap-2" onClick={() => setPanel('settings')}>
        <Settings2 className="size-4" />
        Настроить вью
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2" onClick={() => copyViewLink(v)}>
        <LinkIcon className="size-4" />
        Скопировать ссылку
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2" onClick={() => void handleDuplicate(v)}>
        <Copy className="size-4" />
        Дублировать вью
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="gap-2 text-destructive focus:text-destructive"
        onClick={() => setDeleteTarget(v)}
      >
        <Trash2 className="size-4" />
        Удалить вью
      </DropdownMenuItem>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Строка вкладок + тулбар вью (Notion-style). */}
      <div className="flex items-center gap-0.5 pb-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
              menu={tabMenu(v)}
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
          <button
            type="button"
            aria-label="Новая вью"
            title="Новая вью"
            onClick={() => setPanel('new')}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>

        {/* Тулбар вью — только для табличного/списочного/календарного (у канбана свой). */}
        {!isKanban && (
          <div className="flex shrink-0 items-center gap-0.5">
            <FilterMenu filters={state.filters} onChange={setFilters} active={filtersActive} />
            <SortMenu sort={state.sort} onChange={setSort} />
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

      {/* Строка активных фильтров/сортировки (chips, Notion-style). */}
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
          {state.filters.status !== null && (
            <FilterChip
              label={`Статус: ${STATUS_LABEL[state.filters.status]}`}
              onClear={() => setFilters({ status: null })}
            />
          )}
          {state.filters.priority !== null && (
            <FilterChip
              label={`Приоритет: ${PRIORITY_META[state.filters.priority].label}`}
              onClear={() => setFilters({ priority: null })}
            />
          )}
          {state.filters.due !== null && (
            <FilterChip
              label={DUE_FILTER_LABELS[state.filters.due]}
              onClear={() => setFilters({ due: null })}
            />
          )}
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
          sort={state.sort}
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

      {/* Правая панель: создание вью. */}
      <SidePanel open={panel === 'new'} onClose={() => setPanel(null)} title="Новая вью">
        <NewViewPanel onCreate={handleCreate} />
      </SidePanel>

      {/* Правая панель: настройки активной вью. */}
      <SidePanel open={panel === 'settings' && active !== null} onClose={() => setPanel(null)} title="Настройки вью">
        {active && (
          <ViewSettingsPanel
            view={active}
            onRename={(name) => void handleUpdate(active, { name })}
            onType={(type) => void handleUpdate(active, { type })}
            onCopyLink={() => copyViewLink(active)}
            onDuplicate={() => void handleDuplicate(active)}
            onDelete={() => setDeleteTarget(active)}
          />
        )}
      </SidePanel>

      {/* Переименование вью. */}
      <RenameViewDialog
        view={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSubmit={(name) => renameTarget && void handleUpdate(renameTarget, { name })}
      />

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

// Меню «Фильтр»: свойство → значения (Notion Filter by…).
function FilterMenu({
  filters,
  onChange,
  active,
}: {
  filters: ViewFilters;
  onChange: (patch: Partial<ViewFilters>) => void;
  active: boolean;
}): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">Фильтровать по…</p>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <span className={cn('size-2 rounded-full', filters.status ? STATUS_DOT[filters.status] : 'bg-muted-foreground/30')} />
            Статус
            {filters.status !== null && (
              <span className="ml-auto text-xs text-muted-foreground">{STATUS_LABEL[filters.status]}</span>
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[11rem]">
            {VISIBLE_KANBAN_STATUSES.map((s) => (
              <DropdownMenuItem key={s} className="gap-2" onClick={() => onChange({ status: s })}>
                <span className={cn('size-2 rounded-full', STATUS_DOT[s])} />
                {STATUS_LABEL[s]}
                {filters.status === s && <Check className="ml-auto size-3.5" />}
              </DropdownMenuItem>
            ))}
            {filters.status !== null && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-muted-foreground" onClick={() => onChange({ status: null })}>
                  Сбросить
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            Приоритет
            {filters.priority !== null && (
              <span className="ml-auto text-xs text-muted-foreground">
                {PRIORITY_META[filters.priority].label}
              </span>
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[11rem]">
            {TASK_PRIORITIES.map((p: TaskPriority) => (
              <DropdownMenuItem key={p} className="gap-2" onClick={() => onChange({ priority: p })}>
                <span className={cn('size-2 rounded-full', PRIORITY_META[p].dotColor)} />
                {PRIORITY_META[p].label}
                {filters.priority === p && <Check className="ml-auto size-3.5" />}
              </DropdownMenuItem>
            ))}
            {filters.priority !== null && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-muted-foreground" onClick={() => onChange({ priority: null })}>
                  Сбросить
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            Срок
            {filters.due !== null && (
              <span className="ml-auto text-xs text-muted-foreground">{DUE_FILTER_LABELS[filters.due]}</span>
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[11rem]">
            {(Object.keys(DUE_FILTER_LABELS) as ViewDueFilter[]).map((d) => (
              <DropdownMenuItem key={d} onClick={() => onChange({ due: d })}>
                {DUE_FILTER_LABELS[d]}
                {filters.due === d && <Check className="ml-auto size-3.5" />}
              </DropdownMenuItem>
            ))}
            {filters.due !== null && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-muted-foreground" onClick={() => onChange({ due: null })}>
                  Сбросить
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-muted-foreground"
              onClick={() => onChange({ status: null, priority: null, due: null })}
            >
              Сбросить все фильтры
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Меню «Сортировка»: выбор свойства (повторный клик по chip меняет направление).
function SortMenu({
  sort,
  onChange,
}: {
  sort: ViewSort | null;
  onChange: (s: ViewSort | null) => void;
}): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">Сортировать по…</p>
        {(Object.keys(VIEW_SORT_LABELS) as ViewSortKey[]).map((k) => (
          <DropdownMenuItem
            key={k}
            className="gap-2"
            onClick={() =>
              onChange(
                sort?.key === k ? { key: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' },
              )
            }
          >
            {VIEW_SORT_LABELS[k]}
            {sort?.key === k &&
              (sort.dir === 'asc' ? (
                <ArrowUp className="ml-auto size-3.5" />
              ) : (
                <ArrowDown className="ml-auto size-3.5" />
              ))}
          </DropdownMenuItem>
        ))}
        {sort && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-muted-foreground" onClick={() => onChange(null)}>
              Убрать сортировку
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }): React.ReactElement {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 text-xs text-primary">
      {label}
      <button type="button" aria-label={`Убрать фильтр ${label}`} onClick={onClear}>
        <X className="size-3 opacity-60 hover:opacity-100" />
      </button>
    </span>
  );
}

// Вкладка вью: клик — выбрать; у АКТИВНОЙ пользовательской справа появляется шеврон-меню.
// Меню НЕ на самой кнопке вкладки: Radix-триггер перехватывает pointerdown и глушит клик —
// вкладка переставала переключаться (ловилось e2e). У дефолтной «Доски» меню нет.
function ViewTab({
  icon: Icon,
  name,
  active,
  onSelect,
  menu,
}: {
  icon: LucideIcon;
  name: string;
  active: boolean;
  onSelect: () => void;
  menu?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center rounded-md transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'inline-flex items-center gap-1.5 py-1 pl-2 text-[13px] font-medium',
          active && menu ? 'pr-0.5' : 'pr-2',
        )}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="max-w-[9rem] truncate">{name}</span>
      </button>
      {active && menu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Меню вью"
              title="Меню вью"
              className="grid h-full place-items-center rounded-r-md py-1 pl-0.5 pr-1.5 text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[13rem]">
            {menu}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// Правая выезжающая панель (Notion side panel): прозрачный оверлей, клик вне закрывает.
function SidePanel({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}): React.ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div className="fixed inset-y-0 right-0 z-50 flex w-[21rem] max-w-[92vw] flex-col border-l bg-card shadow-2xl duration-200 animate-in slide-in-from-right-4 fade-in">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">{title}</p>
          <button
            type="button"
            aria-label="Закрыть панель"
            onClick={onClose}
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </>
  );
}

// Содержимое панели «Новая вью»: имя + сетка типов + «Готово» (Notion New view panel).
function NewViewPanel({
  onCreate,
}: {
  onCreate: (name: string, type: BoardViewType) => Promise<void>;
}): React.ReactElement {
  const [type, setType] = useState<BoardViewType>('table');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const effectiveName = (touched && name.trim()) || BOARD_VIEW_TYPE_LABELS[type];

  return (
    <div className="flex flex-col gap-3">
      <input
        autoFocus
        value={touched ? name : ''}
        onChange={(e) => {
          setTouched(true);
          setName(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void onCreate(effectiveName, type);
          }
        }}
        maxLength={64}
        placeholder={BOARD_VIEW_TYPE_LABELS[type]}
        aria-label="Название вью"
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-foreground/30"
      />
      <div>
        <p className="pb-1.5 text-xs font-medium text-muted-foreground">Вид</p>
        <div className="grid grid-cols-2 gap-1.5">
          {BOARD_VIEW_TYPES.map((t) => {
            const Icon = VIEW_TYPE_ICONS[t];
            return (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs transition-colors',
                  type === t
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
      <Button size="sm" className="w-full" onClick={() => void onCreate(effectiveName, type)}>
        Готово
      </Button>
    </div>
  );
}

// Содержимое панели «Настройки вью»: имя (live), layout, ссылки/дублировать/удалить.
function ViewSettingsPanel({
  view,
  onRename,
  onType,
  onCopyLink,
  onDuplicate,
  onDelete,
}: {
  view: BoardView;
  onRename: (name: string) => void;
  onType: (t: BoardViewType) => void;
  onCopyLink: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const [name, setName] = useState(view.name);
  useEffect(() => setName(view.name), [view.id, view.name]);
  const commitName = (): void => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== view.name) onRename(trimmed);
  };
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="pb-1.5 text-xs font-medium text-muted-foreground">Название</p>
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
          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-foreground/30"
        />
      </div>
      <div>
        <p className="pb-1.5 text-xs font-medium text-muted-foreground">Вид</p>
        <div className="grid grid-cols-2 gap-1.5">
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
      <div className="flex flex-col gap-0.5 border-t pt-3">
        <PanelRow icon={LinkIcon} label="Скопировать ссылку на вью" onClick={onCopyLink} />
        <PanelRow icon={Copy} label="Дублировать вью" onClick={onDuplicate} />
        <PanelRow icon={Trash2} label="Удалить вью" onClick={onDelete} destructive />
      </div>
    </div>
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

function RenameViewDialog({
  view,
  onClose,
  onSubmit,
}: {
  view: BoardView | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  useEffect(() => {
    setName(view?.name ?? '');
  }, [view]);
  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <Dialog open={view !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs gap-3 p-5">
        <DialogHeader>
          <DialogTitle className="text-base">Переименовать вью</DialogTitle>
        </DialogHeader>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={64}
          aria-label="Название вью"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground/30"
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit}>Сохранить</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

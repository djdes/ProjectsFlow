import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  Copy,
  FolderSearch,
  Heart,
  HeartOff,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { useProjects } from '@/presentation/hooks/useProjects';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { Collapse } from '@/presentation/components/motion/Collapse';
import { useReorderProjects } from '@/presentation/hooks/useReorderProjects';
import { useReorderFavoriteProjects } from '@/presentation/hooks/useReorderFavoriteProjects';
import { useToggleProjectFavorite } from '@/presentation/hooks/useToggleProjectFavorite';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';
import { useDuplicateProject } from '@/presentation/hooks/useDuplicateProject';
import { useNewProjectDialog } from '@/presentation/components/forms/NewProjectDialogProvider';
import { useSidebarSectionCollapse } from '@/presentation/hooks/useSidebarSectionCollapse';
import { useSidebarTaskSearch } from '@/presentation/hooks/useSidebarTaskSearch';
import { Highlight } from '@/presentation/components/search/Highlight';
import { matchesKeyboardLayoutQuery } from '@/lib/keyboardLayoutSearch';
import { RecentTasksBlock } from './RecentTasksBlock';
import { SidebarTaskResults } from './SidebarTaskResults';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { avatarColor } from './projectIcons';
import { RenameProjectDialog } from '@/presentation/components/project/RenameProjectDialog';
import { DeleteProjectDialog } from '@/presentation/components/project/DeleteProjectDialog';
import type { Project } from '@/domain/project/Project';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';

type MoveDir = 'up' | 'down';
type Bucket = 'favorites' | 'main';

type RowProps = {
  project: Project;
  // Какой секции принадлежит эта строка. Один и тот же project.id может рендериться
  // в обеих секциях — bucket нужен для уникальных id (dnd-kit, React keys) и для
  // выбора правильного onMove.
  bucket: Bucket;
  // Перетаскивание/перемещение доступно только на полном списке (без активного поиска).
  reorderable: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (projectId: string, dir: MoveDir) => void;
  // Активный поисковый запрос — подсвечиваем совпадение в имени проекта (пусто = без подсветки).
  highlightQuery?: string;
};

function SidebarProjectRow({
  project,
  bucket,
  reorderable,
  isFirst,
  isLast,
  onMove,
  highlightQuery,
}: RowProps): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh: refreshProjects } = useProjectsContext();
  const { toggle: toggleFavorite } = useToggleProjectFavorite();
  const { submit: updateProject } = useUpdateProject();
  const { submit: duplicateProject } = useDuplicateProject();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isArchived = project.status === 'archived';
  // Удалить может только owner; inbox-проект (служебный, один на юзера) удалять
  // нельзя в принципе — пункт прячем, чтобы не было ложной кнопки.
  const canDelete = project.role === 'owner' && !project.isInbox;
  // Архивировать/дублировать — editor+ (viewer не может менять проект). Inbox исключаем.
  const canManage = project.role !== 'viewer' && !project.isInbox;

  const handleSetArchived = async (archived: boolean): Promise<void> => {
    try {
      await updateProject(project.id, { status: archived ? 'archived' : 'active' });
      refreshProjects();
    } catch (e) {
      toast.error(`Не удалось ${archived ? 'архивировать' : 'вернуть'} проект: ${(e as Error).message}`);
    }
  };

  const handleDuplicate = async (): Promise<void> => {
    try {
      const created = await duplicateProject({ name: project.name, icon: project.icon });
      refreshProjects();
      navigate(`/projects/${created.id}`);
    } catch (e) {
      toast.error(`Не удалось дублировать проект: ${(e as Error).message}`);
    }
  };

  // Один project.id может рендериться дважды (в favorites и в main); чтобы dnd-kit и
  // React не ругались на дубли ключей — префиксуем sortable-id'шник bucket'ом.
  const sortableId = `${bucket}-${project.id}`;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    disabled: !reorderable,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Авто-скролл активного проекта в зону видимости — в длинном списке легко потерять
  // место. Композируем ref dnd-kit со своим, чтобы дотянуться до DOM-узла строки.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const setRefs = (node: HTMLDivElement | null): void => {
    setNodeRef(node);
    rowRef.current = node;
  };
  const isActiveRoute =
    location.pathname === `/projects/${project.id}` ||
    location.pathname.startsWith(`/projects/${project.id}/`);
  useEffect(() => {
    if (isActiveRoute) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isActiveRoute]);

  // Бейджи (число задач + индикатор команды) прячем при hover/focus/открытом меню —
  // на их месте появляется кнопка «три точки».
  const actionsActive = menuOpen;

  return (
    <div
      ref={setRefs}
      style={style}
      // Правый клик по строке = открытие меню «три точки» (контекст-меню проекта).
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      className={cn(
        'group relative flex items-center rounded-md',
        isDragging && 'z-10 opacity-60',
      )}
    >
      <NavLink
        to={`/projects/${project.id}`}
        // listeners/attributes на ссылке: тащим за всю строку. Мышь — порог 8px; тач —
        // long-press, чтобы тап-навигация и скролл списка не превращались в drag.
        {...(reorderable ? listeners : {})}
        {...(reorderable ? attributes : {})}
        className={({ isActive }) =>
          cn(
            'relative flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors',
            'hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]',
            'cursor-pointer',
            isActive && 'bg-foreground/[0.06] font-medium text-foreground dark:bg-white/10',
            isArchived && 'opacity-50',
            // На active drag — grab-cursor, иначе обычная pointer-рука (это всё-таки ссылка).
            reorderable && isDragging && 'cursor-grabbing',
          )
        }
      >
        {() => (
          <>
            {/* Иконка: эмодзи проекта (если задана) или фирменный чип — детерминированный
                цвет проекта + первая буква имени (Notion-style). git-подключение —
                маленькая зелёная точка-индикатор поверх. */}
            <span className="relative shrink-0">
              {project.icon ? (
                <span className="grid size-5 place-items-center overflow-hidden text-base leading-none" aria-hidden>
                  <ProjectIconView icon={project.icon} pixelSize={18} />
                </span>
              ) : (
                <span
                  className={cn(
                    'grid size-5 place-items-center rounded-md text-xs font-semibold leading-none',
                    avatarColor(project.name),
                  )}
                  aria-hidden
                >
                  {(project.name.trim()[0] ?? '?').toUpperCase()}
                </span>
              )}
              {project.gitRepoUrl && (
                <span
                  aria-hidden
                  className="absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full bg-emerald-500 ring-2 ring-sidebar"
                />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <Highlight text={project.name} query={highlightQuery ?? ''} />
            </span>
            {/* В покое справа — только иконка совместного проекта (ровный правый край).
                По наведению она гаснет: на её место выезжают число задач + «три точки». */}
            {(project.memberCount ?? 0) > 1 && (
              <Users
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-opacity',
                  'group-hover:opacity-0 group-focus-within:opacity-0 max-md:opacity-0',
                  actionsActive && 'opacity-0',
                )}
                aria-label="Совместный проект"
              />
            )}
          </>
        )}
      </NavLink>

      {/* Число задач — появляется по наведению, слева от кнопки «три точки» (right-1, size-7). */}
      {(project.taskCount ?? 0) > 0 && (
        <span
          aria-label={`Задач: ${project.taskCount}`}
          className={cn(
            'pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-xs leading-5 tabular-nums text-muted-foreground',
            'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100',
            actionsActive && 'opacity-100',
          )}
        >
          {project.taskCount}
        </span>
      )}

      {/* «Три точки»: видны при наведении/фокусе строки, при открытом меню и на мобиле. */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Действия проекта «${project.name}»`}
            // Не даём нажатию инициировать drag строки (mousedown/touchstart — активаторы dnd-kit).
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className={cn(
              'absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-all duration-200 hover:bg-foreground/[0.06] hover:text-foreground dark:hover:bg-white/10',
              'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100',
              menuOpen && 'opacity-100',
            )}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-48">
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <Pencil />
            Изменить имя
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void toggleFavorite(project.id, !project.isFavorite);
            }}
          >
            {project.isFavorite ? <HeartOff /> : <Heart />}
            {project.isFavorite ? 'Удалить из избранного' : 'Добавить в избранное'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate(`/projects/${project.id}/kb`)}>
            <BookOpen />
            База знаний
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate(`/projects/${project.id}/overview`)}>
            <Users />
            Общий доступ
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!reorderable || isFirst}
            onSelect={() => onMove(project.id, 'up')}
          >
            <ArrowUp />
            Переместить выше
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!reorderable || isLast}
            onSelect={() => onMove(project.id, 'down')}
          >
            <ArrowDown />
            Переместить ниже
          </DropdownMenuItem>
          {canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void handleDuplicate()}>
                <Copy />
                Дублировать
              </DropdownMenuItem>
              {isArchived ? (
                <DropdownMenuItem onSelect={() => void handleSetArchived(false)}>
                  <ArchiveRestore />
                  Вернуть из архива
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => void handleSetArchived(true)}>
                  <Archive />
                  В архив
                </DropdownMenuItem>
              )}
            </>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setDeleteOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 />
                Удалить проект…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameProjectDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        projectId={project.id}
        currentName={project.name}
      />

      {canDelete && (
        <DeleteProjectDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          projectId={project.id}
          projectName={project.name}
          // memberCount включает самого юзера; «остальные» = на 1 меньше.
          // Если поле не пришло (старый ответ) — считаем что других нет.
          otherMemberCount={Math.max(0, (project.memberCount ?? 1) - 1)}
          onDeleted={() => {
            // Если удалили проект, на странице которого сейчас находимся — уведём на главную.
            if (location.pathname.startsWith(`/projects/${project.id}`)) {
              navigate('/');
            }
            // И руками просим список перечитать (realtime SSE тоже сработает, но
            // мгновенное обновление UX лучше — пользователь видит результат сразу).
            refreshProjects();
          }}
        />
      )}
    </div>
  );
}

function SidebarProjectListSkeleton(): React.ReactElement {
  return (
    <div className="space-y-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <div className="size-4 shrink-0 animate-pulse rounded bg-muted" />
          <div
            className="h-3 animate-pulse rounded bg-muted"
            style={{ width: `${60 + (i % 3) * 10}%` }}
          />
        </div>
      ))}
    </div>
  );
}

// Один проект в секции. Хелпер выносит общий рендер строк (skeleton иначе разрастается).
function ProjectGroup({
  projects,
  bucket,
  reorderable,
  onReorderEnd,
  onMove,
  highlightQuery,
}: {
  projects: readonly Project[];
  bucket: Bucket;
  reorderable: boolean;
  onReorderEnd: (event: DragEndEvent) => void;
  onMove: (projectId: string, dir: MoveDir) => void;
  highlightQuery?: string;
}): React.ReactElement {
  // Мышь — порог 8px (быстрый reorder). Тач — long-press ~220мс, чтобы скролл списка
  // проектов пальцем не «хватал» строку (строки — это ещё и навигация по тапу).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );
  const sortableIds = projects.map((p) => `${bucket}-${p.id}`);

  const rows = (
    <div className="space-y-1">
      {projects.map((p, idx) => (
        <SidebarProjectRow
          key={`${bucket}-${p.id}`}
          project={p}
          bucket={bucket}
          reorderable={reorderable}
          isFirst={idx === 0}
          isLast={idx === projects.length - 1}
          onMove={onMove}
          highlightQuery={highlightQuery}
        />
      ))}
    </div>
  );

  if (!reorderable) return rows;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorderEnd}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        {rows}
      </SortableContext>
    </DndContext>
  );
}

// Лимит проектов на тариф. Сейчас у всех безлимит → показываем ∞. Когда появятся
// тарифы, значение придёт из профиля/подписки и рендер ниже подхватит число.
const PROJECT_LIMIT = Infinity;

// Затухание краёв списка при прокрутке (как в Notion). Маска живёт в CSS
// (.pf-scroll-fade), здесь — только решение, с какой стороны её включить: сверху, если
// что-то уже прокручено вверх, снизу — пока список не домотан до конца. Статичная маска
// не годится: она гасила бы первый и последний пункт, когда скрывать нечего.
// Возвращаем ref-КОЛБЭК (через useState), а не useRef: контейнер списка размонтируется
// при переключении на общий чат пространства, и подписки должны переезжать вместе с ним.
function useScrollFade(): (node: HTMLDivElement | null) => void {
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!node) return;
    const sync = (): void => {
      // Допуск в 1px: при zoom/HiDPI scrollTop дробный и до точного края не доходит.
      node.dataset.fadeTop = node.scrollTop > 1 ? 'true' : 'false';
      node.dataset.fadeBottom =
        node.scrollTop + node.clientHeight < node.scrollHeight - 1 ? 'true' : 'false';
      // Заголовки секций — sticky top-0, поэтому затухание должно начинаться под
      // прилипшим заголовком, а не у верха контейнера: иначе гаснет сам заголовок.
      // Берём НИЗ заголовка, а не его высоту: когда следующая секция выталкивает
      // текущий заголовок вверх, низ уезжает вместе с ним и граница едет плавно.
      const box = node.getBoundingClientRect();
      let start = 0;
      for (const header of node.querySelectorAll<HTMLElement>('[data-pf-sticky-header]')) {
        const r = header.getBoundingClientRect();
        const pinned = r.top - box.top < 1 && r.bottom - box.top > 1;
        if (pinned) start = Math.max(start, r.bottom - box.top);
      }
      node.style.setProperty('--pf-fade-start', `${Math.round(start)}px`);
    };
    node.addEventListener('scroll', sync, { passive: true });
    // Высота меняется не только от скролла: поиск, разворот секций, догрузка проектов.
    // ResizeObserver ловит размер вьюпорта, MutationObserver — изменения содержимого.
    const ro = new ResizeObserver(sync);
    ro.observe(node);
    const mo = new MutationObserver(sync);
    mo.observe(node, { childList: true, subtree: true });
    sync();
    return () => {
      node.removeEventListener('scroll', sync);
      ro.disconnect();
      mo.disconnect();
    };
  }, [node]);

  return setNode;
}

export function SidebarProjectList(): React.ReactElement {
  const { data, loading, error } = useProjects();
  const { reorder } = useReorderProjects();
  const { reorder: reorderFavorites } = useReorderFavoriteProjects();
  const { open: openNewProject } = useNewProjectDialog();
  const { collapsed: favCollapsed, toggle: toggleFavCollapsed } =
    useSidebarSectionCollapse('favorites');
  const { collapsed: mainCollapsed, toggle: toggleMainCollapsed } =
    useSidebarSectionCollapse('main');
  const { collapsed: archivedCollapsed, toggle: toggleArchivedCollapsed } =
    useSidebarSectionCollapse('archived', true);
  const [query, setQuery] = useState('');
  // Поиск ищет И по проектам (по имени, мгновенно), И по задачам (по описанию, дебаунс).
  const taskSearch = useSidebarTaskSearch(query);
  // Вызываем ДО ранних return'ов ниже — иначе порядок хуков поедет между рендерами.
  const setScrollFadeRef = useScrollFade();

  if (loading) return <SidebarProjectListSkeleton />;

  if (error) {
    return (
      <p className="px-2 py-1.5 text-sm text-destructive">
        Не&nbsp;удалось загрузить список проектов.
      </p>
    );
  }

  // Inbox-проект скрываем — он рендерится отдельным пунктом в Sidebar.
  const all = (data ?? []).filter((p) => !p.isInbox);
  // Активные проекты идут в «Избранное»/«Мои проекты», архивные — в отдельную секцию ниже.
  const visible = all.filter((p) => p.status !== 'archived');
  const archived = all.filter((p) => p.status === 'archived');

  // Шапка «Мои проекты» (заголовок + счётчик + «+») рендерится всегда, чтобы юзер мог
  // создать первый проект. Сам заголовок кликается — сворачивает секцию (как в Todoist).
  // Фон заголовков — СПЛОШНОЙ, без bg-sidebar/90 + backdrop-blur-sm: mask-image на
  // скролл-контейнере (.pf-scroll-fade) отключает backdrop-filter, и сквозь полупрозрачный
  // фон читался уезжающий под заголовок текст. Проверено рендером: с блюром — чёткий
  // «призрак» названия проекта поверх заголовка, со сплошным фоном — чисто.
  const myProjectsHeader = (
    <div
      data-pf-sticky-header
      className="sticky top-0 z-10 flex items-center justify-between gap-1 rounded bg-sidebar px-2 py-1.5"
    >
      <button
        type="button"
        onClick={toggleMainCollapsed}
        aria-expanded={!mainCollapsed}
        className="group flex flex-1 items-center rounded text-left text-xs font-medium text-muted-foreground/80 hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            'h-3 w-0 shrink-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover:mr-1.5 group-hover:w-3 group-hover:opacity-100',
            mainCollapsed && '-rotate-90',
          )}
        />
        <span>Мои проекты</span>
        {/* Лимит показываем только когда он реально есть (тарифы); «/∞» — дев-шум. */}
        <span className="ml-1.5 tabular-nums opacity-70">
          {PROJECT_LIMIT === Infinity ? visible.length : `${visible.length}/${PROJECT_LIMIT}`}
        </span>
      </button>
      <button
        type="button"
        onClick={openNewProject}
        aria-label="Новый проект"
        className="group grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground active:scale-90 dark:hover:bg-white/10"
      >
        <Plus className="size-4 transition-transform duration-300 group-hover:rotate-90" />
      </button>
    </div>
  );

  if (all.length === 0) {
    return (
      <div className="space-y-1.5">
        {myProjectsHeader}
        <p className="px-2 py-1.5 text-sm text-muted-foreground">Проектов пока нет.</p>
      </div>
    );
  }

  const q = query.trim();
  const searching = q.length > 0;
  const matches = (p: Project): boolean => matchesKeyboardLayoutQuery(p.name, q);

  // Секция «Избранное» — подмножество, сортированное локально по favorite_sort_order
  // (сервер отдаёт основной список в порядке sort_order). Дубликат project.id ожидаем —
  // см. spec: проект виден И в «Избранное», И в «Мои проекты».
  const favoritesAll = visible
    .filter((p) => p.isFavorite)
    .slice()
    .sort((a, b) => a.favoriteSortOrder - b.favoriteSortOrder);

  const favorites = searching ? favoritesAll.filter(matches) : favoritesAll;
  const regular = searching ? visible.filter(matches) : visible;
  // Секцию «Избранное» показываем только когда есть favorites И мы не в режиме поиска.
  // При поиске сворачиваем в плоский результат, чтобы не было дублей в выдаче.
  const showFavoritesSection = !searching && favoritesAll.length > 0;

  // В режиме поиска DnD выключен (как и в исходной логике).
  const reorderable = !searching;

  const handleFavoritesDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = favorites.map((p) => p.id);
    const oldIndex = ids.indexOf(stripBucket(String(active.id)));
    const newIndex = ids.indexOf(stripBucket(String(over.id)));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ids, oldIndex, newIndex);
    void reorderFavorites(ids, next);
  };

  const handleRegularDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = regular.map((p) => p.id);
    const oldIndex = ids.indexOf(stripBucket(String(active.id)));
    const newIndex = ids.indexOf(stripBucket(String(over.id)));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ids, oldIndex, newIndex);
    void reorder(ids, next);
  };

  const moveInFavorites = (projectId: string, dir: MoveDir): void => {
    const ids = favorites.map((p) => p.id);
    const i = ids.indexOf(projectId);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = arrayMove(ids, i, j);
    void reorderFavorites(ids, next);
  };

  const moveInRegular = (projectId: string, dir: MoveDir): void => {
    const ids = regular.map((p) => p.id);
    const i = ids.indexOf(projectId);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = arrayMove(ids, i, j);
    void reorder(ids, next);
  };

  const hasTaskMatches = taskSearch.results.length > 0;
  const hasProjectMatches = regular.length > 0;
  // Совсем ничего не нашли — ни в задачах, ни в проектах — и поиск задач уже отработал.
  const nothingFound = searching && !taskSearch.loading && !hasTaskMatches && !hasProjectMatches;

  return (
    // Колонка на всю высоту: поиск закреплён сверху (его focus-ring не обрезается
    // overflow-контейнером), список проектов скроллится в своём min-h-0 боксе — профиль
    // снизу остаётся видимым при любом числе проектов.
    <div className="flex h-full flex-col gap-2">
      {/* Поиск закреплён сверху (его focus-ring не обрезается overflow-контейнером) и НЕ
          скроллится. «Недавнее» переехало вниз — внутрь скролла, над списком проектов. */}
      {visible.length > 1 && (
        <div className="relative shrink-0">
          <FolderSearch className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Проект, задачи"
            aria-label="Поиск: проект, задачи"
            className="h-8 w-full pl-7 text-sm"
          />
        </div>
      )}

      <div
        ref={setScrollFadeRef}
        className="pf-scroll-visible pf-scroll-fade -mx-1 min-h-0 flex-1 space-y-4 px-1"
      >
        {/* Вне поиска — «Недавнее» (недавно открытые задачи). В поиске — найденные задачи
            (блок «Задачи»: 3 → «ещё» до 10, сортировка по дате создания, подсветка). */}
        {searching ? (
          hasTaskMatches && <SidebarTaskResults results={taskSearch.results} query={query} />
        ) : (
          <RecentTasksBlock />
        )}

      {/* «Избранное» — самостоятельная секция НАД «Мои проекты». Скрывается в режиме поиска
          (тогда выдача плоская, без дублей). Заголовок кликается — сворачивает секцию. */}
      {showFavoritesSection && favorites.length > 0 && (
        <div className="space-y-1 pb-1">
          <button
            type="button"
            onClick={toggleFavCollapsed}
            aria-expanded={!favCollapsed}
            data-pf-sticky-header
            className="group sticky top-0 z-10 flex w-full items-center rounded bg-sidebar px-2 py-1.5 text-left text-xs font-medium text-muted-foreground/80 hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                'h-3 w-0 shrink-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover:mr-1.5 group-hover:w-3 group-hover:opacity-100',
                favCollapsed && '-rotate-90',
              )}
            />
            <span>Избранное</span>
          </button>
          <Collapse open={!favCollapsed}>
            <ProjectGroup
              projects={favorites}
              bucket="favorites"
              reorderable={reorderable}
              onReorderEnd={handleFavoritesDragEnd}
              onMove={moveInFavorites}
            />
          </Collapse>
        </div>
      )}

      {/* «Мои проекты». В поиске показываем только если есть совпадения по проектам —
          при «только задачи» блок проектов скрыт целиком (как и просили). */}
      {(!searching || hasProjectMatches) && (
        <div className="space-y-1">
          {myProjectsHeader}
          <Collapse open={!mainCollapsed}>
            {regular.length > 0 ? (
              <ProjectGroup
                projects={regular}
                bucket="main"
                reorderable={reorderable}
                onReorderEnd={handleRegularDragEnd}
                onMove={moveInRegular}
                highlightQuery={searching ? query : undefined}
              />
            ) : null}
          </Collapse>
        </div>
      )}

      {/* Совсем ничего не нашлось — ни в задачах, ни в проектах. */}
      {nothingFound && (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">Ничего не найдено.</p>
      )}

      {/* «Архивные» — спрятанные проекты. Показываем ВСЕГДА (вне поиска), чтобы пункт был
          обнаружим даже без архивных. По умолчанию свёрнута; «Вернуть из архива» — в меню строки. */}
      {!searching && (
        <div className="space-y-1 pt-1">
          <button
            type="button"
            onClick={toggleArchivedCollapsed}
            aria-expanded={!archivedCollapsed}
            data-pf-sticky-header
            className="group sticky top-0 z-10 flex w-full items-center rounded bg-sidebar px-2 py-1.5 text-left text-xs font-medium text-muted-foreground/80 hover:text-foreground"
          >
            <ChevronDown
              className={cn('h-3 w-0 shrink-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover:mr-1.5 group-hover:w-3 group-hover:opacity-100', archivedCollapsed && '-rotate-90')}
            />
            <span>Архивные</span>
            {archived.length > 0 && <span className="ml-1.5 tabular-nums opacity-70">{archived.length}</span>}
          </button>
          <Collapse open={!archivedCollapsed}>
            {archived.length > 0 ? (
              <ProjectGroup
                projects={archived}
                bucket="main"
                reorderable={false}
                onReorderEnd={() => {}}
                onMove={() => {}}
              />
            ) : (
              <p className="px-2 py-1.5 text-xs text-muted-foreground/70">Нет архивных проектов.</p>
            )}
          </Collapse>
        </div>
      )}
      </div>
    </div>
  );
}

// `${bucket}-${projectId}` → `projectId`. Bucket — фиксированный список ('favorites'|'main'),
// поэтому split по первому `-` корректен (UUID не содержит `-` в первом сегменте... содержит,
// поэтому ищем именно префикс).
function stripBucket(sortableId: string): string {
  if (sortableId.startsWith('favorites-')) return sortableId.slice('favorites-'.length);
  if (sortableId.startsWith('main-')) return sortableId.slice('main-'.length);
  return sortableId;
}

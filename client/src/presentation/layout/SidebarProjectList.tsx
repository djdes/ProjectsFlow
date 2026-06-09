import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
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
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
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
import { useReorderProjects } from '@/presentation/hooks/useReorderProjects';
import { useReorderFavoriteProjects } from '@/presentation/hooks/useReorderFavoriteProjects';
import { useToggleProjectFavorite } from '@/presentation/hooks/useToggleProjectFavorite';
import { useNewProjectDialog } from '@/presentation/components/forms/NewProjectDialogProvider';
import { useSidebarSectionCollapse } from '@/presentation/hooks/useSidebarSectionCollapse';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { defaultProjectIcon as ProjectIcon } from './projectIcons';
import { RenameProjectDialog } from '@/presentation/components/project/RenameProjectDialog';
import { DeleteProjectDialog } from '@/presentation/components/project/DeleteProjectDialog';
import type { Project } from '@/domain/project/Project';

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
};

function SidebarProjectRow({
  project,
  bucket,
  reorderable,
  isFirst,
  isLast,
  onMove,
}: RowProps): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh: refreshProjects } = useProjectsContext();
  const { toggle: toggleFavorite } = useToggleProjectFavorite();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isArchived = project.status === 'archived';
  // Удалить может только owner; inbox-проект (служебный, один на юзера) удалять
  // нельзя в принципе — пункт прячем, чтобы не было ложной кнопки.
  const canDelete = project.role === 'owner' && !project.isInbox;

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

  // Бейджи (число задач + индикатор команды) прячем при hover/focus/открытом меню —
  // на их месте появляется кнопка «три точки».
  const actionsActive = menuOpen;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex items-center rounded-md',
        isDragging && 'z-10 opacity-60',
      )}
    >
      <NavLink
        to={`/projects/${project.id}`}
        // listeners/attributes на ссылке: тащим за всю строку. Порог сенсора (5px)
        // отделяет drag от обычного клика-навигации.
        {...(reorderable ? listeners : {})}
        {...(reorderable ? attributes : {})}
        className={({ isActive }) =>
          cn(
            'relative flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
            'hover:bg-muted',
            'cursor-pointer',
            isActive && 'bg-accent text-accent-foreground',
            isArchived && 'opacity-50',
            // На active drag — grab-cursor, иначе обычная pointer-рука (это всё-таки ссылка).
            reorderable && isDragging && 'cursor-grabbing',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
            )}
            {/* Цвет иконки = индикатор git: зелёная при подключённом репо, серая без него. */}
            <ProjectIcon
              className={cn(
                'size-4 shrink-0',
                project.gitRepoUrl ? 'text-emerald-500' : 'text-muted-foreground',
              )}
              aria-label={project.gitRepoUrl ? 'Git подключён' : 'Git не подключён'}
            />
            <span className="flex-1 truncate">{project.name}</span>
            <span
              className={cn(
                'flex shrink-0 items-center gap-1',
                'group-hover:invisible group-focus-within:invisible max-md:invisible',
                actionsActive && 'invisible',
              )}
            >
              {(project.memberCount ?? 0) > 1 && (
                <Users
                  className="size-3.5 text-muted-foreground"
                  aria-label="Совместный проект"
                />
              )}
              {(project.taskCount ?? 0) > 0 && (
                <span
                  className="rounded-full bg-muted px-1.5 text-[11px] leading-5 tabular-nums text-muted-foreground"
                  aria-label={`Задач: ${project.taskCount}`}
                >
                  {project.taskCount}
                </span>
              )}
            </span>
          </>
        )}
      </NavLink>

      {/* «Три точки»: видны при наведении/фокусе строки, при открытом меню и на мобиле. */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Действия проекта «${project.name}»`}
            // Не даём pointerdown инициировать drag строки.
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              'absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground',
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
}: {
  projects: readonly Project[];
  bucket: Bucket;
  reorderable: boolean;
  onReorderEnd: (event: DragEndEvent) => void;
  onMove: (projectId: string, dir: MoveDir) => void;
}): React.ReactElement {
  // Порог 5px: клик/тап по проекту не превращается в drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const sortableIds = projects.map((p) => `${bucket}-${p.id}`);

  const rows = (
    <div className="space-y-0.5">
      {projects.map((p, idx) => (
        <SidebarProjectRow
          key={`${bucket}-${p.id}`}
          project={p}
          bucket={bucket}
          reorderable={reorderable}
          isFirst={idx === 0}
          isLast={idx === projects.length - 1}
          onMove={onMove}
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

export function SidebarProjectList(): React.ReactElement {
  const { data, loading, error } = useProjects();
  const { reorder } = useReorderProjects();
  const { reorder: reorderFavorites } = useReorderFavoriteProjects();
  const { open: openNewProject } = useNewProjectDialog();
  const { collapsed: favCollapsed, toggle: toggleFavCollapsed } =
    useSidebarSectionCollapse('favorites');
  const { collapsed: mainCollapsed, toggle: toggleMainCollapsed } =
    useSidebarSectionCollapse('main');
  const [query, setQuery] = useState('');

  if (loading) return <SidebarProjectListSkeleton />;

  if (error) {
    return (
      <p className="px-2 py-1.5 text-sm text-destructive">
        Не&nbsp;удалось загрузить список проектов.
      </p>
    );
  }

  // Inbox-проект скрываем — он рендерится отдельным пунктом в Sidebar.
  const visible = (data ?? []).filter((p) => !p.isInbox);

  // Шапка «Мои проекты» (заголовок + счётчик + «+») рендерится всегда, чтобы юзер мог
  // создать первый проект. Сам заголовок кликается — сворачивает секцию (как в Todoist).
  const myProjectsHeader = (
    <div className="flex items-center justify-between gap-1 px-2 pt-1">
      <button
        type="button"
        onClick={toggleMainCollapsed}
        aria-expanded={!mainCollapsed}
        className="group flex flex-1 items-baseline gap-1.5 rounded text-left text-[11px] font-medium uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            'size-3 shrink-0 self-center transition-transform',
            mainCollapsed && '-rotate-90',
          )}
        />
        <span>Мои проекты</span>
        <span className="tracking-normal tabular-nums normal-case opacity-70">
          {visible.length}/{PROJECT_LIMIT === Infinity ? '∞' : PROJECT_LIMIT}
        </span>
      </button>
      <button
        type="button"
        onClick={openNewProject}
        aria-label="Новый проект"
        className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );

  if (visible.length === 0) {
    return (
      <div className="space-y-1.5">
        {myProjectsHeader}
        <p className="px-2 py-1.5 text-sm text-muted-foreground">Проектов пока нет.</p>
      </div>
    );
  }

  const q = query.trim().toLocaleLowerCase('ru');
  const searching = q.length > 0;
  const matches = (p: Project): boolean => p.name.toLocaleLowerCase('ru').includes(q);

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

  const noMatches = searching && favorites.length === 0 && regular.length === 0;

  return (
    // Колонка на всю высоту: поиск закреплён сверху (его focus-ring не обрезается
    // overflow-контейнером), список проектов скроллится в своём min-h-0 боксе — профиль
    // снизу остаётся видимым при любом числе проектов.
    <div className="flex h-full flex-col gap-1.5">
      {visible.length > 1 && (
        <div className="relative shrink-0">
          <FolderSearch className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск проекта"
            aria-label="Поиск проекта"
            className="h-8 w-full pl-7 text-sm"
          />
        </div>
      )}

      <div className="-mx-1 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1">
      {/* «Избранное» — самостоятельная секция НАД «Мои проекты». Скрывается в режиме поиска
          (тогда выдача плоская, без дублей). Заголовок кликается — сворачивает секцию. */}
      {showFavoritesSection && favorites.length > 0 && (
        <div className="space-y-1 pb-1">
          <button
            type="button"
            onClick={toggleFavCollapsed}
            aria-expanded={!favCollapsed}
            className="flex w-full items-center gap-1.5 px-2 pt-1 text-left text-[11px] font-medium uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                'size-3 shrink-0 transition-transform',
                favCollapsed && '-rotate-90',
              )}
            />
            <span>Избранное</span>
          </button>
          {!favCollapsed && (
            <ProjectGroup
              projects={favorites}
              bucket="favorites"
              reorderable={reorderable}
              onReorderEnd={handleFavoritesDragEnd}
              onMove={moveInFavorites}
            />
          )}
        </div>
      )}

      <div className="space-y-1">
        {myProjectsHeader}
        {!mainCollapsed && (
          noMatches ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">Ничего не найдено.</p>
          ) : regular.length > 0 ? (
            <ProjectGroup
              projects={regular}
              bucket="main"
              reorderable={reorderable}
              onReorderEnd={handleRegularDragEnd}
              onMove={moveInRegular}
            />
          ) : null
        )}
      </div>
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

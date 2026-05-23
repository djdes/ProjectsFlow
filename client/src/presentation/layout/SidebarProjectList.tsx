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
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { useProjects } from '@/presentation/hooks/useProjects';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { useReorderProjects } from '@/presentation/hooks/useReorderProjects';
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

type RowProps = {
  project: Project;
  // Перетаскивание/перемещение доступно только на полном списке (без активного поиска).
  reorderable: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (projectId: string, dir: MoveDir) => void;
};

function SidebarProjectRow({
  project,
  reorderable,
  isFirst,
  isLast,
  onMove,
}: RowProps): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh: refreshProjects } = useProjectsContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isArchived = project.status === 'archived';
  // Удалить может только owner; inbox-проект (служебный, один на юзера) удалять
  // нельзя в принципе — пункт прячем, чтобы не было ложной кнопки.
  const canDelete = project.role === 'owner' && !project.isInbox;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
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
            isActive && 'bg-accent text-accent-foreground',
            isArchived && 'opacity-50',
            reorderable && 'cursor-grab active:cursor-grabbing',
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

export function SidebarProjectList(): React.ReactElement {
  const { data, loading, error } = useProjects();
  const { reorder } = useReorderProjects();
  const [query, setQuery] = useState('');

  // Порог 5px: клик/тап по проекту не превращается в drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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

  if (visible.length === 0) {
    return <p className="px-2 py-1.5 text-sm text-muted-foreground">Проектов пока нет.</p>;
  }

  const q = query.trim().toLocaleLowerCase('ru');
  const searching = q.length > 0;
  const filtered = searching
    ? visible.filter((p) => p.name.toLocaleLowerCase('ru').includes(q))
    : visible;
  const renderedIds = filtered.map((p) => p.id);

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = renderedIds.indexOf(String(active.id));
    const newIndex = renderedIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(renderedIds, oldIndex, newIndex);
    void reorder(renderedIds, next);
  };

  const handleMove = (projectId: string, dir: MoveDir): void => {
    const i = renderedIds.indexOf(projectId);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= renderedIds.length) return;
    const next = arrayMove(renderedIds, i, j);
    void reorder(renderedIds, next);
  };

  const rows =
    filtered.length === 0 ? (
      <p className="px-2 py-1.5 text-sm text-muted-foreground">Ничего не найдено.</p>
    ) : (
      <div className="space-y-0.5">
        {filtered.map((p, idx) => (
          <SidebarProjectRow
            key={p.id}
            project={p}
            reorderable={!searching}
            isFirst={idx === 0}
            isLast={idx === filtered.length - 1}
            onMove={handleMove}
          />
        ))}
      </div>
    );

  return (
    <div className="space-y-1.5">
      {visible.length > 1 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск проекта…"
            aria-label="Поиск проекта"
            className="h-8 w-full pl-7 text-sm"
          />
        </div>
      )}
      {searching ? (
        rows
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={renderedIds} strategy={verticalListSortingStrategy}>
            {rows}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

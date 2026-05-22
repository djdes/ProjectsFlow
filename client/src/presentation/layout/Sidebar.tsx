import { Link, NavLink } from 'react-router-dom';
import { Bell, Inbox, PanelLeft, Plus, Search, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNewProjectDialog } from '@/presentation/components/forms/NewProjectDialogProvider';
import { useAddTaskDialog } from '@/presentation/components/forms/AddTaskDialogProvider';
import { useGlobalSearch } from '@/presentation/components/search/GlobalSearchProvider';
import { useUnreadNotificationsCount } from '@/presentation/hooks/useUnreadNotificationsCount';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useProjects } from '@/presentation/hooks/useProjects';
import { SidebarProjectList } from './SidebarProjectList';
import { SidebarUserMenu } from './SidebarUserMenu';

// Лимит проектов на тариф. Сейчас у всех безлимит → показываем ∞. Когда появятся
// тарифы, значение придёт из профиля/подписки и рендер ниже подхватит число.
const PROJECT_LIMIT = Infinity;

type SidebarProps = {
  // Передаётся только на desktop — рисует иконку сворачивания панели. На мобиле (drawer)
  // не передаётся, тоггл не рендерится.
  onToggleCollapse?: () => void;
};

export function Sidebar({ onToggleCollapse }: SidebarProps): React.ReactElement {
  const { count: unreadCount } = useUnreadNotificationsCount();
  const { open: openSearch } = useGlobalSearch();
  const { open: openNewProject } = useNewProjectDialog();
  const { open: openAddTask } = useAddTaskDialog();
  const { user } = useCurrentUser();
  const { data: projects, loading: projectsLoading } = useProjects();

  // Счётчик «N/∞»: считаем обычные проекты (без phantom-инбокса). Пока грузится — не
  // показываем, чтобы не мигало «0/∞».
  const ownProjectsCount = (projects ?? []).filter((p) => !p.isInbox).length;

  return (
    <aside className="grid h-full grid-rows-[auto_auto_auto_auto_auto_1fr_auto] gap-3 border-r bg-card/40 p-3">
      {/* Шапка: лого + колокольчик уведомлений + тоггл панели */}
      <div className="flex items-center gap-1">
        <Link
          to="/"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-base font-semibold tracking-tight transition-colors hover:bg-muted"
        >
          <span
            className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
            aria-hidden="true"
          >
            PF
          </span>
          <span className="truncate">ProjectsFlow</span>
        </Link>

        <NavLink
          to="/notifications"
          aria-label="Уведомления"
          className={({ isActive }) =>
            cn(
              'relative grid size-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-muted',
              isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-medium leading-4 text-primary-foreground"
              aria-label={`${unreadCount} непрочитанных`}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </NavLink>

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Свернуть панель"
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelLeft className="size-4" />
          </button>
        )}
      </div>

      {/* Главное действие: быстрое добавление задачи. Без фона, зелёный акцент. */}
      <button
        type="button"
        onClick={openAddTask}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold text-success transition-colors hover:bg-muted"
      >
        <Plus className="size-4 shrink-0" />
        <span className="flex-1 text-left">Добавить задачу</span>
      </button>

      <button
        type="button"
        onClick={openSearch}
        className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left">Поиск задач</span>
        <kbd className="rounded border bg-muted px-1.5 text-[10px] font-medium tracking-wider text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          cn(
            'group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
            'hover:bg-muted',
            isActive && 'bg-accent text-accent-foreground',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
            )}
            <Inbox className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">Входящие</span>
          </>
        )}
      </NavLink>

      <div className="flex items-center justify-between px-2 pt-1">
        <span className="flex items-baseline gap-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Мои проекты
          {!projectsLoading && (
            <span className="tracking-normal tabular-nums normal-case opacity-70">
              {ownProjectsCount}/{PROJECT_LIMIT === Infinity ? '∞' : PROJECT_LIMIT}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={openNewProject}
          aria-label="Новый проект"
          className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <nav className="-mx-1 overflow-y-auto px-1">
        <SidebarProjectList />
      </nav>

      <div className="space-y-1 border-t pt-2">
        {user?.isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted',
                isActive && 'bg-accent text-accent-foreground',
              )
            }
          >
            <Shield className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">Администрирование</span>
          </NavLink>
        )}
        <SidebarUserMenu />
      </div>
    </aside>
  );
}

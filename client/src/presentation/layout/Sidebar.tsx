import { Link, NavLink } from 'react-router-dom';
import { Bell, Inbox, PanelLeft, Plus, Search, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAddTaskDialog } from '@/presentation/components/forms/AddTaskDialogProvider';
import { useGlobalSearch } from '@/presentation/components/search/GlobalSearchProvider';
import { useUnreadNotificationsCount } from '@/presentation/hooks/useUnreadNotificationsCount';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useProjects } from '@/presentation/hooks/useProjects';
import type { Project } from '@/domain/project/Project';
import { SidebarProjectList } from './SidebarProjectList';
import { SidebarUserMenu } from './SidebarUserMenu';
import { avatarColor, getInitials } from './projectIcons';

type SidebarProps = {
  // Передаётся только на desktop — рисует иконку сворачивания панели. На мобиле (drawer)
  // не передаётся, тоггл не рендерится.
  onToggleCollapse?: () => void;
  // Свёрнутый режим (desktop): узкий icon-rail вместо полной панели. Навигация остаётся
  // доступной (иконки + избранные проекты + профиль), а не прячется целиком.
  collapsed?: boolean;
};

export function Sidebar({ onToggleCollapse, collapsed = false }: SidebarProps): React.ReactElement {
  const { count: unreadCount } = useUnreadNotificationsCount();
  const { open: openSearch } = useGlobalSearch();
  const { open: openAddTask } = useAddTaskDialog();
  const { user } = useCurrentUser();
  const { data: projects } = useProjects();

  if (collapsed) {
    const favorites = (projects ?? []).filter((p) => !p.isInbox && p.isFavorite);
    return (
      <aside className="flex h-full flex-col items-center gap-1 bg-sidebar p-2">
        <TooltipProvider delayDuration={300}>
          {onToggleCollapse && (
            <RailButton onClick={onToggleCollapse} label="Развернуть панель">
              <PanelLeft className="size-4" />
            </RailButton>
          )}
          <Link
            to="/"
            aria-label="ProjectsFlow"
            className="grid size-9 shrink-0 place-items-center"
          >
            <span className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              PF
            </span>
          </Link>

          <div className="my-0.5 h-px w-6 bg-border" />

          <RailButton onClick={openAddTask} label="Добавить задачу">
            <Plus className="size-4 text-success" />
          </RailButton>
          <RailButton onClick={openSearch} label="Глобальный поиск">
            <Search className="size-4" />
          </RailButton>
          <RailNavLink to="/" end label="Входящие">
            <Inbox className="size-4" />
          </RailNavLink>

          <div className="my-0.5 h-px w-6 bg-border" />

          <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-0.5">
            {favorites.map((p) => (
              <RailProjectLink key={p.id} project={p} />
            ))}
          </div>

          <div className="my-0.5 h-px w-6 bg-border" />

          <RailNavLink to="/notifications" label="Уведомления" badge={unreadCount}>
            <Bell className="size-4" />
          </RailNavLink>
          {user?.isAdmin && (
            <RailNavLink to="/admin" label="Администрирование">
              <Shield className="size-4" />
            </RailNavLink>
          )}
          <SidebarUserMenu compact />
        </TooltipProvider>
      </aside>
    );
  }

  return (
    <aside className="grid h-full grid-rows-[auto_auto_auto_auto_1fr_auto] gap-3 bg-sidebar p-3">
      {/* Шапка: лого + колокольчик уведомлений + тоггл панели */}
      <div className="flex items-center gap-1">
        <Link
          to="/"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-base font-semibold tracking-tight transition-colors hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]"
        >
          <span
            className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
            aria-label="ProjectsFlow"
          >
            PF
          </span>
        </Link>

        <NavLink
          to="/notifications"
          aria-label="Уведомления"
          className={({ isActive }) =>
            cn(
              'relative grid size-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]',
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
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06] hover:text-foreground"
          >
            <PanelLeft className="size-4" />
          </button>
        )}
      </div>

      {/* Главное действие: быстрое добавление задачи. Зелёный акцент только на иконке. */}
      <button
        type="button"
        onClick={openAddTask}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]"
      >
        <Plus className="size-4 shrink-0 text-success" />
        <span className="flex-1 text-left">Добавить задачу</span>
      </button>

      <button
        type="button"
        onClick={openSearch}
        className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left">Глобальный поиск</span>
        <kbd className="rounded bg-foreground/[0.06] px-1.5 text-[10px] font-medium tracking-wider text-muted-foreground dark:bg-white/10">
          ⌘K
        </kbd>
      </button>

      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          cn(
            'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
            'hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]',
            isActive && 'bg-foreground/[0.06] font-medium text-foreground dark:bg-white/10',
          )
        }
      >
        <Inbox className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">Входящие</span>
      </NavLink>

      <nav className="min-h-0">
        <SidebarProjectList />
      </nav>

      <div className="space-y-1 border-t pt-2">
        {user?.isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]',
                isActive && 'bg-foreground/[0.06] font-medium text-foreground dark:bg-white/10',
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

// ===== icon-rail (свёрнутая панель) =====

function RailButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06] hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function RailNavLink({
  to,
  end,
  label,
  badge,
  children,
}: {
  to: string;
  end?: boolean;
  label: string;
  badge?: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={to}
          end={end}
          aria-label={label}
          className={({ isActive }) =>
            cn(
              'relative grid size-9 shrink-0 place-items-center rounded-md transition-colors hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]',
              isActive
                ? 'bg-foreground/[0.06] text-foreground dark:bg-white/10'
                : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {children}
          {badge !== undefined && badge > 0 && (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-medium text-primary-foreground">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function RailProjectLink({ project }: { project: Project }): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={`/projects/${project.id}`}
          aria-label={project.name}
          className={({ isActive }) =>
            cn(
              'grid size-8 shrink-0 place-items-center rounded-md transition-transform hover:scale-105',
              project.icon ? 'bg-foreground/[0.04] text-base dark:bg-white/[0.06]' : cn('text-[10px] font-semibold', avatarColor(project.name)),
              isActive && 'ring-2 ring-primary',
            )
          }
        >
          {project.icon ?? getInitials(project.name)}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">{project.name}</TooltipContent>
    </Tooltip>
  );
}

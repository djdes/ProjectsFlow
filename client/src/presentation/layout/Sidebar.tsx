import { useCallback, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Bell, House, Inbox, MessageCircle, PanelLeft, Plus, Search, Shield } from 'lucide-react';
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
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import { useChatUnread } from '@/presentation/hooks/useChatUnread';
import { useProjects } from '@/presentation/hooks/useProjects';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { GlassTabBar, type GlassTabItem } from '@/presentation/components/nav/GlassTabBar';
import { WorkspaceChatPanel } from '@/presentation/chat/WorkspaceChatPanel';
import type { Project } from '@/domain/project/Project';
import { SidebarProjectList } from './SidebarProjectList';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { avatarColor, getInitials } from './projectIcons';

// Вид нижней области сайдбара: список проектов («Главная») или общий чат пространства.
type SidebarView = 'home' | 'chat';
const VIEW_KEY = 'pf_sidebar_view';

function readView(): SidebarView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'chat' ? 'chat' : 'home';
  } catch {
    return 'home';
  }
}

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
  const { workspace } = useCurrentWorkspace();
  const { count: chatUnread } = useChatUnread(workspace?.id ?? null);
  const { animations } = useMotion();
  const navigate = useNavigate();

  const [view, setView] = useState<SidebarView>(readView);
  const setViewPersist = useCallback((v: SidebarView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* localStorage недоступен — вид просто не персистится */
    }
  }, []);

  // 4-кнопочный glass-rail: Главная/Чат — held-toggle вида; Входящие/Поиск — моментальные.
  const railItems: GlassTabItem[] = [
    { key: 'home', label: 'Главная', icon: <House className="size-5" /> },
    { key: 'chat', label: 'Чат', icon: <MessageCircle className="size-5" />, badge: chatUnread },
    { key: 'inbox', label: 'Входящие', icon: <Inbox className="size-5" /> },
    { key: 'search', label: 'Поиск', icon: <Search className="size-5" /> },
  ];
  const onRailSelect = (i: number): void => {
    if (i === 0) setViewPersist('home');
    else if (i === 1) setViewPersist('chat');
    else if (i === 2) navigate('/');
    else openSearch();
  };

  if (collapsed) {
    const favorites = (projects ?? []).filter((p) => !p.isInbox && p.isFavorite);
    return (
      <aside className="flex h-full min-h-0 flex-col items-center gap-1 overflow-hidden bg-sidebar p-2">
        <TooltipProvider delayDuration={300}>
          {onToggleCollapse && (
            <RailButton onClick={onToggleCollapse} label="Развернуть панель">
              <PanelLeft className="size-4" />
            </RailButton>
          )}
          <WorkspaceSwitcher compact />

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
          <RailButton
            onClick={() => {
              setViewPersist('chat');
              onToggleCollapse?.();
            }}
            label="Чат"
            badge={chatUnread}
          >
            <MessageCircle className="size-4" />
          </RailButton>

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
        </TooltipProvider>
      </aside>
    );
  }

  return (
    <aside className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_auto_1fr_auto] gap-3 overflow-hidden bg-sidebar p-3">
      {/* Шапка: компактное лого + поиск + колокольчик + тоггл панели. На мобиле (drawer)
          правый отступ, чтобы контролы не лезли под крестик SheetContent (top-4 right-4). */}
      <div className="flex items-center gap-1 max-md:pr-8">
        <WorkspaceSwitcher />

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

      {/* Навигационный glass-rail: Главная/Чат/Входящие/Поиск. */}
      <GlassTabBar
        items={railItems}
        activeIndex={view === 'home' ? 0 : 1}
        onSelect={onRailSelect}
        layoutId="pf-sidebar-rail-glass"
      />

      {/* Главное действие: быстрое добавление задачи. Зелёный акцент только на иконке. */}
      <button
        type="button"
        onClick={openAddTask}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]"
      >
        <Plus className="size-4 shrink-0 text-success" />
        <span className="flex-1 text-left">Добавить задачу</span>
      </button>

      {/* Нижняя область: список проектов («Главная») ИЛИ общий чат пространства. Crossfade. */}
      {animations ? (
        <motion.div
          key={view}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18 }}
          className="min-h-0 min-w-0"
        >
          {view === 'chat' ? (
            <WorkspaceChatPanel />
          ) : (
            <nav className="h-full min-h-0 min-w-0">
              <SidebarProjectList />
            </nav>
          )}
        </motion.div>
      ) : (
        <div className="min-h-0 min-w-0">
          {view === 'chat' ? (
            <WorkspaceChatPanel />
          ) : (
            <nav className="h-full min-h-0 min-w-0">
              <SidebarProjectList />
            </nav>
          )}
        </div>
      )}

      {user?.isAdmin && (
        <div className="border-t pt-2">
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
        </div>
      )}
    </aside>
  );
}

// ===== icon-rail (свёрнутая панель) =====

function RailButton({
  onClick,
  label,
  badge,
  children,
}: {
  onClick: () => void;
  label: string;
  badge?: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="relative grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06] hover:text-foreground"
        >
          {children}
          {badge !== undefined && badge > 0 && (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-medium text-primary-foreground">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
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

import { cloneElement, isValidElement, useCallback, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronsLeft, ChevronsRight, Plus, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAddTaskDialog } from '@/presentation/components/forms/AddTaskDialogProvider';
import { useGlobalSearch } from '@/presentation/components/search/GlobalSearchProvider';
import { useActionableUnreadCount } from '@/presentation/hooks/useActionableUnreadCount';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useActiveChatUnread } from '@/presentation/hooks/useChatRooms';
import { useProjects } from '@/presentation/hooks/useProjects';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { SidebarNavRail, type RailItem } from '@/presentation/components/nav/SidebarNavRail';
import {
  AnimatedHome,
  AnimatedChat,
  AnimatedInbox,
  AnimatedSearch,
} from '@/presentation/components/nav/AnimatedNavIcons';
import { CommunicationPanel } from '@/presentation/chat/CommunicationPanel';
import { OPEN_CHAT_EVENT } from '@/presentation/chat/openChatEvent';
import type { Project } from '@/domain/project/Project';
import { SidebarProjectList } from './SidebarProjectList';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { avatarColor, getInitials } from './projectIcons';

// Активная вкладка рейла (только переключатели слева): Главная показывает список проектов
// в нижней области, Чат — общий чат пространства. Входящие/Поиск — это icon-кнопки действий
// справа, они НЕ становятся активной вкладкой (просто выполняют переход/открывают поиск).
type RailKey = 'home' | 'chat';
const RAIL_ORDER: readonly RailKey[] = ['home', 'chat'];
const RAIL_KEY = 'pf_sidebar_rail';

function readRail(): RailKey {
  try {
    return localStorage.getItem(RAIL_KEY) === 'chat' ? 'chat' : 'home';
  } catch {
    return 'home';
  }
}

type SidebarProps = {
  // Передаётся только на desktop — рисует иконку сворачивания панели. На мобиле (drawer)
  // не передаётся, тоггл не рендерится.
  onToggleCollapse?: () => void;
  // Свёрнутый режим (desktop, кнопка-бургер): узкий icon-rail вместо полной панели.
  collapsed?: boolean;
  // Узкая ширина (ресайз ниже порога): ТОЛЬКО верхний навигационный ряд без подписей
  // (иконки). Остальная панель (свитчер, список проектов) — как есть.
  navCompact?: boolean;
};

export function Sidebar({
  onToggleCollapse,
  collapsed = false,
  navCompact = false,
}: SidebarProps): React.ReactElement {
  // Колокольчик убран — единственная поверхность уведомлений теперь чат-лента. Сигнал
  // «нужно действие» вешаем на rail-кнопку «Чат», чтобы он был виден и на «Главной».
  const { count: actionable } = useActionableUnreadCount();
  const { open: openSearch } = useGlobalSearch();
  const { open: openAddTask } = useAddTaskDialog();
  const { user } = useCurrentUser();
  const { data: projects } = useProjects();
  // Непрочитанное в ВИДИМОМ чате (активное пространство, с фолбэком на хаб владельца для
  // приглашённого) — совпадает с тем, что откроется по клику, и гасится при прочтении.
  const chatUnread = useActiveChatUnread();
  const { animations } = useMotion();
  const navigate = useNavigate();

  const [activeRail, setActiveRail] = useState<RailKey>(readRail);
  const setRailPersist = useCallback((k: RailKey) => {
    setActiveRail(k);
    try {
      localStorage.setItem(RAIL_KEY, k);
    } catch {
      /* localStorage недоступен — активная кнопка просто не персистится */
    }
  }, []);

  // Клик по chat_mention-уведомлению в ленте — переключаемся на вкладку «Чат».
  useEffect(() => {
    const onOpenChat = (): void => setRailPersist('chat');
    window.addEventListener(OPEN_CHAT_EVENT, onOpenChat);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpenChat);
  }, [setRailPersist]);
  // Нижняя область = чат только когда активен Чат; для Главная/Входящие/Поиск — проекты.
  const showChat = activeRail === 'chat';

  // Rail: слева вкладки-переключатели (Главная/Чат — активная разворачивается с подписью),
  // справа icon-кнопки действий (Входящие/Поиск — без активного состояния, клик = действие).
  const railItems: RailItem[] = [
    { key: 'home', label: 'Главная', icon: <AnimatedHome className="size-5" />, variant: 'tab' },
    { key: 'chat', label: 'Чат', icon: <AnimatedChat className="size-5" />, badge: chatUnread + actionable, variant: 'tab' },
    {
      // Центральная акцентная кнопка «Задача» (как «+» в YouTube) — открывает AddTaskDialog.
      key: 'add',
      label: 'Задача',
      icon: <Plus className="size-5" />,
      variant: 'action',
      accent: true,
      onAction: openAddTask,
    },
    {
      key: 'inbox',
      label: 'Входящие',
      icon: <AnimatedInbox className="size-5" />,
      variant: 'action',
      onAction: () => navigate('/'),
    },
    {
      key: 'search',
      label: 'Поиск',
      icon: <AnimatedSearch className="size-5" />,
      variant: 'action',
      onAction: openSearch,
    },
  ];
  // Клик по вкладке-переключателю (только Главная/Чат). Входящие/Поиск идут через onAction.
  const onRailSelect = (i: number): void => {
    const key = RAIL_ORDER[i] ?? 'home';
    setRailPersist(key);
    // «Главная» — не только переключатель нижней области сайдбара: ведёт и на главный
    // экран («Входящие», route '/') — из глубины проекта домой одним кликом. На мобиле
    // drawer закроется сам (AppShell закрывает его при смене маршрута).
    if (key === 'home') navigate('/');
  };

  if (collapsed) {
    const favorites = (projects ?? []).filter((p) => !p.isInbox && p.isFavorite);
    return (
      <aside className="flex h-full min-h-0 flex-col items-center gap-1 overflow-hidden bg-sidebar p-2">
        <TooltipProvider delayDuration={550} skipDelayDuration={120}>
          {onToggleCollapse && (
            <RailButton onClick={onToggleCollapse} label="Развернуть панель">
              <ChevronsRight className="size-5" />
            </RailButton>
          )}
          <WorkspaceSwitcher compact />

          <div className="my-0.5 h-px w-6 bg-border" />

          <RailButton onClick={openAddTask} label="Добавить задачу">
            <Plus className="size-4 text-success" />
          </RailButton>
          <RailButton onClick={openSearch} label="Глобальный поиск" animated>
            <AnimatedSearch className="size-4" />
          </RailButton>
          <RailNavLink to="/" end label="Входящие" animated>
            <AnimatedInbox className="size-4" />
          </RailNavLink>
          <RailButton
            onClick={() => {
              setRailPersist('chat');
              onToggleCollapse?.();
            }}
            label="Чат"
            badge={chatUnread}
            animated
          >
            <AnimatedChat className="size-4" />
          </RailButton>

          <div className="my-0.5 h-px w-6 bg-border" />

          <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-0.5">
            {favorites.map((p) => (
              <RailProjectLink key={p.id} project={p} />
            ))}
          </div>

          {user?.isAdmin && (
            <>
              <div className="my-0.5 h-px w-6 bg-border" />
              <RailNavLink to="/admin" label="Администрирование">
                <Shield className="size-4" />
              </RailNavLink>
            </>
          )}
        </TooltipProvider>
      </aside>
    );
  }

  return (
    <aside className="group/sidebar grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr_auto] gap-2 overflow-hidden bg-sidebar px-2.5 pb-3">
      {/* Шапка: переключатель пространства + тоггл панели. Высота строки = min-h-11 (44px)
          с вертикальным центрированием — ровно как верхняя строка крошек на страницах
          (Notion-style: свитчер пространства и топбар на одной горизонтали). Уведомления
          переехали в чат-ленту; колокольчика больше нет. На мобиле (drawer) правый отступ,
          чтобы контролы не лезли под крестик SheetContent. */}
      <div className="flex h-11 items-center gap-1 max-md:pr-8">
        <WorkspaceSwitcher />

        {onToggleCollapse && (
          <TooltipProvider delayDuration={550} skipDelayDuration={120}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  aria-label="Свернуть панель"
                  // Кнопка сворачивания появляется только при наведении на левую панель (Notion).
                  className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-hover hover:text-foreground focus-visible:opacity-100 group-hover/sidebar:opacity-100"
                >
                  <ChevronsLeft className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="flex items-center gap-1.5">
                <span>Свернуть панель</span>
                <kbd className="rounded bg-foreground/10 px-1 text-[10px] leading-4">Ctrl+\</kbd>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Навигационный rail: Главная/Чат/Задача/Входящие/Поиск. Узкая панель → без подписей
          (только иконки), остальная панель не меняется. */}
      <SidebarNavRail
        items={railItems}
        activeIndex={RAIL_ORDER.indexOf(activeRail)}
        onSelect={onRailSelect}
        compact={navCompact}
      />

      {/* Нижняя область: список проектов («Главная») ИЛИ общий чат пространства. Crossfade. */}
      {animations ? (
        <motion.div
          key={showChat ? 'chat' : 'home'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18 }}
          // НЕ overflow-hidden: список проектов намеренно «вытекает» на -mx-1 (фокус-ринги),
          // а чат скроллит свой внутренний контейнер. overflow-hidden тут срезал ринги/4px.
          className="min-h-0 min-w-0"
        >
          {showChat ? (
            <CommunicationPanel />
          ) : (
            <nav className="h-full min-h-0 min-w-0">
              <SidebarProjectList />
            </nav>
          )}
        </motion.div>
      ) : (
        <div className="min-h-0 min-w-0">
          {showChat ? (
            <CommunicationPanel />
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
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-hover',
                isActive && 'bg-active font-medium text-foreground',
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
  animated,
  children,
}: {
  onClick: () => void;
  label: string;
  badge?: number;
  // Если иконка «живая» (AnimatedXxx) — оживляем её при наведении на узкий рейл.
  animated?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const [hover, setHover] = useState(false);
  const icon =
    animated && isValidElement(children)
      ? cloneElement(children as React.ReactElement<{ active?: boolean }>, { active: hover })
      : children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
          aria-label={label}
          className="relative grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          {icon}
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
  animated,
  children,
}: {
  to: string;
  end?: boolean;
  label: string;
  badge?: number;
  animated?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const [hover, setHover] = useState(false);
  // Сохраняем уже заданный active (напр. колокольчик звенит при непрочитанных) и добавляем
  // оживление на hover/активном маршруте.
  const childActive = isValidElement(children)
    ? Boolean((children.props as { active?: boolean }).active)
    : false;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={to}
          end={end}
          aria-label={label}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          className={({ isActive }) =>
            cn(
              'relative grid size-9 shrink-0 place-items-center rounded-md transition-colors hover:bg-hover',
              isActive
                ? 'bg-active text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              {animated && isValidElement(children)
                ? cloneElement(children as React.ReactElement<{ active?: boolean }>, {
                    active: hover || isActive || childActive,
                  })
                : children}
              {badge !== undefined && badge > 0 && (
                <span className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-medium text-primary-foreground">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </>
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

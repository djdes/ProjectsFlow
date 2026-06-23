import { useCallback, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Bell, FolderKanban, Inbox, Menu, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { NewProjectDialogProvider } from '@/presentation/components/forms/NewProjectDialogProvider';
import { AddTaskDialogProvider } from '@/presentation/components/forms/AddTaskDialogProvider';
import { GlobalSearchProvider } from '@/presentation/components/search/GlobalSearchProvider';
import { ProjectsProvider } from '@/presentation/hooks/ProjectsProvider';
import { GithubConnectionProvider } from '@/presentation/hooks/GithubConnectionProvider';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { useNotificationStream } from '@/presentation/hooks/useNotificationStream';
import { useUnreadNotificationsCount } from '@/presentation/hooks/useUnreadNotificationsCount';
import { InstallAppPrompt } from '@/presentation/components/pwa/InstallAppPrompt';
import { Sidebar } from './Sidebar';

const COLLAPSE_KEY = 'pf_sidebar_collapsed';

export function AppShell(): React.ReactElement {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Свёрнутость левой панели (desktop), переживает перезагрузку.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleCollapse = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* localStorage недоступен — состояние просто не персистится */
      }
      return next;
    });
  }, []);

  // SSE real-time-уведомления (toast + мгновенный бейдж). Только для authenticated-сессии,
  // которой и является AppShell (рендерится внутри ProtectedRoute).
  useNotificationStream();

  // ProjectsProvider — внутри ProtectedRoute (этот компонент рендерится только для authenticated),
  // поэтому не делает 401-запросов когда пользователь не залогинен.
  return (
    <ProjectsProvider>
      <GithubConnectionProvider>
        <NewProjectDialogProvider>
        <AddTaskDialogProvider>
        <GlobalSearchProvider>
        {isDesktop ? (
          <div
            className={cn(
              'grid h-dvh bg-background text-foreground',
              collapsed ? 'grid-cols-[3.5rem_1fr]' : 'grid-cols-[260px_1fr]',
            )}
          >
            <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
            <main className="relative overflow-y-auto">
              <Outlet />
            </main>
          </div>
        ) : (
          <div className="flex h-dvh flex-col bg-background text-foreground">
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDrawerOpen(true)}
                aria-label="Открыть меню"
              >
                <Menu />
              </Button>
              <span className="text-sm font-semibold">ProjectsFlow</span>
            </header>
            <InstallAppPrompt variant="banner" />
            <main className="flex-1 overflow-y-auto">
              <Outlet />
            </main>
            <MobileBottomNav onOpenProjects={() => setDrawerOpen(true)} />
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetContent side="left" className="w-72 p-0">
                <div onClick={() => setDrawerOpen(false)} className="h-full">
                  <Sidebar />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        )}
        </GlobalSearchProvider>
        </AddTaskDialogProvider>
        </NewProjectDialogProvider>
      </GithubConnectionProvider>
    </ProjectsProvider>
  );
}

// Нижний таб-бар (только mobile, <768px): Входящие / Проекты (drawer) / Уведомления / Профиль.
// Современный мобильный стандарт вместо «всё за гамбургером». Плавающие элементы
// (композер, булк-бар) подняты на его высоту через max-md-оффсеты.
function MobileBottomNav({ onOpenProjects }: { onOpenProjects: () => void }): React.ReactElement {
  const { count: unreadCount } = useUnreadNotificationsCount();

  // Активная вкладка получает «жидко-стеклянный» чип: слой светлее самой панели,
  // с верхним бликом и кольцом — приподнятое frosted-glass-выделение (iOS-26 / Telegram).
  const itemClass = (isActive: boolean): string =>
    cn(
      'group relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-[1.15rem] py-1.5 text-[10px] leading-none transition-all duration-300 ease-out',
      isActive
        ? 'text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_1px_3px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_3px_rgba(0,0,0,0.3)] dark:ring-white/10'
        : 'text-muted-foreground active:scale-[0.94]',
      isActive && 'bg-background/90 dark:bg-white/[0.07]',
    );

  // Парящая стеклянная панель: внешний <nav> держит отступы (эффект парения + safe-area
  // снизу), внутренний слой — frosted glass (blur + saturate + полупрозрачность + тень).
  // В потоке flex (shrink-0): контент страницы останавливается над панелью, оверлапа нет.
  // См. CLAUDE.md → «Правка мобильной вёрстки / PWA под iPhone».
  return (
    <nav className="shrink-0 px-3 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.55rem)]">
      <div className="relative mx-auto flex max-w-md items-stretch gap-1 rounded-[1.55rem] border border-white/20 bg-background/65 p-1 shadow-[0_8px_28px_-6px_rgba(0,0,0,0.35)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-background/55 dark:shadow-[0_8px_28px_-4px_rgba(0,0,0,0.6)]">
        {/* верхний блик стекла */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/20"
        />
        <NavLink to="/" end className={({ isActive }) => itemClass(isActive)}>
          <span className="relative inline-flex">
            <Inbox className="size-5" />
          </span>
          Входящие
        </NavLink>
        <button type="button" onClick={onOpenProjects} className={itemClass(false)}>
          <span className="relative inline-flex">
            <FolderKanban className="size-5" />
          </span>
          Проекты
        </button>
        <NavLink to="/notifications" className={({ isActive }) => itemClass(isActive)}>
          <span className="relative inline-flex">
            <Bell className="size-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1 inline-flex min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-[14px] text-primary-foreground">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </span>
          Уведомления
        </NavLink>
        <NavLink to="/profile" className={({ isActive }) => itemClass(isActive)}>
          <span className="relative inline-flex">
            <User className="size-5" />
          </span>
          Профиль
        </NavLink>
      </div>
    </nav>
  );
}

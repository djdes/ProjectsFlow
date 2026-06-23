import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Bell, FolderKanban, Inbox, Menu, User, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
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
  const { pathname } = useLocation();
  // Закрываем мобильный drawer ТОЛЬКО при смене маршрута (клик по проекту/разделу). Раньше
  // тут была обёртка onClick={close} вокруг всего Sidebar — она закрывала панель на ЛЮБОЙ
  // клик, ломая разворот секции «Мои проекты». Теперь тоггл секции (без навигации) не закрывает.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);
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
              'grid h-dvh overflow-hidden bg-background text-foreground',
              collapsed ? 'grid-cols-[3.5rem_1fr]' : 'grid-cols-[260px_1fr]',
            )}
          >
            <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
            <main className="relative min-h-0 overflow-y-auto">
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
              <SheetContent side="left" showClose={false} className="w-72 p-0">
                <div className="h-full">
                  <Sidebar />
                </div>
                {/* Свой крестик — выровнен по строке шапки Sidebar (p-3, иконки size-8),
                    чтобы быть на одной линии с колокольчиком, а не ниже (как дефолтный top-4). */}
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Закрыть"
                  className="absolute right-2 top-3 grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground dark:hover:bg-white/10"
                >
                  <X className="size-4" />
                </button>
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

type NavItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  run: () => void;
  badge?: number;
};

// Нижний таб-бар (только mobile, <768px): Входящие / Проекты (drawer) / Уведомления / Профиль.
// Парящая стеклянная панель (iOS-26 / Telegram glass). Жест: зажать и провести пальцем по
// панели — стеклянный индикатор пружинисто едет за пальцем (motion layout), на отпускании
// выбирается вкладка под ним. Обычный тап и клавиатура (Enter/Space) тоже работают.
function MobileBottomNav({ onOpenProjects }: { onOpenProjects: () => void }): React.ReactElement {
  const { count: unreadCount } = useUnreadNotificationsCount();
  const { animations } = useMotion();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const containerRef = useRef<HTMLDivElement>(null);
  // Индекс вкладки под пальцем во время жеста (null — жеста нет).
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // «Поп» иконки при срабатывании вкладки (как в Telegram): index — какая, id растёт на
  // каждом срабатывании, чтобы анимация перезапускалась (через смену key у motion-иконки).
  const [pop, setPop] = useState<{ index: number; id: number }>({ index: -1, id: 0 });

  const items: NavItem[] = [
    { key: 'inbox', label: 'Входящие', icon: <Inbox className="size-5" />, active: pathname === '/', run: () => navigate('/') },
    { key: 'projects', label: 'Проекты', icon: <FolderKanban className="size-5" />, active: false, run: onOpenProjects },
    { key: 'notifications', label: 'Уведомления', icon: <Bell className="size-5" />, badge: unreadCount, active: pathname.startsWith('/notifications'), run: () => navigate('/notifications') },
    { key: 'profile', label: 'Профиль', icon: <User className="size-5" />, active: pathname.startsWith('/profile'), run: () => navigate('/profile') },
  ];
  const activeIndex = items.findIndex((i) => i.active);
  // Подсвечено: палец во время жеста, иначе — активный маршрут (−1 = ничего, напр. внутри проекта).
  const highlight = dragIndex ?? activeIndex;

  // Какая вкладка под точкой X — панель из равных flex-ячеек, делим ширину на их число.
  const indexFromX = (clientX: number): number | null => {
    const el = containerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const ratio = (clientX - r.left) / r.width;
    return Math.min(items.length - 1, Math.max(0, Math.floor(ratio * items.length)));
  };

  // Срабатывание вкладки: действие + триггер «попа» иконки.
  const select = (i: number): void => {
    items[i]?.run();
    setPop((p) => ({ index: i, id: p.id + 1 }));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragIndex(indexFromX(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (dragIndex === null) return;
    const i = indexFromX(e.clientX);
    if (i !== null) setDragIndex(i);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (dragIndex === null) return;
    select(indexFromX(e.clientX) ?? dragIndex);
    setDragIndex(null);
  };

  const glassTransition = animations
    ? { type: 'spring' as const, stiffness: 520, damping: 34, mass: 0.7 }
    : { duration: 0 };

  // Парящая стеклянная панель: внешний <nav> держит отступы (эффект парения + safe-area
  // снизу), внутренний слой — frosted glass (blur + saturate + полупрозрачность + тень).
  // В потоке flex (shrink-0): контент страницы останавливается над панелью, оверлапа нет.
  // См. CLAUDE.md → «Правка мобильной вёрстки / PWA под iPhone».
  return (
    <nav className="shrink-0 px-3 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.15rem)]">
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDragIndex(null)}
        className="relative mx-auto flex max-w-md touch-none select-none items-stretch gap-1 rounded-[1.55rem] border border-white/20 bg-background/65 p-1 shadow-[0_8px_28px_-6px_rgba(0,0,0,0.35)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-background/55 dark:shadow-[0_8px_28px_-4px_rgba(0,0,0,0.6)]"
      >
        {/* верхний блик стекла */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/20"
        />
        {items.map((item, idx) => {
          const isHighlighted = idx === highlight;
          const isUnderFinger = dragIndex !== null && idx === dragIndex;
          return (
            <button
              key={item.key}
              type="button"
              aria-label={item.label}
              aria-current={item.active ? 'page' : undefined}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  select(idx);
                }
              }}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-[1.15rem] py-1.5 text-[10px] leading-none transition-colors duration-200',
                isHighlighted ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {/* Стеклянный индикатор: один на панель (layoutId) — пружинисто переезжает между вкладками. */}
              {isHighlighted && (
                <motion.span
                  aria-hidden
                  layoutId="pf-nav-glass"
                  transition={glassTransition}
                  className="absolute inset-0 rounded-[1.15rem] bg-background/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_1px_3px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_3px_rgba(0,0,0,0.3)] dark:ring-white/10"
                />
              )}
              <span className="relative z-10 inline-flex">
                {animations ? (
                  <motion.span
                    // key растёт при срабатывании → motion перезапускает «поп» (как иконки в Telegram).
                    key={pop.index === idx ? pop.id : 'idle'}
                    className="inline-flex"
                    initial={pop.index === idx ? { scale: 0.55 } : false}
                    animate={{ scale: isUnderFinger ? 1.14 : 1, y: isUnderFinger ? -2 : 0 }}
                    transition={{ type: 'spring', stiffness: 620, damping: 15, mass: 0.7 }}
                  >
                    {item.icon}
                  </motion.span>
                ) : (
                  item.icon
                )}
                {item.key === 'notifications' && (item.badge ?? 0) > 0 && (
                  <span className="absolute -right-1.5 -top-1 inline-flex min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-[14px] text-primary-foreground">
                    {(item.badge ?? 0) > 99 ? '99+' : item.badge}
                  </span>
                )}
              </span>
              <span className="relative z-10">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

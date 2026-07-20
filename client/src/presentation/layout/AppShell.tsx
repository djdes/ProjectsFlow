import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, Sparkles, X } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AnimatedChat,
  AnimatedFolder,
  AnimatedInbox,
  AnimatedUser,
} from '@/presentation/components/nav/AnimatedNavIcons';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { cn } from '@/lib/utils';
import { NewProjectDialogProvider } from '@/presentation/components/forms/NewProjectDialogProvider';
import { AddTaskDialogProvider } from '@/presentation/components/forms/AddTaskDialogProvider';
import { GlobalSearchProvider } from '@/presentation/components/search/GlobalSearchProvider';
import { ProjectsProvider } from '@/presentation/hooks/ProjectsProvider';
import { WorkspacesProvider } from '@/presentation/hooks/WorkspacesProvider';
import { UsageProvider } from '@/presentation/usage/UsageProvider';
import { UsageDialogProvider } from '@/presentation/usage/UsageDialogProvider';
import { UpgradeDialogProvider } from '@/presentation/usage/UpgradeDialogProvider';
import { UsageBanner } from '@/presentation/usage/UsageBanner';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import { PageTransition } from '@/presentation/components/motion/PageTransition';
import { WorkspaceIcon } from './WorkspaceIcon';
import { GithubConnectionProvider } from '@/presentation/hooks/GithubConnectionProvider';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { useNotificationStream } from '@/presentation/hooks/useNotificationStream';
import { useActionableUnreadCount } from '@/presentation/hooks/useActionableUnreadCount';
import { InstallAppPrompt } from '@/presentation/components/pwa/InstallAppPrompt';
import { HelpWidget } from '@/presentation/components/help/HelpWidget';
import { useSidebarWidth, SIDEBAR_COMPACT_WIDTH } from '@/presentation/hooks/useSidebarWidth';
import { RightPanelProvider, RightPanelWidthProvider } from './rightPanelContext';
import { ResizeHandleHint } from '@/presentation/components/layout/ResizeHandleHint';
import { SidebarCollapsedContext } from './sidebarCollapsedContext';
import { SidebarResizingContext } from './sidebarResizingContext';
import { Sidebar } from './Sidebar';
import { useEdgeSwipe } from '@/presentation/hooks/useEdgeSwipe';

const COLLAPSE_KEY = 'pf_sidebar_collapsed';

export function AppShell(): React.ReactElement {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mainScrolled, setMainScrolled] = useState(false);
  const handleMainScroll = useCallback((event: React.UIEvent<HTMLElement>): void => {
    const next = event.currentTarget.scrollTop > 8;
    setMainScrolled((current) => (current === next ? current : next));
  }, []);
  // Ширина открытого справа окна. Основной <main> остаётся неизменным; значение используют
  // только элементы, которым разрешено сужаться под панелью (плашка и строка отображений).
  const [rightPanelWidth, setRightPanelWidth] = useState(0);
  const { pathname } = useLocation();
  const studioRoute = /\/projects\/[^/]+\/studio(?:\/|$)/.test(pathname);
  const immersiveRoute = pathname === '/ai' || pathname.startsWith('/ai/') || studioRoute;
  const [studioChatHidden, setStudioChatHidden] = useState(false);
  useEffect(() => {
    const onStudioChatHidden = (event: Event): void => {
      const hidden = (event as CustomEvent<{ hidden?: boolean }>).detail?.hidden;
      if (typeof hidden === 'boolean') setStudioChatHidden(hidden);
    };
    window.addEventListener('pf:studio-chat-hidden', onStudioChatHidden);
    return () => window.removeEventListener('pf:studio-chat-hidden', onStudioChatHidden);
  }, []);
  // Закрываем мобильный drawer ТОЛЬКО при смене маршрута (клик по проекту/разделу). Раньше
  // тут была обёртка onClick={close} вокруг всего Sidebar — она закрывала панель на ЛЮБОЙ
  // клик, ломая разворот секции «Мои проекты». Теперь тоггл секции (без навигации) не закрывает.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);
  // iPhone-style жест: свайп от левого края открывает мобильную панель, свайп влево — закрывает.
  // Только на мобиле (!isDesktop); на десктопе панель управляется иначе (Ctrl+\ / клик).
  useEdgeSwipe({
    enabled: !isDesktop,
    open: drawerOpen,
    onOpen: () => setDrawerOpen(true),
    onClose: () => setDrawerOpen(false),
  });
  // Свёрнутость левой панели (desktop), переживает перезагрузку.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  // Сворачивание принадлежит окну задачи (auto), а не ручному тогглу — чтобы при
  // сужении окна вернуть панель только если её свернуло перетаскивание, а не юзер.
  const autoCollapsedRef = useRef(false);
  const toggleCollapse = useCallback(() => {
    // Ручной тоггл «забирает» владение: после него ресайз окна панель не вернёт.
    autoCollapsedRef.current = false;
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

  // Страницы, которым принадлежит весь viewport (Studio/ИИ), могут один раз попросить
  // свернуть панель. Это управляемый сигнал, а не клик-эмуляция: пользователь затем может
  // снова открыть панель, и контент штатно сдвинется вправо.
  useEffect(() => {
    const onSetCollapsed = (event: Event): void => {
      const detail = (event as CustomEvent<{ collapsed?: boolean }>).detail;
      if (typeof detail?.collapsed !== 'boolean') return;
      autoCollapsedRef.current = false;
      setCollapsed(detail.collapsed);
      try { localStorage.setItem(COLLAPSE_KEY, detail.collapsed ? '1' : '0'); } catch { /* ignore */ }
    };
    window.addEventListener('pf:set-sidebar-collapsed', onSetCollapsed);
    return () => window.removeEventListener('pf:set-sidebar-collapsed', onSetCollapsed);
  }, []);

  // Окно задачи дотянули ресайзом до левой панели → сворачиваем её (task 16).
  // Сигнал шлёт useResizableWidth (window-событие), чтобы не тянуть проп через полдерева.
  // При обратном сужении окна (pf:drawer-clear-sidebar) панель возвращаем — но только
  // если её свернуло именно перетаскивание окна (autoCollapsedRef), а не ручной тоггл.
  useEffect(() => {
    const setCollapsedPersisted = (next: boolean): void => {
      setCollapsed((v) => {
        if (v === next) return v;
        try {
          localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
        } catch {
          /* localStorage недоступен */
        }
        return next;
      });
    };
    const onOverSidebar = (): void => {
      autoCollapsedRef.current = true;
      setCollapsedPersisted(true);
    };
    const onClearSidebar = (): void => {
      if (!autoCollapsedRef.current) return;
      autoCollapsedRef.current = false;
      setCollapsedPersisted(false);
    };
    window.addEventListener('pf:drawer-over-sidebar', onOverSidebar);
    window.addEventListener('pf:drawer-clear-sidebar', onClearSidebar);
    return () => {
      window.removeEventListener('pf:drawer-over-sidebar', onOverSidebar);
      window.removeEventListener('pf:drawer-clear-sidebar', onClearSidebar);
    };
  }, []);

  // Хоткей Ctrl+\ (Cmd+\ на mac) — тоггл левой панели, как в Notion.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        toggleCollapse();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleCollapse]);

  // Ширина левой панели (тянется ручкой у правого края), запоминается в профиле.
  // Активна только на desktop и когда панель развёрнута.
  const { width: sidebarWidth, dragging: sidebarDragging, onHandlePointerDown } = useSidebarWidth(
    isDesktop && !collapsed,
    toggleCollapse,
  );
  // Ресайз увёл ширину ниже порога → ТОЛЬКО верхний навигационный ряд становится иконками
  // (без подписей). Остальная панель (свитчер, список проектов) не меняется.
  const navCompact = !collapsed && sidebarWidth < SIDEBAR_COMPACT_WIDTH;
  const { animations } = useMotion();

  // Свёрнутая панель: наведение на бургер (или на предпросмотр) показывает плавающий
  // предпросмотр панели; клик по бургеру — закрепляет её открытой. Таймер на закрытие
  // «сшивает» зазор между бургером и оверлеем, чтобы предпросмотр не мигал.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<number | null>(null);
  const openPeek = useCallback((): void => {
    if (peekTimer.current) {
      window.clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
    setPeek(true);
  }, []);
  const closePeekSoon = useCallback((): void => {
    if (peekTimer.current) window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeek(false), 140);
  }, []);
  // Смена маршрута (клик по проекту в предпросмотре) — прячем предпросмотр.
  useEffect(() => {
    setPeek(false);
  }, [pathname]);

  // SSE real-time-уведомления (toast + мгновенный бейдж). Только для authenticated-сессии,
  // которой и является AppShell (рендерится внутри ProtectedRoute).
  useNotificationStream();

  // ProjectsProvider — внутри ProtectedRoute (этот компонент рендерится только для authenticated),
  // поэтому не делает 401-запросов когда пользователь не залогинен.
  return (
    <SidebarCollapsedContext.Provider value={isDesktop && collapsed}>
    <SidebarResizingContext.Provider value={sidebarDragging}>
    <WorkspacesProvider>
    <ProjectsProvider>
    <UsageProvider>
      <GithubConnectionProvider>
        <NewProjectDialogProvider>
        <UpgradeDialogProvider>
        <UsageDialogProvider>
        {/* AddTaskDialogProvider ВНУТРИ Upgrade/UsageDialog: он монтирует <AddTaskDialog> с
            композером, а тот через useAiBlocked зовёт useUsageDialog + useUpgradeDialog.
            Снаружи этих провайдеров «Добавить задачу» падало «must be used inside …». */}
        <AddTaskDialogProvider>
        <GlobalSearchProvider>
        <RightPanelProvider value={setRightPanelWidth}>
        <RightPanelWidthProvider value={rightPanelWidth}>
        {isDesktop ? (
          <div
            className={cn(
              'relative grid h-dvh overflow-hidden bg-background text-foreground',
              // Пока тянем ручку — гасим выделение текста.
              sidebarDragging && 'select-none',
            )}
            // Свёрнутая панель скрывается ЦЕЛИКОМ (Notion-style); развёрнутая — тянется ручкой.
            style={{ gridTemplateColumns: collapsed ? '1fr' : `${sidebarWidth}px 1fr` }}
          >
            {!collapsed && (
              <Sidebar collapsed={collapsed} navCompact={navCompact} onToggleCollapse={toggleCollapse} />
            )}
            {/* Ручка ресайза панели: тонкая полоса на её правом крае. Тяга → шире/уже,
                клик → свернуть (Ctrl+\), на hover — чёрная подсказка справа. */}
            {!collapsed && (
              <ResizeHandleHint side="right">
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Изменить ширину панели или свернуть"
                  onPointerDown={onHandlePointerDown}
                  style={{ left: sidebarWidth }}
                  className={cn(
                    'absolute top-0 z-30 h-full w-2 -translate-x-1/2 cursor-col-resize',
                    // Тонкая линия-индикатор по центру — проявляется на hover / во время тяги.
                    'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-primary/40',
                    sidebarDragging && 'after:bg-primary/60',
                  )}
                />
              </ResizeHandleHint>
            )}
            {/* Свёрнутая панель (Notion-style): бургер сверху-слева + предпросмотр на hover.
                Контент (обложка, синяя плашка) при этом растянут до левого края. */}
            {collapsed && !(studioRoute && studioChatHidden) && (
              <>
                <TooltipProvider delayDuration={550} skipDelayDuration={120}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onMouseEnter={openPeek}
                        onMouseLeave={closePeekSoon}
                        onClick={() => {
                          setPeek(false);
                          toggleCollapse();
                        }}
                        aria-label="Показать боковую панель"
                        className="absolute left-2 top-1.5 z-[110] grid size-8 place-items-center rounded-md bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-hover hover:text-foreground"
                      >
                        <Menu className="size-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      className="flex items-center gap-1.5 border-transparent bg-foreground text-background"
                    >
                      <span>Закрепить панель</span>
                      <kbd className="rounded bg-background/15 px-1 text-[10px] leading-4">Ctrl+\</kbd>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {/* Плавающий предпросмотр панели — оверлей поверх контента (не двигает его). */}
                <AnimatePresence>
                  {peek && (
                    <motion.div
                      key="sidebar-peek"
                      initial={animations ? { x: -14, opacity: 0 } : false}
                      animate={{ x: 0, opacity: 1 }}
                      exit={animations ? { x: -14, opacity: 0 } : { opacity: 0 }}
                      transition={animations ? { type: 'spring', stiffness: 560, damping: 44 } : { duration: 0 }}
                      onMouseEnter={openPeek}
                      onMouseLeave={closePeekSoon}
                      style={{ width: sidebarWidth }}
                      className="absolute bottom-3 left-1.5 top-12 z-[100] overflow-hidden rounded-xl border bg-sidebar shadow-2xl"
                    >
                      <Sidebar
                        collapsed={false}
                        navCompact={sidebarWidth < SIDEBAR_COMPACT_WIDTH}
                        onToggleCollapse={toggleCollapse}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
            <main
              className={cn('relative min-h-0', immersiveRoute ? 'overflow-hidden' : 'overflow-y-auto')}
              data-pf-scrolled={mainScrolled ? 'true' : 'false'}
              onScroll={handleMainScroll}
            >
              <PageTransition>
                <Outlet />
              </PageTransition>
            </main>
          </div>
        ) : (
          <div className="flex h-dvh flex-col bg-background text-foreground">
            <header className="flex min-h-11 shrink-0 items-center gap-2 border-b px-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDrawerOpen(true)}
                aria-label="Открыть меню"
              >
                <Menu />
              </Button>
              <MobileWorkspaceTitle />
            </header>
            <InstallAppPrompt variant="banner" />
            <main
              className={cn('min-h-0 flex-1', immersiveRoute ? 'overflow-hidden' : 'overflow-y-auto')}
              data-pf-scrolled={mainScrolled ? 'true' : 'false'}
              onScroll={handleMainScroll}
            >
              <PageTransition>
                <Outlet />
              </PageTransition>
            </main>
            <MobileBottomNav onOpenProjects={() => setDrawerOpen(true)} />
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetContent
                side="left"
                showClose={false}
                className="w-[88vw] max-w-sm p-0 data-[state=closed]:duration-150 data-[state=open]:duration-200"
              >
                <div className="h-full">
                  <Sidebar onNavigate={() => setDrawerOpen(false)} />
                </div>
                {/* Свой крестик — выровнен по строке шапки Sidebar (p-3, иконки size-8),
                    чтобы быть на одной линии с колокольчиком, а не ниже (как дефолтный top-4). */}
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Закрыть"
                  className="absolute right-2 top-3 grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </SheetContent>
            </Sheet>
          </div>
        )}
        {/* Плавающий виджет помощи/поддержки — снизу справа, портал в body, над таб-баром. */}
        <HelpWidget />
        {/* Висящий баннер при низком/исчерпанном лимите — снизу по центру, клик → окно usage. */}
        <UsageBanner />
        </RightPanelWidthProvider>
        </RightPanelProvider>
        </GlobalSearchProvider>
        </AddTaskDialogProvider>
        </UsageDialogProvider>
        </UpgradeDialogProvider>
        </NewProjectDialogProvider>
      </GithubConnectionProvider>
    </UsageProvider>
    </ProjectsProvider>
    </WorkspacesProvider>
    </SidebarResizingContext.Provider>
    </SidebarCollapsedContext.Provider>
  );
}

// Заголовок мобильной шапки — название активного пространства вместо статичного лого.
function MobileWorkspaceTitle(): React.ReactElement {
  const { workspace } = useCurrentWorkspace();
  if (!workspace) return <span className="text-sm font-semibold">ProjectsFlow</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <WorkspaceIcon name={workspace.name} icon={workspace.icon} className="size-5 text-[10px]" />
      <span className="truncate text-sm font-semibold">{workspace.name}</span>
    </span>
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

// Нижний таб-бар (только mobile, <768px): Входящие / Проекты / Чат / ИИ / Профиль.
// Парящая стеклянная панель (iOS-26 / Telegram glass). Жест: зажать и провести пальцем по
// панели — стеклянный индикатор пружинисто едет за пальцем (motion layout), на отпускании
// выбирается вкладка под ним. Обычный тап и клавиатура (Enter/Space) тоже работают.
function MobileBottomNav({ onOpenProjects }: { onOpenProjects: () => void }): React.ReactElement {
  const { count: actionable } = useActionableUnreadCount();
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
    { key: 'inbox', label: 'Входящие', icon: <AnimatedInbox className="size-5" />, active: pathname === '/', run: () => navigate('/') },
    { key: 'projects', label: 'Проекты', icon: <AnimatedFolder className="size-5" />, active: false, run: onOpenProjects },
    { key: 'chat', label: 'Чат', icon: <AnimatedChat className="size-5" />, badge: actionable, active: false, run: () => { try { localStorage.setItem('pf_sidebar_rail', 'chat'); } catch { /* ignore */ } onOpenProjects(); } },
    { key: 'ai', label: 'ИИ', icon: <Sparkles className="size-5" />, active: pathname === '/ai' || pathname.startsWith('/ai/'), run: () => navigate('/ai') },
    { key: 'profile', label: 'Профиль', icon: <AnimatedUser className="size-5" />, active: pathname.startsWith('/profile'), run: () => navigate('/profile') },
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
        // iOS-перф: НЕ используем backdrop-blur на таб-баре — «стеклянная» панель постоянно
        // висит поверх скролла, а backdrop-filter пересчитывается каждый кадр (главный тормоз
        // на iPhone Safari). Делаем СПЛОШНОЙ фон — визуально чисто, скролл плавный.
        className="relative mx-auto flex max-w-md touch-none select-none items-stretch gap-1 rounded-[1.55rem] border border-black/10 bg-background p-1 shadow-[0_8px_28px_-6px_rgba(0,0,0,0.22)] dark:border-white/10 dark:bg-background dark:shadow-[0_8px_28px_-4px_rgba(0,0,0,0.55)]"
      >
        {/* верхний блик стекла */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/20"
        />
        {items.map((item, idx) => {
          const isHighlighted = idx === highlight;
          const isUnderFinger = dragIndex !== null && idx === dragIndex;
          // «Живые» иконки получают active → оживают внутренние части (как в рейле сайдбара).
          const icon = isValidElement(item.icon)
            ? cloneElement(item.icon as React.ReactElement<{ active?: boolean }>, { active: isHighlighted })
            : item.icon;
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
                    {icon}
                  </motion.span>
                ) : (
                  icon
                )}
                {/* Бейдж непрочитанного (U5): раньше сверялось с key 'notifications',
                    которого нет среди вкладок (inbox|projects|chat|profile) — индикатор
                    не рендерился никогда. Теперь показываем на любой вкладке с badge>0. */}
                {(item.badge ?? 0) > 0 && (
                  <span className="absolute -right-1.5 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
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

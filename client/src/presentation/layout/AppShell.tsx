import { NavigationProgress } from '@/presentation/components/experience/NavigationProgress';
import { useAppNavigation } from '@/presentation/components/experience/useAppNavigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, Sparkles, X } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { MobileBottomNav } from './MobileBottomNav';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
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
import { AppExperience } from '@/presentation/components/experience/AppExperience';
import { WorkspaceIcon } from './WorkspaceIcon';
import { GithubConnectionProvider } from '@/presentation/hooks/GithubConnectionProvider';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { useNotificationStream } from '@/presentation/hooks/useNotificationStream';
import { useActionableUnreadCount } from '@/presentation/hooks/useActionableUnreadCount';
import { useActiveChatUnread } from '@/presentation/hooks/useChatRooms';
import { InstallAppPrompt } from '@/presentation/components/pwa/InstallAppPrompt';
import { HelpWidget } from '@/presentation/components/help/HelpWidget';
import { useSidebarWidth, SIDEBAR_COMPACT_WIDTH } from '@/presentation/hooks/useSidebarWidth';
import { RightPanelProvider, RightPanelWidthProvider } from './rightPanelContext';
import { CompletedTodayProvider } from '@/presentation/hooks/CompletedTodayProvider';
import { UnreadTasksProvider } from '@/presentation/hooks/UnreadTasksProvider';
import { FocusedInboxProvider } from '@/presentation/hooks/FocusedInboxProvider';
import { OPEN_INBOX_TASK_EVENT } from '@/presentation/components/tasks/AssignedTaskToast';
import { SPOTLIGHT_TASK_EVENT } from '@/presentation/hooks/useSpotlightTask';
import { CompletedTodayPill } from '@/presentation/components/stats/CompletedTodayPill';
import { CompletionCelebration } from '@/presentation/components/stats/CompletionCelebration';
import { ResizeHandleHint } from '@/presentation/components/layout/ResizeHandleHint';
import { SidebarCollapsedContext } from './sidebarCollapsedContext';
import { SidebarResizingContext } from './sidebarResizingContext';
import { Sidebar } from './Sidebar';
import { useEdgeSwipe } from '@/presentation/hooks/useEdgeSwipe';

const COLLAPSE_KEY = 'pf_sidebar_collapsed';

export function AppShell(): React.ReactElement {
  const navigate = useNavigate();
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
  useAppNavigation(isDesktop);
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
  // iPhone-style жест: тянешь от левого края — панель открывается (доска не скроллится),
  // свайп влево — закрывается. Только на мобиле; на десктопе панель управляется иначе.
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

  // Единственное условие «плавающий бургер сейчас на экране»: им и рисуем кнопку, и
  // помечаем корень для globals.css. Разводить эти два места нельзя — разъехавшись, они
  // дают либо бургер поверх текста, либо пустой отступ на странице, где бургера нет.
  const floatingBurger = isDesktop && collapsed && !(studioRoute && studioChatHidden);

  // Свёрнутая панель: наведение на бургер, на левый край экрана или на сам предпросмотр
  // показывает плавающий предпросмотр панели; клик по бургеру — закрепляет её открытой.
  // Таймер на закрытие «сшивает» зазоры между этими зонами, чтобы предпросмотр не мигал.
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
  //
  // `collapsed` в зависимостях закрывает так: закрепить панель можно не только бургером
  // (он сбрасывает peek сам), но и кнопкой в шапке предпросмотра, хоткеем Ctrl+\ и ручкой
  // ширины. Те пути peek не трогали, он оставался true — и при СЛЕДУЮЩЕМ сворачивании
  // предпросмотр выезжал сразу, без наведения. Курсор в этот момент вне его, значит
  // mouseleave не придёт, closePeekSoon не запустится, и панель висит поверх контента,
  // перехватывая клики. Сброс на любую смену состояния убирает весь класс этих путей —
  // вместо того чтобы помнить про setPeek в каждом новом месте.
  useEffect(() => {
    setPeek(false);
  }, [pathname, collapsed]);

  // SSE real-time-уведомления (toast + мгновенный бейдж). Только для authenticated-сессии,
  // которой и является AppShell (рендерится внутри ProtectedRoute).
  useNotificationStream();

  // ProjectsProvider — внутри ProtectedRoute (этот компонент рендерится только для authenticated),
  // поэтому не делает 401-запросов когда пользователь не залогинен.
  // Переход по кнопке «Открыть» из плашки о назначенной задаче. Сам тост навигацию
  // сделать не может — он отрисован вне роутера.
  useEffect(() => {
    const onOpen = (e: Event): void => {
      const taskId = (e as CustomEvent<{ taskId?: string }>).detail?.taskId;
      if (!taskId) return;
      // Уже на «Входящих» — навигация не нужна и вредна: она сбросила бы позицию
      // скролла и состояние страницы. Просто просим подсветить задачу на месте.
      if (pathname.startsWith('/inbox')) {
        window.dispatchEvent(new CustomEvent(SPOTLIGHT_TASK_EVENT, { detail: { taskId } }));
        return;
      }
      navigate(`/inbox?task=${encodeURIComponent(taskId)}`);
    };
    window.addEventListener(OPEN_INBOX_TASK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_INBOX_TASK_EVENT, onOpen);
  }, [navigate, pathname]);

  return (
    <SidebarCollapsedContext.Provider value={isDesktop && collapsed}>
    <SidebarResizingContext.Provider value={sidebarDragging}>
    <WorkspacesProvider>
    <ProjectsProvider>
    {/* Счётчик «выполнено сегодня» — над роутером, чтобы цифра не сбрасывалась при переходах
        между страницами. Внутри AppShell (а не в main.tsx): запрос требует авторизации. */}
    <CompletedTodayProvider>
    {/* Непрочитанные задачи — над роутером: подсветка нужна и на доске, и во «Входящих»,
        и не должна перезапрашиваться на каждом переходе. */}
    <UnreadTasksProvider>
    <FocusedInboxProvider>
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
          <AppExperience desktop={isDesktop} />
        {isDesktop ? (
          <div
            className={cn(
              'relative grid h-dvh overflow-hidden bg-background text-foreground',
              // Пока тянем ручку — гасим выделение текста.
              sidebarDragging && 'select-none',
            )}
            // Отступ под плавающий бургер выдаёт globals.css по этому атрибуту — страницам
            // достаточно повесить .pf-burger-gap, считать пиксели им не нужно.
            data-pf-floating-burger={floatingBurger ? 'true' : 'false'}
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
                    'absolute inset-bs-0 z-30 h-full w-2 -translate-x-1/2 cursor-col-resize',
                    // Тонкая линия-индикатор по центру — проявляется на hover / во время тяги.
                    'after:absolute after:inset-y-0 after:start-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-primary/40',
                    sidebarDragging && 'after:bg-primary/60',
                  )}
                />
              </ResizeHandleHint>
            )}
            {/* Свёрнутая панель (Notion-style): бургер сверху-слева + предпросмотр на hover.
                Контент (обложка, синяя плашка) при этом растянут до левого края. */}
            {floatingBurger && (
              <>
                {/* Курсор «упёрся» в левый край экрана → панель выезжает так же, как по
                    наведению на бургер (Notion). Полоса 4px ловит движение к краю и почти
                    не отбирает клики у контента, который в свёрнутом виде дотянут до края. */}
                <div
                  aria-hidden
                  onMouseEnter={openPeek}
                  onMouseLeave={closePeekSoon}
                  className="absolute start-0 inset-bs-0 z-[105] h-full w-1"
                />
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
                        // Бургер сливается с фоном страницы: ни заливки, ни тени — подложка
                        // появляется только на hover. Радиус 6px — по MEASURED.md §3.
                        // Геометрия: size-8 + top-1.5 держит центр на y=22 — ровно центр
                        // строки крошек (h-11, items-center); правый край x=40, под него и
                        // считан отступ .pf-burger-gap в globals.css (44px). Размер выбран
                        // крупнее нотионовских 28×28 по просьбе пользователя.
                        // z ВЫШЕ предпросмотра (z-100) и оверлей начинается НИЖЕ бургера
                        // (top-11 = 44 > 38, низ кнопки): подсмотр открывается по наведению
                        // на этот же бургер, и если панель ложится поверх него, браузер шлёт
                        // бургеру mouseleave — ховер срывается (тултип мёртв), а клик
                        // «закрепить» уходит в переключатель пространства, который
                        // оказывается под курсором.
                        className="absolute start-2 inset-bs-1.5 z-[101] grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                      >
                        <Menu className="size-5" />
                        <BurgerUnreadBadge />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      className="flex items-center gap-1.5 border-transparent bg-foreground text-background"
                    >
                      <span>Закрепить панель</span>
                      <kbd className="rounded bg-background/15 px-1 text-2xs leading-4">Ctrl+\</kbd>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {/* Плавающий предпросмотр панели — оверлей поверх контента (не двигает его).
                    top-11 = высота строки верхнего хрома: панель начинается ПОД бургером и
                    не накрывает его — иначе выехавшая панель перехватывает ховер и клик
                    «закрепить» попадает в её же переключатель пространства.
                    Выравнивать подсмотр по закреплённой панели всё равно не по чему:
                    закреплённая — колонка грида от x=0/y=0, а подсмотр стоит на left-1.5. */}
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
                      className="absolute inset-be-3 start-1.5 inset-bs-11 z-[100] overflow-clip rounded-xl border bg-sidebar shadow-2xl"
                    >
                      {/* peek — второй путь к закреплению (кроме бургера): кнопка в шапке
                          панели в этом режиме не сворачивает, а закрепляет, поэтому там
                          другая иконка/подпись и она видна сразу, а не по ховеру. */}
                      <Sidebar
                        collapsed={false}
                        peek
                        navCompact={sidebarWidth < SIDEBAR_COMPACT_WIDTH}
                        onToggleCollapse={toggleCollapse}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
            <main
              data-pf-main
              className={cn('relative min-h-0', immersiveRoute ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden')}
              data-pf-scrolled={mainScrolled ? 'true' : 'false'}
              onScroll={handleMainScroll}
            >
              <NavigationProgress />
              <PageTransition>
                <Outlet />
              </PageTransition>
            </main>
          </div>
        ) : (
          <div className="flex h-dvh flex-col bg-background text-foreground">
            <header data-pf-mobile-app-header className="flex min-h-12 shrink-0 items-center gap-2 border-be px-3">
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0"
                onClick={() => setDrawerOpen(true)}
                aria-label="Открыть меню"
              >
                {/* Явный size-5: без него lucide рисует 24px, и на тач-экранах чёткость плывёт
                    (иконка выглядит «раздвоенной»/жирной). Совпадает с бургером десктопа. */}
                <Menu className="size-5" />
              </Button>
              <MobileWorkspaceTitle />
              <CompletedTodayPill />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 rounded-lg text-muted-foreground"
                aria-label="Открыть ИИ и поддержку"
                onClick={() => window.dispatchEvent(new CustomEvent('pf:open-help'))}
              >
                <Sparkles className="size-5" />
              </Button>
            </header>
            <InstallAppPrompt variant="banner" />
            <main
              data-pf-main
              className={cn('min-h-0 flex-1', immersiveRoute ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden')}
              data-pf-scrolled={mainScrolled ? 'true' : 'false'}
              onScroll={handleMainScroll}
            >
              <NavigationProgress />
              <PageTransition>
                <Outlet />
              </PageTransition>
            </main>
            <MobileBottomNav />
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetContent
                mobileSheet={false}
                aria-describedby={undefined}
                side="left"
                showClose={false}
                data-pf-drawer-content
                className="w-[88vw] max-w-sm p-0 ease-out data-[state=closed]:duration-200 data-[state=open]:duration-200"
              >
                <SheetTitle className="sr-only">Навигация</SheetTitle>
                <div className="h-full">
                  <Sidebar onNavigate={() => setDrawerOpen(false)} />
                </div>
                {/* Свой крестик — выровнен по строке шапки Sidebar (p-3, иконки size-8),
                    чтобы быть на одной линии с колокольчиком, а не ниже (как дефолтный top-4). */}
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Закрыть"
                  className="absolute end-2 inset-bs-3 grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </SheetContent>
            </Sheet>
          </div>
        )}
        {/* Конфетти на закрытие задачи из ЛЮБОЙ точки (чекбокс, ховер-кнопка, drag) — один
            праздник на приложение, запускается ключом из CompletedTodayProvider. */}
        <CompletionCelebration />
        {/* Плавающий виджет помощи/поддержки — снизу справа, портал в body, над таб-баром. */}
        <HelpWidget showLauncher={isDesktop} />
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
    </FocusedInboxProvider>
    </UnreadTasksProvider>
    </CompletedTodayProvider>
    </ProjectsProvider>
    </WorkspacesProvider>
    </SidebarResizingContext.Provider>
    </SidebarCollapsedContext.Provider>
  );
}

// Заголовок мобильной шапки — название активного пространства вместо статичного лого.
function MobileWorkspaceTitle(): React.ReactElement {
  const { workspace } = useCurrentWorkspace();
  if (!workspace) return <span className="min-w-0 flex-1 truncate text-sm font-semibold">ProjectsFlow</span>;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <WorkspaceIcon name={workspace.name} icon={workspace.icon} className="size-5 text-[10px]" />
      <span className="truncate text-sm font-semibold">{workspace.name}</span>
    </span>
  );
}

// Бейдж непрочитанного в правом верхнем углу свёрнутого бургера. Пока панель свёрнута,
// её собственный счётчик (rail-кнопка «Чат») не виден вообще — сигнал «есть что
// посмотреть» иначе теряется до разворота панели. Сумма ровно та же, что у «Чата»
// в Sidebar (chatUnread + actionable): разные слагаемые в двух состояниях одной панели
// читались бы как разные цифры об одном и том же.
// Отдельный компонент, а не хуки в теле AppShell: useActiveChatUnread ходит в
// WorkspacesProvider, который AppShell сам монтирует ниже по дереву, — из своего же тела
// его контекст не виден.
function BurgerUnreadBadge(): React.ReactElement | null {
  const { count: actionable } = useActionableUnreadCount();
  const chatUnread = useActiveChatUnread();
  const total = chatUnread + actionable;
  // Ноль не показываем вовсе: пустая точка на кнопке читается как «что-то есть».
  if (total <= 0) return null;
  return (
    <span
      // Стиль и клампинг «99+» — как у бейджей рейла (SidebarNavRail), чтобы значок
      // выглядел одинаково в обоих состояниях панели.
      // pointer-events-none: бейдж свисает за угол кнопки, а на кнопке висит ховер,
      // открывающий предпросмотр панели, — «дырка» в её углу срывала бы и ховер, и клик.
      // Смещение всего на 0.5 (2px): правый край бейджа остаётся внутри 44px, под которые
      // страницы уступают место, иначе цифра наезжала бы на крошки.
      className="pointer-events-none absolute -end-0.5 -inset-bs-0.5 inline-flex tabular-nums min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-[14px] text-primary-foreground"
    >
      {total > 99 ? '99+' : total}
    </span>
  );
}

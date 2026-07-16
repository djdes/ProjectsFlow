import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronsRight, HelpCircle, Loader2, Settings } from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ResizeHandleHint } from '@/presentation/components/layout/ResizeHandleHint';
import { useSetRightPanelWidth } from '@/presentation/layout/rightPanelContext';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useContainer } from '@/infrastructure/di/container';
import { relativeTime } from '@/lib/relativeTime';
import { ActivityItem } from '@/presentation/activity/ActivityItem';
import { ProjectChangesAnalytics } from './ProjectChangesAnalytics';
import { ProjectViewsChart } from './ProjectViewsChart';
import { TaskVersionsDialog } from '@/presentation/components/tasks/TaskVersionsDialog';
import type { ActivityEventItem } from '@/domain/activity/ActivityFeedItem';
import type { ProjectAnalytics, ProjectActivitySummary } from '@/domain/project/ProjectAnalytics';
import {
  PROJECT_CHANGED_EVENT,
  TASK_CHANGED_EVENT,
  TASK_VERSION_CHANGED_EVENT,
} from '@/presentation/hooks/useNotificationStream';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  // Действия проекта (участники + «Поделиться» + меню «⋯») — рендерятся в правом верхнем
  // углу окна (Notion-style), как и в шапке страницы.
  actions?: React.ReactNode;
};

// Вкладка-«текст с подчёркиванием» (Notion): без пилюли-фона, у активной — чёрная линия снизу.
const UNDERLINE_TAB =
  'relative -mb-px rounded-none border-b-2 border-transparent bg-transparent px-0 pb-2 pt-1 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none';

const DEFAULT_WINDOW_DAYS = 28;
const initial = (name: string | null): string => (name?.trim()[0] ?? '?').toUpperCase();

const activityDayKey = (value: Date): string => {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

const activityDayLabel = (value: Date): string => {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (activityDayKey(date) === activityDayKey(today)) return 'Сегодня';
  if (activityDayKey(date) === activityDayKey(yesterday)) return 'Вчера';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  }).format(date);
};

// Ширина панели (px), тянется ручкой у левого края; хранится в localStorage.
const PANEL_WIDTH_KEY = 'pf-project-activity-width';
const PANEL_MIN_WIDTH = 420;
const PANEL_DEFAULT_WIDTH = 768;
function clampPanelWidth(w: number): number {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const max = Math.max(PANEL_MIN_WIDTH, Math.round(vw * 0.95));
  return Math.min(max, Math.max(PANEL_MIN_WIDTH, Math.round(w)));
}

// Окно активности проекта: выезжает справа (как окно задачи). Вкладки «Активность» (лента
// событий) и «Аналитика» (просмотры + зрители + редакторы — как в Notion). Синей плашки
// публикации в этом окне НЕТ (по требованию).
export function ProjectActivityDialog({ open, onOpenChange, projectId, actions }: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const [activity, setActivity] = useState<ActivityEventItem[] | null>(null);
  const [summary, setSummary] = useState<ProjectActivitySummary | null>(null);
  const [analytics, setAnalytics] = useState<ProjectAnalytics | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityReload, setActivityReload] = useState(0);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  // Задача, для которой открыто окно версий (из часы-кнопки события). null = закрыто.
  const [versionsFor, setVersionsFor] = useState<string | null>(null);

  // Ширина панели: тянется ручкой у левого края (drag → шире/уже), клик по границе —
  // закрыть. Значение переживает перезагрузку (localStorage).
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const raw = Number(localStorage.getItem(PANEL_WIDTH_KEY));
      return clampPanelWidth(Number.isFinite(raw) && raw > 0 ? raw : PANEL_DEFAULT_WIDTH);
    } catch {
      return PANEL_DEFAULT_WIDTH;
    }
  });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  // Публикуем ширину только для синей плашки и строки режимов отображения. Остальная
  // страница остаётся прежней ширины и просто оказывается под правой панелью.
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const setRightPanelWidth = useSetRightPanelWidth();
  useEffect(() => {
    // Только десктоп: на мобиле панель — полноэкранный оверлей, marginRight не применяется.
    setRightPanelWidth(open && isDesktop ? panelWidth : 0);
    return () => setRightPanelWidth(0);
  }, [setRightPanelWidth, open, isDesktop, panelWidth]);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      e.preventDefault();
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* best-effort */
      }
      dragRef.current = { x: e.clientX, w: panelWidth };
      let moved = false;
      setDragging(true);
      const onMove = (ev: PointerEvent): void => {
        const d = dragRef.current;
        if (!d) return;
        if (Math.abs(ev.clientX - d.x) > 3) moved = true;
        // Ручка на ЛЕВОМ крае правой панели: влево (меньше clientX) = шире.
        const newWidth = clampPanelWidth(d.w - (ev.clientX - d.x));
        setPanelWidth(newWidth);
      };
      const onUp = (): void => {
        dragRef.current = null;
        setDragging(false);
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onUp);
        // Клик без тяги — закрыть окно; иначе — запомнить ширину.
        if (!moved) {
          onOpenChange(false);
          return;
        }
        setPanelWidth((w) => {
          try {
            localStorage.setItem(PANEL_WIDTH_KEY, String(w));
          } catch {
            /* ignore */
          }
          return w;
        });
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onUp);
    },
    [panelWidth, onOpenChange],
  );

  // Окно графика просмотров (7/28/90 дней) — селектор справа над графиком.
  const [windowDays, setWindowDays] = useState<number>(DEFAULT_WINDOW_DAYS);
  // Приватность истории просмотров (как в Notion). Серверного гейта пока нет —
  // выбор храним локально (per-project), это UI-состояние.
  const [viewHistory, setViewHistory] = useState<'allow' | 'deny'>('allow');
  useEffect(() => {
    try {
      setViewHistory(localStorage.getItem(`pf-view-history:${projectId}`) === 'deny' ? 'deny' : 'allow');
    } catch {
      /* localStorage недоступен */
    }
  }, [projectId]);
  const changeViewHistory = (v: 'allow' | 'deny'): void => {
    setViewHistory(v);
    try {
      localStorage.setItem(`pf-view-history:${projectId}`, v);
    } catch {
      /* ignore */
    }
  };

  // Лента активности + сводка (создатель/редактор) — не зависят от окна графика.
  // Первая страница появляется сразу; оставшаяся история догружается курсором в фоне.
  // Составной курсор createdAt+id не пропускает события, созданные в одну миллисекунду.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let requestId = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const load = (withSpinner: boolean): void => {
      const currentRequestId = ++requestId;
      if (withSpinner) {
        setLoadingActivity(true);
        setActivityError(null);
      }
      setLoadingHistory(true);
      void (async () => {
        let cursor: Awaited<ReturnType<typeof projectRepository.getProjectActivity>>['nextCursor'] = null;
        let collected: ActivityEventItem[] = [];
        let firstPage = true;
        const seenCursors = new Set<string>();
        try {
          do {
            const result = await projectRepository.getProjectActivity(projectId, 100, cursor ?? undefined);
            if (cancelled || currentRequestId !== requestId) return;
            collected = [...collected, ...result.items];
            if (firstPage) {
              setSummary(result.summary);
              setLoadingActivity(false);
              setActivity((current) => {
                if (withSpinner || !current) return collected;
                const byId = new Map(
                  [...collected, ...current].map((item) => [item.id, item]),
                );
                return [...byId.values()].sort(
                  (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
                );
              });
              firstPage = false;
            } else {
              setActivity([...collected]);
            }
            cursor = result.nextCursor;
            if (cursor) {
              const cursorKey = `${cursor.createdAt.toISOString()}:${cursor.id}`;
              if (seenCursors.has(cursorKey)) break;
              seenCursors.add(cursorKey);
            }
          } while (cursor);
          if (!cancelled && currentRequestId === requestId) {
            setActivity([...collected]);
            setActivityError(null);
          }
        } catch {
          if (cancelled || currentRequestId !== requestId) return;
          if (firstPage) {
            setActivity([]);
            setSummary(null);
            setActivityError('Не удалось загрузить историю изменений.');
          } else {
            setActivityError('Часть старой истории не загрузилась. Уже загруженные изменения сохранены.');
          }
        } finally {
          if (!cancelled && currentRequestId === requestId) {
            setLoadingActivity(false);
            setLoadingHistory(false);
          }
        }
      })();
    };
    load(true);
    // Открытое окно моментально подхватывает новые события (создали/перенесли задачу).
    const onChanged = (e: Event): void => {
      const detail = (e as CustomEvent<{
        projectId?: string;
        createdAt?: string;
        actorDisplayName?: string | null;
      }>).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      if (e.type === TASK_VERSION_CHANGED_EVENT && detail?.createdAt) {
        setSummary((current) => current ? {
          ...current,
          lastEditedAt: new Date(detail.createdAt!),
          lastEditedByName: detail.actorDisplayName ?? null,
        } : current);
      }
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => load(false), 80);
      // Лента activity записывается сразу после версии; повтор забирает её при редкой гонке запросов.
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => load(false), 600);
    };
    window.addEventListener('pf:project-activity-changed', onChanged);
    window.addEventListener(TASK_VERSION_CHANGED_EVENT, onChanged);
    window.addEventListener(TASK_CHANGED_EVENT, onChanged);
    window.addEventListener(PROJECT_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('pf:project-activity-changed', onChanged);
      window.removeEventListener(TASK_VERSION_CHANGED_EVENT, onChanged);
      window.removeEventListener(TASK_CHANGED_EVENT, onChanged);
      window.removeEventListener(PROJECT_CHANGED_EVENT, onChanged);
    };
  }, [activityReload, open, projectId, projectRepository]);

  // Аналитика просмотров — перезапрашивается при смене окна (7/28/90).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingAnalytics(true);
    projectRepository
      .getProjectAnalytics(projectId, windowDays)
      .then((a) => { if (!cancelled) setAnalytics(a); })
      .catch(() => { if (!cancelled) setAnalytics(null); })
      .finally(() => { if (!cancelled) setLoadingAnalytics(false); });
    return () => { cancelled = true; };
  }, [open, projectId, projectRepository, windowDays]);

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        showClose={false}
        // Немодально: остальной сайт кликабелен; клик мимо окна НЕ закрывает его (закрытие —
        // только кнопкой сворачивания). Как в Notion.
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        style={{ width: panelWidth, maxWidth: '95vw' }}
        className={cn('group/panel flex h-full w-full flex-col gap-0 overflow-hidden p-0', dragging && 'select-none')}
      >
        {/* Заголовок для a11y (Radix требует Title), визуально скрыт — по требованию без «Активность проекта». */}
        <SheetTitle className="sr-only">Активность проекта</SheetTitle>
        {/* Ручка ресайза у левого края: тяга → шире/уже, клик → закрыть, на hover — подсказка. */}
        <ResizeHandleHint side="left" action="Закрыть" shortcut="Клик">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Изменить ширину окна или закрыть"
            onPointerDown={onHandlePointerDown}
            className={cn(
              'absolute inset-y-0 left-0 z-50 w-1.5 -translate-x-1/2 cursor-col-resize touch-none',
              'before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:transition-colors hover:before:bg-primary/40',
              dragging && 'before:bg-primary/60',
            )}
          />
        </ResizeHandleHint>
        {/* Верхняя строка: слева — кнопка сворачивания «»» (появляется при наведении на окно),
            справа — действия проекта (участники · Поделиться · ⋯). Без заголовка, без крестика.
            h-11 px-2.5 — тот же блок, что и строка крошек в шапке страницы (выровнены по высоте). */}
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-2.5">
          <SheetClose asChild>
            <button
              type="button"
              aria-label="Свернуть"
              title="Свернуть"
              className="grid size-8 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/panel:opacity-100"
            >
              <ChevronsRight className="size-5" />
            </button>
          </SheetClose>
          {actions ? <div className="flex items-center gap-0.5">{actions}</div> : <span />}
        </div>

        <Tabs defaultValue="activity" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-4 mt-2 h-auto shrink-0 justify-start gap-4 rounded-none border-b border-border bg-transparent p-0">
            <TabsTrigger value="activity" className={UNDERLINE_TAB}>Активность</TabsTrigger>
            <TabsTrigger value="analytics" className={UNDERLINE_TAB}>Аналитика</TabsTrigger>
          </TabsList>

          {/* Активность — лента во всю высоту окна (flex-1 + собственный скролл). */}
          <TabsContent value="activity" className="pf-scroll-visible mt-0 min-h-0 flex-1 p-0">
            {loadingActivity ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Загрузка…
              </div>
            ) : activityError && (!activity || activity.length === 0) ? (
              <div className="grid min-h-48 place-items-center px-6 text-center">
                <div>
                  <p className="text-sm font-medium">История не загрузилась</p>
                  <p className="mt-1 text-xs text-muted-foreground">{activityError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 h-10"
                    onClick={() => setActivityReload((value) => value + 1)}
                  >
                    Повторить
                  </Button>
                </div>
              </div>
            ) : !activity || activity.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Пока нет активности.</p>
            ) : (
              <>
                {activityError ? (
                  <div className="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/5 px-5 py-2">
                    <p className="text-xs text-destructive">{activityError}</p>
                    <button
                      type="button"
                      className="shrink-0 text-xs font-medium text-destructive underline-offset-2 hover:underline"
                      onClick={() => setActivityReload((value) => value + 1)}
                    >
                      Повторить
                    </button>
                  </div>
                ) : loadingHistory ? (
                  <div className="flex items-center gap-2 border-b px-5 py-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Загружаем старые изменения…
                  </div>
                ) : null}
                <ul className="pb-4">
                  {activity.map((item, index) => {
                    const showDay =
                      index === 0 ||
                      activityDayKey(activity[index - 1]!.createdAt) !== activityDayKey(item.createdAt);
                    return (
                      <Fragment key={item.id}>
                        {showDay ? (
                          <li
                            role="presentation"
                            className="sticky top-0 z-20 border-b bg-background/95 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground backdrop-blur"
                          >
                            {activityDayLabel(item.createdAt)}
                          </li>
                        ) : null}
                        <ActivityItem item={item} onOpenVersions={setVersionsFor} />
                      </Fragment>
                    );
                  })}
                </ul>
              </>
            )}
          </TabsContent>

          {/* Аналитика — как в Notion: Просмотры (график + окно) + Зрители (с настройкой
              приватности) + Редакторы, и нижняя панель «Настройки / Справка». */}
          {/* data-[state=active]:flex (не голый `flex`): иначе класс display:flex перебивает
              атрибут [hidden] у неактивной вкладки, и скрытая «Аналитика» забирает половину
              высоты flex-колонки → лента «Активность» показывалась лишь на пол-окна. */}
          <TabsContent
            value="analytics"
            className="min-h-0 flex-1 flex-col data-[state=active]:flex"
          >
            <div className="pf-scroll-visible min-h-0 flex-1 space-y-8 px-5 py-4">
              <ProjectChangesAnalytics
                projectId={projectId}
                activity={activity ?? []}
                loading={loadingActivity}
                loadingHistory={loadingHistory}
                error={activityError}
                windowDays={windowDays}
                onWindowDaysChange={setWindowDays}
                onRetry={() => setActivityReload((value) => value + 1)}
              />

              <div className="border-t" />

              {/* Аналитика просмотров остаётся отдельным блоком и использует тот же период. */}
              <section className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold">Просмотры</h2>
                  <p className="text-xs text-muted-foreground">
                    Посещения проекта за выбранный период
                  </p>
                </div>
                {loadingAnalytics ? (
                  <div className="flex h-44 items-center justify-center gap-2 rounded-2xl border text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Загрузка просмотров…
                  </div>
                ) : !analytics ? (
                  <div className="grid h-32 place-items-center rounded-2xl border px-6 text-center">
                    <p className="text-xs text-muted-foreground">
                      Не удалось загрузить аналитику просмотров.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {analytics.totalViews} просмотров всего
                    </p>
                    <ProjectViewsChart perDay={analytics.perDay} windowDays={windowDays} />
                  </>
                )}
              </section>

              {analytics ? (
                <section className="space-y-2.5">
                  <p className="text-sm font-medium">Зрители</p>
                  <div className="flex items-start justify-between gap-3 rounded-2xl border border-border/70 px-4 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">Показывать историю ваших просмотров</p>
                      <p className="text-xs text-muted-foreground">
                        Редакторы страницы видят, когда вы её открывали.{' '}
                        <button
                          type="button"
                          onClick={() =>
                            window.dispatchEvent(
                              new CustomEvent('pf:open-help', {
                                detail: {
                                  tab: 'assistant',
                                  prefill: 'Как работает история просмотров проекта?',
                                },
                              }),
                            )
                          }
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          Подробнее
                        </button>
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-10 shrink-0 gap-1.5 rounded-xl px-3 text-xs font-normal"
                        >
                          {viewHistory === 'allow' ? 'Разрешить' : 'Запретить'}
                          <ChevronDown className="size-3.5 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[180px]">
                        <DropdownMenuItem onClick={() => changeViewHistory('allow')}>
                          Разрешить
                          {viewHistory === 'allow' && <Check className="ml-auto size-4" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => changeViewHistory('deny')}>
                          Запретить
                          {viewHistory === 'deny' && <Check className="ml-auto size-4" />}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {analytics.viewers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Пока никто не заходил.</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {analytics.viewers.map((viewer) => (
                        <li key={viewer.userId} className="flex min-h-11 items-center gap-2.5 rounded-xl px-2 hover:bg-muted/40">
                          <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                            {viewer.avatarUrl ? (
                              <img src={viewer.avatarUrl} alt="" className="size-full object-cover" />
                            ) : (
                              initial(viewer.displayName)
                            )}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">{viewer.displayName}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {relativeTime(viewer.lastViewedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}

              {summary && (
                <section className="space-y-3">
                  <p className="text-sm font-medium">Редакторы</p>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Создатель</p>
                    <div className="flex min-h-11 items-center gap-2.5 rounded-xl px-2">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                        {initial(summary.createdByName)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {summary.createdByName ?? '—'}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {relativeTime(summary.createdAt)}
                      </span>
                    </div>
                  </div>
                  {summary.lastEditedByName && summary.lastEditedAt && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Недавно изменил</p>
                      <div className="flex min-h-11 items-center gap-2.5 rounded-xl px-2">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                          {initial(summary.lastEditedByName)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {summary.lastEditedByName}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {relativeTime(summary.lastEditedAt)}
                        </span>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t px-4 py-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
                  >
                    <Settings className="size-3.5" />
                    Настройки
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[220px]">
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    История ваших просмотров
                  </div>
                  <DropdownMenuItem onClick={() => changeViewHistory('allow')}>
                    Разрешить
                    {viewHistory === 'allow' && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => changeViewHistory('deny')}>
                    Запретить
                    {viewHistory === 'deny' && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('pf:open-help', {
                      detail: { tab: 'assistant' },
                    }),
                  )
                }
                className="inline-flex min-h-10 items-center gap-1.5 px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <HelpCircle className="size-3.5" />
                Справка
              </button>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
    {versionsFor && (
      <TaskVersionsDialog
        projectId={projectId}
        taskId={versionsFor}
        open={versionsFor !== null}
        onOpenChange={(o) => !o && setVersionsFor(null)}
      />
    )}
    </>
  );
}

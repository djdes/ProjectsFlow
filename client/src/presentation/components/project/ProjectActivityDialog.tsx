import { useCallback, useEffect, useRef, useState } from 'react';
import { Calendar, Check, ChevronDown, ChevronsRight, HelpCircle, Loader2, Settings } from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ResizeHandleHint } from '@/presentation/components/layout/ResizeHandleHint';
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
import { ProjectViewsChart } from './ProjectViewsChart';
import { TaskVersionsDialog } from '@/presentation/components/tasks/TaskVersionsDialog';
import type { ActivityEventItem } from '@/domain/activity/ActivityFeedItem';
import type { ProjectAnalytics, ProjectActivitySummary } from '@/domain/project/ProjectAnalytics';

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
// 3650 = «Всё время» (график ограничит ленту годом). Остальные — окна в днях.
const WINDOW_OPTIONS = [7, 28, 90, 3650] as const;
const windowLabel = (days: number): string => (days >= 365 ? 'Всё время' : `За ${days} дней`);
const initial = (name: string | null): string => (name?.trim()[0] ?? '?').toUpperCase();

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

  // По требованию: при открытии окна активности главное окно НЕ меняется (не сужается,
  // описание не переверстывается) — окно просто открывается поверх. Поэтому ширину в
  // AppShell НЕ публикуем (в отличие от drawer'а задачи).
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
        setPanelWidth(clampPanelWidth(d.w - (ev.clientX - d.x)));
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
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = (withSpinner: boolean): void => {
      if (withSpinner) setLoadingActivity(true);
      projectRepository
        .getProjectActivity(projectId, 40)
        .then((r) => { if (!cancelled) { setActivity(r.items); setSummary(r.summary); } })
        .catch(() => { if (!cancelled) { setActivity([]); setSummary(null); } })
        .finally(() => { if (!cancelled) setLoadingActivity(false); });
    };
    load(true);
    // Открытое окно моментально подхватывает новые события (создали/перенесли задачу).
    const onChanged = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId?: string }>).detail;
      if (!detail || detail.projectId === projectId) load(false);
    };
    window.addEventListener('pf:project-activity-changed', onChanged);
    return () => { cancelled = true; window.removeEventListener('pf:project-activity-changed', onChanged); };
  }, [open, projectId, projectRepository]);

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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showClose={false}
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
              <ChevronsRight className="size-4" />
            </button>
          </SheetClose>
          {actions ? <div className="flex items-center gap-0.5">{actions}</div> : <span />}
        </div>

        <Tabs defaultValue="activity" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-4 h-auto shrink-0 justify-start gap-4 rounded-none border-b border-border bg-transparent p-0">
            <TabsTrigger value="activity" className={UNDERLINE_TAB}>Активность</TabsTrigger>
            <TabsTrigger value="analytics" className={UNDERLINE_TAB}>Аналитика</TabsTrigger>
          </TabsList>

          {/* Активность — лента во всю высоту окна (flex-1 + собственный скролл). */}
          <TabsContent value="activity" className="pf-scroll-visible mt-0 min-h-0 flex-1 p-0">
            {loadingActivity ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Загрузка…
              </div>
            ) : !activity || activity.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Пока нет активности.</p>
            ) : (
              <ul className="divide-y">
                {activity.map((item) => (
                  <ActivityItem key={item.id} item={item} onOpenVersions={setVersionsFor} />
                ))}
              </ul>
            )}
          </TabsContent>

          {/* Аналитика — как в Notion: Просмотры (график + окно) + Зрители (с настройкой
              приватности) + Редакторы, и нижняя панель «Настройки / Справка». */}
          <TabsContent value="analytics" className="flex min-h-0 flex-1 flex-col">
            {loadingAnalytics ? (
              <div className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Загрузка…
              </div>
            ) : !analytics ? (
              <p className="flex-1 py-10 text-center text-sm text-muted-foreground">Нет данных.</p>
            ) : (
              <>
                <div className="pf-scroll-visible min-h-0 flex-1 space-y-6 px-5 py-4">
                  {/* Просмотры + селектор окна (7/28/90 дней). */}
                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm">
                        Просмотры{' '}
                        <span className="text-muted-foreground">({analytics.totalViews} всего)</span>
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-7 gap-1.5 rounded-full px-3 text-xs font-normal text-primary"
                          >
                            <Calendar className="size-3.5" />
                            {windowLabel(windowDays)}
                            <ChevronDown className="size-3.5 opacity-60" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {WINDOW_OPTIONS.map((d) => (
                            <DropdownMenuItem key={d} onClick={() => setWindowDays(d)}>
                              {windowLabel(d)}
                              {windowDays === d && <Check className="ml-auto size-4" />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <ProjectViewsChart perDay={analytics.perDay} windowDays={windowDays} />
                  </section>

                  {/* Зрители + карточка приватности истории просмотров. */}
                  <section className="space-y-2.5">
                    <p className="text-sm font-medium">Зрители</p>

                    <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/50 px-3.5 py-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-sm font-medium">Показывать историю ваших просмотров</p>
                        <p className="text-xs text-muted-foreground">
                          Редакторы страницы видят, когда вы её открывали.{' '}
                          <button
                            type="button"
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
                            className="h-8 shrink-0 gap-1.5 px-2.5 text-xs font-normal"
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
                        {analytics.viewers.map((v) => (
                          <li key={v.userId} className="flex items-center gap-2.5 rounded-md px-1 py-1">
                            <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                              {v.avatarUrl ? (
                                <img src={v.avatarUrl} alt="" className="size-full object-cover" />
                              ) : (
                                initial(v.displayName)
                              )}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm">{v.displayName}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {relativeTime(v.lastViewedAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  {/* Редакторы: Создатель / Недавно изменил — с аватарами (инициалы). */}
                  {summary && (
                    <section className="space-y-3">
                      <p className="text-sm font-medium">Редакторы</p>

                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Создатель</p>
                        <div className="flex items-center gap-2.5">
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
                          <div className="flex items-center gap-2.5">
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

                {/* Нижняя панель: «Настройки» (приватность истории) слева, «Справка» справа. */}
                <div className="flex shrink-0 items-center justify-between border-t px-4 py-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
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
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <HelpCircle className="size-3.5" />
                    Справка
                  </button>
                </div>
              </>
            )}
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

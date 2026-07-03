import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useContainer } from '@/infrastructure/di/container';
import { relativeTime } from '@/lib/relativeTime';
import { ActivityItem } from '@/presentation/activity/ActivityItem';
import { TrendChart } from '@/presentation/components/monitoring/TrendChart';
import { ProjectPublishedBanner } from './ProjectPublishedBanner';
import type { ActivityEventItem } from '@/domain/activity/ActivityFeedItem';
import type { ProjectAnalytics } from '@/domain/project/ProjectAnalytics';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
};

const WINDOW_DAYS = 28;

// Массив из WINDOW_DAYS чисел (просмотры по дням, старые → новые), нули для пропущенных дней.
function toDailySeries(perDay: { date: string; count: number }[]): number[] {
  const byDate = new Map(perDay.map((p) => [p.date, p.count]));
  const out: number[] = [];
  const today = new Date();
  for (let i = WINDOW_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(byDate.get(d.toISOString().slice(0, 10)) ?? 0);
  }
  return out;
}

// Окно активности проекта: выезжает справа (как окно задачи). Вкладки «Активность» (лента
// событий) и «Аналитика» (просмотры + зрители). Сверху — плашка публикации (наезжает на окно,
// контент съезжает ниже).
export function ProjectActivityDialog({ open, onOpenChange, projectId }: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const [activity, setActivity] = useState<ActivityEventItem[] | null>(null);
  const [analytics, setAnalytics] = useState<ProjectAnalytics | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingActivity(true);
    setLoadingAnalytics(true);
    projectRepository
      .getProjectActivity(projectId, 40)
      .then((r) => { if (!cancelled) setActivity(r.items); })
      .catch(() => { if (!cancelled) setActivity([]); })
      .finally(() => { if (!cancelled) setLoadingActivity(false); });
    projectRepository
      .getProjectAnalytics(projectId, WINDOW_DAYS)
      .then((a) => { if (!cancelled) setAnalytics(a); })
      .catch(() => { if (!cancelled) setAnalytics(null); })
      .finally(() => { if (!cancelled) setLoadingAnalytics(false); });
    return () => { cancelled = true; };
  }, [open, projectId, projectRepository]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showClose={false}
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        {/* #6: плашка публикации наезжает на окно — весь контент съезжает ниже. */}
        <ProjectPublishedBanner projectId={projectId} />

        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-5 py-3">
          <SheetTitle className="text-base">Активность проекта</SheetTitle>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Закрыть">
              <X className="size-4" />
            </Button>
          </SheetClose>
        </div>

        <Tabs defaultValue="activity" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-5 mt-3 self-start">
            <TabsTrigger value="activity">Активность</TabsTrigger>
            <TabsTrigger value="analytics">Аналитика</TabsTrigger>
          </TabsList>

          {/* Активность */}
          <TabsContent value="activity" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {loadingActivity ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Загрузка…
              </div>
            ) : !activity || activity.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Пока нет активности.</p>
            ) : (
              <ul className="divide-y">
                {activity.map((item) => (
                  <ActivityItem key={item.id} item={item} />
                ))}
              </ul>
            )}
          </TabsContent>

          {/* Аналитика */}
          <TabsContent value="analytics" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-3">
            {loadingAnalytics ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Загрузка…
              </div>
            ) : !analytics ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Нет данных.</p>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium">Просмотры</span>
                    <span className="text-xs text-muted-foreground">
                      {analytics.totalViews} за {analytics.windowDays} дней
                    </span>
                  </div>
                  <TrendChart label="За 28 дней" values={toDailySeries(analytics.perDay)} />
                </div>

                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Зрители ({analytics.viewers.length})
                  </p>
                  {analytics.viewers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Пока никто не заходил.</p>
                  ) : (
                    <ul className="space-y-1">
                      {analytics.viewers.map((v) => (
                        <li key={v.userId} className="flex items-center gap-2.5 rounded-md px-1 py-1">
                          <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                            {v.avatarUrl ? (
                              <img src={v.avatarUrl} alt="" className="size-full object-cover" />
                            ) : (
                              (v.displayName[0] ?? '?').toUpperCase()
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
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

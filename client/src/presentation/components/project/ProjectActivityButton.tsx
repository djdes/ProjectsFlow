import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useContainer } from '@/infrastructure/di/container';
import { relativeTime } from '@/lib/relativeTime';
import type { ProjectActivitySummary } from '@/domain/project/ProjectAnalytics';
import { ProjectActivityDialog } from './ProjectActivityDialog';
import {
  PROJECT_CHANGED_EVENT,
  TASK_CHANGED_EVENT,
  TASK_VERSION_CHANGED_EVENT,
} from '@/presentation/hooks/useNotificationStream';

// Кнопка активности проекта слева от участников. Показывается ТЕКСТОМ (без иконки):
// «Изменено 12 ч назад». Наведение — аккуратный поповер «Изменено/Создано» (как «Activity»
// в Notion). Клик открывает окно активности/аналитики (выезжает справа, как окно задачи).
export function ProjectActivityButton({
  projectId,
  actions,
  open,
  onOpenChange,
}: {
  projectId: string;
  // Действия проекта (участники · Поделиться · ⋯) — прокидываются в окно активности.
  actions?: React.ReactNode;
  // Управляемое состояние окна — чтобы TasksPage прятал действия шапки, пока окно открыто.
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { projectRepository } = useContainer();
  const [summary, setSummary] = useState<ProjectActivitySummary | null>(null);

  // Относительная подпись («только что», «1 мин назад») продолжает идти без действий пользователя.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const load = (): void => {
      const currentRequestId = ++requestId;
      projectRepository
        .getProjectActivity(projectId, 1)
        .then((r) => {
          if (!cancelled && currentRequestId === requestId) setSummary(r.summary);
        })
        .catch(() => undefined);
    };
    load();
    // Мгновенно обновляем «Изменено …» по локальным и серверным realtime-событиям.
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
      refreshTimer = setTimeout(load, 80);
    };
    window.addEventListener('pf:project-activity-changed', onChanged);
    window.addEventListener(TASK_VERSION_CHANGED_EVENT, onChanged);
    window.addEventListener(TASK_CHANGED_EVENT, onChanged);
    window.addEventListener(PROJECT_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener('pf:project-activity-changed', onChanged);
      window.removeEventListener(TASK_VERSION_CHANGED_EVENT, onChanged);
      window.removeEventListener(TASK_CHANGED_EVENT, onChanged);
      window.removeEventListener(PROJECT_CHANGED_EVENT, onChanged);
    };
  }, [projectId, projectRepository]);

  // Подпись: «Изменено <относительное время>» по последней правке (иначе — по созданию).
  const editedAt = summary?.lastEditedAt ?? summary?.createdAt ?? null;
  const label = editedAt ? `Изменено ${relativeTime(editedAt)}` : 'Активность';

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-sm font-normal text-muted-foreground hover:text-foreground"
            onClick={() => onOpenChange(true)}
          >
            {label}
          </Button>
        </TooltipTrigger>
        {summary && (
          <TooltipContent side="bottom" align="end" className="w-64 p-0">
            <div className="p-2">
              <p className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Активность
              </p>
              {summary.lastEditedAt && (
                <div className="flex items-baseline justify-between gap-3 rounded px-1.5 py-1">
                  <span className="min-w-0 truncate text-[13px]">
                    Изменено{summary.lastEditedByName ? ` · ${summary.lastEditedByName}` : ''}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {relativeTime(summary.lastEditedAt)}
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3 rounded px-1.5 py-1">
                <span className="min-w-0 truncate text-[13px]">
                  Создано{summary.createdByName ? ` · ${summary.createdByName}` : ''}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {relativeTime(summary.createdAt)}
                </span>
              </div>
            </div>
          </TooltipContent>
        )}
      </Tooltip>
      <ProjectActivityDialog open={open} onOpenChange={onOpenChange} projectId={projectId} actions={actions} />
    </>
  );
}

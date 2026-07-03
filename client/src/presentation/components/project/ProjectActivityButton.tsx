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

// Дата в минутной точности: «дд.мм.гггг ЧЧ:ММ» (для поповера при наведении).
function formatDateTime(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Кнопка активности проекта слева от участников. Показывается ТЕКСТОМ (без иконки):
// «Изменено 12 ч назад». Наведение — аккуратный поповер «Изменено/Создано» (как «Activity»
// в Notion). Клик открывает окно активности/аналитики (выезжает справа, как окно задачи).
export function ProjectActivityButton({ projectId }: { projectId: string }): React.ReactElement {
  const { projectRepository } = useContainer();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<ProjectActivitySummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    projectRepository
      .getProjectActivity(projectId, 1)
      .then((r) => {
        if (!cancelled) setSummary(r.summary);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
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
            onClick={() => setOpen(true)}
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
                    {formatDateTime(summary.lastEditedAt)}
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3 rounded px-1.5 py-1">
                <span className="min-w-0 truncate text-[13px]">
                  Создано{summary.createdByName ? ` · ${summary.createdByName}` : ''}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {formatDateTime(summary.createdAt)}
                </span>
              </div>
            </div>
          </TooltipContent>
        )}
      </Tooltip>
      <ProjectActivityDialog open={open} onOpenChange={setOpen} projectId={projectId} />
    </>
  );
}

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

// Минутная точность: «дд.мм.гггг ЧЧ:ММ» в локальной зоне (для тултипа).
function formatDateTime(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Кнопка активности проекта слева от участников. Показывается ТЕКСТОМ (без иконки):
// «изменено 12 ч назад». Клик открывает окно активности/аналитики (выезжает справа, как
// окно задачи). Сводку тянем при монтировании — нужна для подписи кнопки.
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

  // Подпись: «изменено <относительное время>» по последней правке (иначе — по созданию).
  const editedAt = summary?.lastEditedAt ?? summary?.createdAt ?? null;
  const label = editedAt ? `изменено ${relativeTime(editedAt)}` : 'Активность';

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
          <TooltipContent side="bottom">
            <div className="space-y-0.5 text-xs">
              {summary.lastEditedAt && (
                <div>
                  Изменён: {summary.lastEditedByName ?? '—'} · {formatDateTime(summary.lastEditedAt)}
                </div>
              )}
              <div>
                Создан: {summary.createdByName ?? '—'} · {formatDateTime(summary.createdAt)}
              </div>
            </div>
          </TooltipContent>
        )}
      </Tooltip>
      <ProjectActivityDialog open={open} onOpenChange={setOpen} projectId={projectId} />
    </>
  );
}

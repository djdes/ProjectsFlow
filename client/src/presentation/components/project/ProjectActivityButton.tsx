import { useCallback, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useContainer } from '@/infrastructure/di/container';
import type { ProjectActivitySummary } from '@/domain/project/ProjectAnalytics';
import { ProjectActivityDialog } from './ProjectActivityDialog';

// Минутная точность: «дд.мм.гггг ЧЧ:ММ» в локальной зоне.
function formatDateTime(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Кнопка активности проекта слева от участников: hover — сводка «изменён/создан» (минутная
// точность), клик — окно с вкладками «Активность»/«Аналитика». Сводку тянем лениво при
// первом наведении, чтобы не грузить сервер на каждом открытии проекта.
export function ProjectActivityButton({ projectId }: { projectId: string }): React.ReactElement {
  const { projectRepository } = useContainer();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<ProjectActivitySummary | null>(null);
  const fetchedRef = useRef(false);

  const loadSummary = useCallback(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    projectRepository
      .getProjectActivity(projectId, 1)
      .then((r) => setSummary(r.summary))
      .catch(() => {
        fetchedRef.current = false;
      });
  }, [projectId, projectRepository]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onMouseEnter={loadSummary}
            onFocus={loadSummary}
            onClick={() => setOpen(true)}
            aria-label="Активность проекта"
          >
            <History className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {summary ? (
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
          ) : (
            'Активность проекта'
          )}
        </TooltipContent>
      </Tooltip>
      <ProjectActivityDialog open={open} onOpenChange={setOpen} projectId={projectId} />
    </>
  );
}

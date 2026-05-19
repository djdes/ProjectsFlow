import { useEffect, useState } from 'react';
import { Inbox as InboxIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { Project } from '@/domain/project/Project';
import { KanbanBoard } from '@/presentation/components/tasks/KanbanBoard';

// «Входящие» — kanban для задач без привязки к конкретному проекту. Под капотом —
// обычный проект с флагом isInbox=true; сервер создаёт его лениво при первом GET /api/inbox.
// UX-разница с TasksPage минимальная: нет хлебных крошек и кнопки sync-commits
// (для inbox это не имеет смысла — у него нет git-репозитория).
export function InboxPage(): React.ReactElement {
  const { projectRepository } = useContainer();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    projectRepository
      .getInbox()
      .then((p) => {
        if (!cancelled) setProject(p);
      })
      .catch((e: unknown) => {
        const msg = (e as Error).message ?? 'Не удалось загрузить «Входящие»';
        if (!cancelled) setError(msg);
        toast.error(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository]);

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Не получилось</h1>
          <p className="text-sm text-muted-foreground">{error ?? 'Inbox недоступен'}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Перезагрузить
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex items-baseline gap-3">
        <InboxIcon className="size-7 text-primary" />
        <h1 className="text-3xl font-semibold tracking-tight">Входящие</h1>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Задачи, которые ещё не&nbsp;привязаны к&nbsp;проекту. Сюда удобно кидать всё,
        что пришло на&nbsp;ум — потом можно разобрать по&nbsp;проектам.
      </p>

      <KanbanBoard projectId={project.id} />
    </div>
  );
}

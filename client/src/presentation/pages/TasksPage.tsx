import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useProject } from '@/presentation/hooks/useProject';
import { useContainer } from '@/infrastructure/di/container';
import { KanbanBoard } from '@/presentation/components/tasks/KanbanBoard';

export function TasksPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, loading, notFound } = useProject(projectId ?? '');
  const { taskRepository } = useContainer();
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const sync = async (): Promise<void> => {
    if (!data) return;
    setSyncing(true);
    try {
      const r = await taskRepository.syncCommits(data.id);
      const linkedMsg =
        r.linkedCount === 0
          ? 'Новых привязок не найдено'
          : `Привязано ${r.linkedCount} коммит(ов)${
              r.autoTransitionedCount > 0
                ? `, ${r.autoTransitionedCount} задач(а) переведено в работу`
                : ''
            }`;
      toast.success(linkedMsg, { description: `Просканировано ${r.scannedCount} коммитов` });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(`Не удалось синхронизировать: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-3 w-48 animate-pulse rounded bg-muted" />
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Проект не&nbsp;найден</h1>
          <Button asChild variant="outline">
            <Link to="/">На&nbsp;главную</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Хлебные крошки">
        <Link to="/" className="hover:text-foreground">
          Проекты
        </Link>
        <ChevronRight className="size-4" />
        <Link to={`/projects/${data.id}`} className="hover:text-foreground">
          {data.name}
        </Link>
        <ChevronRight className="size-4" />
        <span className="text-foreground">Задачи</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Задачи</h1>
        <Button variant="outline" size="sm" onClick={sync} disabled={syncing || !data.gitRepoUrl}>
          <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
          Синхронизировать коммиты
        </Button>
      </div>

      {!data.gitRepoUrl && (
        <p className="text-xs text-muted-foreground">
          Авто-привязка коммитов работает только когда у проекта подключён git-репозиторий. Привяжи
          его в карточке проекта.
        </p>
      )}

      <KanbanBoard key={refreshKey} projectId={data.id} />
    </div>
  );
}

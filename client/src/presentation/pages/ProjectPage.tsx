import { Link, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProject } from '@/presentation/hooks/useProject';
import { GitRepoSection } from '@/presentation/components/forms/GitRepoSection';
import { RecentCommitsSection } from '@/presentation/components/github/RecentCommitsSection';
import type { ProjectStatus } from '@/domain/project/Project';

const statusLabel: Record<ProjectStatus, string> = {
  active: 'Активен',
  paused: 'На паузе',
  archived: 'Архив',
};

function Badge({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="inline-flex items-center rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

export function ProjectPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, loading, notFound } = useProject(projectId ?? '');

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-3 w-48 animate-pulse rounded bg-muted" />
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-4 w-80 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Проект не&nbsp;найден</h1>
          <p className="text-sm text-muted-foreground">
            Возможно, проект был удалён или&nbsp;ссылка устарела.
          </p>
          <Button asChild variant="outline">
            <Link to="/">На&nbsp;главную</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Хлебные крошки">
        <Link to="/" className="hover:text-foreground">
          Проекты
        </Link>
        <ChevronRight className="size-4" />
        <span className="text-foreground">{data.name}</span>
      </nav>

      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">{data.name}</h1>
        <div className="flex flex-wrap gap-2">
          <Badge>{statusLabel[data.status]}</Badge>
        </div>
      </div>

      <GitRepoSection project={data} />

      {data.gitRepoUrl && (
        <RecentCommitsSection projectId={data.id} gitRepoUrl={data.gitRepoUrl} />
      )}
    </div>
  );
}

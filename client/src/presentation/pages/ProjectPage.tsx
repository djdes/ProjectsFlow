import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LayoutGrid, Trash2 } from 'lucide-react';
import { ProjectBreadcrumbs } from '@/presentation/layout/ProjectBreadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useProject } from '@/presentation/hooks/useProject';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { GitRepoSection } from '@/presentation/components/forms/GitRepoSection';
import { RecentCommitsSection } from '@/presentation/components/github/RecentCommitsSection';
import { KbSection } from '@/presentation/components/kb/KbSection';
import { EditableProjectTitle } from '@/presentation/components/project/EditableProjectTitle';
import { TeamSection } from '@/presentation/components/project/TeamSection';
import { DispatcherSection } from '@/presentation/components/project/DispatcherSection';
import { DeleteProjectDialog } from '@/presentation/components/project/DeleteProjectDialog';
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
  const navigate = useNavigate();
  const { data, loading, notFound } = useProject(projectId ?? '');
  const { refresh: refreshProjects, applyReplace } = useProjectsContext();
  const [deleteOpen, setDeleteOpen] = useState(false);

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
    <>
      {/* Хлебные крошки: строка min-h-11 (44px), вертикально центрирована, прижата к верху —
          на одной горизонтали со свитчером пространства в сайдбаре (Notion top-alignment). */}
      <div className="flex h-11 items-center px-2.5">
        <ProjectBreadcrumbs
          projectId={data.id}
          projectName={data.name}
          projectIcon={data.icon}
          view="overview"
        />
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-12 pt-1 sm:px-6">
      <div className="space-y-3">
        <EditableProjectTitle projectId={data.id} name={data.name} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{statusLabel[data.status]}</Badge>
          <Button asChild variant="outline" size="sm">
            <Link to={`/projects/${data.id}`}>
              <LayoutGrid className="size-4" />
              Доска задач
            </Link>
          </Button>
        </div>
      </div>

      <GitRepoSection project={data} />

      {data.gitRepoUrl && (
        <RecentCommitsSection projectId={data.id} gitRepoUrl={data.gitRepoUrl} />
      )}

      <KbSection project={data} />

      <TeamSection project={data} />

      {/* Ralph-диспетчер — не показываем для inbox-проекта (он персональный, нет команды).
          Менять диспетчера может любой участник (viewer+) — server валидирует. */}
      {!data.isInbox && (
        <DispatcherSection project={data} onChanged={(p) => applyReplace(p)} />
      )}

      {/* Опасная зона — только для владельца и не для inbox-проекта (служебный). */}
      {data.role === 'owner' && !data.isInbox && (
        <>
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-base text-destructive">Опасная зона</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 text-sm">
                  <p className="font-medium">Удалить проект</p>
                  <p className="text-muted-foreground">
                    Безвозвратно удалит проект, все его задачи, локальные KB-документы,
                    секреты и финансовые записи. Подключённый GitHub-репозиторий не
                    затрагивается.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                  className="shrink-0"
                >
                  <Trash2 className="size-4" />
                  Удалить проект
                </Button>
              </div>
            </CardContent>
          </Card>

          <DeleteProjectDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            projectId={data.id}
            projectName={data.name}
            otherMemberCount={Math.max(0, (data.memberCount ?? 1) - 1)}
            onDeleted={() => {
              refreshProjects();
              navigate('/');
            }}
          />
        </>
      )}
      </div>
    </>
  );
}

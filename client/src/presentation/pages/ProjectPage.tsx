import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LayoutGrid, Trash2 } from 'lucide-react';
import { ProjectBreadcrumbs } from '@/presentation/layout/ProjectBreadcrumbs';
import { Button } from '@/components/ui/button';
import { useProject } from '@/presentation/hooks/useProject';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { GitRepoSection } from '@/presentation/components/forms/GitRepoSection';
import { RecentCommitsSection } from '@/presentation/components/github/RecentCommitsSection';
import { KbSection } from '@/presentation/components/kb/KbSection';
import { EditableProjectTitle } from '@/presentation/components/project/EditableProjectTitle';
import { TeamSection } from '@/presentation/components/project/TeamSection';
import { DispatcherSection } from '@/presentation/components/project/DispatcherSection';
import { DeleteProjectDialog } from '@/presentation/components/project/DeleteProjectDialog';
import { ProjectStatusSelect } from '@/presentation/components/project/ProjectStatusSelect';
import { NotificationPrefsCard } from '@/presentation/components/project/NotificationPrefsCard';

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
      <div className="sticky top-0 z-20 flex h-11 items-center bg-background px-2.5">
        <ProjectBreadcrumbs
          projectId={data.id}
          projectName={data.name}
          projectIcon={data.icon}
          view="overview"
        />
      </div>

      {/* Тело: отступы как у Входящих/доски (px-6/14/24), контент — центрированная
          колонка max-w-4xl (Notion): на широких мониторах воздух по бокам симметричен. */}
      <div className="px-6 pb-12 pt-1 sm:px-14 lg:px-24">
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <div className="space-y-3">
            <EditableProjectTitle projectId={data.id} name={data.name} />
            <div className="flex flex-wrap items-center gap-2">
              <ProjectStatusSelect project={data} />
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                <Link to={`/projects/${data.id}`}>
                  <LayoutGrid className="size-4" />
                  Доска задач
                </Link>
              </Button>
            </div>
          </div>

          <TeamSection project={data} />

          <GitRepoSection project={data} />

          {data.gitRepoUrl && (
            <RecentCommitsSection projectId={data.id} gitRepoUrl={data.gitRepoUrl} />
          )}

          <KbSection project={data} />

          {/* Ralph-диспетчер — не для inbox-проекта (он персональный, нет команды). */}
          {!data.isInbox && (
            <DispatcherSection project={data} onChanged={(p) => applyReplace(p)} />
          )}

          {/* Личная настройка юзера — отдельным блоком, не внутри «Команды». */}
          {!data.isInbox && (
            <section className="border-t pt-5">
              <NotificationPrefsCard projectId={data.id} />
            </section>
          )}

          {/* Опасная зона — только владелец, не для inbox. Тихая строка вместо красной карточки. */}
          {data.role === 'owner' && !data.isInbox && (
            <>
              <section className="border-t pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-medium">Удалить проект</p>
                    <p className="text-muted-foreground">
                      Безвозвратно: задачи, KB-документы, секреты и финансы. Подключённый
                      GitHub-репозиторий не затрагивается.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteOpen(true)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    Удалить проект
                  </Button>
                </div>
              </section>

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
      </div>
    </>
  );
}

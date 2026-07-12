import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ExternalLink, Github, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import type { Project } from '@/domain/project/Project';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';
import { useGithubConnection } from '@/presentation/hooks/GithubConnectionProvider';
import { useContainer } from '@/infrastructure/di/container';
import { RepoPickerDialog } from '@/presentation/components/github/RepoPickerDialog';
import { CreateRepoDialog } from '@/presentation/components/github/CreateRepoDialog';

type Props = {
  project: Project;
};

export function GitRepoSection({ project }: Props): React.ReactElement {
  const { submit, saving } = useUpdateProject();
  const { connection, loading: connLoading } = useGithubConnection();
  const { projectRepository } = useContainer();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const canEdit = project.role === 'owner' || project.role === 'editor';
  const [collision, setCollision] = useState<{ projectId: string; projectName: string } | null>(
    null,
  );
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);

  // Если репо подключён — проверяем, не используется ли он в чужом проекте, и предлагаем
  // запросить вступление вместо дубля (см. эпик git-collision).
  useEffect(() => {
    setCollision(null);
    setRequested(false);
    const url = project.gitRepoUrl;
    if (!url) return;
    let cancelled = false;
    projectRepository
      .checkGitCollision(url)
      .then((res) => {
        if (!cancelled && res.exists && res.projectId && res.projectName) {
          setCollision({ projectId: res.projectId, projectName: res.projectName });
        }
      })
      .catch(() => {
        /* тихо: баннер — необязательная подсказка */
      });
    return () => {
      cancelled = true;
    };
  }, [project.gitRepoUrl, projectRepository]);

  const handleRequestJoin = async (): Promise<void> => {
    if (!collision) return;
    setRequesting(true);
    try {
      await projectRepository.requestJoin(collision.projectId);
      setRequested(true);
      toast.success('Запрос на доступ отправлен владельцу');
    } catch (e) {
      toast.error(`Не удалось отправить запрос: ${(e as Error).message}`);
    } finally {
      setRequesting(false);
    }
  };

  const handleDisconnectRepo = async (): Promise<void> => {
    try {
      await submit(project.id, { gitRepoUrl: null });
      toast.success('Репозиторий отключён');
    } catch {
      toast.error('Не удалось отключить');
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <Github className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">GitHub репозиторий</CardTitle>
        </CardHeader>
        <CardContent>
          {project.gitRepoUrl ? (
            <div className="space-y-3">
              <a
                href={project.gitRepoUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 break-all font-mono text-sm text-primary hover:underline"
              >
                {project.gitRepoUrl}
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
              <div className="flex flex-wrap gap-2">
                {connection && (
                  <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                    <Github />
                    Сменить репозиторий
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnectRepo}
                  disabled={saving}
                  className="text-muted-foreground hover:text-destructive"
                >
                  Отключить
                </Button>
              </div>

              {collision && (
                <div className="flex flex-col gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <Users className="mt-0.5 size-4 shrink-0 text-blue-600" />
                    <p className="text-sm text-foreground">
                      Этот репозиторий уже используется в проекте{' '}
                      <span className="font-medium">«{collision.projectName}»</span>. Запросить
                      доступ вместо дубля?
                    </p>
                  </div>
                  <div>
                    <Button
                      size="sm"
                      onClick={() => void handleRequestJoin()}
                      disabled={requesting || requested}
                    >
                      {requested ? 'Запрос отправлен' : 'Запросить доступ'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Не подключен. Добавь репозиторий, чтобы быстро открывать код проекта.
              </p>
              {connLoading ? (
                <div className="h-9 w-48 animate-pulse rounded bg-muted" />
              ) : connection ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setPickerOpen(true)}>
                    <Github />
                    Выбрать из GitHub
                  </Button>
                  {canEdit && (
                    <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                      Создать новый
                    </Button>
                  )}
                </div>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <RouterLink to="/profile">
                    <Github />
                    Подключить GitHub в&nbsp;профиле
                  </RouterLink>
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <RepoPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        projectId={project.id}
        currentRepoUrl={project.gitRepoUrl}
        onCreateNew={
          canEdit
            ? () => {
                setPickerOpen(false);
                setCreateOpen(true);
              }
            : undefined
        }
      />
      <CreateRepoDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={project.id}
        projectName={project.name}
      />
    </>
  );
}

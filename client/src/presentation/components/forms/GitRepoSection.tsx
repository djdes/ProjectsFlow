import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ExternalLink, Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import type { Project } from '@/domain/project/Project';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';
import { useGithubConnection } from '@/presentation/hooks/GithubConnectionProvider';
import { RepoPickerDialog } from '@/presentation/components/github/RepoPickerDialog';

type Props = {
  project: Project;
};

export function GitRepoSection({ project }: Props): React.ReactElement {
  const { submit, saving } = useUpdateProject();
  const { connection, loading: connLoading } = useGithubConnection();
  const [pickerOpen, setPickerOpen] = useState(false);

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
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Не подключен. Добавь репозиторий, чтобы быстро открывать код проекта.
              </p>
              {connLoading ? (
                <div className="h-9 w-48 animate-pulse rounded bg-muted" />
              ) : connection ? (
                <Button size="sm" onClick={() => setPickerOpen(true)}>
                  <Github />
                  Выбрать из GitHub
                </Button>
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
      />
    </>
  );
}

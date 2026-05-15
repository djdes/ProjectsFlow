import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { BookOpen, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import type { Project } from '@/domain/project/Project';
import { useContainer } from '@/infrastructure/di/container';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';
import { useGithubConnection } from '@/presentation/hooks/GithubConnectionProvider';
import { ConnectKbDialog } from './ConnectKbDialog';

type Props = { project: Project };

export function KbSection({ project }: Props): React.ReactElement {
  const { kbRepository } = useContainer();
  const { submit: updateProject } = useUpdateProject();
  const { connection: githubConnection } = useGithubConnection();
  const [connectOpen, setConnectOpen] = useState(false);
  const [initializing, setInitializing] = useState(false);

  const handleInit = async (): Promise<void> => {
    setInitializing(true);
    try {
      const { fullName } = await kbRepository.initRepo(project.id);
      await updateProject(project.id, { kbRepoFullName: fullName });
      toast.success(`KB-репо создан: ${fullName}`);
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось создать KB-репо');
    } finally {
      setInitializing(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    try {
      await kbRepository.disconnect(project.id);
      await updateProject(project.id, { kbRepoFullName: null });
      toast.success('KB отключён от проекта');
    } catch {
      toast.error('Не удалось отключить KB');
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <BookOpen className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">База знаний</CardTitle>
        </CardHeader>
        <CardContent>
          {project.kbRepoFullName ? (
            <div className="space-y-3">
              <a
                href={`https://github.com/${project.kbRepoFullName}`}
                target="_blank" rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 break-all font-mono text-sm text-primary hover:underline"
              >
                {project.kbRepoFullName}
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <RouterLink to={`/projects/${project.id}/kb`}>Открыть KB</RouterLink>
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDisconnect}
                  className="text-muted-foreground hover:text-destructive">
                  Отключить
                </Button>
              </div>
            </div>
          ) : !githubConnection ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Чтобы создать KB-репо, подключи GitHub-аккаунт в профиле.
              </p>
              <Button asChild variant="outline" size="sm">
                <RouterLink to="/profile">Перейти в профиль</RouterLink>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                База знаний — отдельный приватный GitHub-репо с операционными заметками проекта.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={handleInit} disabled={initializing}>
                  {initializing ? 'Создаём…' : 'Создать KB-репо'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)}>
                  Подключить существующий
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ConnectKbDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        projectId={project.id}
        onConnected={() => { /* useUpdateProject не нужен — мы тянем через project refresh */ }}
      />
    </>
  );
}

import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { BookOpen, ExternalLink, AlertTriangle, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import type { Project } from '@/domain/project/Project';
import { useContainer } from '@/infrastructure/di/container';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { useGithubConnection } from '@/presentation/hooks/GithubConnectionProvider';
import { ConnectKbDialog } from './ConnectKbDialog';

type Props = { project: Project };

// Имя репо предсказуемо: формирует сервер из project.name (slugify + prefix).
function previewRepoName(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё\s-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `projectsflow-kb-${slug || 'project'}`;
}

export function KbSection({ project }: Props): React.ReactElement {
  const { kbRepository, projectRepository } = useContainer();
  const { submit: updateProject } = useUpdateProject();
  const { applyReplace } = useProjectsContext();
  const { connection: githubConnection } = useGithubConnection();
  const [connectOpen, setConnectOpen] = useState(false);
  const [confirmInitOpen, setConfirmInitOpen] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [initingLocal, setInitingLocal] = useState(false);

  const handleInit = async (): Promise<void> => {
    setConfirmInitOpen(false);
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

  const handleInitLocal = async (): Promise<void> => {
    setInitingLocal(true);
    try {
      await kbRepository.initLocal(project.id);
      // init-local не возвращает проект — подтягиваем свежий и обновляем список.
      const fresh = await projectRepository.getById(project.id);
      if (fresh) applyReplace(fresh);
      toast.success('Локальная база знаний создана');
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось создать локальную базу');
    } finally {
      setInitingLocal(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    try {
      await kbRepository.disconnect(project.id);
      const fresh = await projectRepository.getById(project.id);
      if (fresh) applyReplace(fresh);
      toast.success('KB отключён от проекта');
    } catch {
      toast.error('Не удалось отключить KB');
    }
  };

  const hasKb = project.kbKind !== 'none';

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <BookOpen className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">База знаний</CardTitle>
        </CardHeader>
        <CardContent>
          {hasKb ? (
            <div className="space-y-3">
              {project.kbKind === 'github' && project.kbRepoFullName ? (
                <a
                  href={`https://github.com/${project.kbRepoFullName}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 break-all font-mono text-sm text-primary hover:underline"
                >
                  {project.kbRepoFullName}
                  <ExternalLink className="size-3.5 shrink-0" />
                </a>
              ) : (
                <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <HardDrive className="size-4" /> Локальная база (без Git)
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <RouterLink to={`/projects/${project.id}/kb`}>Открыть KB</RouterLink>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnect}
                  className="text-muted-foreground hover:text-destructive"
                >
                  Отключить
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                База знаний хранит операционные заметки и креды проекта. Можно завести локальную
                (в ProjectsFlow, без Git) или приватный GitHub-репо.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void handleInitLocal()} disabled={initingLocal}>
                  <HardDrive className="size-4" />
                  {initingLocal ? 'Создаём…' : 'Локальная база (без Git)'}
                </Button>
                {githubConnection ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmInitOpen(true)}
                      disabled={initializing}
                    >
                      {initializing ? 'Создаём…' : 'Создать KB-репо'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)}>
                      Подключить существующий
                    </Button>
                  </>
                ) : (
                  <Button asChild variant="ghost" size="sm">
                    <RouterLink to="/profile">Подключить GitHub для KB-репо</RouterLink>
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ConnectKbDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        projectId={project.id}
        onConnected={() => {
          void projectRepository.getById(project.id).then((p) => {
            if (p) applyReplace(p);
          });
        }}
      />

      <Dialog open={confirmInitOpen} onOpenChange={setConfirmInitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" />
              Создать KB-репо в&nbsp;GitHub?
            </DialogTitle>
            <DialogDescription>
              В твоём GitHub-аккаунте будет создан <strong>приватный репозиторий</strong>:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
              {githubConnection?.githubLogin ?? 'твой-аккаунт'} / {previewRepoName(project.name)}
            </div>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li>• Внутри будет создана структура папок для KB</li>
              <li>• Репо приватный — доступ только у тебя и у ProjectsFlow</li>
              <li>• Можно удалить его на GitHub в любой момент (это разорвёт связь)</li>
              <li>• Точное имя репо может отличаться (зависит от slug-генератора)</li>
            </ul>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmInitOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleInit} disabled={initializing}>
              {initializing ? 'Создаём…' : 'Создать репо'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

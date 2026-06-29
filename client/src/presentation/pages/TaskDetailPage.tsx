import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useProject } from '@/presentation/hooks/useProject';
import { useContainer } from '@/infrastructure/di/container';
import { TaskDrawer } from '@/presentation/components/tasks/TaskDrawer';
import type { Task } from '@/domain/task/Task';
import { splitTitleBody, parseTitleHeading, stripInlineMarkdown } from '@/lib/taskTitleBody';

// Заголовок задачи для крошек/вкладки: первая строка описания без markdown-разметки.
function taskTitle(task: Task): string {
  const raw = splitTitleBody(task.description ?? '').title;
  return stripInlineMarkdown(parseTitleHeading(raw).text).trim() || 'Без названия';
}

// Отдельная страница задачи (/projects/:projectId/tasks/:taskId) — открывается из дровера
// кнопкой «развернуть на весь экран». Тот же TaskDrawer в режиме asPage: одна
// центрированная колонка + хлебные крошки сверху (Проекты → Проект → Задача).
export function TaskDetailPage(): React.ReactElement {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(projectId ?? '');
  const { taskRepository } = useContainer();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(() => {
    if (!projectId || !taskId) return;
    void taskRepository
      .list(projectId)
      .then((tasks) => {
        const found = tasks.find((t) => t.id === taskId) ?? null;
        setTask(found);
        setNotFound(!found);
        setLoading(false);
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [projectId, taskId, taskRepository]);

  useEffect(() => {
    load();
  }, [load]);

  // Заголовок вкладки браузера = название задачи.
  useEffect(() => {
    if (task) document.title = `${taskTitle(task)} · ProjectsFlow`;
    return () => {
      document.title = 'ProjectsFlow';
    };
  }, [task]);

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-3 w-48 animate-pulse rounded bg-muted" />
        <div className="h-8 w-72 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (notFound || !task || !projectId) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-2xl font-semibold">Задача не&nbsp;найдена</h1>
          <Link
            to={projectId ? `/projects/${projectId}` : '/'}
            className="text-sm text-primary hover:underline"
          >
            К&nbsp;доске задач
          </Link>
        </div>
      </div>
    );
  }

  const breadcrumbs = (
    <nav aria-label="Хлебные крошки" className="flex min-w-0 items-center gap-1.5 text-sm">
      <Link to="/" className="shrink-0 text-muted-foreground transition-colors hover:text-foreground">
        Проекты
      </Link>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
      <Link
        to={`/projects/${projectId}`}
        className="min-w-0 max-w-[28vw] shrink-0 truncate text-muted-foreground transition-colors hover:text-foreground"
      >
        {project?.name ?? '…'}
      </Link>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
      {/* Заголовок задачи занимает остаток и обрезается многоточием (длинные не ломают строку). */}
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{taskTitle(task)}</span>
    </nav>
  );

  return (
    <TaskDrawer
      asPage
      breadcrumbs={breadcrumbs}
      state={{ mode: 'edit', task }}
      onClose={() => navigate(`/projects/${projectId}`)}
      // onSubmit нужен только в create-mode; на странице задача уже существует.
      onSubmit={async () => task}
      onCommitsChange={load}
      projectName={project?.name}
      isShared={(project?.memberCount ?? 0) > 1}
      aiProjectId={projectId}
      onMove={async (tid, targetStatus) => {
        await taskRepository.move(projectId, tid, {
          targetStatus,
          beforeTaskId: null,
          afterTaskId: null,
        });
        setTask((prev) => (prev ? { ...prev, status: targetStatus } : prev));
      }}
    />
  );
}

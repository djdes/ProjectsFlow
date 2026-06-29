import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useProject } from '@/presentation/hooks/useProject';
import { useContainer } from '@/infrastructure/di/container';
import { ProjectBreadcrumbs } from '@/presentation/layout/ProjectBreadcrumbs';
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
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(() => {
    if (!projectId || !taskId) return;
    void taskRepository
      .list(projectId)
      .then((tasks) => {
        const found = tasks.find((t) => t.id === taskId) ?? null;
        setTask(found);
        setAllTasks(tasks);
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

  // Недавно редактированные задачи проекта для дропдауна крошек (топ-8 по updatedAt).
  const recentTasks = useMemo(
    () =>
      [...allTasks]
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, 8)
        .map((t) => ({ id: t.id, title: taskTitle(t) })),
    [allTasks],
  );

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

  // Крошки в том же виде, что и на остальных страницах проекта (ProjectBreadcrumbs):
  // Проекты ▾ · Проект ▾ · Задача ▾ — с hover-дропдаунами навигации.
  const breadcrumbs = (
    <ProjectBreadcrumbs
      projectId={projectId}
      projectName={project?.name ?? '…'}
      projectIcon={project?.icon}
      view="board"
      task={{ taskId: task.id, title: taskTitle(task), recent: recentTasks }}
    />
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

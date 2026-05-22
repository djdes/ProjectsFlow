import { NavLink } from 'react-router-dom';
import { Users } from 'lucide-react';
import { useProjects } from '@/presentation/hooks/useProjects';
import { cn } from '@/lib/utils';
import { defaultProjectIcon as ProjectIcon } from './projectIcons';
import type { Project } from '@/domain/project/Project';

function SidebarProjectListItem({ project }: { project: Project }): React.ReactElement {
  const isArchived = project.status === 'archived';

  return (
    <NavLink
      to={`/projects/${project.id}`}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
          'hover:bg-muted',
          isActive && 'bg-accent text-accent-foreground',
          isArchived && 'opacity-50',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
          )}
          {/* Цвет иконки = индикатор git: зелёная при подключённом репо, серая без него. */}
          <ProjectIcon
            className={cn(
              'size-4 shrink-0',
              project.gitRepoUrl ? 'text-emerald-500' : 'text-muted-foreground',
            )}
            aria-label={project.gitRepoUrl ? 'Git подключён' : 'Git не подключён'}
          />
          <span className="flex-1 truncate">{project.name}</span>
          {(project.memberCount ?? 0) > 1 && (
            <Users
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label="Совместный проект"
            >
              <title>Совместный проект</title>
            </Users>
          )}
          {(project.taskCount ?? 0) > 0 && (
            <span
              className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] leading-5 tabular-nums text-muted-foreground"
              aria-label={`Задач: ${project.taskCount}`}
            >
              {project.taskCount}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function SidebarProjectListSkeleton(): React.ReactElement {
  return (
    <div className="space-y-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <div className="size-4 shrink-0 animate-pulse rounded bg-muted" />
          <div
            className="h-3 animate-pulse rounded bg-muted"
            style={{ width: `${60 + (i % 3) * 10}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export function SidebarProjectList(): React.ReactElement {
  const { data, loading, error } = useProjects();

  if (loading) return <SidebarProjectListSkeleton />;

  if (error) {
    return (
      <p className="px-2 py-1.5 text-sm text-destructive">
        Не&nbsp;удалось загрузить список проектов.
      </p>
    );
  }

  // Inbox-проект скрываем — он рендерится отдельным пунктом в Sidebar.
  const visible = (data ?? []).filter((p) => !p.isInbox);

  if (visible.length === 0) {
    return <p className="px-2 py-1.5 text-sm text-muted-foreground">Проектов пока нет.</p>;
  }

  return (
    <div className="space-y-0.5">
      {visible.map((p) => (
        <SidebarProjectListItem key={p.id} project={p} />
      ))}
    </div>
  );
}

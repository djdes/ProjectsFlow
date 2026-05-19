import { NavLink } from 'react-router-dom';
import { useProjects } from '@/presentation/hooks/useProjects';
import { cn } from '@/lib/utils';
import { defaultProjectIcon as ProjectIcon } from './projectIcons';
import type { Project, ProjectStatus } from '@/domain/project/Project';

const statusDotColor: Record<ProjectStatus, string> = {
  active: 'bg-emerald-500',
  paused: 'bg-amber-500',
  archived: 'bg-transparent',
};

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
          <ProjectIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{project.name}</span>
          {project.status !== 'archived' && (
            <span
              className={cn('size-1.5 shrink-0 rounded-full', statusDotColor[project.status])}
              aria-label={`Статус: ${project.status}`}
            />
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

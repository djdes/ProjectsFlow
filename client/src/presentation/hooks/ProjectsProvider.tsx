import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Project } from '@/domain/project/Project';
import { useContainer } from '@/infrastructure/di/container';

type ProjectsContextValue = {
  data: Project[] | null;
  loading: boolean;
  error: Error | null;
  // Добавить только что созданный проект в начало списка (оптимистичное обновление).
  applyAppend: (p: Project) => void;
  // Заменить существующий проект (после edit/update).
  applyReplace: (p: Project) => void;
};

const ProjectsCtx = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { listProjects } = useContainer();
  const [data, setData] = useState<Project[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProjects
      .execute()
      .then((projects) => {
        if (!cancelled) setData(projects);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [listProjects]);

  const value: ProjectsContextValue = {
    data,
    loading: data === null && error === null,
    error,
    applyAppend: (project) => {
      setData((prev) => (prev === null ? [project] : [project, ...prev]));
    },
    applyReplace: (project) => {
      setData((prev) => (prev === null ? [project] : prev.map((p) => (p.id === project.id ? project : p))));
    },
  };

  return <ProjectsCtx.Provider value={value}>{children}</ProjectsCtx.Provider>;
}

export function useProjectsContext(): ProjectsContextValue {
  const c = useContext(ProjectsCtx);
  if (!c) throw new Error('useProjectsContext must be used inside <ProjectsProvider>');
  return c;
}

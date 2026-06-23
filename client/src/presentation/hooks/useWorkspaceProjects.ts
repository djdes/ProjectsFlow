import { useCallback, useEffect, useRef, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { PROJECT_CHANGED_EVENT } from './useNotificationStream';

type WorkspaceProject = { id: string; name: string; icon: string | null };

export function useWorkspaceProjects(workspaceId: string): {
  projects: WorkspaceProject[] | null;
  loading: boolean;
  reload: () => void;
  move: (projectId: string, targetWorkspaceId: string) => Promise<void>;
} {
  const { workspaceRepository } = useContainer();
  const [projects, setProjects] = useState<WorkspaceProject[] | null>(null);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const s = (seq.current += 1);
    workspaceRepository
      .listProjects(workspaceId)
      .then((p) => {
        if (s === seq.current) setProjects(p);
      })
      .catch(() => {
        if (s === seq.current) setProjects([]);
      });
  }, [workspaceRepository, workspaceId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const move = async (projectId: string, targetWorkspaceId: string): Promise<void> => {
    await workspaceRepository.moveProject(workspaceId, projectId, targetWorkspaceId);
    reload();
    // Проект ушёл из активного пространства — обновим сайдбар.
    window.dispatchEvent(new Event(PROJECT_CHANGED_EVENT));
  };

  return { projects, loading: projects === null, reload, move };
}

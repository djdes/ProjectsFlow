import { useEffect, useState } from 'react';
import type { Project } from '@/domain/project/Project';
import { useContainer } from '@/infrastructure/di/container';
import { useProjectsContext } from './ProjectsProvider';
import { PROJECT_CHANGED_EVENT } from './useNotificationStream';
import { useWorkspacesContext } from './WorkspacesProvider';

type RequestState = {
  id: string;
  data: Project | null;
  status: 'pending' | 'ready' | 'missing' | 'error';
  error: Error | null;
};

/** Shared project data first; a scoped fallback for direct links and missing list entries. */
export function useProject(id: string): {
  data: Project | null;
  loading: boolean;
  notFound: boolean;
  error: Error | null;
} {
  const { getProject } = useContainer();
  const { data: list, loading: listLoading } = useProjectsContext();
  const { current: workspace, data: workspaces, switchTo } = useWorkspacesContext();
  const fromList = list?.find((project) => project.id === id) ?? null;
  const [request, setRequest] = useState<RequestState>({
    id: '',
    data: null,
    status: 'pending',
    error: null,
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = (): void => setRevision((value) => value + 1);
    window.addEventListener(PROJECT_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PROJECT_CHANGED_EVENT, refresh);
  }, []);
  useEffect(() => {
    if (!id || fromList || listLoading) return;
    let cancelled = false;
    setRequest((previous) => ({
      id,
      data: previous.id === id ? previous.data : null,
      status: 'pending',
      error: null,
    }));
    getProject
      .execute(id)
      .then(async (data) => {
        if (cancelled) return;
        if (data?.workspaceId && data.workspaceId !== workspace?.id) {
          if (workspaces?.some((item) => item.id === data.workspaceId)) {
            // Keep the route, but replace the complete workspace tree before rendering
            // a project reached through a direct link from another workspace.
            await switchTo(data.workspaceId);
            return;
          }
          setRequest({ id, data: null, status: 'missing', error: null });
          return;
        }
        setRequest({
            id,
            data,
            status: data ? 'ready' : 'missing',
            error: null,
          });
      })
      .catch((error: Error) => {
        if (!cancelled) setRequest({ id, data: null, status: 'error', error });
      });
    return () => {
      cancelled = true;
    };
  }, [getProject, id, fromList, listLoading, revision, workspace?.id, workspaces, switchTo]);
  // Never render a previous project's fallback for even one frame after navigation.
  const current = request.id === id ? request : null;
  const data = fromList ?? current?.data ?? null;
  const notFound = !id || (!fromList && current?.status === 'missing');
  const error = fromList ? null : (current?.error ?? null);
  return { data, loading: !data && !notFound && !error, notFound, error };
}

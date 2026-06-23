import type { Workspace } from '@/domain/workspace/Workspace';
import { useWorkspacesContext } from './WorkspacesProvider';

export function useWorkspaces(): {
  data: Workspace[] | null;
  loading: boolean;
  error: Error | null;
} {
  const { data, loading, error } = useWorkspacesContext();
  return { data, loading, error };
}

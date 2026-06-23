import type { Workspace } from '@/domain/workspace/Workspace';
import { useWorkspacesContext } from './WorkspacesProvider';

export function useCurrentWorkspace(): { workspace: Workspace | null; loading: boolean } {
  const { current, loading } = useWorkspacesContext();
  return { workspace: current, loading };
}

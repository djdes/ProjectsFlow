import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceMember, WorkspaceRole } from '@/domain/workspace/Workspace';
import { useContainer } from '@/infrastructure/di/container';

export function useWorkspaceMembers(workspaceId: string): {
  members: WorkspaceMember[] | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
  add: (email: string, role: WorkspaceRole) => Promise<WorkspaceMember>;
  changeRole: (userId: string, role: WorkspaceRole) => Promise<void>;
  remove: (userId: string) => Promise<void>;
} {
  const { workspaceRepository } = useContainer();
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const s = (seq.current += 1);
    workspaceRepository
      .listMembers(workspaceId)
      .then((m) => {
        if (s === seq.current) {
          setMembers(m);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (s === seq.current) setError(e);
      });
  }, [workspaceRepository, workspaceId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const add = async (email: string, role: WorkspaceRole): Promise<WorkspaceMember> => {
    const m = await workspaceRepository.addMember(workspaceId, email, role);
    reload();
    return m;
  };
  const changeRole = async (userId: string, role: WorkspaceRole): Promise<void> => {
    await workspaceRepository.changeMemberRole(workspaceId, userId, role);
    reload();
  };
  const remove = async (userId: string): Promise<void> => {
    await workspaceRepository.removeMember(workspaceId, userId);
    reload();
  };

  return { members, loading: members === null && error === null, error, reload, add, changeRole, remove };
}

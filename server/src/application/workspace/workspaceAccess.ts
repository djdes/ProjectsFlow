import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import {
  WorkspaceNotFoundError,
  NotWorkspaceOwnerError,
} from '../../domain/workspace/errors.js';

// Минимальный порт, нужный guard'ам (структурно совместим с WorkspaceRepository).
type MembershipReader = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
};

/**
 * Юзер должен быть участником пространства. Если нет — 404 WorkspaceNotFoundError
 * (не разглашаем существование чужого пространства).
 */
export async function requireWorkspaceMember(
  repo: MembershipReader,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMember> {
  const m = await repo.getMembership(workspaceId, userId);
  if (!m) throw new WorkspaceNotFoundError();
  return m;
}

/** Юзер должен быть owner'ом пространства. */
export async function requireWorkspaceOwner(
  repo: MembershipReader,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMember> {
  const m = await requireWorkspaceMember(repo, workspaceId, userId);
  if (m.role !== 'owner') throw new NotWorkspaceOwnerError();
  return m;
}

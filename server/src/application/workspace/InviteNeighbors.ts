import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';
import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import type { WorkspaceInviteRole } from '../../domain/workspace/WorkspaceInvite.js';
import {
  CannotInviteToDefaultWorkspaceError,
  WorkspaceInviteMemberExistsError,
  WorkspaceNotFoundError,
} from '../../domain/workspace/errors.js';
import { requireWorkspaceEditor } from './workspaceAccess.js';
import type { CreateWorkspaceInvite } from './CreateWorkspaceInvite.js';
import type { InviteCandidate, WorkspaceNeighborsRepository } from './WorkspaceNeighborsRepository.js';

type Deps = {
  readonly neighbors: WorkspaceNeighborsRepository;
  readonly workspaces: {
    getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
    getById(id: string): Promise<{ id: string; kind: WorkspaceKind } | null>;
  };
  readonly createInvite: Pick<CreateWorkspaceInvite, 'execute'>;
  readonly now: () => Date;
};

// Приглашать может тот же круг, что и по почте (owner/lead/editor), и только в командное
// пространство (в личный хаб не приглашают).
async function requireInviter(deps: Pick<Deps, 'workspaces'>, workspaceId: string, actorUserId: string): Promise<void> {
  await requireWorkspaceEditor(deps.workspaces, workspaceId, actorUserId);
  const workspace = await deps.workspaces.getById(workspaceId);
  if (!workspace) throw new WorkspaceNotFoundError();
  if (workspace.kind !== 'team') throw new CannotInviteToDefaultWorkspaceError();
}

/** Список «соседей» для кнопки «Из соседних пространств». */
export class ListWorkspaceInviteCandidates {
  constructor(private readonly deps: Omit<Deps, 'createInvite'>) {}

  async execute(workspaceId: string, actorUserId: string): Promise<InviteCandidate[]> {
    await requireInviter(this.deps, workspaceId, actorUserId);
    return this.deps.neighbors.listCandidates(actorUserId, workspaceId, this.deps.now());
  }
}

export type InviteNeighborStatus = 'queued' | 'reused' | 'member' | 'not_neighbor' | 'error';

/**
 * Пакетное приглашение «соседей». Почту берём из базы (клиент присылает только id), а
 * приглашение создаёт обычный CreateWorkspaceInvite: права, скрытые проекты редактора,
 * дедуп и доставка (письмо + сайт + Telegram) — те же, что у приглашения по почте.
 */
export class InviteNeighbors {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    readonly workspaceId: string;
    readonly actorUserId: string;
    readonly userIds: readonly string[];
    readonly role: WorkspaceInviteRole;
  }): Promise<{ results: Array<{ userId: string; status: InviteNeighborStatus }> }> {
    await requireInviter(this.deps, input.workspaceId, input.actorUserId);
    const candidates = new Map(
      (await this.deps.neighbors.listCandidates(input.actorUserId, input.workspaceId, this.deps.now())).map(
        (c) => [c.userId, c] as const,
      ),
    );
    const results: Array<{ userId: string; status: InviteNeighborStatus }> = [];
    for (const userId of new Set(input.userIds)) {
      const candidate = candidates.get(userId);
      if (!candidate) {
        const member = await this.deps.workspaces.getMembership(input.workspaceId, userId);
        results.push({ userId, status: member ? 'member' : 'not_neighbor' });
        continue;
      }
      try {
        const { reused } = await this.deps.createInvite.execute({
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          role: input.role,
          email: candidate.email,
        });
        results.push({ userId, status: reused ? 'reused' : 'queued' });
      } catch (err) {
        if (err instanceof WorkspaceInviteMemberExistsError) {
          results.push({ userId, status: 'member' });
          continue;
        }
        console.warn('[invite-neighbors] invite failed:', err);
        results.push({ userId, status: 'error' });
      }
    }
    return { results };
  }
}

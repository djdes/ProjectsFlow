import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projects, workspaceMembers, workspaceProjectExclusions, workspaceInvites, type WorkspaceInviteRow } from '../db/schema.js';
import { parseJsonCol } from './jsonCol.js';
import { WorkspaceInviteAlreadyUsedError, WorkspaceInviteExpiredError, WorkspaceInviteNotFoundError } from '../../domain/workspace/errors.js';
import type {
  WorkspaceInvite,
  WorkspaceInviteRole,
} from '../../domain/workspace/WorkspaceInvite.js';
import type {
  AcceptWorkspaceInviteInput,
  CreateWorkspaceInviteInput,
  WorkspaceInviteRepository,
} from '../../application/workspace/WorkspaceInviteRepository.js';

function toInvite(row: WorkspaceInviteRow): WorkspaceInvite {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    role: row.role as WorkspaceInviteRole,
    token: row.token,
    email: row.email ?? null,
    excludedProjectIds: parseJsonCol<string[]>(row.excludedProjectIds, []),
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt ?? null,
    acceptedByUserId: row.acceptedByUserId ?? null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

export class DrizzleWorkspaceInviteRepository implements WorkspaceInviteRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateWorkspaceInviteInput): Promise<WorkspaceInvite> {
    await this.db.insert(workspaceInvites).values({
      id: input.id,
      workspaceId: input.workspaceId,
      role: input.role,
      token: input.token,
      email: input.email,
      excludedProjectIds: [...(input.excludedProjectIds ?? [])],
      expiresAt: input.expiresAt,
      createdByUserId: input.createdByUserId,
    });
    const fresh = await this.getById(input.id);
    if (!fresh) throw new Error('Failed to read back workspace invite after insert');
    return fresh;
  }

  async getById(inviteId: string): Promise<WorkspaceInvite | null> {
    const rows = await this.db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.id, inviteId))
      .limit(1);
    return rows[0] ? toInvite(rows[0]) : null;
  }

  async acceptWithMembership(input: AcceptWorkspaceInviteInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx.select().from(workspaceInvites)
        .where(eq(workspaceInvites.id, input.inviteId)).for('update');
      const invite = rows[0];
      if (!invite) throw new WorkspaceInviteNotFoundError();
      if (invite.acceptedAt) throw new WorkspaceInviteAlreadyUsedError();
      if (invite.expiresAt <= input.acceptedAt) throw new WorkspaceInviteExpiredError();
      // INSERT IGNORE is atomic for simultaneous invitations to the same workspace.
      const [result] = await tx.insert(workspaceMembers).ignore().values({
        workspaceId: invite.workspaceId, userId: input.acceptedByUserId, role: invite.role,
      });
      if (result.affectedRows > 0) {
        const excluded = new Set(parseJsonCol<string[]>(invite.excludedProjectIds, []));
        const currentProjects = await tx.select({ id: projects.id }).from(projects)
          .where(and(eq(projects.workspaceId, invite.workspaceId), eq(projects.isInbox, false)));
        const values = currentProjects.filter((p) => excluded.has(p.id)).map((p) => ({
          workspaceId: invite.workspaceId, projectId: p.id, userId: input.acceptedByUserId,
        }));
        if (values.length) await tx.insert(workspaceProjectExclusions).values(values);
      }
      await tx.update(workspaceInvites).set({ acceptedAt: input.acceptedAt, acceptedByUserId: input.acceptedByUserId })
        .where(eq(workspaceInvites.id, invite.id));
    });
  }

  async findByToken(token: string): Promise<WorkspaceInvite | null> {
    const rows = await this.db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.token, token))
      .limit(1);
    return rows[0] ? toInvite(rows[0]) : null;
  }

  async listPendingByWorkspace(workspaceId: string, now: Date): Promise<WorkspaceInvite[]> {
    const rows = await this.db
      .select()
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          isNull(workspaceInvites.acceptedAt),
          gt(workspaceInvites.expiresAt, now),
        ),
      )
      .orderBy(asc(workspaceInvites.createdAt));
    return rows.map(toInvite);
  }

  async markAccepted(input: AcceptWorkspaceInviteInput): Promise<WorkspaceInvite | null> {
    await this.db
      .update(workspaceInvites)
      .set({ acceptedAt: input.acceptedAt, acceptedByUserId: input.acceptedByUserId })
      .where(eq(workspaceInvites.id, input.inviteId));
    return this.getById(input.inviteId);
  }

  async delete(inviteId: string): Promise<boolean> {
    const result = await this.db
      .delete(workspaceInvites)
      .where(eq(workspaceInvites.id, inviteId));
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }
}

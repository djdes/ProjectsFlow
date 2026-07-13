import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { workspaceInvites, type WorkspaceInviteRow } from '../db/schema.js';
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

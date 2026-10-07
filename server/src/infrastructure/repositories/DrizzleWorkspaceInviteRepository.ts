import { and, desc, eq, gt, isNull, isNotNull, lte, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projects, workspaces, workspaceMembers, workspaceProjectExclusions, workspaceInvites, type WorkspaceInviteRow } from '../db/schema.js';
import { parseJsonCol } from './jsonCol.js';
import { WorkspaceInviteAlreadyUsedError, WorkspaceInviteExpiredError, WorkspaceInviteNotFoundError } from '../../domain/workspace/errors.js';
import type {
  WorkspaceInvite,
  WorkspaceInviteRole,
  InviteDelivery,
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
    delivery: parseJsonCol<InviteDelivery | null>(row.delivery, null),
    deliveryAttempts: row.deliveryAttempts,
    deliveryNextAttemptAt: row.deliveryNextAttemptAt,
    deliveryLockedAt: row.deliveryLockedAt,
    lastSentAt: row.lastSentAt,
  };
}

export class DrizzleWorkspaceInviteRepository implements WorkspaceInviteRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateWorkspaceInviteInput): Promise<WorkspaceInvite> {
    return this.db.transaction(async tx => {
      // Serialize invitations within a workspace, including simultaneous duplicate clicks.
      await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).for('update');
      const email = input.email?.trim().toLowerCase() || null;
      if (email) {
        const existing = await tx.select().from(workspaceInvites).where(and(
          eq(workspaceInvites.workspaceId, input.workspaceId), isNull(workspaceInvites.acceptedAt),
          sql`LOWER(TRIM(${workspaceInvites.email})) = ${email}`,
        )).orderBy(desc(workspaceInvites.createdAt)).limit(1);
        if (existing[0]) return toInvite(existing[0]);
      }
      await tx.insert(workspaceInvites).values({
        id: input.id,
        workspaceId: input.workspaceId,
        role: input.role,
        token: input.token,
        email,
        excludedProjectIds: [...(input.excludedProjectIds ?? [])],
        expiresAt: input.expiresAt,
        createdByUserId: input.createdByUserId,
        delivery: email ? { email: 'queued', site: 'queued', telegram: 'queued' } : null,
        deliveryNextAttemptAt: email ? input.queuedAt ?? new Date() : null,
      });
      const [fresh] = await tx.select().from(workspaceInvites).where(eq(workspaceInvites.id, input.id));
      if (!fresh) throw new Error('Failed to read back workspace invite after insert');
      return toInvite(fresh);
    });
  }

  async claimDelivery(now: Date): Promise<WorkspaceInvite | null> {
    return this.db.transaction(async tx => {
      const [row] = await tx.select().from(workspaceInvites).where(and(
        isNull(workspaceInvites.acceptedAt), gt(workspaceInvites.expiresAt, now),
        lte(workspaceInvites.deliveryNextAttemptAt, now),
        or(lt(workspaceInvites.deliveryAttempts, 5), isNotNull(workspaceInvites.deliveryLockedAt)),
        or(isNull(workspaceInvites.deliveryLockedAt), lte(workspaceInvites.deliveryLockedAt, new Date(now.getTime() - 300_000))),
      )).orderBy(workspaceInvites.deliveryNextAttemptAt).limit(1).for('update');
      if (!row) return null;
      const claimedAt = new Date(Math.floor(now.getTime() / 1000) * 1000);
      await tx.update(workspaceInvites).set({ deliveryLockedAt: claimedAt, lastSentAt: claimedAt, deliveryAttempts: row.deliveryAttempts + 1 }).where(eq(workspaceInvites.id, row.id));
      return toInvite({ ...row, deliveryLockedAt: claimedAt, lastSentAt: claimedAt, deliveryAttempts: row.deliveryAttempts + 1 });
    });
  }

  async finishDelivery(inviteId: string, claimedAt: Date, delivery: InviteDelivery, nextAttemptAt: Date | null): Promise<void> {
    await this.db.update(workspaceInvites).set({ delivery, deliveryNextAttemptAt: nextAttemptAt, deliveryLockedAt: null })
      .where(and(eq(workspaceInvites.id, inviteId), eq(workspaceInvites.deliveryLockedAt, claimedAt), isNull(workspaceInvites.acceptedAt)));
  }

  async rescheduleDelivery(inviteId: string, now: Date, expiresAt: Date): Promise<WorkspaceInvite | null> {
    const [result] = await this.db.update(workspaceInvites).set({
      expiresAt, delivery: { email: 'queued', site: 'queued', telegram: 'queued' }, deliveryAttempts: 0,
      deliveryNextAttemptAt: now, deliveryLockedAt: null, lastSentAt: now,
    }).where(and(eq(workspaceInvites.id, inviteId), isNull(workspaceInvites.acceptedAt),
      or(isNull(workspaceInvites.lastSentAt), lte(workspaceInvites.lastSentAt, new Date(now.getTime() - 60_000))),
      or(isNull(workspaceInvites.deliveryLockedAt), lte(workspaceInvites.deliveryLockedAt, new Date(now.getTime() - 300_000))),
    ));
    return result.affectedRows ? this.getById(inviteId) : null;
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

  async listPendingByWorkspace(workspaceId: string, _now: Date): Promise<WorkspaceInvite[]> {
    const rows = await this.db
      .select()
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          isNull(workspaceInvites.acceptedAt),
        ),
      )
      .orderBy(desc(workspaceInvites.createdAt));
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

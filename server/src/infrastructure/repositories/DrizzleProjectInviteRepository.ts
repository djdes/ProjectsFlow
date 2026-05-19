import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projectInvites, type ProjectInviteRow } from '../db/schema.js';
import type {
  ProjectInvite,
  ProjectInviteRole,
} from '../../domain/project/ProjectInvite.js';
import type {
  AcceptProjectInviteInput,
  CreateProjectInviteInput,
  ProjectInviteRepository,
} from '../../application/project/ProjectInviteRepository.js';

function toInvite(row: ProjectInviteRow): ProjectInvite {
  return {
    id: row.id,
    projectId: row.projectId,
    role: row.role as ProjectInviteRole,
    token: row.token,
    email: row.email ?? null,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt ?? null,
    acceptedByUserId: row.acceptedByUserId ?? null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

export class DrizzleProjectInviteRepository implements ProjectInviteRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateProjectInviteInput): Promise<ProjectInvite> {
    await this.db.insert(projectInvites).values({
      id: input.id,
      projectId: input.projectId,
      role: input.role,
      token: input.token,
      email: input.email,
      expiresAt: input.expiresAt,
      createdByUserId: input.createdByUserId,
    });
    const fresh = await this.getById(input.id);
    if (!fresh) throw new Error('Failed to read back invite after insert');
    return fresh;
  }

  async getById(inviteId: string): Promise<ProjectInvite | null> {
    const rows = await this.db
      .select()
      .from(projectInvites)
      .where(eq(projectInvites.id, inviteId))
      .limit(1);
    return rows[0] ? toInvite(rows[0]) : null;
  }

  async findByToken(token: string): Promise<ProjectInvite | null> {
    const rows = await this.db
      .select()
      .from(projectInvites)
      .where(eq(projectInvites.token, token))
      .limit(1);
    return rows[0] ? toInvite(rows[0]) : null;
  }

  async listPendingByProject(projectId: string, now: Date): Promise<ProjectInvite[]> {
    const rows = await this.db
      .select()
      .from(projectInvites)
      .where(
        and(
          eq(projectInvites.projectId, projectId),
          isNull(projectInvites.acceptedAt),
          gt(projectInvites.expiresAt, now),
        ),
      )
      .orderBy(asc(projectInvites.createdAt));
    return rows.map(toInvite);
  }

  async markAccepted(input: AcceptProjectInviteInput): Promise<ProjectInvite | null> {
    await this.db
      .update(projectInvites)
      .set({
        acceptedAt: input.acceptedAt,
        acceptedByUserId: input.acceptedByUserId,
      })
      .where(eq(projectInvites.id, input.inviteId));
    return this.getById(input.inviteId);
  }

  async delete(inviteId: string): Promise<boolean> {
    const result = await this.db
      .delete(projectInvites)
      .where(eq(projectInvites.id, inviteId));
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }
}

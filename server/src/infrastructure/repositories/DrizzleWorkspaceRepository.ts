import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projects,
  users,
  workspaces,
  workspaceMembers,
  type WorkspaceRow,
} from '../db/schema.js';
import type { Workspace } from '../../domain/workspace/Workspace.js';
import type {
  WorkspaceMember,
  WorkspaceRole,
} from '../../domain/workspace/WorkspaceMember.js';
import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  WorkspaceListItem,
  WorkspaceRepository,
} from '../../application/workspace/WorkspaceRepository.js';

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? null,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt,
  };
}

// MySQL ER_DUP_ENTRY = 1062 — addMember идемпотентен, дубликат глотаем.
function isDuplicateKey(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  const errno = (err as { errno?: number }).errno;
  return code === 'ER_DUP_ENTRY' || errno === 1062;
}

export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: Database) {}

  async listForUser(userId: string): Promise<WorkspaceListItem[]> {
    const rows = await this.db
      .select({
        workspace: workspaces,
        role: workspaceMembers.role,
        projectCount: sql<number>`(SELECT COUNT(*) FROM projects p WHERE p.workspace_id = ${workspaces.id})`,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(asc(workspaces.createdAt));
    return rows.map((r) => ({
      ...toWorkspace(r.workspace),
      role: r.role,
      projectCount: Number(r.projectCount),
    }));
  }

  async getById(id: string): Promise<Workspace | null> {
    const rows = await this.db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    const row = rows[0];
    return row ? toWorkspace(row) : null;
  }

  async createWithOwnerMembership(input: CreateWorkspaceInput): Promise<Workspace> {
    await this.db.transaction(async (tx) => {
      await tx.insert(workspaces).values({
        id: input.id,
        name: input.name,
        icon: input.icon,
        ownerUserId: input.ownerUserId,
      });
      await tx.insert(workspaceMembers).values({
        workspaceId: input.id,
        userId: input.ownerUserId,
        role: 'owner',
      });
    });
    const rows = await this.db.select().from(workspaces).where(eq(workspaces.id, input.id)).limit(1);
    if (!rows[0]) throw new Error('Failed to read back workspace after insert');
    return toWorkspace(rows[0]);
  }

  async update(id: string, patch: UpdateWorkspaceInput): Promise<Workspace | null> {
    const set: Partial<WorkspaceRow> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (Object.keys(set).length > 0) {
      await this.db.update(workspaces).set(set).where(eq(workspaces.id, id));
    }
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    // workspace_members чистится ON DELETE CASCADE; users.current_workspace_id → NULL.
    await this.db.delete(workspaces).where(eq(workspaces.id, id));
  }

  async countForUser(userId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));
    return Number(rows[0]?.count ?? 0);
  }

  async projectCount(workspaceId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId));
    return Number(rows[0]?.count ?? 0);
  }

  async getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    const rows = await this.db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);
    const row = rows[0];
    return row ? { workspaceId: row.workspaceId, userId: row.userId, role: row.role } : null;
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const rows = await this.db
      .select({ member: workspaceMembers, user: users })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(asc(workspaceMembers.createdAt));
    return rows.map((r) => ({
      workspaceId: r.member.workspaceId,
      userId: r.member.userId,
      role: r.member.role,
      displayName: r.user.displayName,
      email: r.user.email,
      avatarUrl: r.user.avatarUrl ?? null,
    }));
  }

  async countOwners(workspaceId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')));
    return Number(rows[0]?.count ?? 0);
  }

  async addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
    try {
      await this.db.insert(workspaceMembers).values({ workspaceId, userId, role });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      // уже участник — идемпотентно пропускаем
    }
  }

  async setMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
    await this.db
      .update(workspaceMembers)
      .set({ role })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await this.db
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  }

  async setCurrentWorkspace(userId: string, workspaceId: string): Promise<void> {
    await this.db.update(users).set({ currentWorkspaceId: workspaceId }).where(eq(users.id, userId));
  }

  async getCurrentWorkspaceId(userId: string): Promise<string | null> {
    const rows = await this.db
      .select({ current: users.currentWorkspaceId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0]?.current ?? null;
  }

  async findAnotherForUser(userId: string, excludeId: string): Promise<string | null> {
    const rows = await this.db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, userId), ne(workspaceMembers.workspaceId, excludeId)))
      .limit(1);
    return rows[0]?.workspaceId ?? null;
  }
}

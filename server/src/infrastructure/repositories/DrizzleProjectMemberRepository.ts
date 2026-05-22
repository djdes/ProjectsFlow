import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projectMembers,
  projects,
  users,
  type ProjectMemberRow,
  type ProjectRow,
  type UserRow,
} from '../db/schema.js';
import type {
  ProjectMembership,
  ProjectRole,
} from '../../domain/project/ProjectMembership.js';
import type { Project, ProjectStatus } from '../../domain/project/Project.js';
import type { User } from '../../domain/user/User.js';
import type { NotificationPrefs } from '../../domain/notifications/NotificationPrefs.js';
import type {
  AddMemberInput,
  ProjectMemberRepository,
  ProjectMemberWithUser,
  ProjectWithRole,
} from '../../application/project/ProjectMemberRepository.js';

function toMembership(row: ProjectMemberRow): ProjectMembership {
  return {
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
    joinedAt: row.joinedAt,
  };
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? null,
    isAdmin: row.isAdmin,
    createdAt: row.createdAt,
  };
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    status: row.status as ProjectStatus,
    gitRepoUrl: row.gitRepoUrl ?? null,
    kbRepoFullName: row.kbRepoFullName ?? null,
    isInbox: row.isInbox,
    kbKind: row.kbKind,
    financeVisibility: row.financeVisibility,
    createdAt: row.createdAt,
  };
}

export class DrizzleProjectMemberRepository implements ProjectMemberRepository {
  constructor(private readonly db: Database) {}

  async findForProject(projectId: string, userId: string): Promise<ProjectMembership | null> {
    const rows = await this.db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    return rows[0] ? toMembership(rows[0]) : null;
  }

  async listByProject(projectId: string): Promise<ProjectMemberWithUser[]> {
    const rows = await this.db
      .select({ member: projectMembers, user: users })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(projectMembers.joinedAt));
    return rows.map((r) => ({
      ...toMembership(r.member),
      user: toUser(r.user),
      notificationPrefs: r.member.notificationPrefs ?? null,
    }));
  }

  async listProjectsForUser(userId: string): Promise<ProjectWithRole[]> {
    // Коррелированные подзапросы для read-model'а sidebar'а: число участников и задач.
    // Дешевле отдельных запросов на каждый проект; индексы по project_id уже есть.
    const rows = await this.db
      .select({
        project: projects,
        role: projectMembers.role,
        memberCount: sql<number>`(SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = ${projects.id})`,
        taskCount: sql<number>`(SELECT COUNT(*) FROM tasks t WHERE t.project_id = ${projects.id})`,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(eq(projectMembers.userId, userId))
      .orderBy(asc(projectMembers.sortOrder), asc(projects.createdAt));
    return rows.map((r) => ({
      ...toProject(r.project),
      role: r.role,
      memberCount: Number(r.memberCount),
      taskCount: Number(r.taskCount),
    }));
  }

  async countOwners(projectId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'owner')));
    return Number(rows[0]?.count ?? 0);
  }

  async add(input: AddMemberInput): Promise<ProjectMembership> {
    await this.db.insert(projectMembers).values({
      projectId: input.projectId,
      userId: input.userId,
      role: input.role,
    });
    const fresh = await this.findForProject(input.projectId, input.userId);
    if (!fresh) throw new Error('Failed to read back membership after insert');
    return fresh;
  }

  async remove(projectId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async updateRole(
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<ProjectMembership | null> {
    await this.db
      .update(projectMembers)
      .set({ role })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    return this.findForProject(projectId, userId);
  }

  async getNotificationPrefs(
    projectId: string,
    userId: string,
  ): Promise<NotificationPrefs | null> {
    const rows = await this.db
      .select({ prefs: projectMembers.notificationPrefs })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    return rows[0]?.prefs ?? null;
  }

  async setNotificationPrefs(
    projectId: string,
    userId: string,
    prefs: NotificationPrefs,
  ): Promise<void> {
    await this.db
      .update(projectMembers)
      .set({ notificationPrefs: prefs })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  }

  async reorderForUser(userId: string, orderedIds: readonly string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    // Транзакция: все sort_order меняются атомарно. UPDATE скоупится по (projectId, userId),
    // поэтому чужие membership'ы и id без membership'а просто не затрагиваются.
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i += 1) {
        await tx
          .update(projectMembers)
          .set({ sortOrder: i })
          .where(
            and(
              eq(projectMembers.projectId, orderedIds[i]!),
              eq(projectMembers.userId, userId),
            ),
          );
      }
    });
  }
}

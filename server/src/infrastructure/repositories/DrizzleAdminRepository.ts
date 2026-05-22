import { asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projects, users } from '../db/schema.js';
import type { ProjectStatus } from '../../domain/project/Project.js';
import type {
  AdminProjectView,
  AdminRepository,
  AdminUpdateUserPatch,
  AdminUserView,
} from '../../application/admin/AdminRepository.js';

export class DrizzleAdminRepository implements AdminRepository {
  constructor(private readonly db: Database) {}

  async listAllProjects(): Promise<AdminProjectView[]> {
    // Один проект — одна строка (без дублей по members). Счётчики — коррелированными
    // подзапросами; владелец — JOIN по owner_id. Inbox-проекты скрываем.
    const rows = await this.db
      .select({
        id: projects.id,
        name: projects.name,
        status: projects.status,
        gitRepoUrl: projects.gitRepoUrl,
        ownerId: projects.ownerId,
        ownerDisplayName: users.displayName,
        ownerEmail: users.email,
        createdAt: projects.createdAt,
        memberCount: sql<number>`(SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = ${projects.id})`,
        taskCount: sql<number>`(SELECT COUNT(*) FROM tasks t WHERE t.project_id = ${projects.id})`,
      })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.ownerId))
      .where(eq(projects.isInbox, false))
      .orderBy(asc(users.displayName), asc(projects.name));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status as ProjectStatus,
      gitRepoUrl: r.gitRepoUrl ?? null,
      ownerId: r.ownerId,
      ownerDisplayName: r.ownerDisplayName,
      ownerEmail: r.ownerEmail,
      memberCount: Number(r.memberCount),
      taskCount: Number(r.taskCount),
      createdAt: r.createdAt,
    }));
  }

  async listAllUsers(): Promise<AdminUserView[]> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        isAdmin: users.isAdmin,
        createdAt: users.createdAt,
        projectCount: sql<number>`(SELECT COUNT(*) FROM project_members pm WHERE pm.user_id = ${users.id})`,
      })
      .from(users)
      .orderBy(asc(users.createdAt));

    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl ?? null,
      isAdmin: r.isAdmin,
      projectCount: Number(r.projectCount),
      createdAt: r.createdAt,
    }));
  }

  async updateUser(id: string, patch: AdminUpdateUserPatch): Promise<void> {
    const set: Record<string, unknown> = {};
    if (patch.displayName !== undefined) set['displayName'] = patch.displayName;
    if (patch.email !== undefined) set['email'] = patch.email.toLowerCase();
    if (patch.isAdmin !== undefined) set['isAdmin'] = patch.isAdmin;
    if (Object.keys(set).length === 0) return;
    await this.db.update(users).set(set).where(eq(users.id, id));
  }
}

import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projectMemberTaskVisibility,
  projectWorkspaceAccess,
  projects,
  tasks,
  workspaceMembers,
  workspaceProjectExclusions,
} from '../db/schema.js';
import { parseJsonCol } from './jsonCol.js';
import {
  DEFAULT_HOME_SCOPE,
  type MemberTaskScope,
  type ProjectSharing,
  type WorkspaceTaskScope,
} from '../../domain/project/ProjectSharing.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import type {
  ProjectSharingConfig,
  ProjectSharingRepository,
  ProjectWorkspaceMembership,
  SaveProjectSharingInput,
} from '../../application/project/ProjectSharingRepository.js';

function toWorkspaceScope(kind: 'all' | 'own' | 'selected', visibleFrom: unknown): WorkspaceTaskScope {
  if (kind === 'selected') return { kind, from: parseJsonCol<string[]>(visibleFrom, []) };
  return { kind };
}

function toMemberScope(kind: 'all' | 'mine' | 'selected', visibleFrom: unknown): MemberTaskScope {
  if (kind === 'selected') return { kind, from: parseJsonCol<string[]>(visibleFrom, []) };
  return { kind };
}

const fromOf = (scope: WorkspaceTaskScope | MemberTaskScope): string[] | null =>
  scope.kind === 'selected' ? [...new Set(scope.from)] : null;

export class DrizzleProjectSharingRepository implements ProjectSharingRepository {
  constructor(private readonly db: Database) {}

  async loadMany(
    projectIds: readonly string[],
  ): Promise<Map<string, ProjectSharing & { readonly creatorUserId: string }>> {
    const result = new Map<string, ProjectSharing & { readonly creatorUserId: string }>();
    const ids = [...new Set(projectIds)];
    if (ids.length === 0) return result;
    const access = await this.db
      .select()
      .from(projectWorkspaceAccess)
      .where(inArray(projectWorkspaceAccess.projectId, ids));
    if (access.length === 0) return result;
    const candidateIds = [...new Set(access.map((row) => row.projectId))];
    const [projectRows, overrides] = await Promise.all([
      this.db
        .select({ id: projects.id, workspaceId: projects.workspaceId, ownerId: projects.ownerId })
        .from(projects)
        .where(inArray(projects.id, candidateIds)),
      this.db
        .select()
        .from(projectMemberTaskVisibility)
        .where(inArray(projectMemberTaskVisibility.projectId, candidateIds)),
    ]);
    for (const project of projectRows) {
      const rows = access.filter((row) => row.projectId === project.id);
      // Строка только основного пространства — это его правило, а не подключение.
      if (!rows.some((row) => row.workspaceId !== project.workspaceId)) continue;
      const workspaces = new Map<string, WorkspaceTaskScope>([[project.workspaceId, DEFAULT_HOME_SCOPE]]);
      for (const row of rows) workspaces.set(row.workspaceId, toWorkspaceScope(row.taskScope, row.visibleFrom));
      const members = new Map<string, MemberTaskScope>();
      for (const row of overrides) {
        if (row.projectId === project.id) members.set(row.userId, toMemberScope(row.taskScope, row.visibleFrom));
      }
      result.set(project.id, {
        projectId: project.id,
        homeWorkspaceId: project.workspaceId,
        creatorUserId: project.ownerId,
        workspaces,
        members,
      });
    }
    return result;
  }

  async workspaceIdsOf(projectId: string): Promise<string[]> {
    const [project] = await this.db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) return [];
    const rows = await this.db
      .select({ workspaceId: projectWorkspaceAccess.workspaceId })
      .from(projectWorkspaceAccess)
      .where(eq(projectWorkspaceAccess.projectId, projectId));
    return [...new Set([project.workspaceId, ...rows.map((row) => row.workspaceId)])];
  }

  async memberships(
    userIds: readonly string[],
    projectWorkspaces: ReadonlyArray<{ readonly projectId: string; readonly workspaceIds: readonly string[] }>,
  ): Promise<Array<ProjectWorkspaceMembership & { readonly projectId: string }>> {
    const users = [...new Set(userIds)];
    const workspaceIds = [...new Set(projectWorkspaces.flatMap((p) => p.workspaceIds))];
    const projectIds = [...new Set(projectWorkspaces.map((p) => p.projectId))];
    if (users.length === 0 || workspaceIds.length === 0) return [];
    const [members, exclusions] = await Promise.all([
      this.db
        .select({ workspaceId: workspaceMembers.workspaceId, userId: workspaceMembers.userId, role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(inArray(workspaceMembers.userId, users), inArray(workspaceMembers.workspaceId, workspaceIds))),
      this.db
        .select({
          workspaceId: workspaceProjectExclusions.workspaceId,
          projectId: workspaceProjectExclusions.projectId,
          userId: workspaceProjectExclusions.userId,
        })
        .from(workspaceProjectExclusions)
        .where(
          and(inArray(workspaceProjectExclusions.userId, users), inArray(workspaceProjectExclusions.projectId, projectIds)),
        ),
    ]);
    const excluded = new Set(exclusions.map((x) => `${x.projectId}|${x.workspaceId}|${x.userId}`));
    const out: Array<ProjectWorkspaceMembership & { readonly projectId: string }> = [];
    for (const project of projectWorkspaces) {
      for (const member of members) {
        if (!project.workspaceIds.includes(member.workspaceId)) continue;
        out.push({
          projectId: project.projectId,
          workspaceId: member.workspaceId,
          userId: member.userId,
          role: member.role as WorkspaceRole,
          excluded: excluded.has(`${project.projectId}|${member.workspaceId}|${member.userId}`),
        });
      }
    }
    return out;
  }

  async getConfig(projectId: string): Promise<ProjectSharingConfig | null> {
    const [project] = await this.db
      .select({ id: projects.id, workspaceId: projects.workspaceId, ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) return null;
    const [access, overrides] = await Promise.all([
      this.db.select().from(projectWorkspaceAccess).where(eq(projectWorkspaceAccess.projectId, projectId)),
      this.db.select().from(projectMemberTaskVisibility).where(eq(projectMemberTaskVisibility.projectId, projectId)),
    ]);
    return {
      projectId,
      homeWorkspaceId: project.workspaceId,
      creatorUserId: project.ownerId,
      workspaces: access.map((row) => ({ workspaceId: row.workspaceId, taskScope: toWorkspaceScope(row.taskScope, row.visibleFrom) })),
      members: overrides.map((row) => ({ userId: row.userId, taskScope: toMemberScope(row.taskScope, row.visibleFrom) })),
    };
  }

  async saveConfig(projectId: string, input: SaveProjectSharingInput): Promise<{ readonly removedWorkspaceIds: string[] }> {
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .for('update');
      if (!project) return { removedWorkspaceIds: [] };
      const before = await tx
        .select({ workspaceId: projectWorkspaceAccess.workspaceId })
        .from(projectWorkspaceAccess)
        .where(eq(projectWorkspaceAccess.projectId, projectId));
      const keep = input.workspaces.map((w) => w.workspaceId);
      const removedWorkspaceIds = before
        .map((row) => row.workspaceId)
        .filter((id) => !keep.includes(id) && id !== project.workspaceId);
      await tx
        .delete(projectWorkspaceAccess)
        .where(
          keep.length > 0
            ? and(eq(projectWorkspaceAccess.projectId, projectId), notInArray(projectWorkspaceAccess.workspaceId, keep))
            : eq(projectWorkspaceAccess.projectId, projectId),
        );
      for (const row of input.workspaces) {
        const values = { taskScope: row.taskScope.kind, visibleFrom: fromOf(row.taskScope) };
        await tx
          .insert(projectWorkspaceAccess)
          .values({ projectId, workspaceId: row.workspaceId, createdByUserId: input.actorUserId, ...values })
          .onDuplicateKeyUpdate({ set: values });
      }
      if (removedWorkspaceIds.length > 0) {
        // Задачи отключённого пространства остаются в проекте и становятся задачами основного.
        await tx
          .update(tasks)
          .set({ originWorkspaceId: null })
          .where(and(eq(tasks.projectId, projectId), inArray(tasks.originWorkspaceId, removedWorkspaceIds)));
        await tx
          .delete(workspaceProjectExclusions)
          .where(
            and(
              eq(workspaceProjectExclusions.projectId, projectId),
              inArray(workspaceProjectExclusions.workspaceId, removedWorkspaceIds),
            ),
          );
      }
      await tx.delete(projectMemberTaskVisibility).where(eq(projectMemberTaskVisibility.projectId, projectId));
      if (input.members.length > 0) {
        await tx.insert(projectMemberTaskVisibility).values(
          input.members.map((m) => ({
            projectId,
            userId: m.userId,
            taskScope: m.taskScope.kind,
            visibleFrom: fromOf(m.taskScope),
            updatedByUserId: input.actorUserId,
          })),
        );
      }
      return { removedWorkspaceIds };
    });
  }
}

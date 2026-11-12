import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projectWorkspaceAccess, projects, workspaceProjectExclusions } from '../db/schema.js';
import type { WorkspaceProjectAccessRepository } from '../../application/workspace/WorkspaceProjectAccessRepository.js';

export class DrizzleWorkspaceProjectAccessRepository implements WorkspaceProjectAccessRepository {
  constructor(private readonly db: Database) {}

  // Проекты пространства и подключённые к нему общие проекты (db/182): скрыть галочкой можно
  // и общий проект — от участника именно этого пространства.
  async listProjects(workspaceId: string) {
    const linked = await this.db
      .select({ projectId: projectWorkspaceAccess.projectId })
      .from(projectWorkspaceAccess)
      .where(eq(projectWorkspaceAccess.workspaceId, workspaceId));
    const linkedIds = [...new Set(linked.map((row) => row.projectId))];
    const inWorkspace = linkedIds.length > 0
      ? or(eq(projects.workspaceId, workspaceId), inArray(projects.id, linkedIds))
      : eq(projects.workspaceId, workspaceId);
    return this.db.select({ id: projects.id, name: projects.name, icon: projects.icon })
      .from(projects).where(and(inWorkspace, eq(projects.isInbox, false)))
      .orderBy(asc(projects.createdAt));
  }

  async listExclusions(workspaceId: string) {
    return this.db.select({ projectId: workspaceProjectExclusions.projectId, userId: workspaceProjectExclusions.userId })
      .from(workspaceProjectExclusions).where(eq(workspaceProjectExclusions.workspaceId, workspaceId));
  }

  async setAccess(workspaceId: string, projectId: string, userId: string, visible: boolean): Promise<void> {
    if (visible) {
      await this.db.delete(workspaceProjectExclusions).where(and(
        eq(workspaceProjectExclusions.workspaceId, workspaceId),
        eq(workspaceProjectExclusions.projectId, projectId),
        eq(workspaceProjectExclusions.userId, userId),
      ));
    } else {
      await this.db.insert(workspaceProjectExclusions).values({ workspaceId, projectId, userId })
        .onDuplicateKeyUpdate({ set: { userId } });
    }
  }
}

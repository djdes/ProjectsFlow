import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projects, workspaceProjectExclusions } from '../db/schema.js';
import type { WorkspaceProjectAccessRepository } from '../../application/workspace/WorkspaceProjectAccessRepository.js';

export class DrizzleWorkspaceProjectAccessRepository implements WorkspaceProjectAccessRepository {
  constructor(private readonly db: Database) {}

  async listProjects(workspaceId: string) {
    return this.db.select({ id: projects.id, name: projects.name, icon: projects.icon })
      .from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.isInbox, false)))
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

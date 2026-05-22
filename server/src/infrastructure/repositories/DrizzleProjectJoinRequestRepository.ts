import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projectJoinRequests, type ProjectJoinRequestRow } from '../db/schema.js';
import type {
  JoinRequestStatus,
  ProjectJoinRequest,
} from '../../domain/project/ProjectJoinRequest.js';
import type {
  CreateJoinRequestInput,
  ProjectJoinRequestRepository,
} from '../../application/project/ProjectJoinRequestRepository.js';

function toJoinRequest(row: ProjectJoinRequestRow): ProjectJoinRequest {
  return {
    id: row.id,
    projectId: row.projectId,
    requesterUserId: row.requesterUserId,
    gitRepoUrl: row.gitRepoUrl,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? null,
    resolvedByUserId: row.resolvedByUserId ?? null,
  };
}

export class DrizzleProjectJoinRequestRepository implements ProjectJoinRequestRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateJoinRequestInput): Promise<ProjectJoinRequest> {
    // UNIQUE(project_id, requester_user_id): повторный запрос реактивирует pending.
    await this.db
      .insert(projectJoinRequests)
      .values({
        id: input.id,
        projectId: input.projectId,
        requesterUserId: input.requesterUserId,
        gitRepoUrl: input.gitRepoUrl,
        status: 'pending',
      })
      .onDuplicateKeyUpdate({
        set: { status: 'pending', gitRepoUrl: input.gitRepoUrl, resolvedAt: null, resolvedByUserId: null },
      });
    const existing = await this.findPending(input.projectId, input.requesterUserId);
    if (!existing) throw new Error('Failed to read back join request after upsert');
    return existing;
  }

  async getById(id: string): Promise<ProjectJoinRequest | null> {
    const rows = await this.db
      .select()
      .from(projectJoinRequests)
      .where(eq(projectJoinRequests.id, id))
      .limit(1);
    return rows[0] ? toJoinRequest(rows[0]) : null;
  }

  async findPending(
    projectId: string,
    requesterUserId: string,
  ): Promise<ProjectJoinRequest | null> {
    const rows = await this.db
      .select()
      .from(projectJoinRequests)
      .where(
        and(
          eq(projectJoinRequests.projectId, projectId),
          eq(projectJoinRequests.requesterUserId, requesterUserId),
        ),
      )
      .limit(1);
    return rows[0] ? toJoinRequest(rows[0]) : null;
  }

  async findByProjectAndRequester(
    projectId: string,
    requesterUserId: string,
  ): Promise<ProjectJoinRequest | null> {
    const rows = await this.db
      .select()
      .from(projectJoinRequests)
      .where(
        and(
          eq(projectJoinRequests.projectId, projectId),
          eq(projectJoinRequests.requesterUserId, requesterUserId),
        ),
      )
      .limit(1);
    return rows[0] ? toJoinRequest(rows[0]) : null;
  }

  async resolve(
    id: string,
    status: Exclude<JoinRequestStatus, 'pending'>,
    resolvedByUserId: string,
    resolvedAt: Date,
  ): Promise<void> {
    await this.db
      .update(projectJoinRequests)
      .set({ status, resolvedByUserId, resolvedAt })
      .where(eq(projectJoinRequests.id, id));
  }
}

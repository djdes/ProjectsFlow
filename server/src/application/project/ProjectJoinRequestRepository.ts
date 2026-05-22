import type {
  JoinRequestStatus,
  ProjectJoinRequest,
} from '../../domain/project/ProjectJoinRequest.js';

export type CreateJoinRequestInput = {
  readonly id: string;
  readonly projectId: string;
  readonly requesterUserId: string;
  readonly gitRepoUrl: string;
};

export interface ProjectJoinRequestRepository {
  // Upsert: повторный запрос на ту же пару (project, requester) реактивирует pending.
  create(input: CreateJoinRequestInput): Promise<ProjectJoinRequest>;
  getById(id: string): Promise<ProjectJoinRequest | null>;
  findPending(projectId: string, requesterUserId: string): Promise<ProjectJoinRequest | null>;
  resolve(
    id: string,
    status: Exclude<JoinRequestStatus, 'pending'>,
    resolvedByUserId: string,
    resolvedAt: Date,
  ): Promise<void>;
}

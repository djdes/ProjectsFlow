import type {
  CommitSyncJobRepository,
  PendingCommitSyncJob,
} from './CommitSyncJobRepository.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

type Deps = {
  readonly commitSyncJobs: CommitSyncJobRepository;
};

export class ListPendingCommitSyncJobs {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; limit?: number }): Promise<PendingCommitSyncJob[]> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    return this.deps.commitSyncJobs.listPendingForDispatcher(input.userId, limit);
  }
}

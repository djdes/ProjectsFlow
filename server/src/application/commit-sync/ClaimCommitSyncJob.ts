import type { CommitSyncJob } from '../../domain/commit-sync/CommitSyncJob.js';
import {
  CommitSyncJobAlreadyClaimedError,
  CommitSyncJobNotFoundError,
  NotDispatcherForCommitSyncJobError,
} from '../../domain/commit-sync/errors.js';
import type { CommitSyncJobRepository } from './CommitSyncJobRepository.js';

type Deps = {
  readonly commitSyncJobs: CommitSyncJobRepository;
};

export class ClaimCommitSyncJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; jobId: string }): Promise<CommitSyncJob> {
    const job = await this.deps.commitSyncJobs.findById(input.jobId);
    if (!job) throw new CommitSyncJobNotFoundError(input.jobId);
    if (job.dispatcherUserId !== input.userId) {
      throw new NotDispatcherForCommitSyncJobError(input.jobId);
    }
    const claimed = await this.deps.commitSyncJobs.claimById(input.jobId);
    if (!claimed) throw new CommitSyncJobAlreadyClaimedError(input.jobId);
    return claimed;
  }
}

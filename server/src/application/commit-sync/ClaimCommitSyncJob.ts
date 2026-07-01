import type { CommitSyncJob } from '../../domain/commit-sync/CommitSyncJob.js';
import {
  CommitSyncJobAlreadyClaimedError,
  CommitSyncJobNotFoundError,
  NotDispatcherForCommitSyncJobError,
} from '../../domain/commit-sync/errors.js';
import type { CommitSyncJobRepository } from './CommitSyncJobRepository.js';
import { assertDispatcherAllowed, type CheckBudget } from '../usage/CheckBudget.js';

type Deps = {
  readonly commitSyncJobs: CommitSyncJobRepository;
  // Гейт лимитов ИНИЦИАТОРА (владельца проекта): free → нет доступа, исчерпал окно → claim запрещён.
  readonly checkBudget?: CheckBudget;
};

export class ClaimCommitSyncJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; jobId: string }): Promise<CommitSyncJob> {
    const job = await this.deps.commitSyncJobs.findById(input.jobId);
    if (!job) throw new CommitSyncJobNotFoundError(input.jobId);
    if (job.dispatcherUserId !== input.userId) {
      throw new NotDispatcherForCommitSyncJobError(input.jobId);
    }
    // Гейтим ИНИЦИАТОРА (владельца проекта, включившего автоматизацию), а не диспетчера-админа.
    await assertDispatcherAllowed(this.deps.checkBudget, job.createdBy ?? job.dispatcherUserId);
    const claimed = await this.deps.commitSyncJobs.claimById(input.jobId);
    if (!claimed) throw new CommitSyncJobAlreadyClaimedError(input.jobId);
    return claimed;
  }
}

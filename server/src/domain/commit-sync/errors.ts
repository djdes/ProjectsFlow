export class CommitSyncJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Commit sync job ${jobId} not found`);
    this.name = 'CommitSyncJobNotFoundError';
  }
}

export class CommitSyncJobAlreadyClaimedError extends Error {
  constructor(jobId: string) {
    super(`Commit sync job ${jobId} is already claimed by another session`);
    this.name = 'CommitSyncJobAlreadyClaimedError';
  }
}

export class CommitSyncJobNotInRunningStateError extends Error {
  constructor(jobId: string, currentStatus: string) {
    super(`Commit sync job ${jobId} cannot be completed - current status: ${currentStatus}`);
    this.name = 'CommitSyncJobNotInRunningStateError';
  }
}

// 503: у проекта нет dispatcher_user_id — некому выполнить синк.
export class CommitSyncProjectHasNoDispatcherError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} has no dispatcher assigned`);
    this.name = 'CommitSyncProjectHasNoDispatcherError';
  }
}

// 403: caller не диспетчер для этого job'а.
export class NotDispatcherForCommitSyncJobError extends Error {
  constructor(jobId: string) {
    super(`Not the dispatcher for commit sync job ${jobId}`);
    this.name = 'NotDispatcherForCommitSyncJobError';
  }
}

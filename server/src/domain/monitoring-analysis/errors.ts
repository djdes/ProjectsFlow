export class MonitoringAnalysisJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Monitoring analysis job ${jobId} not found`);
    this.name = 'MonitoringAnalysisJobNotFoundError';
  }
}

export class MonitoringAnalysisJobAlreadyClaimedError extends Error {
  constructor(jobId: string) {
    super(`Monitoring analysis job ${jobId} is already claimed by another session`);
    this.name = 'MonitoringAnalysisJobAlreadyClaimedError';
  }
}

export class MonitoringAnalysisJobNotInRunningStateError extends Error {
  constructor(jobId: string, currentStatus: string) {
    super(`Monitoring analysis job ${jobId} cannot be completed - current status: ${currentStatus}`);
    this.name = 'MonitoringAnalysisJobNotInRunningStateError';
  }
}

// 503: у проекта нет dispatcher_user_id — некому выполнить анализ.
export class MonitoringAnalysisProjectHasNoDispatcherError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} has no dispatcher assigned`);
    this.name = 'MonitoringAnalysisProjectHasNoDispatcherError';
  }
}

// 403: caller не имеет доступа к job'у (не создатель и не admin).
export class MonitoringAnalysisJobAccessDeniedError extends Error {
  constructor(jobId: string) {
    super(`Access denied for monitoring analysis job ${jobId}`);
    this.name = 'MonitoringAnalysisJobAccessDeniedError';
  }
}

// 403: caller не диспетчер для этого job'а.
export class NotDispatcherForMonitoringAnalysisJobError extends Error {
  constructor(jobId: string) {
    super(`Not the dispatcher for monitoring analysis job ${jobId}`);
    this.name = 'NotDispatcherForMonitoringAnalysisJobError';
  }
}

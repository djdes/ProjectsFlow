export class AiPromptJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`AI prompt job ${jobId} not found`);
    this.name = 'AiPromptJobNotFoundError';
  }
}

export class AiPromptJobAlreadyClaimedError extends Error {
  constructor(jobId: string) {
    super(`AI prompt job ${jobId} is already claimed by another session`);
    this.name = 'AiPromptJobAlreadyClaimedError';
  }
}

export class AiPromptJobNotInRunningStateError extends Error {
  constructor(jobId: string, currentStatus: string) {
    super(`AI prompt job ${jobId} cannot be completed - current status: ${currentStatus}`);
    this.name = 'AiPromptJobNotInRunningStateError';
  }
}

// 503: дефолтный диспетчер для inbox-задач не сконфигурирован.
export class AiPromptDispatcherNotConfiguredError extends Error {
  constructor() {
    super('Default AI dispatcher is not configured (set AI_PROMPT_DEFAULT_DISPATCHER_EMAIL)');
    this.name = 'AiPromptDispatcherNotConfiguredError';
  }
}

// 503: у проекта нет dispatcher_user_id (project_id != null, но dispatcher не назначен).
export class AiPromptProjectHasNoDispatcherError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} has no dispatcher assigned`);
    this.name = 'AiPromptProjectHasNoDispatcherError';
  }
}

// 403: caller не имеет доступа к job'у (не owner и не admin).
export class AiPromptJobAccessDeniedError extends Error {
  constructor(jobId: string) {
    super(`Access denied for AI prompt job ${jobId}`);
    this.name = 'AiPromptJobAccessDeniedError';
  }
}

// 403: caller не диспетчер для этого job'а.
export class NotDispatcherForAiPromptJobError extends Error {
  constructor(jobId: string) {
    super(`Not the dispatcher for AI prompt job ${jobId}`);
    this.name = 'NotDispatcherForAiPromptJobError';
  }
}

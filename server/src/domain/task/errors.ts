export class TaskNotFoundError extends Error {
  constructor(public readonly taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = 'TaskNotFoundError';
  }
}

export class TaskTitleEmptyError extends Error {
  constructor() {
    super('Task title must be non-empty');
    this.name = 'TaskTitleEmptyError';
  }
}

export class TaskCommitNotFoundError extends Error {
  constructor(public readonly sha: string) {
    super(`Commit not linked to task: ${sha}`);
    this.name = 'TaskCommitNotFoundError';
  }
}

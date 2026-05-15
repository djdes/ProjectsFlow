export class ProjectNameAlreadyExistsError extends Error {
  constructor(public readonly attemptedName: string) {
    super(`Project with name "${attemptedName}" already exists for this owner`);
    this.name = 'ProjectNameAlreadyExistsError';
  }
}

export class ProjectNameEmptyError extends Error {
  constructor() {
    super('Project name cannot be empty');
    this.name = 'ProjectNameEmptyError';
  }
}

export class ProjectNotFoundError extends Error {
  constructor() {
    super('Project not found');
    this.name = 'ProjectNotFoundError';
  }
}

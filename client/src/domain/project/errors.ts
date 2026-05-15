export class ProjectNameAlreadyExistsError extends Error {
  constructor(public readonly attemptedName: string) {
    super(`Project with name "${attemptedName}" already exists`);
    this.name = 'ProjectNameAlreadyExistsError';
  }
}

export class ProjectNameEmptyError extends Error {
  constructor() {
    super('Project name cannot be empty');
    this.name = 'ProjectNameEmptyError';
  }
}

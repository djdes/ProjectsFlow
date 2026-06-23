export class WorkspaceNameEmptyError extends Error {
  constructor() {
    super('Workspace name cannot be empty');
    this.name = 'WorkspaceNameEmptyError';
  }
}

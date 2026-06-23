export class WorkspaceNotFoundError extends Error {
  constructor() {
    super('Workspace not found');
    this.name = 'WorkspaceNotFoundError';
  }
}

export class NotWorkspaceMemberError extends Error {
  constructor() {
    super('Not a workspace member');
    this.name = 'NotWorkspaceMemberError';
  }
}

export class NotWorkspaceOwnerError extends Error {
  constructor() {
    super('Workspace owner role required');
    this.name = 'NotWorkspaceOwnerError';
  }
}

export class LastOwnerError extends Error {
  constructor() {
    super('Cannot remove or demote the last owner');
    this.name = 'LastOwnerError';
  }
}

export class WorkspaceNotEmptyError extends Error {
  constructor() {
    super('Workspace still has projects');
    this.name = 'WorkspaceNotEmptyError';
  }
}

export class CannotDeleteLastWorkspaceError extends Error {
  constructor() {
    super('Cannot delete your only workspace');
    this.name = 'CannotDeleteLastWorkspaceError';
  }
}

export class WorkspaceNameEmptyError extends Error {
  constructor() {
    super('Workspace name cannot be empty');
    this.name = 'WorkspaceNameEmptyError';
  }
}

export class UserNotFoundByEmailError extends Error {
  constructor(public readonly email: string) {
    super(`No user with email ${email}`);
    this.name = 'UserNotFoundByEmailError';
  }
}

export class NotProjectOwnerError extends Error {
  constructor() {
    super('Only the project owner can move it');
    this.name = 'NotProjectOwnerError';
  }
}

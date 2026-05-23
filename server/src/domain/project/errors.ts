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

// Юзер не является членом проекта (или не имеет нужной роли). Multi-tenancy errors
// — отдельная семантика от ProjectNotFoundError: иногда хочется ответить 403 «нет прав»
// вместо 404 «нет проекта». На практике для not-member отдаём 404 (не палим существование),
// для wrong-role — 403.
export class InsufficientProjectRoleError extends Error {
  constructor(
    public readonly haveRole: 'owner' | 'editor' | 'viewer',
    public readonly requiredAction: string,
  ) {
    super(`Role "${haveRole}" cannot perform "${requiredAction}"`);
    this.name = 'InsufficientProjectRoleError';
  }
}

export class ProjectInviteNotFoundError extends Error {
  constructor() {
    super('Project invite not found');
    this.name = 'ProjectInviteNotFoundError';
  }
}

export class ProjectInviteExpiredError extends Error {
  constructor() {
    super('Project invite has expired');
    this.name = 'ProjectInviteExpiredError';
  }
}

export class ProjectInviteAlreadyUsedError extends Error {
  constructor() {
    super('Project invite has already been used');
    this.name = 'ProjectInviteAlreadyUsedError';
  }
}

export class CannotInviteToInboxError extends Error {
  constructor() {
    super('Cannot invite members to inbox project (it is personal)');
    this.name = 'CannotInviteToInboxError';
  }
}

export class CannotRemoveSelfAsLastOwnerError extends Error {
  constructor() {
    super('Cannot remove or demote yourself as the only owner');
    this.name = 'CannotRemoveSelfAsLastOwnerError';
  }
}

// Inbox-проект — служебный (по одному на юзера, туда падают orphan-задачи).
// Удалять его нельзя: разрушит инвариант системы «у юзера всегда есть inbox».
export class CannotDeleteInboxError extends Error {
  constructor() {
    super('Cannot delete inbox project');
    this.name = 'CannotDeleteInboxError';
  }
}

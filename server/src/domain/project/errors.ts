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

// Inbox-проект скрыт из общего списка сайдбара, поэтому пометка favorite не имеет
// смысла (и UI до неё не доедет). Защита от ручных API-вызовов.
export class CannotFavoriteInboxError extends Error {
  constructor() {
    super('Cannot favorite inbox project');
    this.name = 'CannotFavoriteInboxError';
  }
}

// === Git-token delegation ===
// Все ошибки use-case'а GetDelegatedGitToken — мапятся на конкретные HTTP-коды
// в errorHandler (см. presentation/middleware/errorHandler.ts).

// Caller — не текущий диспетчер проекта. 403.
export class NotProjectDispatcherError extends Error {
  constructor() {
    super('Caller is not the current dispatcher of this project');
    this.name = 'NotProjectDispatcherError';
  }
}

// Owner не включил делегирование (или выключил). 403.
export class GitTokenDelegationDisabledError extends Error {
  constructor() {
    super('Owner has not granted git-token delegation for this project');
    this.name = 'GitTokenDelegationDisabledError';
  }
}

// Granter (тот кто делегировал) отключил GitHub. 410.
export class GranterGithubDisconnectedError extends Error {
  constructor() {
    super('Granter disconnected GitHub; ask the owner to reconnect on /profile');
    this.name = 'GranterGithubDisconnectedError';
  }
}

// Granter больше не owner проекта (ownership передали другому). 403.
// Старая делегация автоматически невалидна — нужна новая от текущего owner'а.
export class GranterNotOwnerAnymoreError extends Error {
  constructor() {
    super('The user who granted git-token delegation is no longer the project owner');
    this.name = 'GranterNotOwnerAnymoreError';
  }
}

// Owner пытается включить делегацию, но у него самого не подключён GitHub. 400.
export class GithubNotConnectedForDelegationError extends Error {
  constructor() {
    super('Cannot enable git-token delegation: connect GitHub on /profile first');
    this.name = 'GithubNotConnectedForDelegationError';
  }
}

// Кандидаты для делегации есть (кто-то включил toggle), но ни у одного из них
// нет подключённого GitHub — токен взять физически не у кого. 403. v0.15+.
// candidatesChecked используется в API-ответе для диагностики на стороне Ralph'а.
export class NoEligibleGrantorError extends Error {
  constructor(public readonly candidatesChecked: number) {
    super(`No eligible grantor for git-token delegation (checked ${candidatesChecked} member(s))`);
    this.name = 'NoEligibleGrantorError';
  }
}

// Caller не является членом проекта — не может включать СВОЮ делегацию. 403. v0.15+.
// Admin при включении за другого получает другую проверку (target должен быть member).
export class NotProjectMemberForDelegationError extends Error {
  constructor() {
    super('Only project members can enable their own git-token delegation');
    this.name = 'NotProjectMemberForDelegationError';
  }
}

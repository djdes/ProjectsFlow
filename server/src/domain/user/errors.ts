export class UserNotFoundError extends Error {
  constructor() {
    super('User not found');
    this.name = 'UserNotFoundError';
  }
}

export class UserEmailAlreadyExistsError extends Error {
  constructor(public readonly email: string) {
    super(`User with email "${email}" already exists`);
    this.name = 'UserEmailAlreadyExistsError';
  }
}

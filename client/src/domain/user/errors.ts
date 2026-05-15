export class InvalidCredentialsError extends Error {
  constructor() {
    super('Неверный email или пароль');
    this.name = 'InvalidCredentialsError';
  }
}

export class UserEmailAlreadyExistsError extends Error {
  constructor(public readonly email: string) {
    super(`Email ${email} уже занят`);
    this.name = 'UserEmailAlreadyExistsError';
  }
}

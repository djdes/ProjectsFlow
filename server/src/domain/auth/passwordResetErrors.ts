// Ошибки сброса пароля. Все три мапятся в 400/410 в errorHandler. Токен-инвалид и
// использованный/протухший различаем, чтобы UI дал понятную подсказку («запросите заново»).
export class PasswordResetTokenInvalidError extends Error {
  constructor() {
    super('Password reset token is invalid');
    this.name = 'PasswordResetTokenInvalidError';
  }
}

export class PasswordResetTokenExpiredError extends Error {
  constructor() {
    super('Password reset token has expired or was already used');
    this.name = 'PasswordResetTokenExpiredError';
  }
}

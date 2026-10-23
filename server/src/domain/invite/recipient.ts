export class InviteEmailMismatchError extends Error {
  constructor() {
    super('Войдите в аккаунт с почтой, на которую отправлено приглашение');
    this.name = 'InviteEmailMismatchError';
  }
}

export function assertInviteRecipientEmail(inviteEmail: string, userEmail: string | null): void {
  if (inviteEmail.trim().toLowerCase() !== userEmail?.trim().toLowerCase()) {
    throw new InviteEmailMismatchError();
  }
}

export type AdminUserErrorCode = 'user_not_found' | 'cannot_modify_self' | 'admin_access_revoked' | 'email_taken' | 'invalid_user_data';

export class AdminUserError extends Error {
  constructor(readonly code: AdminUserErrorCode, message: string) {
    super(message);
    this.name = 'AdminUserError';
  }
}

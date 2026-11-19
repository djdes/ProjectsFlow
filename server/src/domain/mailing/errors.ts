// Mailing errors are mapped to HTTP statuses by presentation/mailing/routes.ts.
export type MailingErrorCode =
  | 'template_not_found'
  | 'campaign_not_found'
  | 'workspace_not_found'
  | 'invalid_content'
  | 'audience_empty'
  | 'audience_changed'
  | 'request_conflict'
  | 'not_cancellable'
  | 'test_rate_limited';

export class MailingError extends Error {
  constructor(public readonly code: MailingErrorCode, message: string) {
    super(message);
    this.name = 'MailingError';
  }
}

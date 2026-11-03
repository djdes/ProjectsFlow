// Admin mailings: template library, campaigns and their delivery progress.

export type MailingContent = {
  readonly subject: string;
  readonly preheader: string;
  readonly bodyMarkdown: string;
  readonly ctaLabel: string | null;
  readonly ctaUrl: string | null;
};

export type MailingTemplateDraft = MailingContent & { readonly name: string };

export type MailingTemplate = MailingTemplateDraft & {
  readonly id: string;
  readonly createdAt: string; // ISO
  readonly updatedAt: string; // ISO
};

// Built-in starting point; opened in the editor as a new, unsaved template.
export type MailingStarter = MailingTemplateDraft & {
  readonly key: string;
  readonly description: string;
};

export type MailingPlan = 'free' | 'prime' | 'vip';

export type MailingAudience =
  | { readonly kind: 'all' }
  | { readonly kind: 'workspace'; readonly workspaceId: string }
  | { readonly kind: 'plan'; readonly plans: readonly MailingPlan[] };

export type MailingReach = {
  readonly eligible: number;
  readonly unsubscribed: number;
  readonly invalid: number;
};

export type MailingWorkspaceOption = {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
};

export type MailingRecipientStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | 'cancelled';

export type MailingCampaign = {
  readonly id: string;
  readonly templateId: string | null;
  readonly name: string;
  readonly content: MailingContent;
  readonly audience: MailingAudience;
  readonly status: 'sending' | 'completed' | 'cancelled';
  readonly totalCount: number;
  readonly counts: Readonly<Record<MailingRecipientStatus, number>>;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly cancelledAt: string | null;
};

export type MailingRecipientProblem = {
  readonly email: string;
  readonly displayName: string;
  readonly status: 'failed' | 'skipped';
  readonly error: string | null;
};

export type MailingPreview = {
  readonly subject: string;
  readonly preheader: string;
  readonly html: string;
  readonly text: string;
};

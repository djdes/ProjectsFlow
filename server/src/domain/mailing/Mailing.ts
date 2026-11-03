// Admin mailings (db/176): a template library, campaigns sent from a template snapshot,
// one queue row per recipient and a platform-wide unsubscribe list.

export type MailingContent = {
  readonly subject: string;
  // Inbox snippet shown next to the subject; hidden inside the letter body.
  readonly preheader: string;
  // Markdown produced by the app editor; rendered by renderMailingBody.
  readonly bodyMarkdown: string;
  readonly ctaLabel: string | null;
  readonly ctaUrl: string | null;
};

export type MailingTemplate = MailingContent & {
  readonly id: string;
  readonly name: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export const MAILING_PLANS = ['free', 'prime', 'vip'] as const;
export type MailingPlan = (typeof MAILING_PLANS)[number];

export type MailingAudience =
  | { readonly kind: 'all' }
  | { readonly kind: 'workspace'; readonly workspaceId: string }
  | { readonly kind: 'plan'; readonly plans: readonly MailingPlan[] };

export type MailingCampaignStatus = 'sending' | 'completed' | 'cancelled';

export const MAILING_RECIPIENT_STATUSES = ['queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled'] as const;
export type MailingRecipientStatus = (typeof MAILING_RECIPIENT_STATUSES)[number];
export type MailingCounts = Readonly<Record<MailingRecipientStatus, number>>;

export const emptyMailingCounts = (): Record<MailingRecipientStatus, number> =>
  ({ queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, cancelled: 0 });

export type MailingCampaign = {
  readonly id: string;
  readonly templateId: string | null;
  readonly name: string;
  readonly content: MailingContent;
  readonly audience: MailingAudience;
  readonly status: MailingCampaignStatus;
  readonly totalCount: number;
  readonly counts: MailingCounts;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
  readonly cancelledAt: Date | null;
};

// A platform user who may receive a campaign, before unsubscribes are applied.
export type MailingCandidate = {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly workspaceName: string | null;
};

// A claimed queue row together with what the worker needs to render the letter.
export type MailingDelivery = MailingCandidate & {
  readonly campaignId: string;
  readonly content: MailingContent;
  readonly attempts: number;
  readonly lockedAt: Date;
};

export type MailingRecipientFailure = {
  readonly email: string;
  readonly displayName: string;
  readonly status: 'failed' | 'skipped';
  readonly error: string | null;
};

export const MAILING_LIMITS = {
  name: 120,
  subject: 200,
  preheader: 200,
  body: 50_000,
  ctaLabel: 80,
  ctaUrl: 500,
} as const;

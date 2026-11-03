// Admin mailings: template library, campaigns and their delivery progress.

// Letter designs: the classic card or a promo layout with a hero image and an offer field.
export const MAILING_LAYOUTS = ['standard', 'trial', 'annual', 'winback', 'referral', 'deadline', 'news'] as const;
export type MailingLayout = (typeof MAILING_LAYOUTS)[number];

// Display-only promo terms, also available in texts as {{offer}} and {{deadline}}.
// caption — line next to the badge; empty means the layout's own one.
// price — optional line under the badge; «X вместо Y» shows Y crossed out.
export type MailingOffer = { readonly badge: string; readonly deadline: string; readonly caption?: string; readonly price?: string };

export const MAILING_OFFER_LIMITS = { badge: 40, deadline: 60, caption: 40, price: 60 } as const;

export type MailingContent = {
  readonly subject: string;
  readonly preheader: string;
  readonly bodyMarkdown: string;
  readonly ctaLabel: string | null;
  readonly ctaUrl: string | null;
  readonly layout: MailingLayout;
  readonly offer: MailingOffer | null;
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

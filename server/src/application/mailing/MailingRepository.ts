import type {
  MailingAudience,
  MailingCampaign,
  MailingCandidate,
  MailingContent,
  MailingDelivery,
  MailingRecipientFailure,
  MailingTemplate,
} from '../../domain/mailing/Mailing.js';

export type MailingTemplateInput = MailingContent & { readonly name: string };

export type MailingWorkspaceOption = {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
};

export type NewMailingCampaign = {
  readonly id: string;
  readonly templateId: string;
  readonly name: string;
  readonly content: MailingContent;
  readonly audience: MailingAudience;
  readonly requestHash: string;
  readonly createdBy: string;
  readonly recipients: readonly MailingCandidate[];
};

export type CreateCampaignResult =
  | { readonly kind: 'created'; readonly campaign: MailingCampaign }
  // Same request id seen before: the stored hash says whether it is the same request.
  | { readonly kind: 'exists'; readonly campaign: MailingCampaign; readonly requestHash: string };

export interface MailingRepository {
  listTemplates(): Promise<MailingTemplate[]>;
  getTemplate(id: string): Promise<MailingTemplate | null>;
  createTemplate(id: string, input: MailingTemplateInput, createdBy: string): Promise<MailingTemplate>;
  updateTemplate(id: string, input: MailingTemplateInput): Promise<MailingTemplate | null>;
  deleteTemplate(id: string): Promise<boolean>;

  listWorkspaceOptions(): Promise<MailingWorkspaceOption[]>;
  workspaceExists(id: string): Promise<boolean>;
  /** Active (not deleted) users matched by the audience, before unsubscribes. */
  listAudienceCandidates(audience: MailingAudience, now: Date): Promise<MailingCandidate[]>;
  listUnsubscribedUserIds(): Promise<Set<string>>;
  isUnsubscribed(userId: string): Promise<boolean>;
  /** Idempotent: the first unsubscribe is kept. False when the user does not exist. */
  unsubscribe(userId: string, now: Date): Promise<boolean>;
  /** The user as a recipient (name, email, current workspace), null if deleted/unknown. */
  findRecipient(userId: string): Promise<MailingCandidate | null>;

  /** Inserts the campaign and its queue in one transaction; idempotent by campaign id. */
  createCampaign(input: NewMailingCampaign, now: Date): Promise<CreateCampaignResult>;
  listCampaigns(limit: number): Promise<MailingCampaign[]>;
  getCampaign(id: string): Promise<MailingCampaign | null>;
  getCampaignRequestHash(id: string): Promise<string | null>;
  listRecipientProblems(campaignId: string, limit: number): Promise<MailingRecipientFailure[]>;
  /** sending → cancelled; queued recipients become cancelled. False if it was not sending. */
  cancelCampaign(id: string, now: Date): Promise<boolean>;

  // --- queue (RunMailingQueue) ---
  /** `sending` claims older than `before` → failed (delivery unknown, never resent). */
  failStaleClaims(before: Date, error: string): Promise<number>;
  /** Letters handed to the sender since `since`, claims in flight included. */
  countSentSince(since: Date): Promise<number>;
  /** Claims up to `limit` due recipients of sending campaigns (queued → sending, attempts+1). */
  claimDue(now: Date, limit: number): Promise<MailingDelivery[]>;
  /** Every finish is conditional on the claim still being ours (status sending + locked_at). */
  markSent(d: MailingDelivery, now: Date): Promise<void>;
  markRetry(d: MailingDelivery, at: Date, error: string): Promise<void>;
  markFailed(d: MailingDelivery, error: string): Promise<void>;
  markSkipped(d: MailingDelivery, reason: string): Promise<void>;
  /** sending campaigns without queued/sending recipients → completed. */
  completeDrained(now: Date): Promise<number>;
}

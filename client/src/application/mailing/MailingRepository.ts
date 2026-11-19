import type {
  MailingAudience,
  MailingCampaign,
  MailingContent,
  MailingPreview,
  MailingReach,
  MailingRecipientProblem,
  MailingStarter,
  MailingTemplate,
  MailingTemplateDraft,
  MailingWorkspaceOption,
} from '@/domain/mailing/Mailing';

// Admin-only mailings API (раздел «Администрирование» → «Рассылки»).
export interface MailingRepository {
  listTemplates(): Promise<{ templates: MailingTemplate[]; starters: MailingStarter[] }>;
  createTemplate(draft: MailingTemplateDraft): Promise<MailingTemplate>;
  updateTemplate(id: string, draft: MailingTemplateDraft): Promise<MailingTemplate>;
  deleteTemplate(id: string): Promise<void>;
  // Server-rendered letter for the admin as recipient: the same HTML that is sent.
  preview(content: MailingContent): Promise<MailingPreview>;
  // Sends the letter to the admin's own address; returns it.
  sendTest(content: MailingContent): Promise<{ to: string }>;
  listWorkspaces(): Promise<MailingWorkspaceOption[]>;
  reach(audience: MailingAudience): Promise<MailingReach>;
  listCampaigns(): Promise<MailingCampaign[]>;
  getCampaign(id: string): Promise<{ campaign: MailingCampaign; problems: MailingRecipientProblem[] }>;
  // requestId makes a retried launch return the same campaign; expectedReach guards
  // against an audience that changed after the admin looked at it.
  launch(input: { requestId: string; templateId: string; audience: MailingAudience; expectedReach: number }): Promise<MailingCampaign>;
  cancel(id: string): Promise<MailingCampaign>;
}

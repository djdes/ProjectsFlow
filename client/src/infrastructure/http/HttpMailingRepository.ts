import type { MailingRepository } from '@/application/mailing/MailingRepository';
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
import { httpClient } from './httpClient';

const BASE = '/admin/mailings';

export class HttpMailingRepository implements MailingRepository {
  listTemplates(): Promise<{ templates: MailingTemplate[]; starters: MailingStarter[] }> {
    return httpClient.get<{ templates: MailingTemplate[]; starters: MailingStarter[] }>(`${BASE}/templates`);
  }

  async createTemplate(draft: MailingTemplateDraft): Promise<MailingTemplate> {
    return (await httpClient.post<{ template: MailingTemplate }>(`${BASE}/templates`, draft)).template;
  }

  async updateTemplate(id: string, draft: MailingTemplateDraft): Promise<MailingTemplate> {
    return (await httpClient.put<{ template: MailingTemplate }>(`${BASE}/templates/${encodeURIComponent(id)}`, draft)).template;
  }

  async deleteTemplate(id: string): Promise<void> {
    await httpClient.delete<unknown>(`${BASE}/templates/${encodeURIComponent(id)}`);
  }

  preview(content: MailingContent): Promise<MailingPreview> {
    return httpClient.post<MailingPreview>(`${BASE}/preview`, content);
  }

  sendTest(content: MailingContent): Promise<{ to: string }> {
    return httpClient.post<{ to: string }>(`${BASE}/test`, content);
  }

  async listWorkspaces(): Promise<MailingWorkspaceOption[]> {
    return (await httpClient.get<{ workspaces: MailingWorkspaceOption[] }>(`${BASE}/audience/workspaces`)).workspaces;
  }

  async reach(audience: MailingAudience): Promise<MailingReach> {
    return (await httpClient.post<{ reach: MailingReach }>(`${BASE}/reach`, { audience })).reach;
  }

  async listCampaigns(): Promise<MailingCampaign[]> {
    return (await httpClient.get<{ campaigns: MailingCampaign[] }>(`${BASE}/campaigns`)).campaigns;
  }

  getCampaign(id: string): Promise<{ campaign: MailingCampaign; problems: MailingRecipientProblem[] }> {
    return httpClient.get<{ campaign: MailingCampaign; problems: MailingRecipientProblem[] }>(`${BASE}/campaigns/${encodeURIComponent(id)}`);
  }

  async launch(input: { requestId: string; templateId: string; audience: MailingAudience; expectedReach: number }): Promise<MailingCampaign> {
    return (await httpClient.post<{ campaign: MailingCampaign }>(`${BASE}/campaigns`, input)).campaign;
  }

  async cancel(id: string): Promise<MailingCampaign> {
    return (await httpClient.post<{ campaign: MailingCampaign }>(`${BASE}/campaigns/${encodeURIComponent(id)}/cancel`)).campaign;
  }
}

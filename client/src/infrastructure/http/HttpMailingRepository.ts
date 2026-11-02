import type { MailingRepository } from '@/application/mailing/MailingRepository';
import type { AudienceFilters, AudienceUser, ContactFilters, CsvImportPreview, MailingCampaign, MailingContact, MailingContactInput, MailingDetails, MailingDraftInput, MailingOverview, MailingPage, MailingPreview, MailingReach, MailingSettings, MailingSuppression } from '@/domain/mailing/Mailing';
import { httpClient } from './httpClient';
const ROOT = '/admin/mailings';
function query(values: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}
export class HttpMailingRepository implements MailingRepository {
  overview() { return httpClient.get<MailingOverview>(`${ROOT}/overview`); }
  audience(filters: AudienceFilters, page: number) { return httpClient.get<MailingPage<AudienceUser>>(`${ROOT}/audience?${query({ ...filters, page })}`); }
  contacts(filters: ContactFilters, page: number) { return httpClient.get<MailingPage<MailingContact>>(`${ROOT}/contacts?${query({ ...filters, page })}`); }
  addContact(input: MailingContactInput) { return httpClient.post<{ inserted: number; duplicates: number }>(`${ROOT}/contacts`, input); }
  async deleteContact(id: string) { await httpClient.delete(`${ROOT}/contacts/${encodeURIComponent(id)}`); }
  previewImport(csv: string, source: string) { return httpClient.post<CsvImportPreview>(`${ROOT}/imports/preview`, { csv, source }); }
  importContacts(csv: string, source: string) { return httpClient.post<{ inserted: number; duplicates: number; invalid: number }>(`${ROOT}/imports`, { csv, source }); }
  stoplist(search: string, page: number) { return httpClient.get<MailingPage<MailingSuppression>>(`${ROOT}/stoplist?${query({ search, page })}`); }
  async suppress(email: string) { await httpClient.post(`${ROOT}/stoplist`, { email }); }
  async unsuppress(email: string) { await httpClient.delete(`${ROOT}/stoplist/${encodeURIComponent(email)}`); }
  settings(input: MailingSettings) { return httpClient.put<MailingSettings>(`${ROOT}/settings`, input); }
  reach(input: MailingDraftInput) { return httpClient.post<MailingReach>(`${ROOT}/reach`, input); }
  preview(input: MailingDraftInput, userId?: string) { return httpClient.post<MailingPreview>(`${ROOT}/preview`, { draft: input, userId }); }
  save(input: MailingDraftInput, id?: string, revision?: number) {
    return id ? httpClient.patch<MailingCampaign>(`${ROOT}/campaigns/${encodeURIComponent(id)}`, { ...input, revision }) : httpClient.post<MailingCampaign>(`${ROOT}/campaigns`, input);
  }
  details(id: string, page = 1) { return httpClient.get<MailingDetails>(`${ROOT}/campaigns/${encodeURIComponent(id)}?page=${page}`); }
  async deleteDraft(id: string) { await httpClient.delete(`${ROOT}/campaigns/${encodeURIComponent(id)}`); }
  launch(id: string, revision: number, scheduledAt: string | null) { return httpClient.post<MailingCampaign>(`${ROOT}/campaigns/${encodeURIComponent(id)}/launch`, { revision, scheduledAt }); }
  test(id: string) { return httpClient.post<{ results: { channel: string; status: string; message: string }[] }>(`${ROOT}/campaigns/${encodeURIComponent(id)}/test`, {}); }
  async cancel(id: string) { await httpClient.post(`${ROOT}/campaigns/${encodeURIComponent(id)}/cancel`, {}); }
  async retry(id: string) { await httpClient.post(`${ROOT}/campaigns/${encodeURIComponent(id)}/retry`, {}); }
}

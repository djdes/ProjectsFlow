import type {
  AudienceFilters, AudienceUser, ContactFilters, CsvImportPreview, MailingCampaign,
  MailingContact, MailingContactInput, MailingDetails, MailingDraftInput, MailingOverview,
  MailingPage, MailingPreview, MailingReach, MailingSettings, MailingSuppression,
} from '@/domain/mailing/Mailing';

export interface MailingRepository {
  overview(): Promise<MailingOverview>;
  audience(filters: AudienceFilters, page: number): Promise<MailingPage<AudienceUser>>;
  contacts(filters: ContactFilters, page: number): Promise<MailingPage<MailingContact>>;
  addContact(input: MailingContactInput): Promise<{ inserted: number; duplicates: number }>;
  deleteContact(id: string): Promise<void>;
  previewImport(csv: string, source: string): Promise<CsvImportPreview>;
  importContacts(csv: string, source: string): Promise<{ inserted: number; duplicates: number; invalid: number }>;
  stoplist(search: string, page: number): Promise<MailingPage<MailingSuppression>>;
  suppress(email: string): Promise<void>;
  unsuppress(email: string): Promise<void>;
  settings(input: MailingSettings): Promise<MailingSettings>;
  reach(input: MailingDraftInput): Promise<MailingReach>;
  preview(input: MailingDraftInput, userId?: string): Promise<MailingPreview>;
  save(input: MailingDraftInput, id?: string, revision?: number): Promise<MailingCampaign>;
  details(id: string, page?: number): Promise<MailingDetails>;
  deleteDraft(id: string): Promise<void>;
  launch(id: string, revision: number, scheduledAt: string | null): Promise<MailingCampaign>;
  test(id: string): Promise<{ results: { channel: string; status: string; message: string }[] }>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<void>;
}

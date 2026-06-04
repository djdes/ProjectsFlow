import type { DailyDigestConfig, DigestSettings } from '../../domain/digest/DigestSettings.js';

export type SaveDigestSettingsInput = {
  readonly telegramGroupChatId: number | null;
  readonly telegramGroupTitle: string | null;
  readonly daily: DailyDigestConfig;
};

export interface DigestSettingsRepository {
  // Всегда возвращает настройки (дефолты, если строки нет).
  getByProject(projectId: string): Promise<DigestSettings>;
  // Upsert настроек. НЕ трогает daily_last_sent_on.
  save(projectId: string, input: SaveDigestSettingsInput): Promise<DigestSettings>;
  // Для планировщика: все проекты с включённой ежедневной сводкой.
  listDailyEnabled(): Promise<DigestSettings[]>;
  // Отметить, что сводка отправлена в указанную МSK-дату ('YYYY-MM-DD').
  markDailySent(projectId: string, dateMsk: string): Promise<void>;
}

import type { DailyDigestConfig, DigestSettings } from '../../domain/digest/DigestSettings.js';

export type SaveDigestSettingsInput = {
  readonly telegramGroupChatId: number | null;
  readonly telegramGroupTitle: string | null;
  readonly daily: DailyDigestConfig;
};

// Ранее введённая Telegram-группа (для подсказок истории в окне автоматизации).
export type DigestGroupHistory = {
  readonly chatId: number;
  readonly title: string | null;
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
  // Distinct Telegram-группы (chat_id + последнее известное название) из всех проектов,
  // где userId — участник. Источник подсказок «ранее введённые ID групп».
  listGroupsForUser(userId: string): Promise<DigestGroupHistory[]>;
}

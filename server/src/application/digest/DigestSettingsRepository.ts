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

// Сообщения последнего ручного теста. Нужны только для уборки перед следующим тестом;
// автоматические ежедневные сводки сюда не попадают и никогда не удаляются.
export type DigestTestDelivery = {
  readonly chatId: number;
  readonly messageIds: number[];
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
  getLastTestDeliveries(projectId: string): Promise<DigestTestDelivery[]>;
  replaceLastTestDeliveries(
    projectId: string,
    deliveries: readonly DigestTestDelivery[],
  ): Promise<void>;
  // Distinct Telegram-группы (chat_id + последнее известное название) — подсказки
  // «ранее введённые ID групп». Объединение: (A) все проекты, где userId — участник
  // (любое пространство), + (B) все проекты ПРОСТРАНСТВА проекта projectId, из которого
  // открыто окно (т.е. группы, что вводили другие участники этого пространства).
  listGroupsForUser(userId: string, projectId: string): Promise<DigestGroupHistory[]>;
}

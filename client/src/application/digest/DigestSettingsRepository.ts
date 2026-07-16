import type { TaskStatus } from '@/domain/task/Task';

export type DigestChannelKind = 'email' | 'telegram' | 'notification';
export type DigestTgTarget = 'personal' | 'group';
export type DigestTgGrouping = 'status' | 'assignee';

export type DailyDigestConfig = {
  readonly enabled: boolean;
  readonly hour: number; // 0..23 (МSK)
  readonly minute: number; // 0..59
  readonly recipientUserIds: string[];
  readonly channels: DigestChannelKind[];
  readonly tgTargets: DigestTgTarget[];
  readonly tgGrouping: DigestTgGrouping;
  readonly statuses: TaskStatus[];
  // true — слать только по будням (Пн–Пт МSK), в выходные не отправлять.
  readonly weekdaysOnly: boolean;
};

export type DigestSettings = {
  readonly projectId: string;
  readonly telegramGroupChatId: number | null;
  readonly telegramGroupTitle: string | null;
  readonly daily: DailyDigestConfig;
  readonly dailyLastSentOn: string | null;
};

export type SaveDigestSettingsInput = {
  readonly telegramGroupChatId: number | null;
  readonly telegramGroupTitle: string | null;
  readonly daily: DailyDigestConfig;
};

// Ранее введённая Telegram-группа (подсказка истории для поля chat_id).
export type DigestGroupHistory = {
  readonly chatId: number;
  readonly title: string | null;
};

export interface DigestSettingsRepository {
  get(projectId: string): Promise<DigestSettings>;
  save(projectId: string, input: SaveDigestSettingsInput): Promise<DigestSettings>;
  // Отправить сводку немедленно (по текущим сохранённым настройкам). Возвращает число задач.
  sendNow(projectId: string): Promise<{ taskCount: number }>;
  // История ранее введённых Telegram-групп юзера (для combobox-подсказок).
  listGroups(projectId: string): Promise<DigestGroupHistory[]>;
  // Резолв названия группы по chat_id через бота. null — бот не в группе / нет прав.
  resolveGroupTitle(projectId: string, chatId: number): Promise<{ title: string | null }>;
}

import type { TaskStatus } from '../task/Task.js';

// Каналы доставки ежедневной сводки.
export type DigestChannelKind = 'email' | 'telegram' | 'notification';
export const DIGEST_CHANNELS: readonly DigestChannelKind[] = ['email', 'telegram', 'notification'];

// Куда слать Telegram-канал сводки: в личку участникам и/или в группу проекта.
export type DigestTgTarget = 'personal' | 'group';
export const DIGEST_TG_TARGETS: readonly DigestTgTarget[] = ['personal', 'group'];

export type DailyDigestConfig = {
  readonly enabled: boolean;
  readonly hour: number; // 0..23 (Europe/Moscow)
  readonly minute: number; // 0..59
  readonly recipientUserIds: string[]; // участники проекта (включая владельца)
  readonly channels: DigestChannelKind[];
  readonly tgTargets: DigestTgTarget[];
  readonly statuses: TaskStatus[]; // какие колонки включать
};

export type DigestSettings = {
  readonly projectId: string;
  // Telegram-группа проекта (для ручного экспорта в группу и канала «в группу» сводки).
  readonly telegramGroupChatId: number | null;
  readonly telegramGroupTitle: string | null;
  readonly daily: DailyDigestConfig;
  // МSK-дата последней успешной отправки сводки (анти-дубль), 'YYYY-MM-DD' или null.
  readonly dailyLastSentOn: string | null;
};

// Дефолты, когда строки настроек ещё нет.
export function defaultDigestSettings(projectId: string): DigestSettings {
  return {
    projectId,
    telegramGroupChatId: null,
    telegramGroupTitle: null,
    daily: {
      enabled: false,
      hour: 9,
      minute: 0,
      recipientUserIds: [],
      channels: ['notification'],
      tgTargets: ['personal'],
      statuses: ['backlog', 'manual', 'todo', 'done'],
    },
    dailyLastSentOn: null,
  };
}

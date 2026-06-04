import type { TaskStatus } from '@/domain/task/Task';

export type DigestChannelKind = 'email' | 'telegram' | 'notification';
export type DigestTgTarget = 'personal' | 'group';

export type DailyDigestConfig = {
  readonly enabled: boolean;
  readonly hour: number; // 0..23 (МSK)
  readonly minute: number; // 0..59
  readonly recipientUserIds: string[];
  readonly channels: DigestChannelKind[];
  readonly tgTargets: DigestTgTarget[];
  readonly statuses: TaskStatus[];
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

export interface DigestSettingsRepository {
  get(projectId: string): Promise<DigestSettings>;
  save(projectId: string, input: SaveDigestSettingsInput): Promise<DigestSettings>;
}

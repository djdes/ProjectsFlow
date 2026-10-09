import type { ScheduleDay } from '@/domain/digest/ScheduleDays';

export type WorkspaceAssigneeDigestRecipientMode = 'all' | 'selected';
export type WorkspaceDigestProjectMode = 'all' | 'selected';
// Режим сверки коммитов: 'auto' — переносить задачи автоматически, 'propose' — только оповещать.
export type WorkspaceCommitSyncAction = 'propose' | 'auto';

export type WorkspaceAssigneeDigestSettings = {
  readonly workspaceId: string;
  readonly enabled: boolean;
  // Личная сводка в бота: каждому участнику его задачи карточками с кнопками. Время, дни,
  // проекты и получатели — общие с групповой таблицей.
  readonly personalEnabled: boolean;
  readonly hour: number;
  readonly minute: number;
  readonly daysOfWeek: ScheduleDay[];
  readonly telegramGroupChatId: number | null;
  readonly telegramGroupTitle: string | null;
  readonly recipientMode: WorkspaceAssigneeDigestRecipientMode;
  readonly recipientUserIds: string[];
  readonly projectMode: WorkspaceDigestProjectMode;
  readonly projectIds: string[];
  readonly commitSyncEnabled: boolean;
  readonly commitSyncHour: number;
  readonly commitSyncMinute: number;
  readonly commitSyncAction: WorkspaceCommitSyncAction;
  readonly commitSyncLastSentOn: string | null;
  readonly eodReminderEnabled: boolean;
  readonly eodReminderHour: number;
  readonly eodReminderMinute: number;
  readonly eodReminderLastSentOn: string | null;
  readonly lastSentOn: string | null;
};

export type WorkspaceAssigneeDigestMember = {
  readonly userId: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly telegramUsername: string | null;
  readonly hasTelegram: boolean;
};

export type WorkspaceAssigneeDigestGroup = {
  readonly chatId: number;
  readonly title: string | null;
};

export type SaveWorkspaceAssigneeDigestInput = {
  readonly enabled: boolean;
  readonly personalEnabled: boolean;
  readonly hour: number;
  readonly minute: number;
  readonly daysOfWeek: ScheduleDay[];
  readonly telegramGroupChatId: number | null;
  readonly telegramGroupTitle: string | null;
  readonly recipientMode: WorkspaceAssigneeDigestRecipientMode;
  readonly recipientUserIds: string[];
  readonly projectMode: WorkspaceDigestProjectMode;
  readonly projectIds: string[];
  readonly commitSyncEnabled: boolean;
  readonly commitSyncHour: number;
  readonly commitSyncMinute: number;
  readonly commitSyncAction: WorkspaceCommitSyncAction;
  readonly eodReminderEnabled: boolean;
  readonly eodReminderHour: number;
  readonly eodReminderMinute: number;
};

export type WorkspaceAssigneeDigestSendResult = {
  readonly taskCount: number;
  readonly sentCount: number;
  readonly skippedRecipientUserIds: string[];
  readonly projectCount: number;
  // Задач в сообщении «На утверждении» (0 — сообщения не было).
  readonly approvalTaskCount?: number;
  // Тест личной сводки — только нажавшему. null — личная сводка выключена.
  readonly personal?: {
    readonly sentCount: number;
    readonly taskCount: number;
    readonly skippedRecipientUserIds: string[];
  } | null;
};

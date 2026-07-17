export type WorkspaceAssigneeDigestRecipientMode = 'all' | 'selected';
export type WorkspaceDigestProjectMode = 'all' | 'selected';

export type WorkspaceAssigneeDigestSettings = {
  readonly workspaceId: string;
  readonly enabled: boolean;
  readonly hour: number;
  readonly minute: number;
  readonly weekdaysOnly: boolean;
  readonly telegramGroupChatId: number | null;
  readonly telegramGroupTitle: string | null;
  readonly recipientMode: WorkspaceAssigneeDigestRecipientMode;
  readonly recipientUserIds: string[];
  readonly projectMode: WorkspaceDigestProjectMode;
  readonly projectIds: string[];
  readonly commitSyncEnabled: boolean;
  readonly commitSyncHour: number;
  readonly commitSyncMinute: number;
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
  readonly hour: number;
  readonly minute: number;
  readonly weekdaysOnly: boolean;
  readonly telegramGroupChatId: number | null;
  readonly telegramGroupTitle: string | null;
  readonly recipientMode: WorkspaceAssigneeDigestRecipientMode;
  readonly recipientUserIds: string[];
  readonly projectMode: WorkspaceDigestProjectMode;
  readonly projectIds: string[];
  readonly commitSyncEnabled: boolean;
  readonly commitSyncHour: number;
  readonly commitSyncMinute: number;
  readonly eodReminderEnabled: boolean;
  readonly eodReminderHour: number;
  readonly eodReminderMinute: number;
};

export type WorkspaceAssigneeDigestSendResult = {
  readonly taskCount: number;
  readonly sentCount: number;
  readonly skippedRecipientUserIds: string[];
  readonly projectCount: number;
};

import { ALL_SCHEDULE_DAYS, type ScheduleDay } from './ScheduleDays.js';

export type WorkspaceAssigneeDigestRecipientMode = 'all' | 'selected';
export type WorkspaceDigestProjectMode = 'all' | 'selected';

export type WorkspaceAssigneeDigestSettings = {
  readonly workspaceId: string;
  readonly enabled: boolean;
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
  readonly commitSyncLastSentOn: string | null;
  readonly eodReminderEnabled: boolean;
  readonly eodReminderHour: number;
  readonly eodReminderMinute: number;
  readonly eodReminderLastSentOn: string | null;
  readonly lastSentOn: string | null;
};

export function defaultWorkspaceAssigneeDigestSettings(
  workspaceId: string,
): WorkspaceAssigneeDigestSettings {
  return {
    workspaceId,
    enabled: false,
    hour: 9,
    minute: 0,
    daysOfWeek: [...ALL_SCHEDULE_DAYS],
    telegramGroupChatId: null,
    telegramGroupTitle: null,
    recipientMode: 'all',
    recipientUserIds: [],
    projectMode: 'all',
    projectIds: [],
    commitSyncEnabled: false,
    commitSyncHour: 17,
    commitSyncMinute: 0,
    commitSyncLastSentOn: null,
    eodReminderEnabled: false,
    eodReminderHour: 17,
    eodReminderMinute: 20,
    eodReminderLastSentOn: null,
    lastSentOn: null,
  };
}

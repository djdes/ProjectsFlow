import type {
  WorkspaceAssigneeDigestRecipientMode,
  WorkspaceCommitSyncAction,
  WorkspaceDigestProjectMode,
  WorkspaceAssigneeDigestSettings,
} from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import type {
  DigestGroupHistory,
  DigestTestDelivery,
} from './DigestSettingsRepository.js';
import type { ScheduleDay } from '../../domain/digest/ScheduleDays.js';

export type SaveWorkspaceAssigneeDigestSettingsInput = {
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
  readonly commitSyncAction: WorkspaceCommitSyncAction;
  readonly eodReminderEnabled: boolean;
  readonly eodReminderHour: number;
  readonly eodReminderMinute: number;
};

export interface WorkspaceAssigneeDigestRepository {
  get(workspaceId: string): Promise<WorkspaceAssigneeDigestSettings>;
  save(
    workspaceId: string,
    input: SaveWorkspaceAssigneeDigestSettingsInput,
  ): Promise<WorkspaceAssigneeDigestSettings>;
  listEnabled(): Promise<WorkspaceAssigneeDigestSettings[]>;
  listScheduled(): Promise<WorkspaceAssigneeDigestSettings[]>;
  markSent(workspaceId: string, dateMsk: string): Promise<void>;
  markCommitSyncSent(workspaceId: string, dateMsk: string): Promise<void>;
  markEodReminderSent(workspaceId: string, dateMsk: string): Promise<void>;
  getLastTestDeliveries(workspaceId: string): Promise<DigestTestDelivery[]>;
  replaceLastTestDeliveries(
    workspaceId: string,
    deliveries: readonly DigestTestDelivery[],
  ): Promise<void>;
  listGroups(workspaceId: string): Promise<DigestGroupHistory[]>;
}

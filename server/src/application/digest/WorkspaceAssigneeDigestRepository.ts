import type {
  WorkspaceAssigneeDigestRecipientMode,
  WorkspaceAssigneeDigestSettings,
} from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import type {
  DigestGroupHistory,
  DigestTestDelivery,
} from './DigestSettingsRepository.js';

export type SaveWorkspaceAssigneeDigestSettingsInput = {
  readonly enabled: boolean;
  readonly hour: number;
  readonly minute: number;
  readonly weekdaysOnly: boolean;
  readonly telegramGroupChatId: number | null;
  readonly telegramGroupTitle: string | null;
  readonly recipientMode: WorkspaceAssigneeDigestRecipientMode;
  readonly recipientUserIds: string[];
};

export interface WorkspaceAssigneeDigestRepository {
  get(workspaceId: string): Promise<WorkspaceAssigneeDigestSettings>;
  save(
    workspaceId: string,
    input: SaveWorkspaceAssigneeDigestSettingsInput,
  ): Promise<WorkspaceAssigneeDigestSettings>;
  listEnabled(): Promise<WorkspaceAssigneeDigestSettings[]>;
  markSent(workspaceId: string, dateMsk: string): Promise<void>;
  getLastTestDeliveries(workspaceId: string): Promise<DigestTestDelivery[]>;
  replaceLastTestDeliveries(
    workspaceId: string,
    deliveries: readonly DigestTestDelivery[],
  ): Promise<void>;
  listGroups(workspaceId: string): Promise<DigestGroupHistory[]>;
}

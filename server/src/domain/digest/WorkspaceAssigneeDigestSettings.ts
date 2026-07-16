export type WorkspaceAssigneeDigestRecipientMode = 'all' | 'selected';

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
    weekdaysOnly: true,
    telegramGroupChatId: null,
    telegramGroupTitle: null,
    recipientMode: 'all',
    recipientUserIds: [],
    lastSentOn: null,
  };
}

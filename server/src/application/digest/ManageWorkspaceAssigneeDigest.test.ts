import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ManageWorkspaceAssigneeDigest } from './ManageWorkspaceAssigneeDigest.js';
import type { WorkspaceAssigneeDigestRepository } from './WorkspaceAssigneeDigestRepository.js';
import type { SendWorkspaceAssigneeDigest } from './SendWorkspaceAssigneeDigest.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { TelegramClient } from '../telegram/TelegramClient.js';
import { WorkspaceNotFoundError } from '../../domain/workspace/errors.js';
import {
  defaultWorkspaceAssigneeDigestSettings,
} from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';

const WORKSPACE_ID = 'workspace-1';
const MEMBER_ID = 'member-1';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

function makeManager() {
  let savedRecipientUserIds: string[] = [];
  let sendCalls = 0;

  const workspaces = {
    async getMembership(workspaceId: string, userId: string) {
      if (workspaceId !== WORKSPACE_ID || userId !== MEMBER_ID) return null;
      return { workspaceId, userId, role: 'viewer' as const };
    },
    async listMembers() {
      return [
        { workspaceId: WORKSPACE_ID, userId: MEMBER_ID, role: 'viewer' as const },
      ];
    },
  } as unknown as WorkspaceRepository;

  const settings = {
    async get() {
      return defaultWorkspaceAssigneeDigestSettings(WORKSPACE_ID);
    },
    async save(workspaceId, input) {
      savedRecipientUserIds = input.recipientUserIds;
      return {
        ...defaultWorkspaceAssigneeDigestSettings(workspaceId),
        ...input,
        lastSentOn: null,
      };
    },
    async listGroups() {
      return [];
    },
  } as unknown as WorkspaceAssigneeDigestRepository;

  const send = {
    async execute() {
      sendCalls += 1;
      return {
        sentCount: 1,
        taskCount: 1,
        projectCount: 1,
        skippedRecipientUserIds: [],
      };
    },
  } as unknown as SendWorkspaceAssigneeDigest;

  const telegram = {
    async getChat(chatId: number) {
      return { id: chatId, title: 'Рабочая группа', type: 'supergroup' };
    },
  } as unknown as TelegramClient;

  const users = {
    async getTelegramLink() {
      return null;
    },
  } as unknown as UserRepository;
  const projects = {
    async listByWorkspace() {
      return [{ id: PROJECT_ID, name: 'DocsFlow', icon: null }];
    },
  } as never;

  return {
    manager: new ManageWorkspaceAssigneeDigest({
      repo: settings,
      workspaces,
      users,
      telegram,
      send,
      projects,
    }),
    getSavedRecipientUserIds: () => savedRecipientUserIds,
    getSendCalls: () => sendCalls,
  };
}

test('workspace assignee digest shared settings are editable by any member', async () => {
  const { manager, getSavedRecipientUserIds, getSendCalls } = makeManager();

  const saved = await manager.save(WORKSPACE_ID, MEMBER_ID, {
    enabled: true,
    hour: 10,
    minute: 30,
    daysOfWeek: [1, 2, 3, 4, 5, 6, 0],
    telegramGroupChatId: -1001,
    telegramGroupTitle: 'Рабочая группа',
    recipientMode: 'selected',
    recipientUserIds: [MEMBER_ID, 'outsider'],
    projectMode: 'selected',
    projectIds: [PROJECT_ID, '22222222-2222-4222-8222-222222222222'],
    commitSyncEnabled: true,
    commitSyncHour: 17,
    commitSyncMinute: 0,
    commitSyncAction: 'auto',
    eodReminderEnabled: true,
    eodReminderHour: 17,
    eodReminderMinute: 20,
  });
  assert.equal(saved.enabled, true);
  assert.equal(saved.commitSyncAction, 'auto');
  assert.deepEqual(getSavedRecipientUserIds(), [MEMBER_ID]);

  await manager.sendNow(WORKSPACE_ID, MEMBER_ID);
  assert.equal(getSendCalls(), 1);

  const group = await manager.resolveGroupTitle(WORKSPACE_ID, MEMBER_ID, -1001);
  assert.equal(group.title, 'Рабочая группа');
});

test('workspace assignee digest shared settings remain closed to outsiders', async () => {
  const { manager } = makeManager();
  await assert.rejects(
    () =>
      manager.save(WORKSPACE_ID, 'outsider', {
        enabled: true,
        hour: 9,
        minute: 0,
        daysOfWeek: [1, 2, 3, 4, 5],
        telegramGroupChatId: -1001,
        telegramGroupTitle: null,
        recipientMode: 'all',
        recipientUserIds: [],
        projectMode: 'all',
        projectIds: [],
        commitSyncEnabled: false,
        commitSyncHour: 17,
        commitSyncMinute: 0,
        commitSyncAction: 'propose',
        eodReminderEnabled: false,
        eodReminderHour: 17,
        eodReminderMinute: 20,
      }),
    WorkspaceNotFoundError,
  );
});

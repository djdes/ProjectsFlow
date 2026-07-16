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

  return {
    manager: new ManageWorkspaceAssigneeDigest({
      repo: settings,
      workspaces,
      users,
      telegram,
      send,
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
    weekdaysOnly: false,
    telegramGroupChatId: -1001,
    telegramGroupTitle: 'Рабочая группа',
    recipientMode: 'selected',
    recipientUserIds: [MEMBER_ID, 'outsider'],
  });
  assert.equal(saved.enabled, true);
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
        weekdaysOnly: true,
        telegramGroupChatId: -1001,
        telegramGroupTitle: null,
        recipientMode: 'all',
        recipientUserIds: [],
      }),
    WorkspaceNotFoundError,
  );
});

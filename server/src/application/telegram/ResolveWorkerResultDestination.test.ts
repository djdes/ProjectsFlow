import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResolveWorkerResultDestination } from './ResolveWorkerResultDestination.js';
import { defaultWorkspaceAssigneeDigestSettings } from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import type { Task } from '../../domain/task/Task.js';
import type { TelegramTaskOrigin } from './TelegramTaskOriginRepository.js';

function harness() {
  const state = {
    origin: null as TelegramTaskOrigin | null,
    project: { id: 'p', workspaceId: 'w', isInbox: false },
    projectChat: null as number | null,
    automation: true,
    workspace: { ...defaultWorkspaceAssigneeDigestSettings('w'), enabled: true, telegramGroupChatId: -100123 },
  };
  const service = new ResolveWorkerResultDestination({
    origins: { async getByTask() { return state.origin; } },
    projects: { async getById() { return state.project; } } as never,
    settings: { async getByProject() { return { telegramGroupChatId: state.projectChat }; } } as never,
    workspaceSettings: { async get() { return state.workspace; } },
    automation: { async getConfig() { return { assigneeDigestEnabled: state.automation }; } } as never,
  });
  const task = { id: 't', projectId: 'p', assignee: { userId: 'u' } } as Task;
  return { state, resolve: () => service.resolve(task) };
}

test('website worker result uses the configured workspace group; project group overrides it', async () => {
  const h = harness();
  assert.deepEqual(await h.resolve(), { taskId: 't', projectId: 'p', chatId: -100123, messageId: null, source: 'workspace' });
  h.state.projectChat = -100456;
  assert.equal((await h.resolve())?.chatId, -100456);
  assert.equal((await h.resolve())?.source, 'project');
});

test('intake reply destination takes precedence, moved task cannot fall back to another group', async () => {
  const h = harness();
  h.state.origin = { taskId: 't', projectId: 'p', chatId: -100789, messageId: 42, requestedAt: null };
  assert.equal((await h.resolve())?.messageId, 42);
  assert.equal((await h.resolve())?.chatId, -100789);
  h.state.origin = { ...h.state.origin, projectId: 'private-project' };
  assert.equal(await h.resolve(), null);
});

test('workspace fallback respects opt-in, project scope, recipient scope, and private inbox', async () => {
  for (const variant of ['disabled', 'project-off', 'project-excluded', 'recipient-excluded', 'inbox', 'no-group', 'private-chat']) {
    const h = harness();
    if (variant === 'disabled') h.state.workspace.enabled = false;
    if (variant === 'project-off') h.state.automation = false;
    if (variant === 'project-excluded') { h.state.workspace.projectMode = 'selected'; h.state.workspace.projectIds = ['another']; }
    if (variant === 'recipient-excluded') { h.state.workspace.recipientMode = 'selected'; h.state.workspace.recipientUserIds = ['another']; }
    if (variant === 'inbox') h.state.project.isInbox = true;
    if (variant === 'no-group') h.state.workspace.telegramGroupChatId = 0;
    if (variant === 'private-chat') h.state.workspace.telegramGroupChatId = 123;
    assert.equal(await h.resolve(), null, variant);
  }
  const h = harness();
  h.state.workspace.projectMode = 'selected'; h.state.workspace.projectIds = ['p'];
  h.state.workspace.recipientMode = 'selected'; h.state.workspace.recipientUserIds = ['u'];
  assert.equal((await h.resolve())?.source, 'workspace');
});

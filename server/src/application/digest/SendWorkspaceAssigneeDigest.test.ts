import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkspaceAssigneeDigestMessage } from './SendWorkspaceAssigneeDigest.js';
import type { Task } from '../../domain/task/Task.js';
import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';

function task(id: string, projectId: string, description: string, deadline: string | null): Task {
  return {
    id,
    projectId,
    createdBy: '11111111-1111-4111-8111-111111111111',
    creator: null,
    assignee: {
      userId: '22222222-2222-4222-8222-222222222222',
      displayName: 'Денис',
      avatarUrl: null,
    },
    description,
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'todo',
    statusBeforeDone: null,
    position: 1,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline,
    startDate: null,
    parentTaskId: null,
    priority: null,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    updatedAt: new Date('2026-07-10T00:00:00.000Z'),
  };
}

const link: TelegramLink = {
  telegramUserId: 123,
  telegramUsername: 'denis_pf',
  telegramFirstName: 'Денис',
  telegramPhotoUrl: null,
  telegramAuthDate: null,
  tgChatId: 123,
  tgStartedAt: new Date(),
  tgPairedAt: new Date(),
  prefs: null,
};

test('workspace assignee digest renders one compact message with mention and project groups', () => {
  const message = buildWorkspaceAssigneeDigestMessage({
    displayName: 'Денис',
    telegramLink: link,
    appUrl: 'https://projectsflow.ru',
    now: new Date('2026-07-16T09:00:00.000Z'),
    projects: [
      {
        project: { id: 'project-a', name: 'DocsFlow' },
        tasks: [task('task-a', 'project-a', 'Проверить документы\nПодробности', '2026-07-18')],
      },
      {
        project: { id: 'project-b', name: 'Banana' },
        tasks: [task('task-b', 'project-b', 'Собрать релиз', null)],
      },
    ],
  });

  assert.match(message, /Ежедневные задачи для @denis_pf/);
  assert.match(message, /Открытых задач: <b>2<\/b>/);
  assert.match(message, /<blockquote expandable>/);
  assert.match(message, /DocsFlow/);
  assert.match(message, /Banana/);
  assert.match(message, /projects\/project-a\?task=task-a/);
  assert.match(message, /осталось 2 дня/);
  assert.ok(message.length <= 3800);
});

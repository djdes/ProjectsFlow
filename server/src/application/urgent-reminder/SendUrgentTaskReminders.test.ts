import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultWorkspaceAssigneeDigestSettings } from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';
import type { UrgentReminderSlot } from '../../domain/task/urgentTaskReminder.js';
import type { SendMessageInput, SendMessageResult } from '../telegram/TelegramClient.js';
import {
  SendUrgentTaskReminders,
  buildUrgentGroupMessage,
  buildUrgentPersonalMessage,
} from './SendUrgentTaskReminders.js';
import type {
  UrgentReminderCandidate,
  UrgentTaskReminderRepository,
} from './UrgentTaskReminderRepository.js';

const SLOT: UrgentReminderSlot = { key: '2026-11-04@08', date: '2026-11-04', hour: 8 };
const GROUP = -100123;

function candidate(overrides: Partial<UrgentReminderCandidate> = {}): UrgentReminderCandidate {
  return {
    taskId: 't1',
    projectId: 'p1',
    projectName: 'Сайт',
    workspaceId: 'w1',
    isInbox: false,
    createdBy: 'u-owner',
    description: 'Поправить форму заявки\nподробности',
    priority: 1,
    status: 'todo',
    deadline: '2026-11-05',
    assigneeUserId: 'u1',
    assigneeName: 'Иван',
    ...overrides,
  };
}

function link(overrides: Partial<TelegramLink> = {}): TelegramLink {
  return {
    telegramUserId: 555,
    telegramUsername: 'ivan_dev',
    telegramFirstName: 'Иван',
    telegramPhotoUrl: null,
    telegramAuthDate: null,
    tgChatId: 555,
    tgStartedAt: new Date('2026-01-01'),
    tgPairedAt: null,
    prefs: null,
    ...overrides,
  };
}

class FakeReminders implements UrgentTaskReminderRepository {
  readonly claimed = new Set<string>();
  constructor(public tasks: UrgentReminderCandidate[]) {}
  async listCandidates() {
    return this.tasks;
  }
  async claim(taskId: string, slotKey: string) {
    const key = `${taskId}|${slotKey}`;
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
}

function setup(opts: {
  tasks: UrgentReminderCandidate[];
  links?: Record<string, TelegramLink | null>;
  groupChatId?: number | null;
  enabled?: boolean;
  results?: SendMessageResult[];
}) {
  const reminders = new FakeReminders(opts.tasks);
  const sent: SendMessageInput[] = [];
  const attached: unknown[] = [];
  const results = [...(opts.results ?? [])];
  let messageId = 100;
  const useCase = new SendUrgentTaskReminders({
    reminders,
    settings: {
      get: async (workspaceId) => ({
        ...defaultWorkspaceAssigneeDigestSettings(workspaceId),
        telegramGroupChatId: opts.groupChatId === undefined ? GROUP : opts.groupChatId,
        urgentRemindersEnabled: opts.enabled ?? true,
      }),
    },
    users: { getTelegramLink: async (userId) => opts.links?.[userId] ?? null },
    telegram: {
      sendMessage: async (input) => {
        sent.push(input);
        return results.shift() ?? { kind: 'ok', messageId: ++messageId };
      },
    },
    appUrl: 'https://projectsflow.ru/',
    messageTasks: { attach: async (input) => void attached.push(input) },
    sleep: async () => undefined,
  });
  return { useCase, reminders, sent, attached };
}

test('assignee gets one personal message and the group gets one message per task', async () => {
  const { useCase, sent, attached } = setup({
    tasks: [
      candidate(),
      candidate({ taskId: 't2', priority: null, description: 'Срочно: упал прод', deadline: null }),
      candidate({ taskId: 't3', priority: 3, description: 'Обычная задача' }),
    ],
    links: { u1: link() },
  });

  const result = await useCase.execute(SLOT);

  assert.deepEqual(result, { taskCount: 2, personalSent: 1, groupSent: 2 });
  const personal = sent.filter((m) => m.chatId === 555);
  const group = sent.filter((m) => m.chatId === GROUP);
  assert.equal(personal.length, 1);
  assert.match(personal[0]!.text, /Поправить форму заявки/);
  assert.match(personal[0]!.text, /Срочно: упал прод/);
  assert.doesNotMatch(personal[0]!.text, /Обычная задача/);
  assert.equal(group.length, 2);
  assert.match(group[0]!.text, /@ivan_dev/);
  assert.match(group[0]!.text, /Поправить форму заявки/);
  assert.match(group[1]!.text, /Пометка «срочно»/);
  assert.equal(attached.length, 2);
});

test('second run in the same slot sends nothing', async () => {
  const { useCase, sent } = setup({ tasks: [candidate()], links: { u1: link() } });
  await useCase.execute(SLOT);
  const before = sent.length;
  const again = await useCase.execute(SLOT);
  assert.equal(again.taskCount, 0);
  assert.equal(sent.length, before);
  const next = await useCase.execute({ key: '2026-11-04@16', date: '2026-11-04', hour: 16 });
  assert.equal(next.taskCount, 1);
});

test('closed, draft and approval tasks are not reminded', async () => {
  const { useCase, sent } = setup({
    tasks: [
      candidate({ status: 'done' }),
      candidate({ taskId: 't2', status: 'backlog' }),
      candidate({ taskId: 't3', status: 'pending_approval' }),
    ],
    links: { u1: link() },
  });
  const result = await useCase.execute(SLOT);
  assert.equal(result.taskCount, 0);
  assert.equal(sent.length, 0);
});

test('workspace switch turns reminders off', async () => {
  const { useCase, sent, reminders } = setup({
    tasks: [candidate()],
    links: { u1: link() },
    enabled: false,
  });
  await useCase.execute(SLOT);
  assert.equal(sent.length, 0);
  assert.equal(reminders.claimed.size, 0);
});

test('without Telegram the group still sees the assignee by name; without a group only DM goes', async () => {
  const noLink = setup({ tasks: [candidate()] });
  const r1 = await noLink.useCase.execute(SLOT);
  assert.deepEqual(r1, { taskCount: 1, personalSent: 0, groupSent: 1 });
  assert.match(noLink.sent[0]!.text, /исполнитель Иван/);

  const notStarted = setup({ tasks: [candidate()], links: { u1: link({ tgStartedAt: null }) } });
  assert.equal((await notStarted.useCase.execute(SLOT)).personalSent, 0);

  const noGroup = setup({ tasks: [candidate()], links: { u1: link() }, groupChatId: null });
  const r3 = await noGroup.useCase.execute(SLOT);
  assert.deepEqual(r3, { taskCount: 1, personalSent: 1, groupSent: 0 });
});

test('own inbox notes stay private, delegated inbox tasks go to the group', async () => {
  const { useCase, sent } = setup({
    tasks: [
      candidate({ taskId: 'own', isInbox: true, createdBy: 'u1', description: 'Личное срочно' }),
      candidate({ taskId: 'given', isInbox: true, createdBy: 'u-boss', description: 'Поручение' }),
    ],
    links: { u1: link() },
  });
  const result = await useCase.execute(SLOT);
  assert.deepEqual(result, { taskCount: 2, personalSent: 1, groupSent: 1 });
  const group = sent.filter((m) => m.chatId === GROUP);
  assert.match(group[0]!.text, /Поручение/);
  assert.match(group[0]!.text, /\/inbox\?task=given/);
  assert.match(sent.find((m) => m.chatId === 555)!.text, /Личное срочно/);
});

test('rate limit is waited out and the message is retried once', async () => {
  const { useCase, sent } = setup({
    tasks: [candidate()],
    groupChatId: GROUP,
    results: [{ kind: 'rate_limited', retryAfter: 3 }],
  });
  const result = await useCase.execute(SLOT);
  assert.equal(result.groupSent, 1);
  assert.equal(sent.length, 2);
});

test('message texts carry title, priority, project, deadline and link', () => {
  const task = candidate({ description: 'Поправить <форму>' });
  const group = buildUrgentGroupMessage({
    task,
    telegramLink: link({ telegramUsername: null }),
    slot: SLOT,
    appUrl: 'https://projectsflow.ru',
  });
  assert.equal(
    group,
    [
      '<b>🔥 Срочная задача</b> · исполнитель <a href="tg://user?id=555">Иван</a>',
      '<b><a href="https://projectsflow.ru/projects/p1?task=t1">Поправить &lt;форму&gt;</a></b>',
      'Приоритет: 🔴 Срочно',
      'Проект: Сайт',
      'Дедлайн: 05.11 · остался 1 день',
      '<a href="https://projectsflow.ru/projects/p1?task=t1">Открыть задачу ↗</a>',
    ].join('\n'),
  );

  const personal = buildUrgentPersonalMessage({
    tasks: [task, candidate({ taskId: 't2', priority: 2, deadline: null, projectName: 'CRM' })],
    slot: SLOT,
    appUrl: 'https://projectsflow.ru',
  });
  assert.match(personal, /^<b>🔥 Срочные задачи — утреннее напоминание<\/b>/);
  assert.match(personal, /На вас 2 задачи/);
  assert.match(personal, /🟠 Высокий · 📁 CRM · ⏰ без дедлайна/);
});

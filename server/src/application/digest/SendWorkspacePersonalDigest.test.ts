import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultWorkspaceAssigneeDigestSettings } from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import {
  PERSONAL_DIGEST_CARD_KIND,
  PERSONAL_DIGEST_CARD_LIMIT,
  SendWorkspacePersonalDigest,
  buildPersonalDigestCard,
  buildPersonalDigestHeader,
  sortPersonalDigestItems,
  type PersonalDigestItem,
} from './SendWorkspacePersonalDigest.js';
import type {
  SendAgentNotificationCommand,
  SendAgentNotificationResult,
} from '../telegram/SendAgentTelegramNotification.js';
import { TASK_ACTION_KINDS } from '../telegram/taskActionKeyboard.js';
import type { Task, TaskPriority, TaskStatus } from '../../domain/task/Task.js';

const DENIS = '22222222-2222-4222-8222-222222222222';
const OLGA = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-07-16T06:00:00.000Z'); // 09:00 MSK

function task(
  id: string,
  description: string,
  opts: {
    projectId?: string;
    assignee?: string;
    deadline?: string | null;
    priority?: TaskPriority | null;
    status?: TaskStatus;
    creator?: { userId: string; displayName: string } | null;
  } = {},
): Task {
  return {
    id,
    projectId: opts.projectId ?? 'project-a',
    createdBy: opts.creator?.userId ?? DENIS,
    creator: opts.creator ? { ...opts.creator, avatarUrl: null } : null,
    assignee: { userId: opts.assignee ?? DENIS, displayName: 'Денис', avatarUrl: null },
    description,
    icon: null,
    cover: null,
    coverPosition: 50,
    status: opts.status ?? 'manual',
    statusBeforeDone: null,
    position: 1,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: opts.deadline ?? null,
    startDate: null,
    parentTaskId: null,
    priority: opts.priority ?? null,
    taskType: null,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    updatedAt: new Date('2026-07-10T00:00:00.000Z'),
  };
}

function item(t: Task, projectName = 'DocsFlow'): PersonalDigestItem {
  return { task: t, project: { id: t.projectId, name: projectName }, isInbox: false };
}

function harness(opts: {
  tasks: Task[];
  personalEnabled?: boolean;
  telegram?: (cmd: SendAgentNotificationCommand) => SendAgentNotificationResult;
}) {
  const sent: SendAgentNotificationCommand[] = [];
  const digest = new SendWorkspacePersonalDigest({
    settings: {
      async get() {
        return {
          ...defaultWorkspaceAssigneeDigestSettings('w1'),
          personalEnabled: opts.personalEnabled ?? true,
        };
      },
    },
    workspaces: {
      async listMembers() {
        return [
          { workspaceId: 'w1', userId: DENIS, role: 'editor' },
          { workspaceId: 'w1', userId: OLGA, role: 'editor' },
        ] as never;
      },
    },
    projects: {
      async listByWorkspace() {
        return [{ id: 'project-a', name: 'DocsFlow', icon: null }];
      },
      async listInboxesByOwners() {
        return [];
      },
    },
    tasks: {
      async listByProject() {
        return opts.tasks;
      },
    },
    comments: {
      async countsByTasks() {
        return new Map([['t1', 2]]);
      },
    },
    telegram: {
      async execute(cmd) {
        sent.push(cmd);
        return opts.telegram?.(cmd) ?? { status: 'ok', messageId: sent.length, chatId: 1 };
      },
    },
    appUrl: 'https://projectsflow.ru/',
    sleep: async () => undefined,
  });
  return { digest, sent };
}

test('personal digest card shows task details and action buttons', () => {
  const card = buildPersonalDigestCard(
    item(
      task('t1', 'Переделать шаблон письма\n**Восстановление пароля** и <script>', {
        deadline: '2026-07-14',
        priority: 2,
        status: 'in_progress',
        creator: { userId: OLGA, displayName: 'Ольга' },
      }),
    ),
    { appUrl: 'https://projectsflow.ru', commentCount: 2, now: NOW },
  );

  assert.match(card.text, /^📌 <b>Переделать шаблон письма<\/b>/);
  assert.match(card.text, /📁 DocsFlow · 🟠 Высокий · В работе/);
  assert.match(card.text, /❗ Срок: .* — просрочено на 2 дня/);
  assert.match(card.text, /👤 Поставил\(а\): Ольга/);
  assert.match(card.text, /<blockquote expandable>Восстановление пароля и &lt;script&gt;<\/blockquote>/);
  assert.match(card.text, /💬 2/);
  const buttons = card.keyboard.inline_keyboard.flat();
  assert.deepEqual(
    buttons.map((b) => b.callback_data ?? b.url),
    ['nd:t1', 'nc:t1', 'bt:t:t1', 'https://projectsflow.ru/projects/project-a?task=t1'],
  );
});

test('personal digest card keeps a long one-line description readable: clipped title, full text quoted', () => {
  const long = `Проверить письма клиенту, и др. ${'шаблоны восстановления пароля '.repeat(8)}`.trim();
  const card = buildPersonalDigestCard(item(task('t1', long)), {
    appUrl: 'https://projectsflow.ru',
    commentCount: 0,
    now: NOW,
  });
  const title = /^📌 <b>(.+)<\/b>/.exec(card.text)?.[1] ?? '';
  assert.ok(title.startsWith('Проверить письма клиенту, и др. шаблоны'));
  assert.ok(title.endsWith('…') && title.length <= 161);
  assert.match(card.text, new RegExp(`<blockquote expandable>${long}</blockquote>`));
  assert.doesNotMatch(card.text, /💬/);
});

test('personal digest card does not repeat a short title in the quote', () => {
  const card = buildPersonalDigestCard(item(task('t1', 'Подключить ЭДО для Янины и БФС')), {
    appUrl: 'https://projectsflow.ru',
    commentCount: 0,
    now: NOW,
  });
  assert.match(card.text, /^📌 <b>Подключить ЭДО для Янины и БФС<\/b>/);
  assert.doesNotMatch(card.text, /blockquote/);
});

test('personal digest puts overdue first, then priority, then nearest deadline', () => {
  const sorted = sortPersonalDigestItems(
    [
      item(task('no-priority', 'A')),
      item(task('low-soon', 'B', { priority: 4, deadline: '2026-07-17' })),
      item(task('urgent', 'C', { priority: 1 })),
      item(task('overdue', 'D', { deadline: '2026-07-01' })),
      item(task('low-later', 'E', { priority: 4, deadline: '2026-08-01' })),
    ],
    NOW,
  );
  assert.deepEqual(
    sorted.map((i) => i.task.id),
    ['overdue', 'urgent', 'low-soon', 'low-later', 'no-priority'],
  );
});

test('personal digest header counts tasks per project and urgency', () => {
  const header = buildPersonalDigestHeader(
    [
      item(task('a', 'A', { deadline: '2026-07-01' })),
      item(task('b', 'B', { deadline: '2026-07-16', priority: 1 })),
      item(task('c', 'C', { projectId: 'project-b' }), 'ScanFlow'),
    ],
    NOW,
  );
  assert.match(header, /Ваши задачи на сегодня<\/b> — 3 задачи/);
  assert.match(header, /📁 DocsFlow — 2\n📁 ScanFlow — 1/);
  assert.match(header, /❗ Просрочено: <b>1<\/b> · ⏰ Срок сегодня: <b>1<\/b> · 🔴 Срочных: <b>1<\/b>/);
});

test('personal digest sends each member their own tasks as cards with reply-to-comment kind', async () => {
  const { digest, sent } = harness({
    tasks: [
      task('t1', 'Задача Дениса'),
      task('t2', 'Задача Ольги', { assignee: OLGA }),
      task('t3', 'Готовая', { status: 'done' }),
      task('t4', 'Ждёт утверждения', { status: 'pending_approval' }),
    ],
  });
  const result = await digest.execute('w1');

  assert.deepEqual(result, { sentCount: 2, taskCount: 2, skippedRecipientUserIds: [] });
  const cards = sent.filter((cmd) => cmd.kind === PERSONAL_DIGEST_CARD_KIND);
  assert.deepEqual(
    cards.map((cmd) => [cmd.userId, cmd.taskId, cmd.projectId]),
    [
      [DENIS, 't1', 'project-a'],
      [OLGA, 't2', 'project-a'],
    ],
  );
  // Карточка регистрирует reply→комментарий тем же путём, что задачные уведомления.
  assert.ok(TASK_ACTION_KINDS.has(PERSONAL_DIGEST_CARD_KIND));
  assert.ok(cards.every((cmd) => cmd.replyMarkup && cmd.skipDedupCheck));
});

test('personal digest test send goes only to the requested member and ignores the toggle', async () => {
  const { digest, sent } = harness({
    personalEnabled: false,
    tasks: [task('t1', 'Задача Дениса'), task('t2', 'Задача Ольги', { assignee: OLGA })],
  });
  assert.deepEqual(await digest.execute('w1'), {
    sentCount: 0,
    taskCount: 0,
    skippedRecipientUserIds: [],
  });
  await digest.execute('w1', { force: true, onlyUserId: OLGA });
  assert.ok(sent.length > 0);
  assert.ok(sent.every((cmd) => cmd.userId === OLGA));
});

test('personal digest skips members without a reachable bot chat', async () => {
  const { digest, sent } = harness({
    tasks: [task('t1', 'Задача Дениса'), task('t2', 'Задача Ольги', { assignee: OLGA })],
    telegram: (cmd) =>
      cmd.userId === OLGA ? { status: 'not_started' } : { status: 'ok', messageId: 1, chatId: 1 },
  });
  const result = await digest.execute('w1');
  assert.deepEqual(result.skippedRecipientUserIds, [OLGA]);
  // Для Ольги ушла только попытка заголовка, карточки не слались.
  assert.equal(sent.filter((cmd) => cmd.userId === OLGA).length, 1);
});

test('personal digest caps cards and links the rest to the app', async () => {
  const many = Array.from({ length: PERSONAL_DIGEST_CARD_LIMIT + 3 }, (_, i) =>
    task(`t${i}`, `Задача ${i}`),
  );
  const { digest, sent } = harness({ tasks: many });
  await digest.execute('w1');
  assert.equal(
    sent.filter((cmd) => cmd.kind === PERSONAL_DIGEST_CARD_KIND).length,
    PERSONAL_DIGEST_CARD_LIMIT,
  );
  assert.match(sent.at(-1)!.text, /… и ещё 3 задачи — <a href="https:\/\/projectsflow\.ru\/">/);
});

test('personal digest retries once after a Telegram rate limit', async () => {
  let attempts = 0;
  const { digest, sent } = harness({
    tasks: [task('t1', 'Задача Дениса')],
    telegram: (cmd) => {
      if (cmd.kind === PERSONAL_DIGEST_CARD_KIND && attempts++ === 0) {
        return { status: 'rate_limited', retryAfter: 3 };
      }
      return { status: 'ok', messageId: 1, chatId: 1 };
    },
  });
  await digest.execute('w1');
  assert.equal(sent.filter((cmd) => cmd.kind === PERSONAL_DIGEST_CARD_KIND).length, 2);
});

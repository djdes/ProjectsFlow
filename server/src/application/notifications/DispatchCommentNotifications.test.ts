import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchCommentNotifications } from './DispatchCommentNotifications.js';
import { buildTaskUrl } from './taskUrl.js';
import type { NotificationPrefs } from '../../domain/notifications/NotificationPrefs.js';

// --- Минимальные in-memory фейки (тест гоняется через tsx + node:test, без новых deps) ---

type Member = {
  userId: string;
  user: { id: string; email: string; displayName: string; avatarUrl: string | null };
  notificationPrefs: NotificationPrefs | null;
};

function member(id: string, displayName: string, opts?: { email?: string; prefOff?: boolean }): Member {
  return {
    userId: id,
    user: {
      id,
      email: opts?.email ?? `${id}@example.com`,
      displayName,
      avatarUrl: null,
    },
    notificationPrefs: opts?.prefOff ? { comment_created: { team: false, mcp: false } } : null,
  };
}

type Harness = {
  service: DispatchCommentNotifications;
  sentEmails: { to: string; subject: string }[];
  recorded: { recipientUserId: string; channel: string; status: string; reason: string | null }[];
  tgCalls: string[];
  tgSends: { userId: string; kind: string }[];
};

function makeHarness(opts: {
  members: Member[];
  tgResults?: Record<string, { status: string; messageId?: number; chatId?: number; description?: string }>;
  failEmailFor?: string;
  // Ответственный по задаче. undefined → 'B' (дефолт для большинства кейсов),
  // null → задача без ответственного.
  assigneeUserId?: string | null;
  // Комментарии по id — для резолва автора родительского коммента (reply).
  comments?: Record<string, { id: string; ownerUserId: string }>;
}): Harness {
  const sentEmails: Harness['sentEmails'] = [];
  const recorded: Harness['recorded'] = [];
  const tgCalls: string[] = [];
  const tgSends: Harness['tgSends'] = [];
  let counter = 0;

  const assigneeUserId = opts.assigneeUserId === undefined ? 'B' : opts.assigneeUserId;
  const task =
    assigneeUserId === null
      ? { id: 't1', description: 'описание задачи', assignee: null }
      : { id: 't1', description: 'описание задачи', assignee: { userId: assigneeUserId } };

  const service = new DispatchCommentNotifications({
    members: { listByProject: async () => opts.members } as never,
    projects: { getById: async () => ({ id: 'p1', name: 'Проект' }) } as never,
    tasks: { getById: async () => task } as never,
    comments: {
      getById: async (id: string) => opts.comments?.[id] ?? null,
    } as never,
    email: {
      send: async (msg: { to: string; subject: string }) => {
        if (opts.failEmailFor && msg.to === opts.failEmailFor) throw new Error('smtp boom');
        sentEmails.push({ to: msg.to, subject: msg.subject });
      },
    } as never,
    tgSend: {
      execute: async (cmd: { userId: string; kind: string }) => {
        tgCalls.push(cmd.userId);
        tgSends.push({ userId: cmd.userId, kind: cmd.kind });
        return (opts.tgResults?.[cmd.userId] ?? { status: 'ok', messageId: 1, chatId: 1 }) as never;
      },
    } as never,
    log: {
      recordMany: async (rows: Harness['recorded']) => {
        recorded.push(...rows);
      },
      listByComment: async () => [],
    } as never,
    idGen: () => `id-${++counter}`,
    appUrl: 'https://app.example',
  });

  return { service, sentEmails, recorded, tgCalls, tgSends };
}

const baseComment = {
  id: 'c1',
  taskId: 't1',
  body: 'привет команда',
  actorKind: 'user' as const,
  agentName: null,
};

test('buildTaskUrl добавляет якорь на комментарий', () => {
  assert.equal(
    buildTaskUrl('https://app.example/', 'p1', 't1', 'c1'),
    'https://app.example/projects/p1?task=t1#comment-c1',
  );
  assert.equal(buildTaskUrl('https://app.example', 'p1', 't1'), 'https://app.example/projects/p1?task=t1');
});

test('audience=all: уведомление ответственному, но НЕ постороннему участнику пространства', async () => {
  const h = makeHarness({
    // B — ответственный, C — просто участник пространства (посторонний для этой задачи).
    members: [member('A', 'Автор'), member('B', 'Боб'), member('C', 'Кэрол')],
    assigneeUserId: 'B',
  });
  await h.service.execute({
    projectId: 'p1',
    actorUserId: 'A',
    source: 'team',
    audience: { mode: 'all' },
    comment: baseComment,
  });
  assert.deepEqual(h.sentEmails.map((e) => e.to), ['B@example.com']);
  assert.deepEqual(h.tgCalls, ['B']);
  assert.deepEqual(h.tgSends, [{ userId: 'B', kind: 'comment_on_my_task' }]);
  // Посторонняя C не получила ничего ни в одном канале.
  assert.equal(h.recorded.some((r) => r.recipientUserId === 'C'), false);
  // Автор A не получил уведомление о самом себе.
  assert.equal(h.recorded.some((r) => r.recipientUserId === 'A'), false);
});

test('audience=all: pref_off у ответственного → email skipped, TG всё равно пробуем', async () => {
  const h = makeHarness({
    members: [member('A', 'Автор'), member('B', 'Боб', { prefOff: true })],
    assigneeUserId: 'B',
  });
  await h.service.execute({
    projectId: 'p1',
    actorUserId: 'A',
    source: 'team',
    audience: { mode: 'all' },
    comment: baseComment,
  });
  assert.deepEqual(h.sentEmails, []);
  const emailRow = h.recorded.find((r) => r.channel === 'email' && r.recipientUserId === 'B');
  assert.equal(emailRow?.status, 'skipped');
  assert.equal(emailRow?.reason, 'pref_off');
  // TG-pref резолвится внутри tgSend — попытка отправки всё равно делается.
  assert.deepEqual(h.tgCalls, ['B']);
});

test('audience=all: автор родительского коммента получает уведомление об ответе', async () => {
  const h = makeHarness({
    members: [member('A', 'Автор'), member('B', 'Боб'), member('C', 'Кэрол')],
    // Ответственный — B; C ответственным не является, но это ответ на её коммент.
    assigneeUserId: 'B',
    comments: { c0: { id: 'c0', ownerUserId: 'C' } },
  });
  await h.service.execute({
    projectId: 'p1',
    actorUserId: 'A',
    source: 'team',
    audience: { mode: 'all' },
    comment: { ...baseComment, replyToCommentId: 'c0' },
  });
  assert.deepEqual(h.sentEmails.map((e) => e.to).sort(), ['B@example.com', 'C@example.com']);
  assert.deepEqual(h.tgCalls.sort(), ['B', 'C']);
});

test('audience=all: удалённый родительский коммент не роняет рассылку', async () => {
  const h = makeHarness({
    members: [member('A', 'Автор'), member('B', 'Боб')],
    assigneeUserId: 'B',
    comments: {},
  });
  await h.service.execute({
    projectId: 'p1',
    actorUserId: 'A',
    source: 'team',
    audience: { mode: 'all' },
    comment: { ...baseComment, replyToCommentId: 'gone' },
  });
  assert.deepEqual(h.sentEmails.map((e) => e.to), ['B@example.com']);
});

test('audience=all: упомянутый получает TG с kind=mention (даже если он посторонний)', async () => {
  const h = makeHarness({
    members: [member('A', 'Автор'), member('B', 'Боб'), member('C', 'Кэрол')],
    assigneeUserId: 'B',
  });
  await h.service.execute({
    projectId: 'p1',
    actorUserId: 'A',
    source: 'team',
    audience: { mode: 'all' },
    comment: { ...baseComment, body: 'эй @Кэрол глянь' },
  });
  // Ответственный B — обычное уведомление, упомянутая C — отдельный kind 'mention'.
  assert.deepEqual(h.tgSends.sort((x, y) => x.userId.localeCompare(y.userId)), [
    { userId: 'B', kind: 'comment_on_my_task' },
    { userId: 'C', kind: 'mention' },
  ]);
  // И письмо упомянутой тоже уходит.
  assert.deepEqual(h.sentEmails.map((e) => e.to).sort(), ['B@example.com', 'C@example.com']);
  const tgRow = h.recorded.find((r) => r.channel === 'telegram' && r.recipientUserId === 'C');
  assert.equal(tgRow?.status, 'sent');
});

test('audience=all: упомянутый ответственный получает ОДНО TG-уведомление', async () => {
  const h = makeHarness({
    members: [member('A', 'Автор'), member('B', 'Боб')],
    assigneeUserId: 'B',
  });
  await h.service.execute({
    projectId: 'p1',
    actorUserId: 'A',
    source: 'team',
    audience: { mode: 'all' },
    comment: { ...baseComment, body: 'эй @Боб глянь' },
  });
  assert.deepEqual(h.tgSends, [{ userId: 'B', kind: 'comment_on_my_task' }]);
  assert.equal(h.sentEmails.length, 1);
});

test('audience=all: задача без ответственного не роняет рассылку', async () => {
  const h = makeHarness({
    members: [member('A', 'Автор'), member('B', 'Боб')],
    assigneeUserId: null,
  });
  await h.service.execute({
    projectId: 'p1',
    actorUserId: 'A',
    source: 'team',
    audience: { mode: 'all' },
    comment: baseComment,
  });
  // Причастных нет → никто не уведомлён, но и исключения нет.
  assert.deepEqual(h.sentEmails, []);
  assert.deepEqual(h.tgCalls, []);
  assert.deepEqual(h.recorded, []);
});

test('audience=selected: только выбранные', async () => {
  const h = makeHarness({
    members: [member('A', 'Автор'), member('B', 'Боб'), member('C', 'Кэрол')],
  });
  await h.service.execute({
    projectId: 'p1',
    actorUserId: 'A',
    source: 'team',
    audience: { mode: 'selected', userIds: ['C'] },
    comment: baseComment,
  });
  assert.deepEqual(h.sentEmails.map((e) => e.to), ['C@example.com']);
  assert.deepEqual(h.tgCalls, ['C']);
  assert.equal(h.recorded.some((r) => r.recipientUserId === 'B'), false);
});

test('audience=none, но @mention получает email принудительно (мимо pref)', async () => {
  const h = makeHarness({
    members: [member('A', 'Автор'), member('B', 'Боб', { prefOff: true })],
  });
  await h.service.execute({
    projectId: 'p1',
    actorUserId: 'A',
    source: 'team',
    audience: { mode: 'none' },
    comment: { ...baseComment, body: 'эй @Боб глянь' },
  });
  // Боб упомянут → email отправлен несмотря на pref_off и mode=none.
  assert.deepEqual(h.sentEmails.map((e) => e.to), ['B@example.com']);
  assert.equal(h.recorded.find((r) => r.channel === 'email')?.status, 'sent');
  // TG в mode=none для упомянутого не шлём (mention в TG — отдельный механизм).
  assert.deepEqual(h.tgCalls, []);
});

test('маппинг статусов Telegram → строка журнала', async () => {
  const h = makeHarness({
    members: [member('A', 'Автор'), member('B', 'Боб')],
    tgResults: { B: { status: 'not_connected' } },
  });
  await h.service.execute({
    projectId: 'p1',
    actorUserId: 'A',
    source: 'team',
    audience: { mode: 'all' },
    comment: baseComment,
  });
  const tgRow = h.recorded.find((r) => r.channel === 'telegram' && r.recipientUserId === 'B');
  assert.equal(tgRow?.status, 'skipped');
  assert.equal(tgRow?.reason, 'not_linked');
});

test('сбой email → строка failed, не роняет dispatch', async () => {
  const h = makeHarness({
    members: [member('A', 'Автор'), member('B', 'Боб')],
    failEmailFor: 'B@example.com',
  });
  await h.service.execute({
    projectId: 'p1',
    actorUserId: 'A',
    source: 'team',
    audience: { mode: 'all' },
    comment: baseComment,
  });
  const emailRow = h.recorded.find((r) => r.channel === 'email' && r.recipientUserId === 'B');
  assert.equal(emailRow?.status, 'failed');
});

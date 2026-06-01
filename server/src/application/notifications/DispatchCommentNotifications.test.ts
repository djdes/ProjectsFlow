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
};

function makeHarness(opts: {
  members: Member[];
  tgResults?: Record<string, { status: string; messageId?: number; chatId?: number; description?: string }>;
  failEmailFor?: string;
}): Harness {
  const sentEmails: Harness['sentEmails'] = [];
  const recorded: Harness['recorded'] = [];
  const tgCalls: string[] = [];
  let counter = 0;

  const service = new DispatchCommentNotifications({
    members: { listByProject: async () => opts.members } as never,
    projects: { getById: async () => ({ id: 'p1', name: 'Проект' }) } as never,
    tasks: { getById: async () => ({ id: 't1', description: 'описание задачи' }) } as never,
    email: {
      send: async (msg: { to: string; subject: string }) => {
        if (opts.failEmailFor && msg.to === opts.failEmailFor) throw new Error('smtp boom');
        sentEmails.push({ to: msg.to, subject: msg.subject });
      },
    } as never,
    tgSend: {
      execute: async (cmd: { userId: string }) => {
        tgCalls.push(cmd.userId);
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

  return { service, sentEmails, recorded, tgCalls };
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

test('audience=all: письма всем кроме автора по их pref; оба канала записаны', async () => {
  const h = makeHarness({
    members: [member('A', 'Автор'), member('B', 'Боб'), member('C', 'Кэрол', { prefOff: true })],
  });
  await h.service.execute({
    projectId: 'p1',
    actorUserId: 'A',
    source: 'team',
    audience: { mode: 'all' },
    comment: baseComment,
  });
  // Email: B — отправлено, C — пропущено (pref_off). Автор A исключён.
  assert.deepEqual(h.sentEmails.map((e) => e.to).sort(), ['B@example.com']);
  const emailRows = h.recorded.filter((r) => r.channel === 'email');
  assert.equal(emailRows.find((r) => r.recipientUserId === 'B')?.status, 'sent');
  assert.equal(emailRows.find((r) => r.recipientUserId === 'C')?.status, 'skipped');
  assert.equal(emailRows.find((r) => r.recipientUserId === 'C')?.reason, 'pref_off');
  // Telegram: оба (B, C) — попытка отправки (pref TG резолвится внутри tgSend).
  assert.deepEqual(h.tgCalls.sort(), ['B', 'C']);
  assert.equal(h.recorded.filter((r) => r.channel === 'telegram').length, 2);
  // Автор A не получил ничего.
  assert.equal(h.recorded.some((r) => r.recipientUserId === 'A'), false);
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

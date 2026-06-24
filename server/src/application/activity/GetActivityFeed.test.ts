import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetActivityFeed } from './GetActivityFeed.js';
import type { ActivityRepository } from './ActivityRepository.js';
import type { ActivityEvent } from '../../domain/activity/ActivityEvent.js';
import type { Notification } from '../../domain/notifications/Notification.js';

function ev(id: string, at: string, projectId = 'p1'): ActivityEvent {
  return {
    id,
    workspaceId: 'w1',
    projectId,
    actorUserId: 'u2',
    kind: 'task_created',
    payload: { taskExcerpt: 'T' },
    createdAt: new Date(at),
  };
}

function notif(id: string, type: string, at: string, projectId: string | null, readAt: Date | null = null): Notification {
  const payload = projectId ? { type, projectId } : { type };
  return { id, userId: 'u1', payload, readAt, createdAt: new Date(at) } as unknown as Notification;
}

function makeFeed(opts: {
  events?: ActivityEvent[];
  notifs?: Notification[];
  wsProjects?: string[];
}) {
  const events = opts.events ?? [];
  const activity: ActivityRepository = {
    async record() {},
    async listForUserInWorkspace(_u, _w, q) {
      const filtered = q.before ? events.filter((e) => e.createdAt < q.before!) : events;
      return [...filtered].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, q.limit);
    },
    async deleteOlderThan() {
      return 0;
    },
  };
  const notifications = {
    async listByUser(
      _u: string,
      q: { limit: number; unreadOnly: boolean; before?: Date },
    ): Promise<Notification[]> {
      const all = opts.notifs ?? [];
      let filtered = q.unreadOnly ? all.filter((n) => n.readAt === null) : all;
      if (q.before) filtered = filtered.filter((n) => n.createdAt < q.before!);
      return [...filtered].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, q.limit);
    },
  };
  const workspaceProjectIds = async (): Promise<Set<string>> => new Set(opts.wsProjects ?? ['p1']);
  return new GetActivityFeed({ activity, notifications, workspaceProjectIds });
}

test('all: merges activity + notifications sorted by createdAt desc', async () => {
  const feed = makeFeed({
    events: [ev('e1', '2026-06-24T10:00:00Z'), ev('e2', '2026-06-24T12:00:00Z')],
    notifs: [notif('n1', 'comment_mention', '2026-06-24T11:00:00Z', 'p1')],
  });
  const items = await feed.execute('u1', 'w1', { tab: 'all', limit: 10 });
  assert.deepEqual(
    items.map((i) => (i.type === 'activity' ? i.event.id : i.notification.id)),
    ['e2', 'n1', 'e1'],
  );
});

test('all: notifications scoped to workspace projects; out-of-workspace excluded', async () => {
  const feed = makeFeed({
    events: [],
    notifs: [
      notif('in', 'comment_mention', '2026-06-24T10:00:00Z', 'p1'),
      notif('out', 'comment_mention', '2026-06-24T11:00:00Z', 'pX'),
    ],
    wsProjects: ['p1'],
  });
  const items = await feed.execute('u1', 'w1', { tab: 'all', limit: 10 });
  assert.deepEqual(items.map((i) => (i.type === 'notification' ? i.notification.id : '')), ['in']);
});

test('all: project-less personal notification (inbox delegation) always included', async () => {
  const feed = makeFeed({
    notifs: [notif('d1', 'task_delegation', '2026-06-24T10:00:00Z', null)],
    wsProjects: ['p1'],
  });
  const items = await feed.execute('u1', 'w1', { tab: 'all', limit: 10 });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.type, 'notification');
});

test('action: only actionable unread notifications, scoped', async () => {
  const feed = makeFeed({
    notifs: [
      notif('inv', 'project_invite', '2026-06-24T10:00:00Z', 'p1'),
      notif('mention', 'comment_mention', '2026-06-24T11:00:00Z', 'p1'),
      notif('read', 'task_delegation', '2026-06-24T12:00:00Z', null, new Date('2026-06-24T12:30:00Z')),
    ],
  });
  const items = await feed.execute('u1', 'w1', { tab: 'action', limit: 10 });
  // mention не actionable; read — прочитано → только invite.
  assert.deepEqual(items.map((i) => (i.type === 'notification' ? i.notification.id : '')), ['inv']);
});

test('all: notifications past the first page are reachable via before-cursor', async () => {
  // Регрессия: раньше уведомления брались только N свежих и фильтровались по before
  // в памяти → старее первой страницы были недостижимы. Теперь before уходит в источник.
  const feed = makeFeed({
    events: [],
    notifs: [
      notif('new', 'comment_mention', '2026-06-24T12:00:00Z', 'p1'),
      notif('old', 'comment_mention', '2026-06-24T08:00:00Z', 'p1'),
    ],
  });
  const page1 = await feed.execute('u1', 'w1', { tab: 'all', limit: 1 });
  assert.deepEqual(page1.map((i) => (i.type === 'notification' ? i.notification.id : '')), ['new']);
  const page2 = await feed.execute('u1', 'w1', {
    tab: 'all',
    limit: 1,
    before: page1[0]!.createdAt,
  });
  assert.deepEqual(page2.map((i) => (i.type === 'notification' ? i.notification.id : '')), ['old']);
});

test('all: limit respected after merge', async () => {
  const feed = makeFeed({
    events: [ev('e1', '2026-06-24T10:00:00Z'), ev('e2', '2026-06-24T09:00:00Z')],
    notifs: [notif('n1', 'comment_mention', '2026-06-24T11:00:00Z', 'p1')],
  });
  const items = await feed.execute('u1', 'w1', { tab: 'all', limit: 2 });
  assert.equal(items.length, 2);
  assert.equal(items[0]!.type === 'notification' ? items[0]!.notification.id : '', 'n1');
});

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { RequestWorkspaceContext } from '../../infrastructure/workspace/RequestWorkspaceContext.js';
import { workspaceScope } from '../middleware/workspaceScope.js';
import { taskAssigneesRouter } from '../assignees/routes.js';
import { inboxRouter } from '../inbox/routes.js';
import { notificationsRouter } from '../notifications/routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { ListTasksAssignedToMe } from '../../application/task/ListTasksAssignedToMe.js';
import { ListTasksAssignedToOthers } from '../../application/task/ListTasksAssignedToOthers.js';
import { ListPersonalTasksOfColleagues } from '../../application/task/ListPersonalTasksOfColleagues.js';
import { ListMemberTasksForLead } from '../../application/task/ListMemberTasksForLead.js';
import { GetOrCreateInbox } from '../../application/project/GetOrCreateInbox.js';
import { ListNotifications } from '../../application/notifications/ListNotifications.js';
import { CountUnreadNotifications } from '../../application/notifications/CountUnreadNotifications.js';
import { MarkAllNotificationsRead } from '../../application/notifications/MarkAllNotificationsRead.js';
import { MarkNotificationRead } from '../../application/notifications/MarkNotificationRead.js';
import type { Notification, NotificationPayload } from '../../domain/notifications/Notification.js';
import type { NotificationRepository } from '../../application/notifications/NotificationRepository.js';
import type { RealtimeEvent } from '../../domain/realtime/RealtimeEvent.js';
import type { Task } from '../../domain/task/Task.js';
import type { Project } from '../../domain/project/Project.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function harness(t: TestContext) {
  let active = 'a';
  let gate: ReturnType<typeof deferred> | null = null;
  const entered = deferred();
  const context = new RequestWorkspaceContext();
  const projects = ['a', 'b'].flatMap((ws) => [
    { id: `p-${ws}`, workspaceId: ws, name: `Project ${ws}`, ownerId: 'me', isInbox: false, role: 'owner', createdAt: new Date() },
    { id: `inbox-${ws}`, workspaceId: ws, name: `Inbox ${ws}`, ownerId: 'me', isInbox: true, createdAt: new Date() },
    { id: `personal-${ws}`, workspaceId: ws, name: `Personal ${ws}`, ownerId: `member-${ws}`, isInbox: true, createdAt: new Date() },
  ]) as Project[];
  const tasks = projects.map((project) => ({
    id: `task-${project.id}`, projectId: project.id, createdBy: 'me',
    status: 'backlog', description: project.name, assignee: { userId: project.ownerId, displayName: project.ownerId, avatarUrl: null },
    createdAt: new Date(), updatedAt: new Date(), deadline: null,
  })) as Task[];
  const workspaces = {
    getCurrentWorkspaceId: async () => active,
    findAnotherForUser: async () => 'a',
    getById: async (id: string) => ({ id, kind: id === 'a' ? 'default' as const : 'team' as const }),
    getMembership: async (id: string, user: string) => ['a', 'b'].includes(id) && (user === 'me' || user === `member-${id}`)
      ? { workspaceId: id, userId: user, role: user === 'me' ? 'owner' : 'editor' } : null,
  };
  const resolveActiveWorkspace = async (user: string) => {
    if (gate) { entered.resolve(); await gate.promise; }
    return context.get(user)?.workspace ?? null;
  };
  const projectRepo = {
    getById: async (id: string) => projects.find((p) => p.id === id) ?? null,
    findInboxByOwner: async (owner: string, ws: string) => projects.find((p) => p.isInbox && p.ownerId === owner && p.workspaceId === ws) ?? null,
    listInboxesByOwners: async (owners: string[], ws: string) => projects.filter((p) => p.isInbox && owners.includes(p.ownerId) && p.workspaceId === ws),
  };
  const members = {
    listProjectsForUserInWorkspace: async (_user: string, ws: string) => projects.filter((p) => p.workspaceId === ws && p.ownerId === 'me'),
    findForProject: async () => ({ role: 'owner' }),
    listSharedUsersInWorkspace: async (_user: string, ws: string) => [{ id: `member-${ws}`, displayName: ws }],
  };
  const taskRepo = {
    listAssignedToInWorkspace: async (user: string, ws: string) => tasks.filter((item) => item.assignee.userId === user && projects.some((p) => p.id === item.projectId && p.workspaceId === ws)),
    listByProject: async (id: string) => tasks.filter((item) => item.projectId === id),
    listByProjects: async (ids: string[]) => tasks.filter((item) => ids.includes(item.projectId)),
    findDeletedTaskIds: async () => new Set<string>(),
  };
  const common = {
    projects: projectRepo, tasks: taskRepo, members, workspaces, resolveActiveWorkspace,
    users: { getById: async (id: string) => ({ id, displayName: id }) },
    taskCommits: { countsByTasks: async () => new Map() },
    attachments: { countsByTasks: async () => new Map() },
    comments: { countsByTasks: async () => new Map() },
  };
  const notices: Notification[] = ['b', 'b', 'a', 'a'].map((workspaceId, i) => ({
    id: `n${i}`, userId: 'me', workspaceId, createdAt: new Date(100 - i), readAt: null,
    payload: { type: 'task_assignee_changed', taskId: `task-p-${workspaceId}`, projectId: `p-${workspaceId}` } as NotificationPayload,
  }));
  const repo = {
    listByUser: async (_user, opts) => notices.filter((n) => n.workspaceId === opts.workspaceId && (!opts.unreadOnly || !n.readAt)).slice(0, opts.limit),
    countUnread: async (_user, ws) => notices.filter((n) => n.workspaceId === ws && !n.readAt).length,
    countActionableUnread: async () => 0,
    markRead: async (id, _user, date, ws) => {
      const index = notices.findIndex((n) => n.id === id && n.workspaceId === ws);
      if (index < 0) return false;
      notices[index] = { ...notices[index]!, readAt: date }; return true;
    },
    markAllRead: async (_user, date, ws) => {
      let count = 0;
      notices.forEach((n, i) => { if (n.workspaceId === ws && !n.readAt) { notices[i] = { ...n, readAt: date }; count += 1; } });
      return count;
    },
  } as NotificationRepository;
  let publish: (n: Notification) => void = () => {};
  let publishRealtime: (e: RealtimeEvent) => void = () => {};
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'me' } as never; next(); });
  app.use('/api', workspaceScope({ workspaces: workspaces as never, run: (u, w, next) => context.run(u, w, next) }));
  app.use('/api/assignees', taskAssigneesRouter({
    listAssignedToMe: new ListTasksAssignedToMe(common as never),
    listAssignedToOthers: new ListTasksAssignedToOthers(common as never),
    listPersonalOfColleagues: new ListPersonalTasksOfColleagues(common as never),
    listMemberTasksForLead: new ListMemberTasksForLead(common as never),
  }));
  app.use('/api/inbox', inboxRouter({ getOrCreateInbox: new GetOrCreateInbox({
    repo: projectRepo as never, members: members as never, idGen: () => 'new',
    resolveWorkspaceId: async (u) => (await resolveActiveWorkspace(u))!.id,
  }) }));
  const nd = { repo, resolveActiveWorkspace, now: () => new Date() };
  app.use('/api/notifications', notificationsRouter({
    tasks: taskRepo as never, resolveActiveWorkspace,
    getProjectWorkspaceId: async (id) => projects.find((p) => p.id === id)?.workspaceId ?? null,
    list: new ListNotifications(nd), countUnread: new CountUnreadNotifications(nd),
    markRead: new MarkNotificationRead(nd), markAllRead: new MarkAllNotificationsRead(nd),
    subscribe: (_user, callback) => { publish = callback; return () => { publish = () => {}; }; },
    subscribeRealtime: (_user, callback) => { publishRealtime = callback; return () => { publishRealtime = () => {}; }; },
  }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const request = (path: string, ws?: string, method = 'GET') => fetch(base + path, {
    method, headers: ws ? { 'X-Workspace-Id': ws } : {}, signal: AbortSignal.timeout(5000),
  });
  return { request, base, notices, tasks, publish: (n: Notification) => publish(n),
    realtime: (e: RealtimeEvent) => publishRealtime(e), setActive: (ws: string) => { active = ws; },
    block: () => { gate = deferred(); return { entered: entered.promise, release: () => { gate!.resolve(); gate = null; } }; } };
}

test('HTTP: default and team inboxes, assignments and personal tasks never cross workspace boundaries', async (t) => {
  const h = await harness(t);
  for (const ws of ['a', 'b', 'a']) {
    h.setActive(ws);
    const inbox = await (await h.request('/inbox', ws)).json();
    assert.equal(inbox.project.id, `inbox-${ws}`);
    for (const path of ['/assignees/mine', '/assignees/others', '/assignees/personal', `/assignees/member/member-${ws}`]) {
      const res = await h.request(path, ws);
      assert.equal(res.status, 200, path);
      const body = await res.json();
      assert.ok(body.items.every((item: { projectId: string }) => item.projectId.endsWith(`-${ws}`)), path);
    }
  }
});

test('HTTP: forged workspace and stale member selection are denied without returning tasks', async (t) => {
  const h = await harness(t);
  for (const path of ['/assignees/mine', '/inbox', '/notifications']) {
    assert.equal((await h.request(path, 'private')).status, 404);
  }
  assert.equal((await h.request('/assignees/member/member-b', 'a')).status, 404);
  assert.equal((await fetch(h.base + '/notifications/stream?workspaceId=private')).status, 404);
});

test('HTTP: a delayed request keeps its workspace after the account preference changes', async (t) => {
  const h = await harness(t);
  const gate = h.block();
  const pending = h.request('/assignees/mine');
  await gate.entered;
  h.setActive('b');
  gate.release();
  const old = await (await pending).json();
  assert.ok(old.items.every((item: { projectId: string }) => item.projectId.endsWith('-a')));
  const fresh = await (await h.request('/assignees/mine')).json();
  assert.ok(fresh.items.every((item: { projectId: string }) => item.projectId.endsWith('-b')));
  const [a, b] = await Promise.all(['a', 'b'].map(async (ws) => (await h.request('/inbox', ws)).json()));
  assert.equal(a.project.id, 'inbox-a'); assert.equal(b.project.id, 'inbox-b');
});

test('HTTP: notification pagination, counts and read operations use only the requested workspace', async (t) => {
  const h = await harness(t);
  const page = await (await h.request('/notifications?limit=1', 'a')).json();
  assert.deepEqual(page.notifications.map((n: Notification) => n.id), ['n2']);
  await h.request('/notifications/n0/read', 'a', 'POST');
  assert.equal(h.notices[0]!.readAt, null);
  const read = await (await h.request('/notifications/read-all', 'a', 'POST')).json();
  assert.equal(read.updated, 2);
  assert.equal((await (await h.request('/notifications/unread-count', 'a')).json()).count, 0);
  assert.equal((await (await h.request('/notifications/unread-count', 'b')).json()).count, 2);
});

test('SSE: notifications and realtime events from another workspace never reach the stream', async (t) => {
  const h = await harness(t);
  const abort = new AbortController();
  t.after(() => abort.abort());
  const response = await fetch(h.base + '/notifications/stream?workspaceId=a', { signal: abort.signal });
  const reader = response.body!.getReader();
  await reader.read(); // retry preamble: subscription is ready
  h.publish(h.notices[0]!); // workspace b
  h.publish(h.notices[2]!); // workspace a
  const notice = new TextDecoder().decode((await reader.read()).value);
  assert.ok(notice.includes('n2')); assert.ok(!notice.includes('n0'));
  h.realtime({ kind: 'task_changed', projectId: 'p-b' });
  h.realtime({ kind: 'task_changed', projectId: 'p-a' });
  const event = new TextDecoder().decode((await reader.read()).value);
  assert.ok(event.includes('p-a')); assert.ok(!event.includes('p-b'));
  abort.abort();
});

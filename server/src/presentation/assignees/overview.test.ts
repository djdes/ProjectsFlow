import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { RequestWorkspaceContext } from '../../infrastructure/workspace/RequestWorkspaceContext.js';
import { RequestMemo, requestScopedAdminCheck } from '../../infrastructure/request/RequestMemo.js';
import { workspaceScope } from '../middleware/workspaceScope.js';
import { requestMemoScope } from '../middleware/requestMemoScope.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { taskAssigneesRouter } from './routes.js';
import { configureAdminBypass } from '../../application/project/projectAccess.js';
import { ListTasksAssignedToMe } from '../../application/task/ListTasksAssignedToMe.js';
import { ListTasksAssignedToOthers } from '../../application/task/ListTasksAssignedToOthers.js';
import { ListPersonalTasksOfColleagues } from '../../application/task/ListPersonalTasksOfColleagues.js';
import { ListMemberTasksForLead } from '../../application/task/ListMemberTasksForLead.js';
import { ListApprovalQueue } from '../../application/task/ListApprovalQueue.js';
import { ListTasksAwaitingMyReply } from '../../application/task/ListTasksAwaitingMyReply.js';
import { GetInboxOverview } from '../../application/task/GetInboxOverview.js';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { Project } from '../../domain/project/Project.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';

const ME = 'me';
const WORKSPACES: readonly string[] = ['a', 'b'];
// Colleague's personal tasks I created: canManageTask runs once per task.
const PERSONAL_TASKS = 5;
// Fixed for the whole run: every request must see exactly the same data.
const BASE = Date.now();
const at = (minutesAgo: number) => new Date(BASE - minutesAgo * 60_000);

// I own workspace a and am an editor in b (there the colleague owns it): the approval queue is
// mine only in a, and in b my rights to colleagues' tasks are narrower.
const myRole = (ws: string) => (ws === 'a' ? 'owner' : 'editor');

function project(id: string, ws: string, ownerId: string, isInbox: boolean): Project {
  return { id, workspaceId: ws, ownerId, name: `Проект ${id}`, isInbox, createdAt: at(10_000) } as Project;
}

function task(
  id: string,
  projectId: string,
  input: { assignee: string; createdBy: string; status?: TaskStatus; fromGroup?: boolean },
): Task {
  return {
    id,
    projectId,
    createdBy: input.createdBy,
    creator: null,
    assignee: { userId: input.assignee, displayName: input.assignee, avatarUrl: null },
    description: `Задача ${id}`,
    status: input.status ?? 'backlog',
    statusBeforeDone: null,
    position: 1024,
    deadline: null,
    deletedAt: null,
    ralphCancelRequestedAt: null,
    groupOrigin: input.fromGroup ? { chatId: 42, title: 'Рабочая группа', authorUserId: null, authorName: 'Анна' } : null,
    createdAt: at(600),
    updatedAt: at(300),
  } as Task;
}

// A question addressed to me by the colleague of workspace `ws`.
function question(id: string, taskId: string, ws: string, minutesAgo: number): TaskComment {
  return { id, taskId, ownerUserId: `member-${ws}`, body: `Вопрос  ${id}?`, createdAt: at(minutesAgo) } as TaskComment;
}

const projects = WORKSPACES.flatMap((ws) => [
  project(`p-${ws}`, ws, ws === 'a' ? ME : `member-${ws}`, false),
  project(`inbox-${ws}`, ws, ME, true),
  project(`personal-${ws}`, ws, `member-${ws}`, true),
]);

const tasks = WORKSPACES.flatMap((ws) => [
  task(`mine-${ws}`, `p-${ws}`, { assignee: ME, createdBy: `member-${ws}`, fromGroup: true }),
  task(`mine-inbox-${ws}`, `inbox-${ws}`, { assignee: ME, createdBy: ME }),
  task(`others-${ws}`, `p-${ws}`, { assignee: `member-${ws}`, createdBy: ME, status: 'pending_approval' }),
  task(`others-done-${ws}`, `p-${ws}`, { assignee: `member-${ws}`, createdBy: ME, status: 'done', fromGroup: true }),
  ...Array.from({ length: PERSONAL_TASKS }, (_, i) =>
    task(`personal-${ws}-${i}`, `personal-${ws}`, { assignee: `member-${ws}`, createdBy: ME }),
  ),
  // The colleague's own personal task is never mine to see.
  task(`private-${ws}`, `personal-${ws}`, { assignee: `member-${ws}`, createdBy: `member-${ws}` }),
]);

const comments = WORKSPACES.flatMap((ws) => [
  question(`q-${ws}`, `others-${ws}`, ws, 30),
  question(`q-personal-${ws}`, `personal-${ws}-0`, ws, 20),
  // Closed tasks are not shown.
  question(`q-done-${ws}`, `others-done-${ws}`, ws, 10),
]);

const workspaceOf = (t: Task) => projects.find((p) => p.id === t.projectId)!.workspaceId;

async function harness(t: TestContext) {
  const context = new RequestWorkspaceContext();
  const memo = new RequestMemo();
  let adminReads = 0;
  configureAdminBypass(
    requestScopedAdminCheck(memo, {
      getById: async () => {
        adminReads += 1;
        return { isAdmin: false };
      },
    }),
  );
  t.after(() => configureAdminBypass(async () => false));

  const workspaces = {
    getCurrentWorkspaceId: async () => 'a',
    findAnotherForUser: async () => 'a',
    getById: async (id: string) => (WORKSPACES.includes(id) ? { id, kind: 'team' as const } : null),
    getMembership: async (id: string, user: string) => {
      if (!WORKSPACES.includes(id)) return null;
      if (user === ME) return { workspaceId: id, userId: ME, role: myRole(id) };
      if (user === `member-${id}`) return { workspaceId: id, userId: user, role: id === 'b' ? 'owner' : 'editor' };
      return null;
    },
  };
  const resolveActiveWorkspace = async (user: string) => context.get(user)?.workspace ?? null;
  const projectRepo = {
    getById: async (id: string) => projects.find((p) => p.id === id) ?? null,
    listInboxesByOwners: async (owners: readonly string[], ws: string) =>
      projects.filter((p) => p.isInbox && owners.includes(p.ownerId) && p.workspaceId === ws),
  };
  const members = {
    isProjectHidden: async () => false,
    findForProject: async (projectId: string, user: string) => {
      const p = projects.find((x) => x.id === projectId);
      if (!p || user !== ME || (p.isInbox && p.ownerId !== ME)) return null;
      return { projectId, userId: ME, role: p.isInbox ? 'owner' : myRole(p.workspaceId), joinedAt: at(10_000) };
    },
    listProjectsForUserInWorkspace: async (user: string, ws: string) =>
      projects
        .filter((p) => p.workspaceId === ws && (!p.isInbox || p.ownerId === user))
        .map((p) => ({ ...p, role: p.isInbox ? 'owner' : myRole(ws), memberCount: 2, taskCount: 0, isFavorite: false, favoriteSortOrder: 0 })),
    listSharedUsersInWorkspace: async (user: string, ws: string) =>
      user === ME && WORKSPACES.includes(ws)
        ? [{ id: `member-${ws}`, displayName: `Коллега ${ws}`, email: `${ws}@example.test`, avatarUrl: null }]
        : [],
    // Leads and owners of the project's workspace.
    listApproverUserIdsForProject: async (projectId: string) => {
      const ws = projects.find((p) => p.id === projectId)?.workspaceId;
      return ws === 'a' ? [ME] : ws === 'b' ? ['member-b'] : [];
    },
  };
  const taskRepo = {
    listAssignedToInWorkspace: async (user: string, ws: string) =>
      tasks.filter((x) => x.assignee.userId === user && workspaceOf(x) === ws),
    listByProject: async (id: string) => tasks.filter((x) => x.projectId === id),
    listByProjects: async (ids: readonly string[]) => tasks.filter((x) => ids.includes(x.projectId)),
    listByStatusInWorkspace: async (ws: string, status: TaskStatus) =>
      tasks.filter((x) => x.status === status && workspaceOf(x) === ws),
    listByIds: async (ids: readonly string[]) => tasks.filter((x) => ids.includes(x.id)),
    getById: async (id: string) => tasks.find((x) => x.id === id) ?? null,
  };
  const counts = (shift: number) => ({
    countsByTasks: async (ids: readonly string[]) => new Map(ids.map((id) => [id, (id.length + shift) % 4])),
  });
  const commentRepo = {
    ...counts(2),
    listUnansweredAddressedTo: async (user: string, since: Date) =>
      comments.filter((c) => user === ME && c.createdAt >= since).sort((x, y) => +y.createdAt - +x.createdAt),
  };
  const common = {
    projects: projectRepo,
    members,
    workspaces,
    tasks: taskRepo,
    taskCommits: counts(0),
    attachments: counts(1),
    comments: commentRepo,
    resolveActiveWorkspace,
    users: { getById: async (id: string) => ({ id, displayName: `Имя ${id}`, isAdmin: false }) },
  };
  const lists = {
    listAssignedToMe: new ListTasksAssignedToMe(common as never),
    listAssignedToOthers: new ListTasksAssignedToOthers(common as never),
    listPersonalOfColleagues: new ListPersonalTasksOfColleagues(common as never),
    listApprovalQueue: new ListApprovalQueue(common as never),
    listAwaitingMyReply: new ListTasksAwaitingMyReply(common as never),
  };

  // Same middleware order as createApp: session → workspace scope → memo scope → routes.
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: ME } as never;
    next();
  });
  app.use('/api', workspaceScope({ workspaces: workspaces as never, run: (u, w, next) => context.run(u, w, next) }));
  app.use('/api', requestMemoScope({ run: (active, next) => memo.run(active, next) }));
  app.use(
    '/api/assignees',
    taskAssigneesRouter({
      ...lists,
      listMemberTasksForLead: new ListMemberTasksForLead(common as never),
      getInboxOverview: new GetInboxOverview(lists),
    }),
  );
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/assignees`;
  const request = async (path: string, ws?: string) => {
    const res = await fetch(base + path, {
      headers: ws ? { 'X-Workspace-Id': ws } : {},
      signal: AbortSignal.timeout(5000),
    });
    return { status: res.status, text: await res.text() };
  };
  // Runs a list in the request workspace but without the memo, as if the scope were missing.
  const withoutMemo = <T>(ws: string, run: () => Promise<T>) =>
    new Promise<T>((resolve, reject) =>
      context.run(ME, { id: ws, kind: 'team' }, () => void run().then(resolve, reject)),
    );
  return { request, lists, withoutMemo, adminReads: () => adminReads, resetAdminReads: () => (adminReads = 0) };
}

const PARTS = [
  ['mine', '/mine'],
  ['others', '/others'],
  ['personal', '/personal'],
  ['approvals', '/approvals'],
  ['awaitingReply', '/awaiting-reply'],
] as const;

test('overview: each part is byte-for-byte the answer of its own endpoint', async (t) => {
  const h = await harness(t);
  // No header falls back to the current workspace, like the separate endpoints.
  for (const ws of ['a', 'b', undefined]) {
    for (const query of ['', '?fromGroups=1', '?excludeDone=1', '?excludeDone=1&fromGroups=1']) {
      const overview = await h.request(`/overview${query}`, ws);
      assert.equal(overview.status, 200);
      const separate = await Promise.all(PARTS.map(([, path]) => h.request(path + query, ws)));
      for (const res of separate) assert.equal(res.status, 200);
      const expected = `{${PARTS.map(([name], i) => `${JSON.stringify(name)}:${separate[i]!.text}`).join(',')}}`;
      assert.equal(overview.text, expected, `workspace ${ws ?? '(current)'} ${query}`);
    }
  }

  // excludeDone=1 omits historical done tasks while keeping open ones.
  const openOnly = JSON.parse((await h.request('/overview?excludeDone=1', 'a')).text);
  assert.ok(openOnly.others.items.every((item: { task: { status: string } }) => item.task.status !== 'done'));
  assert.ok(openOnly.mine.items.every((item: { task: { status: string } }) => item.task.status !== 'done'));
  assert.ok(openOnly.others.items.length > 0);

  // The fixtures are not vacuous: workspace a fills every list.
  const body = JSON.parse((await h.request('/overview', 'a')).text);
  for (const [name] of PARTS) assert.ok(body[name].items.length > 0, name);
  assert.equal(body.personal.items.length, PERSONAL_TASKS);
  assert.deepEqual(Object.keys(body), PARTS.map(([name]) => name));
  assert.deepEqual(
    body.awaitingReply.items.map((item: { task: { id: string }; question: { commentId: string } }) => [item.task.id, item.question.commentId]),
    [['personal-a-0', 'q-personal-a'], ['others-a', 'q-a']],
  );
  assert.equal(typeof body.awaitingReply.items[0].question.askedAt, 'string');
});

test('overview: every part stays inside the request workspace; a forged workspace gets 404', async (t) => {
  const h = await harness(t);
  const [a, b] = await Promise.all(['a', 'b'].map(async (ws) => JSON.parse((await h.request('/overview', ws)).text)));
  for (const [ws, body] of [['a', a], ['b', b]] as const) {
    for (const [name] of PARTS) {
      assert.ok(
        body[name].items.every((item: { projectId: string }) => item.projectId.endsWith(`-${ws}`)),
        `${name} in ${ws}`,
      );
    }
  }
  const forged = await h.request('/overview', 'private');
  assert.equal(forged.status, 404);
  assert.doesNotMatch(forged.text, /items/);
});

test('overview: a non-lead gets an empty approval queue, not an error', async (t) => {
  const h = await harness(t);
  const res = await h.request('/overview', 'b');
  assert.equal(res.status, 200);
  const body = JSON.parse(res.text);
  assert.deepEqual(body.approvals, { items: [] });
  assert.ok(body.others.items.length > 0);
  // Rights are the same as in the separate lists: in b I may not manage the colleague's tasks.
  assert.ok(body.personal.items.every((item: { canModify: boolean }) => item.canModify === false));
  assert.ok(body.awaitingReply.items.every((item: { canModify: boolean }) => item.canModify === false));
});

test('one request checks the admin flag once, however many tasks it lists', async (t) => {
  const h = await harness(t);

  // Without the request memo canManageTask reads the flag for every task.
  await h.withoutMemo('a', () => h.lists.listPersonalOfColleagues.execute(ME));
  assert.equal(h.adminReads(), PERSONAL_TASKS);

  h.resetAdminReads();
  assert.equal(JSON.parse((await h.request('/personal', 'a')).text).items.length, PERSONAL_TASKS);
  assert.equal(h.adminReads(), 1);

  // All five lists of the overview share one read, and the next request reads again.
  h.resetAdminReads();
  await h.request('/overview', 'a');
  assert.equal(h.adminReads(), 1);
  await h.request('/overview', 'a');
  assert.equal(h.adminReads(), 2);
});

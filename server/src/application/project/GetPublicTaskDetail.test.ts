import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetPublicTaskDetail } from './GetPublicTaskDetail.js';
import { GetPublicTaskAccess } from './GetPublicTaskAccess.js';
import { GetPublicAttachment } from './GetPublicAttachment.js';
import type { Project } from '../../domain/project/Project.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1', ownerId: 'u1', name: 'Persona', icon: null, status: 'active',
    gitRepoUrl: null, kbRepoFullName: null, kbKind: 'none', financeVisibility: 'owner',
    dispatcherUserId: null, multiTaskWorker: false, isInbox: false,
    description: null, coverUrl: null, coverPosition: 50,
    publicSlug: 'cookie-opinion-k3f9q2', isPublic: true, publicIndexing: false,
    appRepoFullName: null,
    createdAt: new Date('2026-01-01'), ...over,
  };
}

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1', projectId: 'p1', createdBy: 'u1',
    description: 'Заголовок\nтело с картинкой /api/attachments/aaaa',
    icon: null, cover: null, coverPosition: 50, status: 'todo', statusBeforeDone: null,
    position: 1, ralphMode: 'normal', ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null, ralphCancelRequestedByDisplayName: null,
    deadline: null, priority: 2, createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'), delegation: null, ...over,
  };
}

function makeComment(over: Partial<TaskComment> = {}): TaskComment {
  return {
    id: 'c1', taskId: 't1', ownerUserId: 'author1', body: 'коммент',
    actorKind: 'user', agentName: null, notifyMode: 'all',
    replyToCommentId: null, quotedText: null,
    createdAt: new Date('2026-02-02'), updatedAt: new Date('2026-02-02'), ...over,
  };
}

function deps(opts: {
  project?: Project | null;
  task?: Task | null;
  comments?: TaskComment[];
}) {
  const project = opts.project === undefined ? makeProject() : opts.project;
  const task = opts.task === undefined ? makeTask() : opts.task;
  return {
    projects: { async getBySlug(s: string) { return project && project.publicSlug === s ? project : null; } } as any,
    tasks: { async getById(id: string) { return task && task.id === id ? task : null; } } as any,
    comments: { async listByTask() { return opts.comments ?? []; } } as any,
    members: { async findForProject(_p: string, u: string) { return u === 'member1' ? { role: 'editor' } : null; } } as any,
    users: {
      async getById(id: string) {
        return { id, email: `${id}@x`, displayName: `Имя ${id}`, avatarUrl: null, isAdmin: false, createdAt: new Date() };
      },
    } as any,
    attachments: { async getById(id: string) { return id === 'aaaa' ? { id: 'aaaa', taskId: 't1', commentId: null, filename: 'x.png', mimeType: 'image/png', sizeBytes: 1, storageKey: 'k', uploadedAt: new Date() } : null; } } as any,
    storage: { async read(_k: string) { return { data: Buffer.from('bytes'), mimeType: 'image/png' }; } } as any,
  };
}

test('GetPublicTaskDetail: тело с переписанными URL + человеческие комменты', async () => {
  const d = deps({ comments: [makeComment(), makeComment({ id: 'c2', actorKind: 'agent', agentName: 'ralph-worker' })] });
  const detail = await new GetPublicTaskDetail(d).execute('cookie-opinion-k3f9q2', 't1');
  assert.ok(detail);
  assert.match(detail!.description!, /\/api\/public\/boards\/cookie-opinion-k3f9q2\/attachments\/aaaa/);
  // agent-коммент отфильтрован — только человеческий.
  assert.equal(detail!.comments.length, 1);
  assert.equal(detail!.comments[0]!.authorDisplayName, 'Имя author1');
  assert.equal(detail!.priority, 2);
});

test('GetPublicTaskDetail: непубличный проект → null', async () => {
  const detail = await new GetPublicTaskDetail(deps({ project: makeProject({ isPublic: false }) })).execute('cookie-opinion-k3f9q2', 't1');
  assert.equal(detail, null);
});

test('GetPublicTaskDetail: задача не из этого проекта → null', async () => {
  const detail = await new GetPublicTaskDetail(deps({ task: makeTask({ projectId: 'other' }) })).execute('cookie-opinion-k3f9q2', 't1');
  assert.equal(detail, null);
});

test('GetPublicTaskDetail: приватные поля задачи не утекают', async () => {
  const detail = await new GetPublicTaskDetail(deps({})).execute('cookie-opinion-k3f9q2', 't1');
  const keys = Object.keys(detail!).sort();
  assert.deepEqual(keys, ['comments', 'cover', 'coverPosition', 'deadline', 'description', 'icon', 'id', 'priority', 'status']);
});

test('GetPublicTaskAccess: аноним → isMember=false + projectId', async () => {
  const acc = await new GetPublicTaskAccess(deps({})).execute('cookie-opinion-k3f9q2', 't1', null);
  assert.deepEqual(acc, { projectId: 'p1', isMember: false });
});

test('GetPublicTaskAccess: участник → isMember=true', async () => {
  const acc = await new GetPublicTaskAccess(deps({})).execute('cookie-opinion-k3f9q2', 't1', 'member1');
  assert.equal(acc!.isMember, true);
});

test('GetPublicTaskAccess: непубличный → null', async () => {
  const acc = await new GetPublicTaskAccess(deps({ project: makeProject({ isPublic: false }) })).execute('cookie-opinion-k3f9q2', 't1', 'member1');
  assert.equal(acc, null);
});

test('GetPublicAttachment: вложение публичного проекта → байты; чужое/приватное → null', async () => {
  const ok = await new GetPublicAttachment(deps({})).execute('cookie-opinion-k3f9q2', 'aaaa');
  assert.ok(ok);
  assert.equal(ok!.attachment.id, 'aaaa');
  const priv = await new GetPublicAttachment(deps({ project: makeProject({ isPublic: false }) })).execute('cookie-opinion-k3f9q2', 'aaaa');
  assert.equal(priv, null);
  const unknown = await new GetPublicAttachment(deps({})).execute('cookie-opinion-k3f9q2', 'zzzz');
  assert.equal(unknown, null);
});

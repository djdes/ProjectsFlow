import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RecordInput } from '../activity/ActivityRecorder.js';
import type { EmailMessage } from '../notifications/EmailSender.js';
import type { CreateNotificationInput } from '../notifications/NotificationRepository.js';
import type { ProjectRole } from '../../domain/project/ProjectMembership.js';
import type { Project } from '../../domain/project/Project.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { Task } from '../../domain/task/Task.js';
import {
  AssigneeNotProjectMemberError,
  AssigneeNotSharedMemberError,
} from '../../domain/task/errors.js';
import type { User } from '../../domain/user/User.js';
import type { UpdateTaskPatch } from './TaskRepository.js';
import { ChangeTaskAssignee } from './ChangeTaskAssignee.js';

const PROJECT_ID = 'project-1';
const TASK_ID = 'task-1';
const OWNER_ID = 'user-owner';
const CURRENT_ASSIGNEE_ID = 'user-current';
const VIEWER_ID = 'user-viewer';
const TARGET_ID = 'user-target';
const OUTSIDER_ID = 'user-outsider';

const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  [OWNER_ID]: 'Olga Owner',
  [CURRENT_ASSIGNEE_ID]: 'Chris Current',
  [VIEWER_ID]: 'Vera Viewer',
  [TARGET_ID]: 'Tanya Target',
  [OUTSIDER_ID]: 'Oscar Outsider',
};

type HarnessOptions = {
  readonly isInbox?: boolean;
  readonly assigneeUserId?: string;
  readonly memberships?: Readonly<Record<string, ProjectRole>>;
  readonly sharedUserIds?: readonly string[];
};

function makeProject(isInbox: boolean): Project {
  return {
    id: PROJECT_ID,
    ownerId: OWNER_ID,
    name: isInbox ? 'Inbox' : 'Roadmap',
    icon: null,
    status: 'active',
    gitRepoUrl: null,
    kbRepoFullName: null,
    kbKind: 'none',
    financeVisibility: 'owner',
    dispatcherUserId: null,
    multiTaskWorker: false,
    isInbox,
    description: null,
    coverUrl: null,
    coverPosition: 50,
    publicSlug: null,
    isPublic: false,
    publicIndexing: false,
    appRepoFullName: null,
    siteSlug: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeTask(assigneeUserId: string): Task {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    createdBy: OWNER_ID,
    assignee: {
      userId: assigneeUserId,
      displayName: DISPLAY_NAMES[assigneeUserId] ?? assigneeUserId,
      avatarUrl: null,
    },
    description: 'Ship the launch plan',
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'todo',
    statusBeforeDone: null,
    position: 1024,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: null,
    startDate: null,
    parentTaskId: null,
    priority: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };
}

function makeUser(id: string): User {
  return {
    id,
    email: `${id}@example.test`,
    displayName: DISPLAY_NAMES[id] ?? id,
    avatarUrl: null,
    isAdmin: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeHarness(options: HarnessOptions = {}) {
  const project = makeProject(options.isInbox ?? false);
  const memberships = options.memberships ?? {
    [OWNER_ID]: 'owner',
    [CURRENT_ASSIGNEE_ID]: 'editor',
    [VIEWER_ID]: 'viewer',
    [TARGET_ID]: 'viewer',
  };
  const sharedUserIds = options.sharedUserIds ?? [CURRENT_ASSIGNEE_ID, TARGET_ID];
  let task = makeTask(options.assigneeUserId ?? CURRENT_ASSIGNEE_ID);

  const calls = {
    updates: [] as Array<{ taskId: string; patch: UpdateTaskPatch }>,
    membershipLookups: [] as Array<{ projectId: string; userId: string }>,
    sharedLookups: [] as string[],
    userLookups: [] as string[],
    notifications: [] as CreateNotificationInput[],
    emails: [] as EmailMessage[],
    activities: [] as RecordInput[],
  };

  const change = new ChangeTaskAssignee({
    projects: {
      getById: async (id: string) => (id === PROJECT_ID ? project : null),
    } as never,
    members: {
      findForProject: async (projectId: string, userId: string) => {
        calls.membershipLookups.push({ projectId, userId });
        const role = memberships[userId];
        return role
          ? { projectId, userId, role, joinedAt: new Date('2026-01-01T00:00:00.000Z') }
          : null;
      },
      listSharedUsers: async (ownerUserId: string) => {
        calls.sharedLookups.push(ownerUserId);
        return sharedUserIds.map((id) => ({
          id,
          displayName: DISPLAY_NAMES[id] ?? id,
          email: `${id}@example.test`,
          avatarUrl: null,
        }));
      },
    } as never,
    tasks: {
      getById: async (id: string) => (id === TASK_ID ? task : null),
      update: async (taskId: string, patch: UpdateTaskPatch) => {
        calls.updates.push({ taskId, patch });
        if (patch.assigneeUserId !== undefined) task = makeTask(patch.assigneeUserId);
        return task;
      },
    } as never,
    users: {
      getById: async (id: string) => {
        calls.userLookups.push(id);
        return makeUser(id);
      },
    } as never,
    notifications: {
      create: async (input: CreateNotificationInput) => {
        calls.notifications.push(input);
        return undefined as never;
      },
    } as never,
    email: {
      send: async (message: EmailMessage) => {
        calls.emails.push(message);
      },
    },
    activityRecorder: {
      record: async (input: RecordInput) => {
        calls.activities.push(input);
      },
    } as never,
    idGen: () => 'notification-1',
    appUrl: 'https://projectsflow.test/',
  });

  return { change, calls, initialTask: task };
}

async function flushBackgroundWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test('named project: a viewer can assign a task to another member', async () => {
  const h = makeHarness();

  const result = await h.change.execute(PROJECT_ID, TASK_ID, VIEWER_ID, TARGET_ID);
  await flushBackgroundWork();

  assert.equal(result.assignee.userId, TARGET_ID);
  assert.deepEqual(h.calls.updates, [
    { taskId: TASK_ID, patch: { assigneeUserId: TARGET_ID } },
  ]);
  assert.deepEqual(h.calls.membershipLookups, [
    { projectId: PROJECT_ID, userId: VIEWER_ID },
    { projectId: PROJECT_ID, userId: TARGET_ID },
  ]);
});

test('named project: a viewer can take a task without notifying themself', async () => {
  const h = makeHarness();

  const result = await h.change.execute(PROJECT_ID, TASK_ID, VIEWER_ID, VIEWER_ID);
  await flushBackgroundWork();

  assert.equal(result.assignee.userId, VIEWER_ID);
  assert.equal(h.calls.updates.length, 1);
  assert.deepEqual(h.calls.notifications, []);
  assert.deepEqual(h.calls.emails, []);
  assert.deepEqual(h.calls.userLookups, []);
});

test('named project: the new assignee must be a project member', async () => {
  const h = makeHarness();

  await assert.rejects(
    h.change.execute(PROJECT_ID, TASK_ID, VIEWER_ID, OUTSIDER_ID),
    AssigneeNotProjectMemberError,
  );

  assert.deepEqual(h.calls.updates, []);
  assert.deepEqual(h.calls.notifications, []);
  assert.deepEqual(h.calls.emails, []);
});

test('inbox: the owner can assign a task to a shared user', async () => {
  const h = makeHarness({ isInbox: true });

  const result = await h.change.execute(PROJECT_ID, TASK_ID, OWNER_ID, TARGET_ID);

  assert.equal(result.assignee.userId, TARGET_ID);
  assert.deepEqual(h.calls.sharedLookups, [OWNER_ID]);
  assert.deepEqual(h.calls.updates, [
    { taskId: TASK_ID, patch: { assigneeUserId: TARGET_ID } },
  ]);
});

test('inbox: the current assignee can return the task to the owner', async () => {
  const h = makeHarness({ isInbox: true });

  const result = await h.change.execute(
    PROJECT_ID,
    TASK_ID,
    CURRENT_ASSIGNEE_ID,
    OWNER_ID,
  );

  assert.equal(result.assignee.userId, OWNER_ID);
  assert.deepEqual(h.calls.sharedLookups, []);
  assert.equal(h.calls.updates.length, 1);
});

test('inbox: a user who is neither owner nor current assignee cannot reassign', async () => {
  const h = makeHarness({ isInbox: true });

  await assert.rejects(
    h.change.execute(PROJECT_ID, TASK_ID, OUTSIDER_ID, OWNER_ID),
    ProjectNotFoundError,
  );

  assert.deepEqual(h.calls.sharedLookups, []);
  assert.deepEqual(h.calls.updates, []);
});

test('inbox: a non-owner target must be shared with the inbox owner', async () => {
  const h = makeHarness({ isInbox: true, sharedUserIds: [CURRENT_ASSIGNEE_ID] });

  await assert.rejects(
    h.change.execute(PROJECT_ID, TASK_ID, OWNER_ID, TARGET_ID),
    AssigneeNotSharedMemberError,
  );

  assert.deepEqual(h.calls.sharedLookups, [OWNER_ID]);
  assert.deepEqual(h.calls.updates, []);
});

test('assigning the current assignee is idempotent and has no side effects', async () => {
  const h = makeHarness({ assigneeUserId: TARGET_ID });

  const result = await h.change.execute(PROJECT_ID, TASK_ID, VIEWER_ID, TARGET_ID);
  await flushBackgroundWork();

  assert.strictEqual(result, h.initialTask);
  assert.deepEqual(h.calls.updates, []);
  assert.deepEqual(h.calls.userLookups, []);
  assert.deepEqual(h.calls.notifications, []);
  assert.deepEqual(h.calls.emails, []);
  assert.deepEqual(h.calls.activities, []);
});

test('assigning another user emits one notification, email and activity event', async () => {
  const h = makeHarness();

  await h.change.execute(PROJECT_ID, TASK_ID, VIEWER_ID, TARGET_ID);
  await flushBackgroundWork();

  assert.deepEqual(h.calls.notifications, [
    {
      id: 'notification-1',
      userId: TARGET_ID,
      payload: {
        type: 'task_assignee_changed',
        taskId: TASK_ID,
        projectId: PROJECT_ID,
        projectName: 'Roadmap',
        isInbox: false,
        taskExcerpt: 'Ship the launch plan',
        actorUserId: VIEWER_ID,
        actorDisplayName: 'Vera Viewer',
      },
    },
  ]);
  assert.equal(h.calls.emails.length, 1);
  assert.equal(h.calls.emails[0]?.to, `${TARGET_ID}@example.test`);
  assert.match(h.calls.emails[0]?.text ?? '', /https:\/\/projectsflow\.test\/projects\/project-1/u);
  assert.deepEqual(h.calls.activities, [
    {
      projectId: PROJECT_ID,
      actorUserId: VIEWER_ID,
      kind: 'task_updated',
      payload: {
        taskId: TASK_ID,
        taskExcerpt: 'Ship the launch plan',
        changes: [
          {
            field: 'assignee',
            old: 'Chris Current',
            new: 'Tanya Target',
          },
        ],
      },
    },
  ]);
});

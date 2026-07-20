import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectMembership, ProjectRole } from '../../domain/project/ProjectMembership.js';
import { InsufficientProjectRoleError } from '../../domain/project/errors.js';
import {
  MAX_WORKFLOWS_PER_PROJECT,
  WorkflowLimitError,
  WorkflowRuleInvalidError,
  WorkflowRuleNotFoundError,
  type WorkflowAction,
  type WorkflowRule,
  type WorkflowTrigger,
} from '../../domain/automation/WorkflowRule.js';
import { ManageWorkflows, type ProjectWorkflowRepository } from './ManageWorkflows.js';

const PROJECT_ID = 'project-1';
const EDITOR_ID = 'user-editor';
const VIEWER_ID = 'user-viewer';

function makeProject(): Project {
  return {
    id: PROJECT_ID,
    ownerId: 'owner',
    name: 'Roadmap',
    icon: null,
    status: 'active',
    gitRepoUrl: null,
    kbRepoFullName: null,
    kbKind: 'none',
    financeVisibility: 'owner',
    dispatcherUserId: null,
    multiTaskWorker: false,
    isInbox: false,
    description: null,
    coverUrl: null,
    coverPosition: 50,
    publicSlug: null,
    isPublic: false,
    publicIndexing: false,
    appRepoFullName: null,
    siteSlug: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  } as unknown as Project;
}

export class FakeWorkflowRepo implements ProjectWorkflowRepository {
  rules: WorkflowRule[] = [];
  async listByProject(projectId: string): Promise<readonly WorkflowRule[]> {
    return this.rules.filter((r) => r.projectId === projectId);
  }
  async getById(projectId: string, id: string): Promise<WorkflowRule | null> {
    return this.rules.find((r) => r.projectId === projectId && r.id === id) ?? null;
  }
  async countByProject(projectId: string): Promise<number> {
    return this.rules.filter((r) => r.projectId === projectId).length;
  }
  async insert(rule: WorkflowRule): Promise<void> {
    this.rules.push(rule);
  }
  async update(
    projectId: string,
    id: string,
    patch: {
      name?: string;
      trigger?: WorkflowTrigger;
      action?: WorkflowAction;
      enabled?: boolean;
    },
  ): Promise<WorkflowRule | null> {
    const idx = this.rules.findIndex((r) => r.projectId === projectId && r.id === id);
    if (idx < 0) return null;
    const cur = this.rules[idx]!;
    const next: WorkflowRule = {
      ...cur,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
      ...(patch.action !== undefined ? { action: patch.action } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    };
    this.rules[idx] = next;
    return next;
  }
  async delete(projectId: string, id: string): Promise<boolean> {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => !(r.projectId === projectId && r.id === id));
    return this.rules.length < before;
  }
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const rule = this.rules.find((r) => r.id === id);
    if (rule) this.rules[this.rules.indexOf(rule)] = { ...rule, enabled };
  }
  async recordRun(id: string, status: string, at: string): Promise<void> {
    const rule = this.rules.find((r) => r.id === id);
    if (rule) this.rules[this.rules.indexOf(rule)] = { ...rule, lastStatus: status, lastRunAt: at };
  }
}

function makeHarness(roles: Record<string, ProjectRole>): {
  manage: ManageWorkflows;
  repo: FakeWorkflowRepo;
} {
  const repo = new FakeWorkflowRepo();
  let counter = 0;
  const deps = {
    projects: {
      getById: async (id: string) => (id === PROJECT_ID ? makeProject() : null),
    },
    members: {
      findForProject: async (projectId: string, userId: string): Promise<ProjectMembership | null> => {
        const role = roles[userId];
        if (!role || projectId !== PROJECT_ID) return null;
        return { projectId, userId, role, joinedAt: new Date() };
      },
    },
    workflows: repo,
    idGen: () => `wf-${(counter += 1)}`,
    now: () => new Date('2026-07-20T10:00:00.000Z'),
  } as unknown as ConstructorParameters<typeof ManageWorkflows>[0];
  return { manage: new ManageWorkflows(deps), repo };
}

test('create собирает правило из замкнутых триггера и действия', async () => {
  const { manage, repo } = makeHarness({ [EDITOR_ID]: 'editor' });
  const rule = await manage.create(PROJECT_ID, EDITOR_ID, {
    name: 'Готово → Telegram',
    trigger: { type: 'task_status_changed', status: 'done' },
    action: { type: 'send_telegram', message: 'Задача выполнена' },
  });
  assert.equal(rule.enabled, true);
  assert.deepEqual(rule.trigger, { type: 'task_status_changed', status: 'done' });
  assert.deepEqual(rule.action, { type: 'send_telegram', message: 'Задача выполнена' });
  assert.equal(repo.rules.length, 1);
});

test('create отклоняет триггер/действие вне замкнутого набора', async () => {
  const { manage } = makeHarness({ [EDITOR_ID]: 'editor' });
  await assert.rejects(
    () =>
      manage.create(PROJECT_ID, EDITOR_ID, {
        name: 'x',
        trigger: { type: 'moon_phase' },
        action: { type: 'send_telegram', message: 'hi' },
      }),
    WorkflowRuleInvalidError,
  );
  await assert.rejects(
    () =>
      manage.create(PROJECT_ID, EDITOR_ID, {
        name: 'x',
        trigger: { type: 'task_created' },
        action: { type: 'rm_rf', target: '/' },
      }),
    WorkflowRuleInvalidError,
  );
  // Плохой статус в допустимом триггере.
  await assert.rejects(
    () =>
      manage.create(PROJECT_ID, EDITOR_ID, {
        name: 'x',
        trigger: { type: 'task_status_changed', status: 'nonexistent' },
        action: { type: 'set_priority', priority: 1 },
      }),
    WorkflowRuleInvalidError,
  );
  // Приоритет вне 1..4.
  await assert.rejects(
    () =>
      manage.create(PROJECT_ID, EDITOR_ID, {
        name: 'x',
        trigger: { type: 'task_created' },
        action: { type: 'set_priority', priority: 9 },
      }),
    WorkflowRuleInvalidError,
  );
});

test('create требует роль editor+ (viewer запрещён)', async () => {
  const { manage } = makeHarness({ [VIEWER_ID]: 'viewer' });
  await assert.rejects(
    () =>
      manage.create(PROJECT_ID, VIEWER_ID, {
        name: 'x',
        trigger: { type: 'task_created' },
        action: { type: 'send_telegram', message: 'hi' },
      }),
    InsufficientProjectRoleError,
  );
});

test('create упирается в лимит правил на проект', async () => {
  const { manage, repo } = makeHarness({ [EDITOR_ID]: 'editor' });
  for (let i = 0; i < MAX_WORKFLOWS_PER_PROJECT; i += 1) {
    repo.rules.push({
      id: `seed-${i}`,
      projectId: PROJECT_ID,
      name: `r${i}`,
      trigger: { type: 'task_created' },
      action: { type: 'send_telegram', message: 'x' },
      enabled: true,
      lastStatus: null,
      lastRunAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  }
  await assert.rejects(
    () =>
      manage.create(PROJECT_ID, EDITOR_ID, {
        name: 'over',
        trigger: { type: 'task_created' },
        action: { type: 'send_telegram', message: 'x' },
      }),
    WorkflowLimitError,
  );
});

test('update и remove работают по id, 404 на несуществующем', async () => {
  const { manage } = makeHarness({ [EDITOR_ID]: 'editor' });
  const rule = await manage.create(PROJECT_ID, EDITOR_ID, {
    name: 'r',
    trigger: { type: 'task_created' },
    action: { type: 'send_telegram', message: 'x' },
  });
  const updated = await manage.update(PROJECT_ID, EDITOR_ID, rule.id, { enabled: false });
  assert.equal(updated.enabled, false);
  await manage.remove(PROJECT_ID, EDITOR_ID, rule.id);
  await assert.rejects(
    () => manage.remove(PROJECT_ID, EDITOR_ID, rule.id),
    WorkflowRuleNotFoundError,
  );
});

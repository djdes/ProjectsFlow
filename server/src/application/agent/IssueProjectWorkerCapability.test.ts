import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentToken } from '../../domain/agent/AgentToken.js';
import {
  AgentCapabilityForbiddenError,
  AgentCapabilityTaskMismatchError,
} from '../../domain/agent/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { CreateAgentToken } from './CreateAgentToken.js';
import { IssueProjectWorkerCapability } from './IssueProjectWorkerCapability.js';

const NOW = new Date('2026-07-17T10:00:00.000Z');
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function parent(scopeKind: 'account' | 'project' = 'account'): AgentToken {
  return {
    id: 'parent-token',
    userId: 'dispatcher',
    name: 'dispatcher',
    tokenPrefix: 'pfat_test',
    scopeKind,
    projectId: scopeKind === 'project' ? PROJECT_ID : null,
    taskId: null,
    parentTokenId: null,
    expiresAt: null,
    createdAt: NOW,
    lastUsedAt: null,
    revokedAt: null,
  };
}

function harness(dispatcherUserId = 'dispatcher', taskProjectId = PROJECT_ID) {
  let command: Parameters<CreateAgentToken['execute']>[0] | null = null;
  const projects = {
    getById: async () => ({ id: PROJECT_ID, dispatcherUserId }),
  } as unknown as ProjectRepository;
  const tasks = {
    getById: async () => ({ id: TASK_ID, projectId: taskProjectId }),
  } as unknown as TaskRepository;
  const createToken = {
    execute: async (input: Parameters<CreateAgentToken['execute']>[0]) => {
      command = input;
      return {
        plaintext: 'pfat_child',
        token: {
          ...parent('project'),
          id: 'child-token',
          name: input.name,
          parentTokenId: 'parent-token',
          taskId: TASK_ID,
          expiresAt: input.scope?.expiresAt ?? null,
        },
      };
    },
  } as unknown as CreateAgentToken;
  return {
    command: () => command,
    useCase: new IssueProjectWorkerCapability({ projects, tasks, createToken, now: () => NOW }),
  };
}

test('issues a task-bound child capability for the assigned dispatcher', async () => {
  const h = harness();
  const result = await h.useCase.execute({
    userId: 'dispatcher',
    parentToken: parent(),
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    ttlSeconds: 3600,
  });
  assert.equal(result.plaintext, 'pfat_child');
  assert.equal(result.expiresAt.toISOString(), '2026-07-17T11:00:00.000Z');
  assert.deepEqual(h.command()?.scope, {
    kind: 'project',
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    parentTokenId: 'parent-token',
    expiresAt: new Date('2026-07-17T11:00:00.000Z'),
  });
});

test('rejects recursive issuance from a project capability', async () => {
  const h = harness();
  await assert.rejects(
    h.useCase.execute({
      userId: 'dispatcher',
      parentToken: parent('project'),
      projectId: PROJECT_ID,
      taskId: TASK_ID,
    }),
    AgentCapabilityForbiddenError,
  );
});

test('rejects a project not assigned to the dispatcher', async () => {
  const h = harness('someone-else');
  await assert.rejects(
    h.useCase.execute({
      userId: 'dispatcher',
      parentToken: parent(),
      projectId: PROJECT_ID,
      taskId: TASK_ID,
    }),
    AgentCapabilityForbiddenError,
  );
});

test('rejects a task from another project', async () => {
  const h = harness('dispatcher', 'other-project');
  await assert.rejects(
    h.useCase.execute({
      userId: 'dispatcher',
      parentToken: parent(),
      projectId: PROJECT_ID,
      taskId: TASK_ID,
    }),
    AgentCapabilityTaskMismatchError,
  );
});

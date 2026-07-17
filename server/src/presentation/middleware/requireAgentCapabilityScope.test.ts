import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import type { AgentToken } from '../../domain/agent/AgentToken.js';
import { requireAgentCapabilityScope } from './requireAgentCapabilityScope.js';

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';
const TASK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function token(scopeKind: 'account' | 'project'): AgentToken {
  return {
    id: 'token-id',
    userId: 'user-id',
    name: 'test',
    tokenPrefix: 'pfat_test',
    scopeKind,
    projectId: scopeKind === 'project' ? PROJECT_A : null,
    taskId: scopeKind === 'project' ? TASK_A : null,
    parentTokenId: scopeKind === 'project' ? 'parent-id' : null,
    expiresAt: scopeKind === 'project' ? new Date(Date.now() + 60_000) : null,
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null,
  };
}

function invoke(path: string, agentToken: AgentToken, method = 'GET') {
  let status = 200;
  let payload: unknown = null;
  let nextCalled = false;
  const req = { path, method, agentToken } as Request;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(body: unknown) {
      payload = body;
      return this;
    },
  } as unknown as Response;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  requireAgentCapabilityScope()(req, res, next);
  return { status, payload, nextCalled };
}

test('account token keeps dispatcher API access', () => {
  assert.equal(invoke('/pending-agent-jobs', token('account')).nextCalled, true);
});

test('scope middleware fails closed when authentication metadata is absent', () => {
  const denied = invoke('/projects', undefined as unknown as AgentToken);
  assert.equal(denied.status, 401);
  assert.deepEqual(denied.payload, { error: 'agent_token_required' });
});

test('project capability allows only its project', () => {
  assert.equal(
    invoke(`/projects/${PROJECT_A}/tasks/${TASK_A}`, token('project')).nextCalled,
    true,
  );
  const denied = invoke(`/projects/${PROJECT_B}/tasks/${TASK_A}`, token('project'));
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.payload, { error: 'agent_project_scope_violation' });
});

test('task-bound capability cannot address a different task', () => {
  const denied = invoke(`/projects/${PROJECT_A}/tasks/${TASK_B}`, token('project'));
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.payload, { error: 'agent_task_scope_violation' });
});

test('project capability cannot access global queues or project discovery', () => {
  assert.equal(invoke('/pending-agent-jobs', token('project')).status, 403);
  assert.equal(invoke('/projects', token('project')).status, 403);
  assert.equal(invoke('/projects/%E0%A4%A/tasks', token('project')).status, 403);
});

test('project capability may read the explicitly shared account profile', () => {
  assert.equal(invoke('/me', token('project')).nextCalled, true);
  assert.equal(invoke('/me', token('project'), 'POST').status, 403);
});

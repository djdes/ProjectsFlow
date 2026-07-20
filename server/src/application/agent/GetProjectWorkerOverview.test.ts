import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentToken } from '../../domain/agent/AgentToken.js';
import type { LiveSession } from '../../domain/live/LiveSession.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { GetProjectWorkerOverview } from './GetProjectWorkerOverview.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function session(over: Partial<LiveSession> = {}): LiveSession {
  return {
    id: 'sess-1',
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    agentName: 'ralph-worker',
    attempt: 1,
    status: 'completed',
    model: 'claude',
    billedUserId: 'creator',
    headBefore: null,
    headAfter: null,
    costUsd: 0.42,
    tokensIn: 100,
    tokensOut: 200,
    baseSeq: 1,
    lastSeq: 5,
    eventCount: 5,
    startedAt: new Date('2026-07-19T10:00:00.000Z'),
    endedAt: new Date('2026-07-19T10:05:00.000Z'),
    ...over,
  };
}

function capability(over: Partial<AgentToken> = {}): AgentToken {
  return {
    id: 'cap-1',
    userId: 'dispatcher',
    name: 'worker:1111',
    tokenPrefix: 'pfat_x',
    scopeKind: 'project',
    projectId: PROJECT_ID,
    taskId: null,
    parentTokenId: 'parent',
    expiresAt: null,
    createdAt: new Date('2026-07-19T09:00:00.000Z'),
    lastUsedAt: null,
    revokedAt: null,
    ...over,
  };
}

type Overrides = {
  role?: 'owner' | 'editor' | 'viewer' | null;
  sessions?: LiveSession[];
  running?: number;
  caps?: AgentToken[];
  dispatcherUserId?: string | null;
  multiTaskWorker?: boolean;
};

function harness(o: Overrides = {}) {
  const projects = {
    getById: async () => ({
      id: PROJECT_ID,
      dispatcherUserId: o.dispatcherUserId ?? 'dispatcher',
      multiTaskWorker: o.multiTaskWorker ?? true,
    }),
  } as unknown as ProjectRepository;
  const members = {
    findForProject: async () =>
      o.role === null ? null : { projectId: PROJECT_ID, userId: 'u', role: o.role ?? 'viewer', joinedAt: new Date() },
  } as unknown as ProjectMemberRepository;
  const agentTokens = {
    listActiveProjectCapabilities: async () => o.caps ?? [],
  } as unknown as import('./AgentTokenRepository.js').AgentTokenRepository;
  const live = {
    listRecentProjectSessions: async () => o.sessions ?? [],
    countRunningProjectSessions: async () => o.running ?? 0,
  };
  return new GetProjectWorkerOverview({ projects, members, agentTokens, live });
}

test('returns dispatcher/parallel flags, running count and recent runs', async () => {
  const useCase = harness({
    sessions: [session(), session({ id: 'sess-2', status: 'running', endedAt: null })],
    running: 1,
    dispatcherUserId: 'dispatcher',
    multiTaskWorker: true,
  });
  const out = await useCase.execute(PROJECT_ID, 'u');
  assert.equal(out.dispatcherUserId, 'dispatcher');
  assert.equal(out.multiTaskWorker, true);
  assert.equal(out.runningCount, 1);
  assert.equal(out.recentRuns.length, 2);
  assert.equal(out.recentRuns[0]?.startedAt, '2026-07-19T10:00:00.000Z');
  assert.equal(out.recentRuns[0]?.costUsd, 0.42);
});

test('does not leak billedUserId into run projection', async () => {
  const useCase = harness({ sessions: [session()] });
  const out = await useCase.execute(PROJECT_ID, 'u');
  assert.ok(!('billedUserId' in (out.recentRuns[0] as object)));
});

test('summarizes capabilities: counts, task/project split, nearest expiry', async () => {
  const useCase = harness({
    caps: [
      capability({ id: 'c1', taskId: TASK_ID, expiresAt: new Date('2026-07-20T12:00:00.000Z') }),
      capability({ id: 'c2', taskId: null, expiresAt: new Date('2026-07-20T08:00:00.000Z') }),
      capability({ id: 'c3', taskId: null, expiresAt: null }),
    ],
  });
  const out = await useCase.execute(PROJECT_ID, 'u');
  assert.equal(out.capabilities.active, 3);
  assert.equal(out.capabilities.taskScoped, 1);
  assert.equal(out.capabilities.projectScoped, 2);
  assert.equal(out.capabilities.nextExpiryAt, '2026-07-20T08:00:00.000Z');
});

test('rejects a non-member (ProjectNotFoundError from access gate)', async () => {
  const useCase = harness({ role: null });
  await assert.rejects(useCase.execute(PROJECT_ID, 'stranger'));
});

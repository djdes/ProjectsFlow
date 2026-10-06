import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monitoringAnalysisServerQueue } from './monitoringAnalysisServerQueue.js';
import { ClaimMonitoringAnalysisJob } from './ClaimMonitoringAnalysisJob.js';
import { ListPendingMonitoringAnalysisJobs } from './ListPendingMonitoringAnalysisJobs.js';
import { EnqueueMonitoringAnalysisJob } from './EnqueueMonitoringAnalysisJob.js';
import type {
  MonitoringAnalysisJobRepository,
  NewMonitoringAnalysisJobInput,
  QueuedMonitoringAnalysisJob,
} from './MonitoringAnalysisJobRepository.js';
import type { MonitoringAnalysisJob } from '../../domain/monitoring-analysis/MonitoringAnalysisJob.js';
import { MonitoringAnalysisProjectHasNoDispatcherError } from '../../domain/monitoring-analysis/errors.js';
import type { CheckBudget } from '../usage/CheckBudget.js';

const T0 = new Date('2026-10-06T10:00:00Z').getTime();

function job(id: string, overrides: Partial<MonitoringAnalysisJob> = {}): MonitoringAnalysisJob {
  const createdAt = new Date(T0 + Number(id.replace(/\D/g, '') || 0) * 1000);
  return {
    id,
    createdBy: 'user-1',
    projectId: 'p1',
    serverId: 's1',
    dispatcherUserId: 'disp-1',
    status: 'queued',
    analysisType: 'snapshot',
    alertId: null,
    context: 'ctx',
    note: null,
    resultMarkdown: null,
    error: null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    claimedAt: null,
    finishedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

// In-memory репозиторий: ровно то, что трогают claim-путь и листинги.
class FakeJobs {
  readonly jobs = new Map<string, MonitoringAnalysisJob>();
  readonly created: NewMonitoringAnalysisJobInput[] = [];

  constructor(initial: MonitoringAnalysisJob[] = []) {
    for (const j of initial) this.jobs.set(j.id, j);
  }

  async findById(id: string): Promise<MonitoringAnalysisJob | null> {
    return this.jobs.get(id) ?? null;
  }

  async listQueued(limit: number): Promise<QueuedMonitoringAnalysisJob[]> {
    return [...this.jobs.values()]
      .filter((j) => j.status === 'queued')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map((j) => ({ id: j.id, dispatcherUserId: j.dispatcherUserId }));
  }

  async claimById(id: string): Promise<MonitoringAnalysisJob | null> {
    const j = this.jobs.get(id);
    if (!j || j.status !== 'queued') return null;
    const claimed: MonitoringAnalysisJob = { ...j, status: 'running', claimedAt: new Date() };
    this.jobs.set(id, claimed);
    return claimed;
  }

  async existsForAlert(): Promise<boolean> {
    return false;
  }

  async create(input: NewMonitoringAnalysisJobInput): Promise<MonitoringAnalysisJob> {
    this.created.push(input);
    return job('new', { ...input, status: 'queued' });
  }

  asRepo(): MonitoringAnalysisJobRepository {
    return this as unknown as MonitoringAnalysisJobRepository;
  }
}

// Гейт тарифа: пользователи из `free` — на free-тарифе (claim запрещён), остальные — prime.
function budget(free: ReadonlySet<string>, checked: string[]): CheckBudget {
  return {
    execute: async (userId: string) => {
      checked.push(userId);
      return { allowed: true, summary: { isAdmin: false, plan: free.has(userId) ? 'free' : 'prime' } };
    },
  } as unknown as CheckBudget;
}

function setupQueue(initial: MonitoringAnalysisJob[], free: ReadonlySet<string> = new Set()) {
  const repo = new FakeJobs(initial);
  const checked: string[] = [];
  const ran: MonitoringAnalysisJob[] = [];
  let now = T0;
  const adapter = monitoringAnalysisServerQueue({
    monitoringAnalysisJobs: repo,
    claim: new ClaimMonitoringAnalysisJob({ monitoringAnalysisJobs: repo.asRepo(), checkBudget: budget(free, checked) }),
    run: { execute: async (j) => void ran.push(j) },
    now: () => now,
  });
  return {
    repo,
    checked,
    ran,
    adapter,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function runAll(tasks: ReadonlyArray<() => Promise<void>>): Promise<void> {
  for (const task of tasks) await task();
}

test('claim: забирает queued job\'ы всех диспетчеров через use-case и отдаёт исполнителей', async () => {
  const { repo, checked, ran, adapter } = setupQueue([
    job('j1', { dispatcherUserId: 'disp-1', createdBy: 'user-1' }),
    job('j2', { dispatcherUserId: 'disp-2', createdBy: 'user-2' }),
    job('j3', { status: 'succeeded' }),
  ]);
  assert.equal(adapter.queue, 'monitoring');

  const tasks = await adapter.claim(5);
  assert.equal(tasks.length, 2);
  assert.equal(repo.jobs.get('j1')!.status, 'running');
  assert.equal(repo.jobs.get('j2')!.status, 'running');
  // Гейт — по инициатору (createdBy), как у POST .../claim диспетчера.
  assert.deepEqual(checked, ['user-1', 'user-2']);

  await runAll(tasks);
  assert.deepEqual(
    ran.map((j) => [j.id, j.status]),
    [
      ['j1', 'running'],
      ['j2', 'running'],
    ],
  );
});

test('claim: не больше limit заданий за раз, старые — первыми', async () => {
  const { repo, adapter } = setupQueue([job('j3'), job('j1'), job('j2')]);
  const tasks = await adapter.claim(2);
  assert.equal(tasks.length, 2);
  assert.equal(repo.jobs.get('j1')!.status, 'running');
  assert.equal(repo.jobs.get('j2')!.status, 'running');
  assert.equal(repo.jobs.get('j3')!.status, 'queued');
});

test('claim: отказ гейта тарифа — job остаётся queued, не загораживает очередь и перепроверяется раз в 10 с', async () => {
  const { repo, checked, adapter, advance } = setupQueue(
    [job('j1', { createdBy: 'free-user' }), job('j2', { createdBy: 'user-2' })],
    new Set(['free-user']),
  );

  const first = await adapter.claim(1);
  assert.equal(first.length, 1);
  assert.equal(repo.jobs.get('j1')!.status, 'queued');
  assert.equal(repo.jobs.get('j2')!.status, 'running');
  assert.deepEqual(checked, ['free-user', 'user-2']);

  // Следующий тик раннера: отложенный j1 пропускается без пересчёта бюджета, j3 забирается.
  repo.jobs.set('j3', job('j3', { createdBy: 'user-3' }));
  advance(1_500);
  const second = await adapter.claim(1);
  assert.equal(second.length, 1);
  assert.equal(repo.jobs.get('j3')!.status, 'running');
  assert.deepEqual(checked, ['free-user', 'user-2', 'user-3']);

  // Через 10 с отложенный job проверяется снова (тариф мог смениться) — гейт всё ещё против.
  advance(10_000);
  const third = await adapter.claim(1);
  assert.equal(third.length, 0);
  assert.equal(repo.jobs.get('j1')!.status, 'queued');
  assert.deepEqual(checked, ['free-user', 'user-2', 'user-3', 'free-user']);
});

test('claim: job, который успел забрать диспетчер, пропускается', async () => {
  const { repo, adapter } = setupQueue([job('j1'), job('j2')]);
  // Гонка: листинг ещё видит j1 queued, но к claim'у его уже забрал диспетчер.
  const listQueued = repo.listQueued.bind(repo);
  repo.listQueued = async (limit) => {
    const queued = await listQueued(limit);
    repo.jobs.set('j1', { ...repo.jobs.get('j1')!, status: 'running' });
    return queued;
  };
  const tasks = await adapter.claim(5);
  assert.equal(tasks.length, 1);
  assert.equal(repo.jobs.get('j2')!.status, 'running');
});

test('claim: сбой БД не теряет уже забранные job\'ы, а без них уходит раннеру', async () => {
  const repo = new FakeJobs([job('j1'), job('j2')]);
  let calls = 0;
  const failOn = (n: number) =>
    monitoringAnalysisServerQueue({
      monitoringAnalysisJobs: repo,
      claim: {
        execute: async ({ jobId }) => {
          calls += 1;
          if (calls === n) throw new Error('db down');
          return job(jobId, { status: 'running' });
        },
      },
      run: { execute: async () => {} },
    });

  calls = 0;
  assert.equal((await failOn(2).claim(5)).length, 1);
  calls = 0;
  await assert.rejects(failOn(1).claim(5), /db down/);
});

test('листинг диспетчера пуст, пока очередь исполняет сервер; сбой проверки — прежнее поведение', async () => {
  const repo = new FakeJobs();
  let listed = 0;
  const repoWithPending = Object.assign(repo, {
    listPendingForDispatcher: async () => {
      listed += 1;
      return [];
    },
  }).asRepo();

  await new ListPendingMonitoringAnalysisJobs({
    monitoringAnalysisJobs: repoWithPending,
    serverHandles: async () => true,
  }).execute({ userId: 'disp-1' });
  assert.equal(listed, 0);

  await new ListPendingMonitoringAnalysisJobs({
    monitoringAnalysisJobs: repoWithPending,
    serverHandles: async () => false,
  }).execute({ userId: 'disp-1' });
  await new ListPendingMonitoringAnalysisJobs({
    monitoringAnalysisJobs: repoWithPending,
    serverHandles: async () => {
      throw new Error('settings unavailable');
    },
  }).execute({ userId: 'disp-1' });
  await new ListPendingMonitoringAnalysisJobs({ monitoringAnalysisJobs: repoWithPending }).execute({
    userId: 'disp-1',
  });
  assert.equal(listed, 3);
});

function enqueueSetup(dispatcherUserId: string | null, serverHandles?: () => Promise<boolean>) {
  const repo = new FakeJobs();
  const partial = {
    projects: {
      getById: async () => ({ id: 'p1', name: 'Сайт', ownerId: 'owner-1', dispatcherUserId }),
    },
    members: {
      findForProject: async () => ({ projectId: 'p1', userId: 'u1', role: 'owner', joinedAt: new Date(0) }),
    },
    servers: {
      getById: async () => ({ id: 's1', projectId: 'p1', name: 'web', kind: 'vps', host: null, healthUrl: null }),
    },
    snapshots: { getLatest: async () => null, getHistory: async () => [] },
    alerts: { listActiveByProject: async () => [] },
    monitoringAnalysisJobs: repo,
    rateLimiter: { hit: () => true },
    serverHandles,
  };
  const enqueue = new EnqueueMonitoringAnalysisJob(
    partial as unknown as ConstructorParameters<typeof EnqueueMonitoringAnalysisJob>[0],
  );
  return { enqueue, created: repo.created };
}

test('enqueue без диспетчера: при серверном исполнении job записывается на инициатора, иначе 503', async () => {
  const input = { userId: 'u1', projectId: 'p1', serverId: 's1' };

  const served = enqueueSetup(null, async () => true);
  await served.enqueue.execute(input);
  assert.equal(served.created[0]!.dispatcherUserId, 'u1');
  assert.equal(served.created[0]!.createdBy, 'u1');

  await assert.rejects(enqueueSetup(null, async () => false).enqueue.execute(input), MonitoringAnalysisProjectHasNoDispatcherError);
  await assert.rejects(enqueueSetup(null).enqueue.execute(input), MonitoringAnalysisProjectHasNoDispatcherError);

  // Назначенный диспетчер по-прежнему важнее.
  const assigned = enqueueSetup('disp-1', async () => true);
  await assigned.enqueue.execute(input);
  assert.equal(assigned.created[0]!.dispatcherUserId, 'disp-1');
});

test('авто-анализ алерта без диспетчера: при серверном исполнении — на владельца, иначе пропуск', async () => {
  const input = { projectId: 'p1', serverId: 's1', alertId: 'a1' };

  const served = enqueueSetup(null, async () => true);
  assert.ok(await served.enqueue.enqueueAuto(input));
  assert.equal(served.created[0]!.dispatcherUserId, 'owner-1');
  assert.equal(served.created[0]!.createdBy, 'owner-1');

  const skipped = enqueueSetup(null, async () => false);
  assert.equal(await skipped.enqueue.enqueueAuto(input), null);
  assert.equal(skipped.created.length, 0);
});

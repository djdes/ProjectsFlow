import test from 'node:test';
import assert from 'node:assert/strict';
import { CompleteCommitSyncJob } from './CompleteCommitSyncJob.js';

// Проверяем главное изменение: в режиме auto совпадение коммит↔задача переносит задачу в done
// СРАЗУ, без учёта возраста коммита. Раньше свежий коммит уводил задачу в in_progress, из-за
// чего задачи, закрытые в тот же день, «зависали» в работе.

type Updated = { id: string; status: string; statusBeforeDone?: string | null };

function buildJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job1',
    projectId: 'p1',
    dispatcherUserId: 'disp',
    createdBy: 'owner',
    action: 'auto',
    status: 'running',
    thresholdHours: 70,
    // Коммит «минуту назад» — при старом пороге 70ч он бы дал in_progress, а не done.
    commitsJson: JSON.stringify({
      abc123: {
        committedAt: new Date(Date.now() - 60_000).toISOString(),
        message: 'feat: сделал экспорт',
        htmlUrl: 'https://github.com/x/y/commit/abc123',
        authorName: 'Dev',
        authorLogin: 'dev',
      },
    }),
    ...overrides,
  };
}

function harness(job: ReturnType<typeof buildJob>, task: { id: string; projectId: string; status: string }) {
  const updated: Updated[] = [];
  let completed: { status: string; summary: string | null } | null = null;
  const svc = new CompleteCommitSyncJob({
    commitSyncJobs: {
      async findById() { return job as never; },
      async complete(input: { status: string; resultSummary: string | null }) {
        completed = { status: input.status, summary: input.resultSummary };
      },
    } as never,
    tasks: {
      async getById(id: string) { return id === task.id ? (task as never) : null; },
      async update(id: string, patch: { status: string; statusBeforeDone?: string | null }) {
        updated.push({ id, status: patch.status, statusBeforeDone: patch.statusBeforeDone ?? null });
        return {} as never;
      },
    } as never,
  });
  return { svc, updated, getCompleted: () => completed };
}

test('auto: свежий коммит-совпадение → задача сразу в done (порог игнорируется)', async () => {
  const job = buildJob();
  const task = { id: 't1', projectId: 'p1', status: 'todo' };
  const h = harness(job, task);

  await h.svc.execute({
    userId: 'disp',
    jobId: 'job1',
    ok: true,
    matches: [{ taskId: 't1', commitSha: 'abc123', reason: 'реализует экспорт' }],
    error: null,
  });

  assert.equal(h.updated.length, 1);
  assert.equal(h.updated[0]!.status, 'done');
  assert.equal(h.updated[0]!.statusBeforeDone, 'todo'); // снимок для «вернуть из готово»
  assert.equal(h.getCompleted()!.status, 'succeeded');
  assert.ok(/в готово — 1/.test(h.getCompleted()!.summary ?? ''));
});

test('auto: коммита нет в снапшоте прогона → задачу не трогаем', async () => {
  const job = buildJob();
  const task = { id: 't1', projectId: 'p1', status: 'todo' };
  const h = harness(job, task);

  await h.svc.execute({
    userId: 'disp',
    jobId: 'job1',
    ok: true,
    // sha, которого нет в commitsJson — защита от галлюцинации модели.
    matches: [{ taskId: 't1', commitSha: 'ZZZ', reason: 'выдумано' }],
    error: null,
  });

  assert.equal(h.updated.length, 0);
  assert.ok(/Пропущено — 1/.test(h.getCompleted()!.summary ?? ''));
});

test('auto: уже закрытую задачу повторный прогон не двигает (идемпотентность)', async () => {
  const job = buildJob();
  const task = { id: 't1', projectId: 'p1', status: 'done' };
  const h = harness(job, task);

  await h.svc.execute({
    userId: 'disp',
    jobId: 'job1',
    ok: true,
    matches: [{ taskId: 't1', commitSha: 'abc123', reason: 'реализует' }],
    error: null,
  });

  assert.equal(h.updated.length, 0);
});

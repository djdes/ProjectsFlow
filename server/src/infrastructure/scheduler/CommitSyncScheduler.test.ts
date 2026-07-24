import test from 'node:test';
import assert from 'node:assert/strict';
import { CommitSyncScheduler, commitSyncBatchKey } from './CommitSyncScheduler.js';

// Планировщик читает МSK-время из системных часов, поэтому mskNow() не подменить. Здесь проверяем
// ЧИСТУЮ логику отбора, вызывая tick и управляя тем, что вернёт listCommitSyncEnabled: если проект
// «должен был вчера» (lastRunOn в прошлом) и сегодня его день — он ставится; в чужой день — нет.
// Время берём реальное, поэтому час/минуту не проверяем (schedMin=0 всегда прошёл), фокус на дне
// недели и дедупе.

function mskDayToday(): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const [y, m, d] = `${get('year')}-${get('month')}-${get('day')}`.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d!)).getUTCDay();
}

function harness(days: number[]) {
  const enqueued: string[] = [];
  const marked: string[] = [];
  const scheduler = new CommitSyncScheduler({
    automation: {
      async listCommitSyncEnabled() {
        return [{ projectId: 'p1', hour: 0, minute: 0, daysOfWeek: days, lastRunOn: null }];
      },
      async markCommitSyncRun(projectId: string) {
        marked.push(projectId);
      },
    } as never,
    enqueue: {
      async execute(projectId: string) {
        enqueued.push(projectId);
        return { id: 'job1' } as never;
      },
    } as never,
    projects: { async getWorkspaceId() { return null; } } as never,
    settings: { async get() { return { telegramGroupChatId: null }; } } as never,
  });
  return { scheduler, enqueued, marked };
}

test('в разрешённый день сверка ставится (час 00:00 уже прошёл)', async () => {
  const today = mskDayToday();
  const h = harness([today]);
  await h.scheduler.tick();
  assert.deepEqual(h.enqueued, ['p1']);
  assert.deepEqual(h.marked, ['p1']); // дата помечена, чтобы не ретраить каждую минуту
});

test('в НЕ разрешённый день недели сверка не ставится', async () => {
  const today = mskDayToday();
  const other = (today + 1) % 7;
  const h = harness([other]);
  await h.scheduler.tick();
  assert.deepEqual(h.enqueued, []);
  assert.deepEqual(h.marked, []); // не тот день — даже дату не трогаем
});

test('пустой список дней = сверка не запускается', async () => {
  const h = harness([]);
  await h.scheduler.tick();
  assert.deepEqual(h.enqueued, []);
});

// (б) Разное время сверки → разные ключи батча → разные сообщения.
test('batch key separates projects by exact scheduled minute', () => {
  const a = commitSyncBatchKey(-100, '2026-07-24', 17, 0);
  const b = commitSyncBatchKey(-100, '2026-07-24', 17, 1);
  const c = commitSyncBatchKey(-100, '2026-07-24', 17, 0);
  assert.equal(a, '-100:2026-07-24:17:00');
  assert.notEqual(a, b); // 17:00 vs 17:01 — разные батчи
  assert.equal(a, c); // оба 17:00 — один батч
});

test('batch key separates projects by group chat', () => {
  assert.notEqual(
    commitSyncBatchKey(-100, '2026-07-24', 17, 0),
    commitSyncBatchKey(-200, '2026-07-24', 17, 0),
  );
});

// Тик группирует проекты одного пространства+времени под общим ключом, а другое пространство
// (другая группа) — под своим. Расписание в 00:00 всегда «наступило», поэтому тест детерминирован.
test('scheduler tags one tick with a shared batch key per group', async () => {
  const enqueued: Array<{ projectId: string; batchKey: string | null }> = [];
  const workspaceByProject: Record<string, string> = { p1: 'w1', p2: 'w1', p3: 'w2' };
  const chatByWorkspace: Record<string, number> = { w1: -100, w2: -200 };
  const everyDay = [0, 1, 2, 3, 4, 5, 6];

  const scheduler = new CommitSyncScheduler({
    automation: {
      async listCommitSyncEnabled() {
        return [
          { projectId: 'p1', hour: 0, minute: 0, daysOfWeek: everyDay, lastRunOn: null },
          { projectId: 'p2', hour: 0, minute: 0, daysOfWeek: everyDay, lastRunOn: null },
          { projectId: 'p3', hour: 0, minute: 0, daysOfWeek: everyDay, lastRunOn: null },
        ];
      },
      async markCommitSyncRun() {},
    } as never,
    enqueue: {
      async execute(projectId: string, _now: Date, opts: { batchKey?: string | null }) {
        enqueued.push({ projectId, batchKey: opts.batchKey ?? null });
        return null;
      },
    } as never,
    projects: {
      async getWorkspaceId(projectId: string) {
        return workspaceByProject[projectId] ?? null;
      },
    } as never,
    settings: {
      async get(workspaceId: string) {
        return { telegramGroupChatId: chatByWorkspace[workspaceId] ?? null };
      },
    } as never,
  });

  await scheduler.tick();

  const byProject = new Map(enqueued.map((e) => [e.projectId, e.batchKey] as const));
  // p1 и p2 (одно пространство, одно время) — один ключ; p3 (другая группа) — другой.
  assert.equal(byProject.get('p1'), byProject.get('p2'));
  assert.notEqual(byProject.get('p1'), byProject.get('p3'));
  assert.match(byProject.get('p1')!, /^-100:.*:00:00$/);
  assert.match(byProject.get('p3')!, /^-200:.*:00:00$/);
});

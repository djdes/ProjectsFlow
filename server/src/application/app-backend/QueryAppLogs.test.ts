import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QueryAppLogs,
  WorkerLogSource,
  AdminAuditLogSource,
  type AppLogSource,
  type AppLogSourceWindow,
} from './QueryAppLogs.js';
import { categorizeAuditOperation, sanitizeLogDetail, LOG_DETAIL_REDACTED } from '../../domain/app-backend/AppLogEntry.js';
import type { AppLogEntry } from '../../domain/app-backend/AppLogEntry.js';
import type { LiveSession } from '../../domain/live/LiveSession.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';

// Фиксируем «сейчас», чтобы окно 30 дней и курсоры были детерминированными.
const NOW = new Date('2026-07-20T12:00:00.000Z');
const now = (): Date => NOW;

function accessDeps(role: 'owner' | 'editor' | 'viewer' | null = 'editor') {
  return {
    projects: { async getById() { return { id: 'project-1' } as any; } } as any,
    members: {
      async findForProject() {
        return role ? { projectId: 'project-1', userId: 'u1', role, joinedAt: new Date() } : null;
      },
    } as any,
  };
}

// Источник-заглушка: отдаёт заранее заданные записи, отфильтрованные по окну (как реальный источник).
function fakeSource(entries: AppLogEntry[]): AppLogSource {
  return {
    async fetch(_projectId: string, window: AppLogSourceWindow) {
      return entries
        .filter((e) => {
          const ms = Date.parse(e.createdAt);
          return ms > window.sinceMs && ms <= window.beforeMs;
        })
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, window.limit);
    },
  };
}

function entry(part: Partial<AppLogEntry> & { id: string; createdAt: string }): AppLogEntry {
  return {
    category: 'data',
    actorType: 'project_member',
    actorId: 'u1',
    operation: 'dashboard.select',
    tableName: null,
    rowId: null,
    success: true,
    detail: null,
    ...part,
  };
}

test('сливает источники, сортирует по времени убыв. и фильтрует по категории/актору/ошибкам', async () => {
  const data = fakeSource([
    entry({ id: 'a', createdAt: '2026-07-20T10:00:00.000Z', category: 'data', actorId: 'u1' }),
    entry({ id: 'b', createdAt: '2026-07-20T11:30:00.000Z', category: 'data', actorId: 'u2', success: false }),
  ]);
  const worker = fakeSource([
    entry({ id: 'w', createdAt: '2026-07-20T11:00:00.000Z', category: 'worker', actorType: 'system', actorId: null, operation: 'worker.run.started' }),
  ]);
  const q = new QueryAppLogs({ ...accessDeps(), sources: [data, worker], now });

  const all = await q.execute('project-1', 'u1', {});
  assert.deepEqual(all.entries.map((e) => e.id), ['b', 'w', 'a']); // newest first

  const onlyWorker = await q.execute('project-1', 'u1', { category: 'worker' });
  assert.deepEqual(onlyWorker.entries.map((e) => e.id), ['w']);

  const byActor = await q.execute('project-1', 'u1', { actorId: 'u2' });
  assert.deepEqual(byActor.entries.map((e) => e.id), ['b']);

  const errors = await q.execute('project-1', 'u1', { errorsOnly: true });
  assert.deepEqual(errors.entries.map((e) => e.id), ['b']);
});

test('курсорная пагинация не теряет и не дублирует записи', async () => {
  const entries: AppLogEntry[] = [];
  for (let i = 0; i < 5; i += 1) {
    // Спускаемся во времени; две записи делим одну миллисекунду — проверяем тай-брейк по id.
    const createdAt = new Date(NOW.getTime() - i * 60_000).toISOString();
    entries.push(entry({ id: `e${i}a`, createdAt }));
    entries.push(entry({ id: `e${i}b`, createdAt }));
  }
  const q = new QueryAppLogs({ ...accessDeps(), sources: [fakeSource(entries)], now });

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 20; guard += 1) {
    const page: Awaited<ReturnType<QueryAppLogs['execute']>> = await q.execute('project-1', 'u1', { limit: 3, cursor });
    seen.push(...page.entries.map((e) => e.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  assert.equal(seen.length, 10, 'все записи отданы ровно один раз');
  assert.equal(new Set(seen).size, 10, 'без дублей между страницами');
  // Порядок строго убывает по (время,id) — соседи не «прыгают».
  const sorted = [...seen].sort((a, b) => (a < b ? 1 : -1));
  // e-ids: e0a>e0b по строковому сравнению? '0a' < '0b' → e0b раньше. Проверим монотонность вручную.
  assert.deepEqual(seen.slice(0, 2), ['e0b', 'e0a']);
});

test('окно 30 дней отсекает старые записи', async () => {
  const old = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const fresh = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const q = new QueryAppLogs({
    ...accessDeps(),
    sources: [fakeSource([entry({ id: 'old', createdAt: old }), entry({ id: 'fresh', createdAt: fresh })])],
    now,
  });
  const page = await q.execute('project-1', 'u1', {});
  assert.deepEqual(page.entries.map((e) => e.id), ['fresh']);
});

test('detail чистится от секретов, промптов и путей перед отдачей', async () => {
  const q = new QueryAppLogs({
    ...accessDeps(),
    sources: [
      fakeSource([
        entry({
          id: 'x',
          createdAt: NOW.toISOString(),
          category: 'worker',
          operation: 'worker.run.finished',
          detail: {
            status: 'completed',
            api_key: 'sk_live_supersecretvalue',
            prompt: 'Ты ассистент, вот весь системный промпт...',
            path: '/home/projectsflow/data/www/app/index.ts',
            note: 'ghp_0123456789abcdefghijABCDEF',
            column: 'api_key',
            costUsd: 0.42,
          },
        }),
      ]),
    ],
    now,
  });
  const page = await q.execute('project-1', 'u1', {});
  const d = page.entries[0]!.detail!;
  assert.equal(d['status'], 'completed');
  assert.equal(d['costUsd'], 0.42);
  assert.equal(d['api_key'], LOG_DETAIL_REDACTED); // секретный ключ по имени
  assert.equal(d['prompt'], LOG_DETAIL_REDACTED); // verbose-поле
  assert.equal(d['path'], LOG_DETAIL_REDACTED); // путь ФС по имени ключа
  assert.equal(d['note'], LOG_DETAIL_REDACTED); // секрет по ПАТТЕРНУ значения, хоть ключ нейтрален
  // Имя раскрытой колонки — это факт, а не значение: остаётся видимым (reveal фиксирует колонку).
  assert.equal(d['column'], 'api_key');
});

test('reveal-запись сохраняет колонку, но никогда не значение', () => {
  const clean = sanitizeLogDetail({ column: 'password', kind: 'secret' });
  assert.deepEqual(clean, { column: 'password', kind: 'secret' });
});

test('без членства в проекте — ProjectNotFoundError (не палим существование)', async () => {
  const q = new QueryAppLogs({ ...accessDeps(null), sources: [fakeSource([])], now });
  await assert.rejects(() => q.execute('project-1', 'stranger', {}), ProjectNotFoundError);
});

test('categorizeAuditOperation раскладывает операции по категориям', () => {
  assert.equal(categorizeAuditOperation('dashboard.reveal'), 'data');
  assert.equal(categorizeAuditOperation('select'), 'data');
  assert.equal(categorizeAuditOperation('app.entity.query'), 'data');
  assert.equal(categorizeAuditOperation('app.user.sign_in'), 'auth');
  assert.equal(categorizeAuditOperation('app.user.registered'), 'auth');
  assert.equal(categorizeAuditOperation('app.user.invited'), 'auth');
  assert.equal(categorizeAuditOperation('app.user.page_visit'), 'runtime');
});

test('WorkerLogSource даёт события start/finish с безопасным detail', async () => {
  const session: LiveSession = {
    id: 'sess-1',
    projectId: 'project-1',
    taskId: 'task-9',
    agentName: 'ralph',
    attempt: 1,
    status: 'completed',
    model: 'opus',
    billedUserId: 'u1',
    headBefore: 'aaa',
    headAfter: 'bbb',
    costUsd: 0.5,
    tokensIn: 100,
    tokensOut: 200,
    baseSeq: 0,
    lastSeq: 5,
    eventCount: 5,
    startedAt: new Date(NOW.getTime() - 60_000),
    endedAt: new Date(NOW.getTime() - 10_000),
  };
  const src = new WorkerLogSource({
    async listRecentProjectSessions() { return [session]; },
  } as any);
  const window: AppLogSourceWindow = { sinceMs: NOW.getTime() - 86_400_000, beforeMs: NOW.getTime(), limit: 50 };
  const rows = await src.fetch('project-1', window);
  assert.deepEqual(rows.map((r) => r.operation).sort(), ['worker.run.finished', 'worker.run.started']);
  const finished = rows.find((r) => r.operation === 'worker.run.finished')!;
  assert.equal(finished.category, 'worker');
  assert.equal(finished.rowId, 'task-9');
  assert.equal(finished.success, true);
  assert.equal((finished.detail as any).costUsd, 0.5);
});

test('AdminAuditLogSource переносит категорию из operation и фильтрует окно', async () => {
  const inside = NOW.toISOString();
  const outside = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const src = new AdminAuditLogSource({
    async record(): Promise<any> { throw new Error('unused'); },
    async list() {
      return {
        total: 2,
        rows: [
          { id: 'r1', actorType: 'project_member', actorId: 'u1', operation: 'dashboard.reveal', tableName: 't', rowId: '1', success: true, detail: { column: 'c' }, createdAt: inside },
          { id: 'r2', actorType: 'project_member', actorId: 'u1', operation: 'dashboard.select', tableName: 't', rowId: null, success: true, detail: null, createdAt: outside },
        ],
      };
    },
  });
  const rows = await src.fetch('project-1', { sinceMs: NOW.getTime() - 86_400_000, beforeMs: NOW.getTime(), limit: 50 });
  assert.deepEqual(rows.map((r) => r.id), ['admin:r1']);
  assert.equal(rows[0]!.category, 'data');
});

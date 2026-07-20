import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RecordAppVisit, type VisitRateLimiter } from './RecordAppVisit.js';
import type {
  AppTrafficAggregate,
  AppTrafficRepository,
  AppVisitRecord,
} from './AppTrafficRepository.js';

function fakeRepo(): AppTrafficRepository & { readonly stored: AppVisitRecord[] } {
  const stored: AppVisitRecord[] = [];
  return {
    stored,
    async record(visit) {
      stored.push(visit);
    },
    async countForDay(projectId, visitDay) {
      return stored.filter((v) => v.projectId === projectId && v.visitDay === visitDay).length;
    },
    async aggregate(): Promise<AppTrafficAggregate> {
      return { perDay: [], byClass: {}, totalVisits: 0, totalSessions: 0 };
    },
  };
}

const allowAll: VisitRateLimiter = { hit: () => true };

function at(iso: string): () => Date {
  return () => new Date(iso);
}

test('RecordAppVisit stores an anonymized aggregate row (no IP, no raw UA)', async () => {
  const repo = fakeRepo();
  // Реальный односторонн's хеш, как в проде — чтобы проверить, что сырой seed (ip|ua) не утекает.
  const hashSession = (raw: string) => createHash('sha256').update(raw).digest('hex');
  const rec = new RecordAppVisit({
    traffic: repo,
    rateLimiter: allowAll,
    hashSession,
    now: at('2026-07-20T10:00:00.000Z'),
  });

  const result = await rec.record({
    projectId: 'p1',
    path: '/checkout?token=sk_live_secret#frag',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
    sessionSeed: '203.0.113.7|Mozilla/5.0 iPhone',
  });

  assert.equal(result.recorded, true);
  assert.equal(repo.stored.length, 1);
  const row = repo.stored[0]!;
  // Query/fragment отброшены — секрет из query не попадает в хранилище.
  assert.equal(row.path, '/checkout');
  assert.equal(row.userAgentClass, 'mobile');
  assert.equal(row.visitDay, '2026-07-20');
  // session_hash — детерминированный посоленный дайджест seed'а, а не сам seed.
  assert.equal(row.sessionHash, hashSession('p1:2026-07-20:203.0.113.7|Mozilla/5.0 iPhone'));
  // Никаких сырых IP/UA-полей в записи.
  assert.deepEqual(
    Object.keys(row).sort(),
    ['createdAt', 'path', 'projectId', 'sessionHash', 'userAgentClass', 'visitDay'],
  );
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes('203.0.113.7'), 'raw IP must never be persisted');
  assert.ok(!serialized.includes('iPhone'), 'raw UA must never be persisted');
});

test('RecordAppVisit rotates session_hash across days (no cross-day tracking)', async () => {
  const repo = fakeRepo();
  const make = (now: string) =>
    new RecordAppVisit({
      traffic: repo,
      rateLimiter: allowAll,
      hashSession: (raw) => `h:${raw}`,
      now: at(now),
    });
  await make('2026-07-20T10:00:00.000Z').record({ projectId: 'p1', path: '/', userAgent: 'x', sessionSeed: 'same-visitor' });
  await make('2026-07-21T10:00:00.000Z').record({ projectId: 'p1', path: '/', userAgent: 'x', sessionSeed: 'same-visitor' });
  assert.notEqual(repo.stored[0]!.sessionHash, repo.stored[1]!.sessionHash);
});

test('RecordAppVisit refuses over the per-project rate limit', async () => {
  const repo = fakeRepo();
  const rec = new RecordAppVisit({
    traffic: repo,
    rateLimiter: { hit: () => false },
    hashSession: (raw) => raw,
    now: at('2026-07-20T10:00:00.000Z'),
  });
  const result = await rec.record({ projectId: 'p1', path: '/', userAgent: 'x', sessionSeed: 's' });
  assert.deepEqual(result, { recorded: false, reason: 'rate_limited' });
  assert.equal(repo.stored.length, 0);
});

test('RecordAppVisit enforces a daily row cap per project', async () => {
  const repo = fakeRepo();
  const rec = new RecordAppVisit({
    traffic: repo,
    rateLimiter: allowAll,
    hashSession: (raw) => raw,
    now: at('2026-07-20T10:00:00.000Z'),
    dailyCap: 2,
  });
  const input = { projectId: 'p1', path: '/', userAgent: 'x', sessionSeed: 's' };
  assert.equal((await rec.record(input)).recorded, true);
  assert.equal((await rec.record(input)).recorded, true);
  const third = await rec.record(input);
  assert.deepEqual(third, { recorded: false, reason: 'daily_cap' });
  assert.equal(repo.stored.length, 2);
});

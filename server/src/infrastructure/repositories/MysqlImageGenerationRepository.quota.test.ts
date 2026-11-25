import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'mysql2/promise';
import { MysqlImageGenerationRepository } from './MysqlImageGenerationRepository.js';

test('rolling quota counts failed jobs, includes active slots and computes reset durations in SQL UTC', async () => {
  const queries: string[] = [];
  const rows = Array.from({ length: 10 }, (_, index) => ({ status: index === 0 ? 'queued' : index === 1 ? 'running' : index === 2 ? 'failed' : 'succeeded', releaseAfterSeconds: String(100 + index) }));
  const repo = new MysqlImageGenerationRepository({ async query(sql: string, params?: string[]) {
    queries.push(sql);
    if (sql.startsWith('UPDATE')) return [{ affectedRows: 0 }];
    assert.deepEqual(params, ['owner']);
    return [rows];
  } } as unknown as Pool);
  assert.deepEqual(await repo.quota('owner'), { active: 2, remaining: 0, releaseAfterSeconds: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109] });
  assert.match(queries[1]!, /UTC_TIMESTAMP\(3\) - INTERVAL 1 DAY/);
  assert.match(queries[1]!, /TIMESTAMPDIFF\(MICROSECOND/);
  rows.length = 0;
  assert.deepEqual(await repo.quota('owner'), { active: 0, remaining: 10, releaseAfterSeconds: [] });
});

test('perDay = 0 disables the daily cap: remaining stays positive', async () => {
  const rows = Array.from({ length: 25 }, () => ({ status: 'succeeded', releaseAfterSeconds: '100' }));
  const repo = new MysqlImageGenerationRepository({ async query(sql: string) {
    if (sql.startsWith('UPDATE')) return [{ affectedRows: 0 }];
    return [rows];
  } } as unknown as Pool, { maxActive: 4, perDay: 0 });
  const quota = await repo.quota('owner');
  assert.equal(quota.remaining > 0, true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema.js';
import { DrizzleProjectSharingRepository } from './DrizzleProjectSharingRepository.js';
import { RequestMemo } from '../request/RequestMemo.js';

function capture(): { db: never; sql: string[] } {
  const sql: string[] = [];
  const respond = async (query: unknown) => {
    sql.push(typeof query === 'string' ? query : (query as { sql: string }).sql);
    return [[], []];
  };
  const db = drizzle({ query: respond, execute: respond } as never, { schema, mode: 'default' }) as never;
  return { db, sql };
}

function inRequest(memo: RequestMemo, work: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => memo.run(() => true, () => void work().then(resolve, reject)));
}

// canManageTask → canSeeTask → TaskVisibility.canSee loads the project's sharing rules for every
// task of a list; within one request they are read once per project.
test('within one request the sharing rules of a project are read once', async () => {
  const { db, sql } = capture();
  const memo = new RequestMemo();
  const repo = new DrizzleProjectSharingRepository(db, memo);
  const workspaces = [{ projectId: 'p', workspaceIds: ['home', 'linked'] }];
  await inRequest(memo, async () => {
    for (let task = 0; task < 5; task += 1) {
      assert.equal((await repo.loadMany(['p'])).size, 0);
      assert.deepEqual(await repo.memberships(['u'], workspaces), []);
    }
    // Callers own the map they get.
    (await repo.loadMany(['p'])).set('p', {} as never);
    assert.equal((await repo.loadMany(['p'])).size, 0);
    await repo.loadMany(['p2']);
  });
  // loadMany(['p']) — 1, memberships — 2 (members + exclusions), loadMany(['p2']) — 1.
  assert.equal(sql.length, 4);

  sql.length = 0;
  await repo.loadMany(['p']);
  await repo.loadMany(['p']);
  assert.equal(sql.length, 2);
});

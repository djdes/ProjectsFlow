import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema.js';
import { DrizzleProjectMemberRepository } from './DrizzleProjectMemberRepository.js';
import { RequestMemo } from '../request/RequestMemo.js';

// Регрессия: в выборке из одной таблицы drizzle пишет `${projects.workspaceId}` без имени
// таблицы — внутри подзапроса такая колонка связывается с таблицей подзапроса (неверный
// результат) или неоднозначна (MariaDB 1052, и любое изменение задачи падало бы с 500).
function capture(): { db: never; sql: string[] } {
  const sql: string[] = [];
  const respond = async (query: unknown) => {
    sql.push(typeof query === 'string' ? query : (query as { sql: string }).sql);
    return [[], []];
  };
  const db = drizzle({ query: respond, execute: respond } as never, { schema, mode: 'default' }) as never;
  return { db, sql };
}

test('isProjectHidden fast path refers to the outer project explicitly inside subqueries', async () => {
  const { db, sql } = capture();
  await new DrizzleProjectMemberRepository(db).isProjectHidden('p', 'u');
  const query = sql[0] ?? '';
  for (const sub of query.match(/EXISTS \(SELECT[^)]*\)/g) ?? []) {
    assert.doesNotMatch(sub, /= `(id|workspace_id)`|<> `(id|workspace_id)`/, sub);
  }
  assert.match(query, /a\.workspace_id <> projects\.workspace_id/);
  assert.match(query, /x\.workspace_id = projects\.workspace_id/);
});

test('findForProject keeps table-qualified columns in its subqueries', async () => {
  const { db, sql } = capture();
  await new DrizzleProjectMemberRepository(db).findForProject('p', 'u');
  assert.match(sql[0] ?? '', /a\.workspace_id <> `projects`\.`workspace_id`/);
});

// Runs `work` inside a memo scope, the way requestMemoScope does for a GET request.
function inRequest(memo: RequestMemo, work: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => memo.run(() => true, () => void work().then(resolve, reject)));
}

test('within one request each access lookup hits the database once per project and user', async () => {
  const { db, sql } = capture();
  const memo = new RequestMemo();
  const repo = new DrizzleProjectMemberRepository(db, undefined, memo);
  await inRequest(memo, async () => {
    // A list of five tasks in one project: canManageTask asks the same questions for each.
    for (let task = 0; task < 5; task += 1) {
      assert.equal(await repo.isProjectHidden('p', 'u'), false);
      assert.equal(await repo.findForProject('p', 'u'), null);
      assert.deepEqual(await repo.listApproverUserIdsForProject('p'), []);
      assert.deepEqual(await repo.listSharedUsersInWorkspace('u', 'ws'), []);
    }
    // Another project or another user is a different question.
    await repo.isProjectHidden('p2', 'u');
    await repo.isProjectHidden('p', 'u2');
  });
  assert.equal(sql.length, 6);

  // Callers own the lists they get: changing one does not change the remembered answer.
  await inRequest(memo, async () => {
    (await repo.listApproverUserIdsForProject('p')).push('intruder');
    assert.deepEqual(await repo.listApproverUserIdsForProject('p'), []);
  });

  // Outside a request (background jobs, Telegram) every call reads, as before.
  sql.length = 0;
  await repo.isProjectHidden('p', 'u');
  await repo.isProjectHidden('p', 'u');
  await repo.findForProject('p', 'u');
  await repo.findForProject('p', 'u');
  assert.equal(sql.length, 4);
});

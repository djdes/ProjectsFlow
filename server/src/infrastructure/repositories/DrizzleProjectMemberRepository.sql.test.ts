import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema.js';
import { DrizzleProjectMemberRepository } from './DrizzleProjectMemberRepository.js';

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

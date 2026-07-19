import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import type { SQL } from 'drizzle-orm';
import { DrizzleTaskRepository } from './DrizzleTaskRepository.js';
import type { Database } from '../db/index.js';

// Регресс-тест самой опасной части db/134: пропущенный `deleted_at IS NULL` хотя бы в одной
// выборке = удалённая задача «воскресает» в одном виде и отсутствует в другом. Реальной
// тестовой БД для Drizzle-репозиториев в кодбейзе нет (см. fakeDrizzleDb.ts), поэтому
// проверяем не результат запроса, а САМО условие: перехватываем аргумент `.where(...)` и
// рендерим его тем же диалектом, что и продовый Drizzle.

const dialect = new MySqlDialect();

function renderSql(condition: unknown): string {
  return dialect.sqlToQuery(condition as SQL).sql;
}

// fake `db`, который записывает условия всех where() и отдаёт заданные строки.
function recordingDb(rows: readonly unknown[] = []) {
  const wheres: string[] = [];

  function chain(): Record<string, unknown> {
    const self: Record<string, unknown> = {};
    const resolve = (): Promise<unknown[]> => Promise.resolve([...rows]);
    Object.assign(self, {
      from: () => self,
      innerJoin: () => self,
      leftJoin: () => self,
      set: () => self,
      where: (cond: unknown) => {
        wheres.push(renderSql(cond));
        return self;
      },
      orderBy: () => self,
      limit: resolve,
      // affectedRows-форма ответа mysql2 для update/delete-чейнов.
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve([{ affectedRows: 1 }]).then(onF, onR),
    });
    return self;
  }

  const db = {
    select: () => {
      const c = chain();
      // select-чейн должен резолвиться в строки, а не в affectedRows.
      c['then'] = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve([...rows]).then(onF, onR);
      return c;
    },
    update: () => chain(),
    delete: () => chain(),
  };

  return { db: db as unknown as Database, wheres };
}

const NOT_DELETED = '`tasks`.`deleted_at` is null';

test('db/134: все read-выборки задач фильтруют deleted_at IS NULL', async () => {
  const cases: readonly (readonly [string, (r: DrizzleTaskRepository) => Promise<unknown>])[] = [
    ['listByProject', (r) => r.listByProject('p1')],
    ['listByIds', (r) => r.listByIds(['t1', 't2'])],
    ['listAssignedTo', (r) => r.listAssignedTo('u1')],
    ['getById', (r) => r.getById('t1')],
    ['getPositionBounds', (r) => r.getPositionBounds('p1', 'todo')],
  ];

  for (const [name, run] of cases) {
    const { db, wheres } = recordingDb([]);
    await run(new DrizzleTaskRepository(db));
    assert.equal(wheres.length > 0, true, `${name}: не было ни одного where()`);
    assert.equal(
      wheres.every((w) => w.includes(NOT_DELETED)),
      true,
      `${name}: выборка без фильтра мягкого удаления → удалённые задачи воскреснут (${wheres.join(' | ')})`,
    );
  }
});

test('db/134: write-операции по id не трогают задачу, лежащую в корзине', async () => {
  const cases: readonly (readonly [string, (r: DrizzleTaskRepository) => Promise<unknown>])[] = [
    ['update', (r) => r.update('t1', { status: 'done' })],
    ['requestRalphCancel', (r) => r.requestRalphCancel('t1', 'u1')],
    ['clearRalphCancel', (r) => r.clearRalphCancel('t1')],
    ['softDelete', (r) => r.softDelete('t1', 'u1')],
  ];

  for (const [name, run] of cases) {
    const { db, wheres } = recordingDb([]);
    await run(new DrizzleTaskRepository(db));
    assert.equal(wheres.length > 0, true, `${name}: не было ни одного where()`);
    assert.equal(
      wheres.every((w) => w.includes(NOT_DELETED)),
      true,
      `${name}: UPDATE без фильтра мягкого удаления (${wheres.join(' | ')})`,
    );
  }
});

test('db/134: корзина и восстановление смотрят на deleted_at IS NOT NULL', async () => {
  const trash = recordingDb([]);
  await new DrizzleTaskRepository(trash.db).listTrashedByProject('p1');
  assert.equal(
    trash.wheres.every((w) => w.includes('`tasks`.`deleted_at` is not null')),
    true,
    `корзина должна показывать только удалённые задачи (${trash.wheres.join(' | ')})`,
  );

  const restore = recordingDb([]);
  await new DrizzleTaskRepository(restore.db).restore('t1');
  assert.equal(
    restore.wheres.some((w) => w.includes('`tasks`.`deleted_at` is not null')),
    true,
    'restore должен снимать метку только с задачи, которая реально в корзине',
  );
});

test('db/134: softDelete — это UPDATE, а не DELETE (строка и её история остаются)', async () => {
  let deleteCalled = false;
  const { db, wheres } = recordingDb([]);
  const spied = {
    ...(db as unknown as Record<string, unknown>),
    delete: () => {
      deleteCalled = true;
      return { where: () => Promise.resolve([{ affectedRows: 1 }]) };
    },
  } as unknown as Database;

  const ok = await new DrizzleTaskRepository(spied).softDelete('t1', 'u1');
  assert.equal(ok, true);
  assert.equal(deleteCalled, false, 'мягкое удаление не должно звать физический DELETE');
  assert.equal(wheres.length, 1);
});

test('db/134: getByIdIncludingDeleted — единственное чтение БЕЗ фильтра (для корзины)', async () => {
  const { db, wheres } = recordingDb([]);
  await new DrizzleTaskRepository(db).getByIdIncludingDeleted('t1');
  assert.equal(
    wheres.some((w) => w.includes(NOT_DELETED)),
    false,
    'иначе восстановить задачу из корзины будет нечем — она не найдётся',
  );
});

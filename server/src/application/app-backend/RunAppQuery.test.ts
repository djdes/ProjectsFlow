import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAppDatabaseStore } from '../../infrastructure/app-backend/SqliteAppDatabaseStore.js';
import { RunAppQuery } from './RunAppQuery.js';
import type { AppSchema } from '../../domain/app-backend/AppSchema.js';
import {
  AppAccessDeniedError,
  AppSchemaInvalidError,
  AppTableNotAllowedError,
  StorageQuotaExceededError,
} from '../../domain/app-backend/errors.js';
import type { Row } from './AppDatabaseStore.js';

const schema: AppSchema = {
  tables: [
    {
      name: 'posts',
      fields: [
        { name: 'title', type: 'text' },
        { name: 'views', type: 'int' },
      ],
      rules: { read: 'anyone', write: 'owner' },
    },
    {
      // Чувствительная колонка api_key (эвристика ловит как secret) — для теста оракула update-many.
      name: 'vault',
      fields: [
        { name: 'label', type: 'text' },
        { name: 'api_key', type: 'text' },
      ],
      rules: { read: 'owner', write: 'owner' },
    },
  ],
};

function setup(limitBytes = 100 * 1024 * 1024): { run: RunAppQuery; store: SqliteAppDatabaseStore } {
  const dir = mkdtempSync(join(tmpdir(), 'pf-runq-'));
  const store = new SqliteAppDatabaseStore(dir);
  store.ensureDatabase('proj-1', schema);
  const backend = {
    projectId: 'proj-1',
    status: 'active' as const,
    schema,
    appKeyHash: 'x',
    usageBytes: 0,
    storageLimitBytes: limitBytes,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const appBackends = {
    async getByProject() {
      return backend;
    },
    async upsert() {
      return backend;
    },
    async setUsage(_p: string, b: number) {
      backend.usageBytes = b;
    },
  } as any;
  return { run: new RunAppQuery({ appBackends, appDb: store }), store };
}

const U1 = { id: 'u1', email: 'u1@x' };
const U2 = { id: 'u2', email: 'u2@x' };

test('select read=anyone без юзера → ок; insert write=owner без юзера → отказ', async () => {
  const { run } = setup();
  assert.deepEqual(await run.execute({ projectId: 'proj-1', table: 'posts', op: 'select' }), []);
  await assert.rejects(
    () => run.execute({ projectId: 'proj-1', table: 'posts', op: 'insert', values: { title: 'x' } }),
    AppAccessDeniedError,
  );
});

test('insert юзером проставляет owner_id; select фильтр/сортировка работают', async () => {
  const { run } = setup();
  await run.execute({ projectId: 'proj-1', table: 'posts', op: 'insert', values: { title: 'a', views: 1 }, currentUser: U1 });
  await run.execute({ projectId: 'proj-1', table: 'posts', op: 'insert', values: { title: 'b', views: 5 }, currentUser: U2 });
  const all = (await run.execute({ projectId: 'proj-1', table: 'posts', op: 'select' })) as Row[];
  assert.equal(all.length, 2);
  assert.ok(all.every((r) => typeof r.owner_id === 'string'));
  const mine = (await run.execute({ projectId: 'proj-1', table: 'posts', op: 'select', filter: { owner_id: 'u1' } })) as Row[];
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.title, 'a');
  const top = (await run.execute({ projectId: 'proj-1', table: 'posts', op: 'select', sort: { column: 'views', dir: 'desc' }, limit: 1 })) as Row[];
  assert.equal(top[0]!.title, 'b');
});

test('таблица не из схемы / системная → AppTableNotAllowedError', async () => {
  const { run } = setup();
  await assert.rejects(() => run.execute({ projectId: 'proj-1', table: 'evil', op: 'select' }), AppTableNotAllowedError);
  await assert.rejects(() => run.execute({ projectId: 'proj-1', table: '_users', op: 'select' }), AppTableNotAllowedError);
});

test('квота: insert при usage ≥ limit → StorageQuotaExceededError, select работает', async () => {
  const { run } = setup(1); // лимит 1 байт — файл схемы уже больше
  await assert.rejects(
    () => run.execute({ projectId: 'proj-1', table: 'posts', op: 'insert', values: { title: 'x' }, currentUser: U1 }),
    StorageQuotaExceededError,
  );
  assert.deepEqual(await run.execute({ projectId: 'proj-1', table: 'posts', op: 'select' }), []);
});

test('owner: чужой не может update/delete, владелец может', async () => {
  const { run } = setup();
  const created = (await run.execute({ projectId: 'proj-1', table: 'posts', op: 'insert', values: { title: 'a' }, currentUser: U1 })) as Row;
  const id = String(created.id);
  await assert.rejects(
    () => run.execute({ projectId: 'proj-1', table: 'posts', op: 'update', id, values: { title: 'hacked' }, currentUser: U2 }),
    AppAccessDeniedError,
  );
  const updated = (await run.execute({ projectId: 'proj-1', table: 'posts', op: 'update', id, values: { title: 'aa' }, currentUser: U1 })) as Row;
  assert.equal(updated.title, 'aa');
  await assert.rejects(
    () => run.execute({ projectId: 'proj-1', table: 'posts', op: 'delete', id, currentUser: U2 }),
    AppAccessDeniedError,
  );
  assert.deepEqual(await run.execute({ projectId: 'proj-1', table: 'posts', op: 'delete', id, currentUser: U1 }), { deleted: 1 });
});

// --- Срез 5: bulk / update-many / soft-delete + restore ---

test('bulk: создание проставляет owner построчно, обновление уважает владельца, потолок 100', async () => {
  const { run } = setup();
  // Без юзера при write=owner — отказ (правило проверяется до батча).
  await assert.rejects(
    () => run.bulkInsert({ projectId: 'proj-1', table: 'posts', rows: [{ title: 'a' }] }),
    AppAccessDeniedError,
  );
  const created = await run.bulkInsert({ projectId: 'proj-1', table: 'posts', rows: [{ title: 'a' }, { title: 'b' }], currentUser: U1 });
  assert.equal(created.length, 2);
  assert.ok(created.every((r) => r.owner_id === 'u1'), 'owner проставлен построчно');
  const ids = created.map((r) => String(r.id));
  // Чужой не может обновить строки U1 через bulkUpdate — построчная проверка владельца отклоняет весь батч.
  await assert.rejects(
    () => run.bulkUpdate({ projectId: 'proj-1', table: 'posts', items: ids.map((id) => ({ id, values: { title: 'x' } })), currentUser: U2 }),
    AppAccessDeniedError,
  );
  const updated = await run.bulkUpdate({ projectId: 'proj-1', table: 'posts', items: ids.map((id) => ({ id, values: { title: 'z' } })), currentUser: U1 });
  assert.equal(updated.length, 2);
  assert.ok(updated.every((r) => r.title === 'z'));
  // Потолок батча 100 — 101 запись отклоняется.
  await assert.rejects(
    () => run.bulkInsert({ projectId: 'proj-1', table: 'posts', rows: Array.from({ length: 101 }, (_, i) => ({ title: `p${i}` })), currentUser: U1 }),
    AppSchemaInvalidError,
  );
});

test('update-many: условие по чувствительной колонке отвергается, права применяются построчно', async () => {
  const { run } = setup();
  await run.bulkInsert({ projectId: 'proj-1', table: 'vault', rows: [{ label: 'a', api_key: 'sk-1' }], currentUser: U1 });
  await run.bulkInsert({ projectId: 'proj-1', table: 'vault', rows: [{ label: 'a', api_key: 'sk-2' }], currentUser: U2 });
  // Оракул: условие по секретной колонке возвращает счётчик изменённых строк → запрещаем.
  await assert.rejects(
    () => run.updateMany({ projectId: 'proj-1', table: 'vault', where: { api_key: 'sk-1' }, values: { label: 'x' }, currentUser: U1 }),
    AppSchemaInvalidError,
  );
  // По несекретной колонке — ок, но под owner-правилом и matched, и updated считают
  // ТОЛЬКО собственные строки. matched=2 было бы cross-owner count oracle: перебором
  // условий вызывающий узнавал бы точное число чужих записей, не меняя их.
  const res = await run.updateMany({ projectId: 'proj-1', table: 'vault', where: { label: 'a' }, values: { label: 'mine' }, currentUser: U1 });
  assert.equal(res.matched, 1, 'matched не должен считать чужие строки (count oracle)');
  assert.equal(res.updated, 1);
  const u2rows = (await run.execute({ projectId: 'proj-1', table: 'vault', op: 'select', currentUser: U2 })) as Row[];
  assert.equal(u2rows[0]!.label, 'a', 'чужая строка не тронута');
  // Пустое условие отклоняется (нельзя обновить всю таблицу).
  await assert.rejects(
    () => run.updateMany({ projectId: 'proj-1', table: 'vault', where: {}, values: { label: 'x' }, currentUser: U1 }),
    AppSchemaInvalidError,
  );
});

test('delete мягкое; restore возвращает строку и уважает владельца построчно', async () => {
  const { run } = setup();
  const created = (await run.execute({ projectId: 'proj-1', table: 'posts', op: 'insert', values: { title: 'a' }, currentUser: U1 })) as Row;
  const id = String(created.id);
  assert.deepEqual(await run.execute({ projectId: 'proj-1', table: 'posts', op: 'delete', id, currentUser: U1 }), { deleted: 1 });
  // Мягко удалённая строка исчезает из выборки.
  assert.equal(((await run.execute({ projectId: 'proj-1', table: 'posts', op: 'select' })) as Row[]).length, 0);
  // Restore возвращает её обратно.
  const restored = await run.restore({ projectId: 'proj-1', table: 'posts', id, currentUser: U1 });
  assert.equal(restored?.title, 'a');
  assert.equal(((await run.execute({ projectId: 'proj-1', table: 'posts', op: 'select' })) as Row[]).length, 1);
  // Чужой не может восстановить чужую (владелец проверяется построчно).
  await run.execute({ projectId: 'proj-1', table: 'posts', op: 'delete', id, currentUser: U1 });
  await assert.rejects(
    () => run.restore({ projectId: 'proj-1', table: 'posts', id, currentUser: U2 }),
    AppAccessDeniedError,
  );
});

test('операционные create/update/delete правила переопределяют legacy write', async () => {
  const { run } = setup();
  const scoped = schema.tables[0]!;
  (scoped.rules as { create?: string; update?: string; delete?: string }).create = 'anyone';
  (scoped.rules as { create?: string; update?: string; delete?: string }).update = 'authenticated';
  (scoped.rules as { create?: string; update?: string; delete?: string }).delete = 'owner';
  const created = await run.execute({ projectId: 'proj-1', table: 'posts', op: 'insert', values: { title: 'public' } }) as Row;
  await assert.rejects(
    () => run.execute({ projectId: 'proj-1', table: 'posts', op: 'update', id: String(created.id), values: { title: 'anon' } }),
    AppAccessDeniedError,
  );
  const updated = await run.execute({ projectId: 'proj-1', table: 'posts', op: 'update', id: String(created.id), values: { title: 'member' }, currentUser: U2 }) as Row;
  assert.equal(updated.title, 'member');
});

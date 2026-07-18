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

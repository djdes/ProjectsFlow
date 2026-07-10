import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProvisionAppBackend } from './ProvisionAppBackend.js';
import { AppSchemaInvalidError } from '../../domain/app-backend/errors.js';
import { NotAssignedDispatcherError } from '../../domain/file-sync/errors.js';

const validSchema = {
  tables: [
    { name: 'posts', fields: [{ name: 'title', type: 'text' }], rules: { read: 'anyone', write: 'owner' } },
  ],
};

// Гейт — requireDispatcherAccess: разрешено только project.dispatcherUserId. dispatcher=null →
// диспетчер не назначен (никто не пройдёт).
function makeDeps(dispatcherUserId: string | null) {
  const calls = { ensured: [] as Array<{ pid: string; tables: number }>, upserts: [] as any[] };
  const projects = {
    async getById(id: string) {
      return { id, dispatcherUserId };
    },
  } as any;
  const members = {
    async findForProject() {
      return null;
    },
  } as any;
  const appDb = {
    ensureDatabase(pid: string, schema: { tables: unknown[] }) {
      calls.ensured.push({ pid, tables: schema.tables.length });
    },
    sizeBytes: () => 0,
    insert: () => ({}),
    select: () => [],
    findOne: () => null,
    update: () => 0,
    remove: () => 0,
  } as any;
  const appBackends = {
    async getByProject() {
      return null;
    },
    async upsert(i: any) {
      calls.upserts.push(i);
      return { ...i, usageBytes: 0, storageLimitBytes: 100, createdAt: new Date(), updatedAt: new Date() };
    },
    async setUsage() {},
  } as any;
  return {
    deps: {
      appBackends,
      appDb,
      projects,
      members,
      genKey: () => 'KEY123',
      hashKey: (k: string) => `hash:${k}`,
    },
    calls,
  };
}

test('ProvisionAppBackend: диспетчер + валидная схема → БД, реестр active, ключ', async () => {
  const { deps, calls } = makeDeps('disp1');
  const out = await new ProvisionAppBackend(deps).execute({
    projectId: 'p1',
    callerUserId: 'disp1',
    rawSchema: validSchema,
  });
  assert.equal(out.appKey, 'KEY123');
  assert.equal(calls.ensured.length, 1);
  assert.equal(calls.ensured[0]!.tables, 1);
  assert.equal(calls.upserts[0].status, 'active');
  assert.equal(calls.upserts[0].appKeyHash, 'hash:KEY123');
  assert.equal(calls.upserts[0].schema.tables.length, 1);
});

test('ProvisionAppBackend: невалидная схема → AppSchemaInvalidError (БД не трогаем)', async () => {
  const { deps, calls } = makeDeps('disp1');
  await assert.rejects(
    () =>
      new ProvisionAppBackend(deps).execute({
        projectId: 'p1',
        callerUserId: 'disp1',
        rawSchema: { tables: 'x' },
      }),
    AppSchemaInvalidError,
  );
  assert.equal(calls.ensured.length, 0);
});

test('ProvisionAppBackend: не диспетчер → NotAssignedDispatcherError', async () => {
  const { deps } = makeDeps('disp1');
  await assert.rejects(
    () =>
      new ProvisionAppBackend(deps).execute({
        projectId: 'p1',
        callerUserId: 'intruder',
        rawSchema: validSchema,
      }),
    NotAssignedDispatcherError,
  );
});

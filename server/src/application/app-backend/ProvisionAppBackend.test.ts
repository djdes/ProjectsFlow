import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProvisionAppBackend } from './ProvisionAppBackend.js';
import { AppSchemaInvalidError } from '../../domain/app-backend/errors.js';
import { InsufficientProjectRoleError } from '../../domain/project/errors.js';
import type { ProjectRole } from '../../domain/project/ProjectMembership.js';

const validSchema = {
  tables: [
    { name: 'posts', fields: [{ name: 'title', type: 'text' }], rules: { read: 'anyone', write: 'owner' } },
  ],
};

function makeDeps(role: ProjectRole | null) {
  const calls = { ensured: [] as Array<{ pid: string; tables: number }>, upserts: [] as any[] };
  const projects = {
    async getById(id: string) {
      return { id, ownerId: 'owner1' };
    },
  } as any;
  const members = {
    async findForProject(pid: string, uid: string) {
      return role ? { projectId: pid, userId: uid, role, joinedAt: new Date() } : null;
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

test('ProvisionAppBackend: owner + валидная схема → БД, реестр active, ключ', async () => {
  const { deps, calls } = makeDeps('owner');
  const out = await new ProvisionAppBackend(deps).execute({
    projectId: 'p1',
    callerUserId: 'owner1',
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
  const { deps, calls } = makeDeps('owner');
  await assert.rejects(
    () =>
      new ProvisionAppBackend(deps).execute({
        projectId: 'p1',
        callerUserId: 'owner1',
        rawSchema: { tables: 'x' },
      }),
    AppSchemaInvalidError,
  );
  assert.equal(calls.ensured.length, 0);
});

test('ProvisionAppBackend: не-owner → InsufficientProjectRoleError', async () => {
  const { deps } = makeDeps('editor');
  await assert.rejects(
    () =>
      new ProvisionAppBackend(deps).execute({
        projectId: 'p1',
        callerUserId: 'owner1',
        rawSchema: validSchema,
      }),
    InsufficientProjectRoleError,
  );
});

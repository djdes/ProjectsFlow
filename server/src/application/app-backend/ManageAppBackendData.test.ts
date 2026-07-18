import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAppDatabaseStore } from '../../infrastructure/app-backend/SqliteAppDatabaseStore.js';
import { ManageAppBackendData } from './ManageAppBackendData.js';
import type { AppBackend } from '../../domain/app-backend/AppBackend.js';
import type { AppSchema } from '../../domain/app-backend/AppSchema.js';
import { InsufficientProjectRoleError } from '../../domain/project/errors.js';
import { StorageQuotaExceededError } from '../../domain/app-backend/errors.js';

const schema: AppSchema = {
  tables: [{
    name: 'products',
    fields: [
      { name: 'name', type: 'text', required: true },
      { name: 'price', type: 'real' },
      { name: 'active', type: 'bool' },
    ],
    rules: { read: 'anyone', write: 'owner' },
  }],
};

function setup(
  role: 'owner' | 'editor' | 'viewer' = 'editor',
  storageLimitBytes = 100 * 1024 * 1024,
) {
  const appDb = new SqliteAppDatabaseStore(mkdtempSync(join(tmpdir(), 'pf-dashboard-')));
  appDb.ensureDatabase('project-1', schema);
  let backend: AppBackend = {
    projectId: 'project-1', status: 'active', schema, appKeyHash: 'hash', usageBytes: 0,
    storageLimitBytes, createdAt: new Date(), updatedAt: new Date(),
  };
  const appBackends = {
    async getByProject() { return backend; },
    async upsert(input: any) { backend = { ...backend, ...input, updatedAt: new Date() }; return backend; },
    async setUsage(_projectId: string, usageBytes: number) { backend = { ...backend, usageBytes }; },
  };
  const manage = new ManageAppBackendData({
    appBackends,
    appDb,
    projects: { async getById() { return { id: 'project-1' } as any; } } as any,
    members: { async findForProject() { return { projectId: 'project-1', userId: 'u1', role, joinedAt: new Date() }; } } as any,
  });
  return { manage, appDb, backend: () => backend };
}

test('Dashboard CRUD нормализует типы, ищет, сортирует и пишет аудит', async () => {
  const { manage } = setup();
  const created = await manage.insertRow('project-1', 'u1', 'products', { name: 'Coffee', price: '12.5', active: 'true', ignored: 'x' });
  assert.equal(created.name, 'Coffee');
  assert.equal(created.price, 12.5);
  assert.equal(created.active, true);
  assert.equal(created.ignored, undefined);
  const page = await manage.listRows('project-1', 'u1', 'products', { search: 'cof', filters: [{ column: 'price', operator: 'gte', value: 10 }] });
  assert.equal(page.total, 1);
  const updated = await manage.updateRow('project-1', 'u1', 'products', String(created.id), { name: 'Coffee Pro', active: false });
  assert.equal(updated?.active, false);
  assert.equal((await manage.listLogs('project-1', 'u1', {})).rows.some((entry) => entry.operation === 'dashboard.update'), true);
  assert.equal((await manage.deleteRow('project-1', 'u1', 'products', String(created.id))).deleted, 1);
});

test('permissions сохраняются отдельно для CRUD и legacy write остаётся совместимым', async () => {
  const { manage, backend } = setup();
  const rules = await manage.updateRules('project-1', 'u1', 'products', {
    create: 'anyone', read: 'anyone', update: 'authenticated', delete: 'owner',
  });
  assert.deepEqual(rules, { create: 'anyone', read: 'anyone', update: 'authenticated', delete: 'owner' });
  const saved = backend().schema!.tables[0]!.rules;
  assert.equal(saved.write, 'authenticated');
  assert.equal(saved.create, 'anyone');
  assert.equal(saved.delete, 'owner');
});

test('viewer может читать Dashboard, но не менять данные', async () => {
  const { manage } = setup('viewer');
  assert.equal((await manage.getDashboard('project-1', 'u1')).status, 'active');
  await assert.rejects(
    () => manage.insertRow('project-1', 'u1', 'products', { name: 'Denied' }),
    InsufficientProjectRoleError,
  );
});

test('превышенная квота блокирует запись, но не чтение Data Explorer', async () => {
  const { manage } = setup('editor', 1);
  assert.equal((await manage.listRows('project-1', 'u1', 'products', {})).total, 0);
  await assert.rejects(
    () => manage.insertRow('project-1', 'u1', 'products', { name: 'Denied by quota' }),
    StorageQuotaExceededError,
  );
});

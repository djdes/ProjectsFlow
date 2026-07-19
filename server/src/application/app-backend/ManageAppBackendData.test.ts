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
import {
  AppSchemaInvalidError,
  AppTableNotAllowedError,
  StorageQuotaExceededError,
} from '../../domain/app-backend/errors.js';
import { SECRET_MASK, maskValue } from '../../domain/app-backend/sensitiveFields.js';

const schema: AppSchema = {
  tables: [
    {
      name: 'products',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'price', type: 'real' },
        { name: 'active', type: 'bool' },
      ],
      rules: { read: 'anyone', write: 'owner' },
    },
    {
      name: 'customers',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'email', type: 'text' },
        { name: 'api_key', type: 'text' },
      ],
      rules: { read: 'authenticated', write: 'owner' },
    },
    {
      name: 'payments',
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'card_number', type: 'text' },
        { name: 'birthdate', type: 'datetime' },
        { name: 'amount', type: 'real' },
      ],
      rules: { read: 'owner', write: 'owner' },
    },
  ],
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

test('типизированные фильтры отбирают строки и отвергают чужие колонки и операторы', async () => {
  const { manage } = setup();
  await manage.insertRow('project-1', 'u1', 'products', { name: 'Coffee', price: 12.5, active: true });
  await manage.insertRow('project-1', 'u1', 'products', { name: 'Tea', price: 4, active: false });
  await manage.insertRow('project-1', 'u1', 'products', { name: 'Cocoa', price: 30, active: null });

  const byNumber = await manage.listRows('project-1', 'u1', 'products', {
    filters: [{ column: 'price', operator: 'gt', value: '10' }],
  });
  assert.deepEqual(byNumber.rows.map((row) => row['name']).sort(), ['Cocoa', 'Coffee']);

  const byBool = await manage.listRows('project-1', 'u1', 'products', {
    filters: [{ column: 'active', operator: 'eq', value: 'false' }],
  });
  assert.deepEqual(byBool.rows.map((row) => row['name']), ['Tea']);

  const byText = await manage.listRows('project-1', 'u1', 'products', {
    filters: [{ column: 'name', operator: 'starts_with', value: 'Co' }],
  });
  assert.deepEqual(byText.rows.map((row) => row['name']).sort(), ['Cocoa', 'Coffee']);

  const empty = await manage.listRows('project-1', 'u1', 'products', {
    filters: [{ column: 'active', operator: 'is_empty' }],
  });
  assert.deepEqual(empty.rows.map((row) => row['name']), ['Cocoa']);

  await assert.rejects(
    () => manage.listRows('project-1', 'u1', 'products', {
      filters: [{ column: 'name); drop table products; --', operator: 'eq', value: 'x' }],
    }),
    AppTableNotAllowedError,
  );
  await assert.rejects(
    () => manage.listRows('project-1', 'u1', 'products', {
      filters: [{ column: 'price', operator: 'like' as never, value: 'x' }],
    }),
    AppSchemaInvalidError,
  );
  await assert.rejects(
    () => manage.listRows('project-1', 'u1', 'products', {
      filters: [{ column: 'price', operator: 'gt', value: 'дорого' }],
    }),
    AppSchemaInvalidError,
  );
});

test('секреты и PII маскируются в выдаче и не подбираются фильтром или поиском', async () => {
  const { manage } = setup();
  await manage.insertRow('project-1', 'u1', 'customers', {
    name: 'Иван', email: 'ivan.petrov@mail.ru', api_key: 'sk-live-42',
  });

  const page = await manage.listRows('project-1', 'u1', 'customers', {});
  assert.deepEqual(page.masked, { email: 'pii', api_key: 'secret' });
  assert.equal(page.rows[0]!['api_key'], SECRET_MASK);
  assert.equal(String(page.rows[0]!['email']).includes('petrov'), false);
  assert.equal(page.rows[0]!['name'], 'Иван');

  await assert.rejects(
    () => manage.listRows('project-1', 'u1', 'customers', {
      filters: [{ column: 'api_key', operator: 'starts_with', value: 'sk-' }],
    }),
    AppSchemaInvalidError,
  );
  // is_empty по секрету допустим: он не раскрывает содержимое.
  assert.equal((await manage.listRows('project-1', 'u1', 'customers', {
    filters: [{ column: 'api_key', operator: 'is_not_empty' }],
  })).total, 1);
  // Свободный поиск не должен находить строку по значению секрета.
  assert.equal((await manage.listRows('project-1', 'u1', 'customers', { search: 'sk-live' })).total, 0);
  assert.equal((await manage.listRows('project-1', 'u1', 'customers', { search: 'Иван' })).total, 1);
});

test('возврат маски не затирает секрет, а раскрытие требует прав и пишется в аудит', async () => {
  const { manage } = setup();
  const created = await manage.insertRow('project-1', 'u1', 'customers', {
    name: 'Иван', email: 'ivan@mail.ru', api_key: 'sk-live-42',
  });
  const rowId = String(created['id']);

  await manage.updateRow('project-1', 'u1', 'customers', rowId, {
    name: 'Иван Петров', api_key: SECRET_MASK,
  });
  const revealed = await manage.revealRowValue('project-1', 'u1', 'customers', rowId, 'api_key');
  assert.equal(revealed.value, 'sk-live-42');

  const logs = await manage.listLogs('project-1', 'u1', {});
  assert.equal(logs.rows.some((entry) => entry.operation === 'dashboard.reveal'), true);

  await assert.rejects(
    () => manage.revealRowValue('project-1', 'u1', 'customers', rowId, 'name'),
    AppTableNotAllowedError,
  );
  await assert.rejects(
    () => manage.insertRow('project-1', 'u1', 'customers', { name: 'Fake', api_key: SECRET_MASK }),
    AppSchemaInvalidError,
  );
});

test('viewer не может раскрыть секрет и не может менять права таблицы', async () => {
  const { manage } = setup('viewer');
  await assert.rejects(
    () => manage.revealRowValue('project-1', 'u1', 'customers', 'row-1', 'api_key'),
    InsufficientProjectRoleError,
  );
  await assert.rejects(
    () => manage.updateRules('project-1', 'u1', 'customers', {
      create: 'anyone', read: 'anyone', update: 'anyone', delete: 'anyone',
    }),
    InsufficientProjectRoleError,
  );
  await assert.rejects(
    () => manage.deleteRow('project-1', 'u1', 'customers', 'row-1'),
    InsufficientProjectRoleError,
  );
  await assert.rejects(
    () => manage.updateRow('project-1', 'u1', 'customers', 'row-1', { name: 'x' }),
    InsufficientProjectRoleError,
  );
});

test('PII защищена как секрет: ни поиска, ни фильтра по значению', async () => {
  const { manage } = setup();
  await manage.insertRow('project-1', 'u1', 'payments', {
    label: 'Заказ №1', card_number: '4276123456789012', amount: 100,
  });

  const page = await manage.listRows('project-1', 'u1', 'payments', {});
  assert.equal(String(page.rows[0]!['card_number']).includes('4276'), false);

  // Свободный поиск по номеру карты не должен подтверждать догадку (оракул на total).
  assert.equal((await manage.listRows('project-1', 'u1', 'payments', { search: '4276123456789012' })).total, 0);
  assert.equal((await manage.listRows('project-1', 'u1', 'payments', { search: '4276' })).total, 0);
  assert.equal((await manage.listRows('project-1', 'u1', 'payments', { search: 'Заказ' })).total, 1);

  for (const operator of ['eq', 'contains', 'starts_with'] as const) {
    await assert.rejects(
      () => manage.listRows('project-1', 'u1', 'payments', {
        filters: [{ column: 'card_number', operator, value: '4276' }],
      }),
      AppSchemaInvalidError,
    );
  }
  await assert.rejects(
    () => manage.listRows('project-1', 'u1', 'customers', {
      filters: [{ column: 'email', operator: 'contains', value: '@mail.ru' }],
    }),
    AppSchemaInvalidError,
  );
  // Проверка на заполненность содержимого не раскрывает — остаётся разрешённой.
  assert.equal((await manage.listRows('project-1', 'u1', 'payments', {
    filters: [{ column: 'card_number', operator: 'is_not_empty' }],
  })).total, 1);
});

test('сортировка по чувствительной колонке отвергается', async () => {
  const { manage } = setup();
  await manage.insertRow('project-1', 'u1', 'payments', { label: 'A', card_number: '4276000000000001' });
  await manage.insertRow('project-1', 'u1', 'payments', { label: 'B', card_number: '5100000000000002' });

  for (const column of ['card_number', 'birthdate']) {
    await assert.rejects(
      () => manage.listRows('project-1', 'u1', 'payments', { sort: { column, dir: 'asc' } }),
      AppSchemaInvalidError,
    );
  }
  await assert.rejects(
    () => manage.listRows('project-1', 'u1', 'customers', { sort: { column: 'api_key', dir: 'desc' } }),
    AppSchemaInvalidError,
  );
  const sorted = await manage.listRows('project-1', 'u1', 'payments', { sort: { column: 'label', dir: 'asc' } });
  assert.deepEqual(sorted.rows.map((row) => row['label']), ['A', 'B']);
});

test('строку с чувствительным полем нетекстового типа можно отредактировать', async () => {
  const { manage } = setup();
  const created = await manage.insertRow('project-1', 'u1', 'payments', {
    label: 'Заказ №1', birthdate: '1990-03-14T00:00:00.000Z', card_number: '4276123456789012',
  });
  const rowId = String(created['id']);

  // Клиент отправляет обратно ровно то, что увидел: маски вместо datetime и текста.
  const updated = await manage.updateRow('project-1', 'u1', 'payments', rowId, {
    label: 'Заказ №2',
    birthdate: created['birthdate'],
    card_number: created['card_number'],
  });
  assert.equal(updated?.['label'], 'Заказ №2');

  const birthdate = await manage.revealRowValue('project-1', 'u1', 'payments', rowId, 'birthdate');
  assert.equal(birthdate.value, '1990-03-14T00:00:00.000Z');
  const card = await manage.revealRowValue('project-1', 'u1', 'payments', rowId, 'card_number');
  assert.equal(card.value, '4276123456789012');
});

test('listRuntimeUsers маскирует почту и пишет аудит', async () => {
  const { manage, appDb } = setup();
  appDb.insert('project-1', '_users', {
    id: 'ru-1', email: 'ivan.petrov@mail.ru', password_hash: 'x',
  });

  const users = await manage.listRuntimeUsers('project-1', 'u1');
  assert.equal(users.length, 1);
  assert.equal(users[0]!.email.includes('petrov'), false);
  assert.equal(users[0]!.email, maskValue('ivan.petrov@mail.ru', 'pii'));

  const logs = await manage.listLogs('project-1', 'u1', {});
  assert.equal(logs.rows.some((entry) => entry.operation === 'dashboard.users.list'), true);
});

test('превышенная квота блокирует запись, но не чтение Data Explorer', async () => {
  const { manage } = setup('editor', 1);
  assert.equal((await manage.listRows('project-1', 'u1', 'products', {})).total, 0);
  await assert.rejects(
    () => manage.insertRow('project-1', 'u1', 'products', { name: 'Denied by quota' }),
    StorageQuotaExceededError,
  );
});

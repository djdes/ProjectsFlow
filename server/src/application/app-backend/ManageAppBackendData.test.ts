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
  AppDuplicateValueError,
  AppRowConflictError,
  AppSchemaInvalidError,
  AppTableNotAllowedError,
  StorageQuotaExceededError,
} from '../../domain/app-backend/errors.js';
import type { AppAdminAuditRepository } from './AppAdminAuditRepository.js';
import type { AppAuditEntry, AppAuditInput, AppAuditListOpts } from './AppDatabaseStore.js';
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
    {
      // Нейтральные имена полей: чувствительность задаётся ТОЛЬКО явным флагом (долг 0.3),
      // эвристика по имени тут ничего не ловит.
      name: 'notes',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'text', sensitive: 'secret' },
      ],
      rules: { read: 'owner', write: 'owner' },
    },
    {
      // Секретная колонка с UNIQUE-ограничением: `token` ловится эвристикой как secret и уникальна.
      // Сценарий оракула существования секрета через нарушение UNIQUE (V2).
      name: 'api_tokens',
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'token', type: 'text', unique: true },
      ],
      rules: { read: 'owner', write: 'owner' },
    },
  ],
};

// In-memory реализация надёжного журнала административного аудита (порт AppAdminAuditRepository).
// Зеркалит фильтры/порядок DrizzleAppAdminAuditRepository: НЕ вытесняется, ordering по seq desc.
function makeAdminAudit(): AppAdminAuditRepository {
  const rows: { projectId: string; seq: number; entry: AppAuditEntry }[] = [];
  let seq = 0;
  let idc = 0;
  return {
    async record(projectId: string, input: AppAuditInput): Promise<AppAuditEntry> {
      const entry: AppAuditEntry = {
        id: `adm-${++idc}`,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        operation: input.operation.slice(0, 80),
        tableName: input.tableName ?? null,
        rowId: input.rowId ?? null,
        success: input.success !== false,
        detail: input.detail ?? null,
        createdAt: new Date().toISOString(),
      };
      rows.push({ projectId, seq: ++seq, entry });
      return entry;
    },
    async list(projectId: string, opts: AppAuditListOpts = {}) {
      let filtered = rows.filter((r) => r.projectId === projectId);
      if (opts.tableName) filtered = filtered.filter((r) => r.entry.tableName === opts.tableName);
      if (opts.operation) filtered = filtered.filter((r) => r.entry.operation === opts.operation);
      if (opts.actorId) filtered = filtered.filter((r) => r.entry.actorId === opts.actorId);
      if (opts.errorsOnly) filtered = filtered.filter((r) => !r.entry.success);
      const total = filtered.length;
      const sorted = [...filtered].sort((a, b) => b.seq - a.seq);
      const limit = opts.limit ?? 100;
      const offset = opts.offset ?? 0;
      return { total, rows: sorted.slice(offset, offset + limit).map((r) => r.entry) };
    },
  };
}

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
  const adminAudit = makeAdminAudit();
  const manage = new ManageAppBackendData({
    appBackends,
    appDb,
    adminAudit,
    projects: { async getById() { return { id: 'project-1' } as any; } } as any,
    members: { async findForProject() { return { projectId: 'project-1', userId: 'u1', role, joinedAt: new Date() }; } } as any,
  });
  return { manage, appDb, adminAudit, backend: () => backend };
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

// --- Долг 0.1: optimistic concurrency ---

test('optimistic concurrency: устаревшая версия падает конфликтом, без версии — last-write-wins', async () => {
  const { manage } = setup();
  const created = await manage.insertRow('project-1', 'u1', 'products', { name: 'Coffee', price: 10 });
  const rowId = String(created['id']);
  const base = String(created['updated_at']);
  assert.ok(base, 'updated_at проставлен при вставке');

  const updated = await manage.updateRow('project-1', 'u1', 'products', rowId, { name: 'Coffee A' }, base);
  assert.equal(updated?.['name'], 'Coffee A');
  assert.notEqual(String(updated?.['updated_at']), base, 'updated_at сдвинулся после записи');

  // Второй апдейт с той же (уже устаревшей) версией — конфликт, а не молчаливое затирание.
  await assert.rejects(
    () => manage.updateRow('project-1', 'u1', 'products', rowId, { name: 'Coffee B' }, base),
    AppRowConflictError,
  );
  // Данные не пострадали — осталась версия первого апдейта.
  const check = await manage.listRows('project-1', 'u1', 'products', {});
  assert.equal(check.rows[0]!['name'], 'Coffee A');

  // Без expectedUpdatedAt проверка версии не применяется (совместимость со старым клиентом).
  const forced = await manage.updateRow('project-1', 'u1', 'products', rowId, { name: 'Coffee C' });
  assert.equal(forced?.['name'], 'Coffee C');
});

test('конфликт версий несёт актуальную строку для перезагрузки панели без потери ввода', async () => {
  const { manage } = setup();
  const created = await manage.insertRow('project-1', 'u1', 'customers', {
    name: 'Иван', email: 'ivan@mail.ru', api_key: 'sk-live-1',
  });
  const rowId = String(created['id']);
  const stale = String(created['updated_at']);
  await manage.updateRow('project-1', 'u1', 'customers', rowId, { name: 'Иван П.' }, stale);
  try {
    await manage.updateRow('project-1', 'u1', 'customers', rowId, { name: 'Иван С.' }, stale);
    assert.fail('ожидался конфликт');
  } catch (error) {
    assert.ok(error instanceof AppRowConflictError);
    // Актуальная строка маскирована — секрет не утекает даже в теле конфликта.
    assert.equal(error.currentRow?.['api_key'], SECRET_MASK);
    assert.equal(error.currentRow?.['name'], 'Иван П.');
    assert.ok(error.currentRow?.['updated_at']);
  }
});

// --- Долг 0.2: выгрузка CSV с ограничениями ---

test('выгрузка CSV не содержит чувствительной колонки — ни значения, ни маски, ни заголовка', async () => {
  const { manage } = setup();
  await manage.insertRow('project-1', 'u1', 'customers', {
    name: 'Иван', email: 'ivan.petrov@mail.ru', api_key: 'sk-live-secret-42',
  });
  const result = await manage.exportRows('project-1', 'u1', 'customers', {});
  assert.equal(result.rowCount, 1);
  assert.equal(result.truncated, false);
  // Ни секретной, ни PII-колонки в списке колонок.
  assert.equal(result.columns.includes('api_key'), false);
  assert.equal(result.columns.includes('email'), false);
  assert.equal(result.columns.includes('name'), true);
  // Ни значения, ни маски, ни заголовка в самом файле.
  assert.equal(result.csv.includes('api_key'), false);
  assert.equal(result.csv.includes('sk-live-secret-42'), false);
  assert.equal(result.csv.includes(SECRET_MASK), false);
  assert.equal(result.csv.includes('petrov'), false);
  assert.equal(result.csv.includes('email'), false);
  assert.equal(result.csv.includes('Иван'), true);
});

test('выгрузка требует update_project и уважает оракул-гарды', async () => {
  const viewer = setup('viewer');
  await assert.rejects(
    () => viewer.manage.exportRows('project-1', 'u1', 'customers', {}),
    InsufficientProjectRoleError,
  );
  const { manage } = setup();
  // Сортировка/фильтр/поиск по чувствительной колонке в экспорте отвергаются так же, как в гриде.
  await assert.rejects(
    () => manage.exportRows('project-1', 'u1', 'customers', { sort: { column: 'api_key', dir: 'asc' } }),
    AppSchemaInvalidError,
  );
  await assert.rejects(
    () => manage.exportRows('project-1', 'u1', 'customers', { filters: [{ column: 'api_key', operator: 'eq', value: 'x' }] }),
    AppSchemaInvalidError,
  );
});

test('выгрузка пишет аудит dashboard.export с числом строк и колонками', async () => {
  const { manage } = setup();
  await manage.insertRow('project-1', 'u1', 'products', { name: 'A', price: 1 });
  await manage.exportRows('project-1', 'u1', 'products', {});
  const logs = await manage.listLogs('project-1', 'u1', {});
  const entry = logs.rows.find((e) => e.operation === 'dashboard.export');
  assert.ok(entry, 'есть запись dashboard.export');
  assert.equal(entry!.detail?.['rows'], 1);
});

test('выгрузка обрезается на потолке 10 000 и сообщает truncated', async () => {
  const { manage, appDb } = setup();
  // Быстрее вставлять напрямую в стор, минуя аудит/квоту — оракул тут не проверяем.
  for (let i = 0; i < 10_001; i++) {
    appDb.insert('project-1', 'products', { name: `p${i}`, price: i });
  }
  const result = await manage.exportRows('project-1', 'u1', 'products', {});
  assert.equal(result.truncated, true);
  assert.equal(result.rowCount, 10_000);
  // Заголовок + 10 000 строк данных.
  assert.equal(result.csv.split('\r\n').length, 10_001);
});

// --- Долг 0.3: явный флаг sensitive ---

test('явный флаг sensitive маскирует нейтральное поле и закрывает оракул', async () => {
  const { manage } = setup();
  await manage.insertRow('project-1', 'u1', 'notes', { title: 'Заметка', body: 'секретный текст' });

  const page = await manage.listRows('project-1', 'u1', 'notes', {});
  assert.equal(page.masked['body'], 'secret');
  assert.equal(page.rows[0]!['body'], SECRET_MASK);
  assert.equal(page.rows[0]!['title'], 'Заметка');

  // Ни сортировки, ни фильтра по значению, ни поиска по флагованному полю.
  await assert.rejects(
    () => manage.listRows('project-1', 'u1', 'notes', { sort: { column: 'body', dir: 'asc' } }),
    AppSchemaInvalidError,
  );
  await assert.rejects(
    () => manage.listRows('project-1', 'u1', 'notes', { filters: [{ column: 'body', operator: 'contains', value: 'сек' }] }),
    AppSchemaInvalidError,
  );
  assert.equal((await manage.listRows('project-1', 'u1', 'notes', { search: 'секретный' })).total, 0);
  assert.equal((await manage.listRows('project-1', 'u1', 'notes', { search: 'Заметка' })).total, 1);
});

test('переключение чувствительности пишется в аудит; снятие возвращает поле, если эвристика молчит', async () => {
  const { manage } = setup();
  await manage.setFieldSensitivity('project-1', 'u1', 'notes', 'title', 'pii');
  let page = await manage.listRows('project-1', 'u1', 'notes', {});
  assert.equal(page.masked['title'], 'pii');
  const logs = await manage.listLogs('project-1', 'u1', {});
  const changed = logs.rows.find((e) => e.operation === 'dashboard.sensitivity_changed');
  assert.ok(changed, 'снятие/установка флага пишется в аудит');
  assert.equal(changed!.detail?.['to'], 'pii');

  // Снятие: 'title' не ловится эвристикой → поле снова открыто.
  await manage.setFieldSensitivity('project-1', 'u1', 'notes', 'title', null);
  page = await manage.listRows('project-1', 'u1', 'notes', {});
  assert.equal(page.masked['title'], undefined);
});

test('снятие флага не раскрывает поле, чьё имя ловит эвристика', async () => {
  const { manage } = setup();
  // customers.api_key ловится эвристикой; даже если явный флаг снять, защита остаётся.
  await manage.setFieldSensitivity('project-1', 'u1', 'customers', 'api_key', null);
  const page = await manage.listRows('project-1', 'u1', 'customers', {});
  assert.equal(page.masked['api_key'], 'secret');
});

test('viewer не может менять чувствительность поля', async () => {
  const { manage } = setup('viewer');
  await assert.rejects(
    () => manage.setFieldSensitivity('project-1', 'u1', 'notes', 'title', 'secret'),
    InsufficientProjectRoleError,
  );
});

// --- Регрессии на дыры аудита раскрытия секретов ---

// V1: запись о раскрытии секрета переживает вытеснение per-project SQLite-буфера трафиком
// публичного App Runtime (>2000 событий). Раньше reveal писался в тот же буфер и вымывался
// ~2000 дешёвыми чтениями; теперь он в надёжном журнале (MariaDB) и всегда достаётся.
test('раскрытие секрета переживает 3000+ рантайм-событий приложения', async () => {
  const { manage, appDb } = setup();
  const created = await manage.insertRow('project-1', 'u1', 'customers', {
    name: 'Иван', email: 'ivan@mail.ru', api_key: 'sk-live-42',
  });
  const rowId = String(created['id']);
  await manage.revealRowValue('project-1', 'u1', 'customers', rowId, 'api_key');

  // Публичный App Runtime заваливает per-project _audit_log дешёвыми чтениями (actorType runtime).
  for (let i = 0; i < 3000; i++) {
    appDb.recordAudit('project-1', {
      actorType: 'runtime',
      actorId: null,
      operation: 'select',
      tableName: 'customers',
      detail: { count: 1 },
    });
  }

  // SQLite-буфер усечён до 2000 — рантайм-запись самого начала уже вытеснена.
  const runtimeOnly = appDb.listAudit('project-1', {});
  assert.equal(runtimeOnly.total <= 2000, true, 'SQLite-буфер усечён');
  assert.equal(runtimeOnly.rows.some((e) => e.operation === 'dashboard.reveal'), false,
    'раскрытия в SQLite-буфере нет — оно в надёжном журнале');

  // Раскрытие всё ещё достаётся из объединённой ленты (фильтр по операции).
  const revealLogs = await manage.listLogs('project-1', 'u1', { operation: 'dashboard.reveal' });
  assert.equal(revealLogs.total, 1);
  assert.equal(
    revealLogs.rows.some((e) => e.operation === 'dashboard.reveal' && e.rowId === rowId),
    true,
  );
});

// V2: подбор существующего значения секрета через нарушение UNIQUE не должен быть бесшумным
// оракулом. Ответ — НЕЙТРАЛЬНЫЙ (без имени колонки и без значения), а попытка пишется в аудит.
test('UNIQUE-конфликт по секретной колонке даёт нейтральную ошибку и пишет неудачную попытку в аудит', async () => {
  const { manage } = setup();
  await manage.insertRow('project-1', 'u1', 'api_tokens', { label: 'A', token: 'sk-secret-1' });

  await assert.rejects(
    () => manage.insertRow('project-1', 'u1', 'api_tokens', { label: 'B', token: 'sk-secret-1' }),
    (error: unknown) => {
      assert.ok(error instanceof AppDuplicateValueError, 'нейтральная ошибка дубликата');
      // Ни имени колонки, ни значения секрета в тексте ошибки.
      assert.equal(/token/i.test((error as Error).message), false, 'имя колонки не раскрыто');
      assert.equal(/sk-secret-1/.test((error as Error).message), false, 'значение не раскрыто');
      return true;
    },
  );

  // Неудачная попытка оставила след в надёжном журнале — канал существования не бесшумен.
  const logs = await manage.listLogs('project-1', 'u1', { errorsOnly: true });
  const failed = logs.rows.find((e) => e.operation === 'dashboard.insert' && e.success === false);
  assert.ok(failed, 'неудачная попытка вставки записана в аудит');
  assert.equal(failed!.detail?.['reason'], 'unique_conflict');
});

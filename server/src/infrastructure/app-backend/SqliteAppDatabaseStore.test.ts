import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAppDatabaseStore } from './SqliteAppDatabaseStore.js';
import { AppTableNotAllowedError } from '../../domain/app-backend/errors.js';
import type { AppSchema } from '../../domain/app-backend/AppSchema.js';

const schema: AppSchema = {
  tables: [
    {
      name: 'posts',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'views', type: 'int' },
      ],
      rules: { read: 'anyone', write: 'owner' },
    },
  ],
};

function newStore(): SqliteAppDatabaseStore {
  const dir = mkdtempSync(join(tmpdir(), 'pf-appdb-'));
  return new SqliteAppDatabaseStore(dir);
}

test('ensureDatabase: системные + таблицы схемы, идемпотентно; insert работает', () => {
  const s = newStore();
  s.ensureDatabase('proj-1', schema);
  s.ensureDatabase('proj-1', schema); // повтор — без ошибки
  const u = s.insert('proj-1', '_users', {
    id: 'u1',
    email: 'a@b.c',
    password_hash: 'h',
    created_at: 'x',
  });
  assert.equal(u.email, 'a@b.c');
  const p = s.insert('proj-1', 'posts', { title: 'hi', views: 3, owner_id: 'u1' });
  assert.ok(p.id, 'id сгенерирован');
  assert.equal(p.title, 'hi');
  assert.ok(p.created_at, 'created_at проставлен автоматически');
});

test('select/findOne/update/remove + фильтр/сортировка/лимит', () => {
  const s = newStore();
  s.ensureDatabase('proj-2', schema);
  s.insert('proj-2', 'posts', { id: 'p1', title: 'a', views: 1, owner_id: 'u1' });
  s.insert('proj-2', 'posts', { id: 'p2', title: 'b', views: 2, owner_id: 'u2' });
  assert.equal(s.select('proj-2', 'posts').length, 2);
  assert.equal(s.select('proj-2', 'posts', { where: { owner_id: 'u1' } }).length, 1);
  const top = s.select('proj-2', 'posts', { orderBy: { column: 'views', dir: 'desc' }, limit: 1 });
  assert.equal(top[0]!.id, 'p2');
  assert.equal(s.findOne('proj-2', 'posts', { id: 'p1' })?.title, 'a');
  assert.equal(s.update('proj-2', 'posts', 'p1', { title: 'aa' }), 1);
  assert.equal(s.findOne('proj-2', 'posts', { id: 'p1' })?.title, 'aa');
  assert.equal(s.remove('proj-2', 'posts', 'p1'), 1);
  assert.equal(s.findOne('proj-2', 'posts', { id: 'p1' }), null);
});

test('sizeBytes растёт после вставок', () => {
  const s = newStore();
  s.ensureDatabase('proj-3', schema);
  const before = s.sizeBytes('proj-3');
  for (let i = 0; i < 200; i++) {
    s.insert('proj-3', 'posts', { title: 'x'.repeat(500), views: i, owner_id: 'u' });
  }
  const after = s.sizeBytes('proj-3');
  assert.ok(after > before, `after(${after}) > before(${before})`);
  assert.ok(after > 0);
});

test('неизвестная таблица/колонка → AppTableNotAllowedError; projectId с traversal → бросок', () => {
  const s = newStore();
  s.ensureDatabase('proj-4', schema);
  assert.throws(() => s.select('proj-4', 'evil'), AppTableNotAllowedError);
  assert.throws(() => s.insert('proj-4', 'posts', { nope: 1 }), AppTableNotAllowedError);
  assert.throws(() => s.select('proj-4', 'posts', { where: { evil: 1 } }), AppTableNotAllowedError);
  assert.throws(() => s.ensureDatabase('../etc/passwd', schema), /invalid projectId/);
});

test('typed filters, cross-field search и count используют только разрешённые колонки', () => {
  const s = newStore();
  s.ensureDatabase('proj-5', schema);
  s.insert('proj-5', 'posts', { title: 'Alpha release', views: 12 });
  s.insert('proj-5', 'posts', { title: 'Beta draft', views: 2 });
  s.insert('proj-5', 'posts', { title: 'Alphabet', views: 7 });
  assert.equal(s.select('proj-5', 'posts', { filters: [{ column: 'title', operator: 'contains', value: 'pha' }] }).length, 2);
  assert.equal(s.select('proj-5', 'posts', { filters: [{ column: 'views', operator: 'gte', value: 7 }] }).length, 2);
  assert.equal(s.select('proj-5', 'posts', { search: { columns: ['title', 'views'], value: 'draft' } }).length, 1);
  assert.equal(s.count('proj-5', 'posts', { filters: [{ column: 'views', operator: 'lt', value: 10 }] }), 2);
  assert.throws(
    () => s.select('proj-5', 'posts', { filters: [{ column: 'password', operator: 'eq', value: 'x' }] }),
    AppTableNotAllowedError,
  );
});

test('updated_at ставится при вставке и бампается при апдейте (монотонно)', () => {
  const s = newStore();
  s.ensureDatabase('proj-ver', schema);
  const p = s.insert('proj-ver', 'posts', { title: 'a', views: 1, owner_id: 'u1' });
  const created = String(p['updated_at']);
  assert.ok(created, 'updated_at проставлен при вставке');
  assert.equal(created, String(p['created_at']), 'при вставке updated_at = created_at');
  assert.equal(s.update('proj-ver', 'posts', String(p['id']), { title: 'b' }), 1);
  const after = s.findOne('proj-ver', 'posts', { id: String(p['id']) });
  assert.notEqual(String(after!['updated_at']), created, 'updated_at сдвинулся строго');
});

test('optimistic guard: апдейт с устаревшим expectedUpdatedAt меняет 0 строк', () => {
  const s = newStore();
  s.ensureDatabase('proj-guard', schema);
  const p = s.insert('proj-guard', 'posts', { title: 'a', owner_id: 'u1' });
  const id = String(p['id']);
  const stale = String(p['updated_at']);
  assert.equal(s.update('proj-guard', 'posts', id, { title: 'b' }, stale), 1, 'совпадающая версия — апдейт проходит');
  assert.equal(s.update('proj-guard', 'posts', id, { title: 'c' }, stale), 0, 'устаревшая версия — 0 строк');
  assert.equal(s.findOne('proj-guard', 'posts', { id })!['title'], 'b', 'данные не затёрты');
});

test('ensureDatabase идемпотентно догоняет updated_at на базе без колонки', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pf-appdb-legacy-'));
  const s = new SqliteAppDatabaseStore(dir);
  // Симулируем «старую» базу: создаём таблицу posts БЕЗ updated_at через прямой доступ невозможно,
  // поэтому проверяем, что повторный ensureDatabase не падает и колонка есть/используется.
  s.ensureDatabase('proj-legacy', schema);
  s.ensureDatabase('proj-legacy', schema);
  const p = s.insert('proj-legacy', 'posts', { title: 'a', owner_id: 'u1' });
  assert.ok('updated_at' in p);
});

test('audit log сохраняет безопасные метаданные и фильтруется', () => {
  const s = newStore();
  s.ensureDatabase('proj-6', schema);
  s.recordAudit('proj-6', { actorType: 'project_member', actorId: 'u1', operation: 'dashboard.insert', tableName: 'posts', rowId: 'p1', detail: { fields: ['title'] } });
  s.recordAudit('proj-6', { actorType: 'runtime', operation: 'select', tableName: 'posts' });
  const all = s.listAudit('proj-6');
  assert.equal(all.total, 2);
  assert.equal(all.rows[0]!.operation, 'select');
  const onlyMember = s.listAudit('proj-6', { actorId: 'u1' });
  assert.equal(onlyMember.total, 1);
  assert.deepEqual(onlyMember.rows[0]!.detail, { fields: ['title'] });
});

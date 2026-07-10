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

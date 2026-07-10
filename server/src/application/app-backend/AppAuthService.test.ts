import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAppDatabaseStore } from '../../infrastructure/app-backend/SqliteAppDatabaseStore.js';
import { AppAuthService } from './AppAuthService.js';
import { AppAuthError, AppUserExistsError } from '../../domain/app-backend/errors.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'pf-appauth-'));
  const store = new SqliteAppDatabaseStore(dir);
  store.ensureDatabase('proj-1', { tables: [] });
  let n = 0;
  const svc = new AppAuthService({
    appDb: store,
    idGen: () => `u${++n}`,
    now: () => new Date('2026-07-10T00:00:00Z'),
  });
  return { store, svc };
}

test('signUp: создаёт юзера (пароль хеширован) + сессию; verify(token) → user', () => {
  const { store, svc } = setup();
  const r = svc.signUp('proj-1', 'A@B.com', 'secret');
  assert.equal(r.user.email, 'a@b.com'); // нормализован
  assert.ok(r.token);
  const urow = store.findOne('proj-1', '_users', { email: 'a@b.com' });
  assert.ok(urow);
  assert.notEqual(urow!.password_hash, 'secret'); // не плейн
  assert.equal(svc.verify('proj-1', r.token)?.email, 'a@b.com');
});

test('signUp: дубль email → AppUserExistsError', () => {
  const { svc } = setup();
  svc.signUp('proj-1', 'a@b.com', 'x');
  assert.throws(() => svc.signUp('proj-1', 'a@b.com', 'y'), AppUserExistsError);
});

test('signIn: верный пароль → токен; неверный/несуществующий → AppAuthError', () => {
  const { svc } = setup();
  svc.signUp('proj-1', 'a@b.com', 'secret');
  assert.ok(svc.signIn('proj-1', 'a@b.com', 'secret').token);
  assert.throws(() => svc.signIn('proj-1', 'a@b.com', 'wrong'), AppAuthError);
  assert.throws(() => svc.signIn('proj-1', 'nope@b.com', 'x'), AppAuthError);
});

test('verify: битый токен → null; signOut убивает сессию', () => {
  const { svc } = setup();
  const r = svc.signUp('proj-1', 'a@b.com', 'secret');
  assert.equal(svc.verify('proj-1', 'garbage'), null);
  assert.equal(svc.verify('proj-1', r.token)?.email, 'a@b.com');
  svc.signOut('proj-1', r.token);
  assert.equal(svc.verify('proj-1', r.token), null);
});

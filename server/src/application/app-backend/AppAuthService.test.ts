import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAppDatabaseStore } from '../../infrastructure/app-backend/SqliteAppDatabaseStore.js';
import { AppAuthService, type GoogleIdentity, type GoogleOAuthProvider } from './AppAuthService.js';
import { AppAuthError, AppUserExistsError } from '../../domain/app-backend/errors.js';

// Фейк провайдера Google: не ходит в сеть, возвращает заранее заданную личность или бросает.
// Так проверяем логику application (state/CSRF/redirect_uri/аудит) без реального Google.
function fakeGoogle(identity: GoogleIdentity | Error): GoogleOAuthProvider & { calls: number } {
  return {
    calls: 0,
    async exchangeAndVerify() {
      (this as { calls: number }).calls += 1;
      if (identity instanceof Error) throw identity;
      return identity;
    },
  };
}

function setup(google?: GoogleOAuthProvider) {
  const dir = mkdtempSync(join(tmpdir(), 'pf-appauth-'));
  const store = new SqliteAppDatabaseStore(dir);
  store.ensureDatabase('proj-1', { tables: [] });
  let n = 0;
  const svc = new AppAuthService({
    appDb: store,
    idGen: () => `u${++n}`,
    now: () => new Date('2026-07-10T00:00:00Z'),
    secret: 'test-oauth-secret',
    ...(google ? { google } : {}),
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

// ── Аудит входа (срез 2 — событие видно в единой ленте логов) ────────────────────────────────

test('signIn/signUp пишут app.user.sign_in в per-project аудит', () => {
  const { store, svc } = setup();
  svc.signUp('proj-1', 'a@b.com', 'secret'); // → sign_up + sign_in
  svc.signIn('proj-1', 'a@b.com', 'secret'); // → sign_in
  const { rows } = store.listAudit('proj-1', { operation: 'app.user.sign_in' });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.actorType === 'runtime' && r.success));
});

test('signIn неуспех пишет неуспешный sign_in без email/пароля', () => {
  const { store, svc } = setup();
  svc.signUp('proj-1', 'a@b.com', 'secret');
  assert.throws(() => svc.signIn('proj-1', 'a@b.com', 'wrong'), AppAuthError);
  const { rows } = store.listAudit('proj-1', { operation: 'app.user.sign_in', errorsOnly: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.actorId, null);
  const detail = JSON.stringify(rows[0]!.detail);
  assert.ok(!detail.includes('a@b.com') && !detail.includes('wrong')); // без PII/пароля
});

// ── Конфиг Google-провайдера ──────────────────────────────────────────────────────────────────

test('setGoogleConfig: сохраняет; статус НИКОГДА не содержит секрет', () => {
  const { store, svc } = setup();
  const status = svc.setGoogleConfig('proj-1', { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'topsecret', enabled: true });
  assert.equal(status.configured, true);
  assert.equal(status.enabled, true);
  assert.equal(status.clientId, 'cid.apps.googleusercontent.com');
  assert.equal(JSON.stringify(status).includes('topsecret'), false);
  // Секрет на диске зашифрован, не в открытом виде.
  const row = store.findOne('proj-1', '_meta', { key: 'auth.google' });
  assert.ok(row && !String(row.value).includes('topsecret'));
});

test('setGoogleConfig: пустой секрет при существующем конфиге сохраняет прежний', () => {
  const { svc } = setup(fakeGoogle({ sub: 's', email: 'g@x.com', emailVerified: true }));
  svc.setGoogleConfig('proj-1', { clientId: 'cid', clientSecret: 'sec1', enabled: false });
  const status = svc.setGoogleConfig('proj-1', { clientId: 'cid', clientSecret: '', enabled: true });
  assert.equal(status.enabled, true);
  assert.equal(status.configured, true);
});

test('setGoogleConfig: без client_id или без секрета (на пустом) → ошибка', () => {
  const { svc } = setup();
  assert.throws(() => svc.setGoogleConfig('proj-1', { clientId: '', clientSecret: 's', enabled: true }), AppAuthError);
  assert.throws(() => svc.setGoogleConfig('proj-1', { clientId: 'cid', clientSecret: '', enabled: true }), AppAuthError);
});

test('disableGoogle: снимает enabled, конфиг остаётся', () => {
  const { svc } = setup();
  svc.setGoogleConfig('proj-1', { clientId: 'cid', clientSecret: 'sec', enabled: true });
  const status = svc.disableGoogle('proj-1');
  assert.equal(status.enabled, false);
  assert.equal(status.configured, true);
});

// ── OAuth flow ────────────────────────────────────────────────────────────────────────────────

const REDIRECT = 'https://app.projectsflow.ru/api/auth/google/callback';

function begin(svc: AppAuthService) {
  svc.setGoogleConfig('proj-1', { clientId: 'cid', clientSecret: 'sec', enabled: true });
  return svc.beginGoogleSignIn('proj-1', { redirectUri: REDIRECT, returnTo: '/dashboard' });
}

test('beginGoogleSignIn: без включённого провайдера → ошибка', () => {
  const { svc } = setup();
  assert.throws(() => svc.beginGoogleSignIn('proj-1', { redirectUri: REDIRECT }), AppAuthError);
});

test('beginGoogleSignIn: собирает URL Google со state/nonce и client_id', () => {
  const { svc } = setup();
  const { authorizationUrl, state, nonce } = begin(svc);
  const url = new URL(authorizationUrl);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(url.searchParams.get('state'), state);
  assert.equal(url.searchParams.get('nonce'), nonce);
  assert.equal(url.searchParams.get('scope'), 'openid email');
});

test('completeGoogleSignIn: happy path — заводит пользователя, сессию, sign_in в аудит', async () => {
  const google = fakeGoogle({ sub: 'g-1', email: 'New@Gmail.com', emailVerified: true });
  const { store, svc } = setup(google);
  const { state, nonce } = begin(svc);
  const { session, returnTo } = await svc.completeGoogleSignIn('proj-1', { code: 'authcode', state, cookieNonce: nonce, redirectUri: REDIRECT });
  assert.equal(session.user.email, 'new@gmail.com');
  assert.equal(returnTo, '/dashboard');
  assert.equal(svc.verify('proj-1', session.token)?.email, 'new@gmail.com');
  assert.equal(google.calls, 1);
  const { rows } = store.listAudit('proj-1', { operation: 'app.user.sign_in' });
  assert.equal(rows.length, 1);
  assert.equal(JSON.stringify(rows[0]!.detail), JSON.stringify({ provider: 'google' }));
  // OAuth-пользователь не входит паролем (password_hash — непроверяемый плейсхолдер).
  assert.throws(() => svc.signIn('proj-1', 'new@gmail.com', 'anything'), AppAuthError);
});

test('completeGoogleSignIn: повторный вход тем же email не плодит пользователя (линкинг)', async () => {
  const google = fakeGoogle({ sub: 'g-1', email: 'again@gmail.com', emailVerified: true });
  const { store, svc } = setup(google);
  const a = begin(svc);
  await svc.completeGoogleSignIn('proj-1', { code: 'c1', state: a.state, cookieNonce: a.nonce, redirectUri: REDIRECT });
  const b = svc.beginGoogleSignIn('proj-1', { redirectUri: REDIRECT });
  await svc.completeGoogleSignIn('proj-1', { code: 'c2', state: b.state, cookieNonce: b.nonce, redirectUri: REDIRECT });
  assert.equal(store.count('proj-1', '_users', { where: { email: 'again@gmail.com' } }), 1);
});

// ── Безопасность: state/CSRF, redirect_uri, id_token ────────────────────────────────────────

test('completeGoogleSignIn: подделанный state → отказ (CSRF/tamper)', async () => {
  const { svc } = setup(fakeGoogle({ sub: 'g', email: 'x@x.com', emailVerified: true }));
  const { nonce } = begin(svc);
  await assert.rejects(
    () => svc.completeGoogleSignIn('proj-1', { code: 'c', state: 'forged.signature', cookieNonce: nonce, redirectUri: REDIRECT }),
    AppAuthError,
  );
});

test('completeGoogleSignIn: cookie nonce ≠ state nonce → отказ (двойная проверка)', async () => {
  const { svc } = setup(fakeGoogle({ sub: 'g', email: 'x@x.com', emailVerified: true }));
  const { state } = begin(svc);
  await assert.rejects(
    () => svc.completeGoogleSignIn('proj-1', { code: 'c', state, cookieNonce: 'other-nonce', redirectUri: REDIRECT }),
    AppAuthError,
  );
});

test('completeGoogleSignIn: несовпадение redirect_uri → отказ', async () => {
  const { svc } = setup(fakeGoogle({ sub: 'g', email: 'x@x.com', emailVerified: true }));
  const { state, nonce } = begin(svc);
  await assert.rejects(
    () => svc.completeGoogleSignIn('proj-1', { code: 'c', state, cookieNonce: nonce, redirectUri: 'https://evil.example/callback' }),
    AppAuthError,
  );
});

test('completeGoogleSignIn: email не подтверждён → отказ, пользователь не создан', async () => {
  const { store, svc } = setup(fakeGoogle({ sub: 'g', email: 'unverified@x.com', emailVerified: false }));
  const { state, nonce } = begin(svc);
  await assert.rejects(
    () => svc.completeGoogleSignIn('proj-1', { code: 'c', state, cookieNonce: nonce, redirectUri: REDIRECT }),
    AppAuthError,
  );
  assert.equal(store.findOne('proj-1', '_users', { email: 'unverified@x.com' }), null);
  const { rows } = store.listAudit('proj-1', { operation: 'app.user.sign_in', errorsOnly: true });
  assert.equal(rows.length, 1);
});

test('completeGoogleSignIn: провайдер бросил (плохая подпись/aud) → отказ + неуспешный аудит', async () => {
  const { store, svc } = setup(fakeGoogle(new Error('aud mismatch')));
  const { state, nonce } = begin(svc);
  await assert.rejects(
    () => svc.completeGoogleSignIn('proj-1', { code: 'c', state, cookieNonce: nonce, redirectUri: REDIRECT }),
    AppAuthError,
  );
  const { rows } = store.listAudit('proj-1', { operation: 'app.user.sign_in', errorsOnly: true });
  assert.equal(rows.length, 1);
});

test('completeGoogleSignIn: без серверного провайдера → честный отказ', async () => {
  const { svc } = setup(); // без google
  svc.setGoogleConfig('proj-1', { clientId: 'cid', clientSecret: 'sec', enabled: true });
  const { state, nonce } = svc.beginGoogleSignIn('proj-1', { redirectUri: REDIRECT });
  await assert.rejects(
    () => svc.completeGoogleSignIn('proj-1', { code: 'c', state, cookieNonce: nonce, redirectUri: REDIRECT }),
    AppAuthError,
  );
});

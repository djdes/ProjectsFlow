import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '../../domain/session/Session.js';
import type { User } from '../../domain/user/User.js';
import { GetCurrentUser } from './GetCurrentUser.js';
import { Impersonation, ImpersonationError } from './Impersonation.js';

const NOW = new Date('2026-11-03T10:00:00Z');
const user = (id: string, isAdmin = false): User =>
  ({ id, email: `${id}@t`, displayName: id, avatarUrl: null, isAdmin, createdAt: NOW }) as User;

function make() {
  const users = new Map<string, User>([['admin', user('admin', true)], ['vasya', user('vasya')]]);
  const sessions = new Map<string, Session>();
  sessions.set('s-admin', {
    id: 's-admin', userId: 'admin', expiresAt: new Date(NOW.getTime() + 86_400_000), createdAt: NOW, impersonatorSessionId: null,
  });
  let seq = 0;
  const deps = {
    users: { getById: async (id: string) => users.get(id) ?? null } as never,
    sessions: {
      async create(input: { id: string; userId: string; expiresAt: Date; impersonatorSessionId?: string | null }) {
        const s = { ...input, createdAt: NOW, impersonatorSessionId: input.impersonatorSessionId ?? null };
        sessions.set(s.id, s);
        return s;
      },
      getById: async (id: string) => sessions.get(id) ?? null,
      delete: async (id: string) => void sessions.delete(id),
      deleteAllForUser: async () => {},
      deleteExpired: async () => 0,
    },
    idGen: () => `s${++seq}`,
    now: () => NOW,
  };
  return { users, sessions, imp: new Impersonation(deps), current: new GetCurrentUser(deps) };
}

test('администратор входит от имени пользователя и возвращается в свою сессию', async () => {
  const { imp, current, sessions } = make();
  const session = await imp.start(user('admin', true), 's-admin', 'vasya');
  const seen = await current.execute(session.id);
  // Права — ровно пользовательские: интерфейс его глазами, без admin-bypass.
  assert.equal(seen?.user.id, 'vasya');
  assert.equal(seen?.user.isAdmin, false);
  assert.deepEqual(seen?.impersonatedBy, { id: 'admin', displayName: 'admin' });

  const back = await imp.stop(session.id);
  assert.equal(back.id, 's-admin');
  assert.equal(sessions.has(session.id), false);
});

test('вход от имени гаснет вместе с сессией администратора и не вкладывается', async () => {
  const { imp, current, sessions } = make();
  const session = await imp.start(user('admin', true), 's-admin', 'vasya');
  await assert.rejects(imp.start(user('admin', true), session.id, 'vasya'), (e) => e instanceof ImpersonationError && e.code === 'already_impersonating');
  await assert.rejects(imp.start(user('admin', true), 's-admin', 'admin'), (e) => e instanceof ImpersonationError && e.code === 'cannot_impersonate_self');
  await assert.rejects(imp.start(user('vasya'), 's-admin', 'admin'), (e) => e instanceof ImpersonationError && e.code === 'not_admin');

  sessions.delete('s-admin');
  assert.equal(await current.execute(session.id), null);
  assert.equal(sessions.has(session.id), false);
});

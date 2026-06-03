import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDefaultAiDispatcher } from './resolveDefaultAiDispatcher.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { AgentTokenRepository } from '../agent/AgentTokenRepository.js';

// --- Минимальные in-memory фейки (тест гоняется через tsx + node:test, без новых deps) ---

type FakeUser = { id: string; email: string; isAdmin: boolean };

function fakes(users: FakeUser[], activeTokensByUser: Record<string, number>) {
  const userRepo = {
    getByEmail: async (email: string) =>
      users.find((u) => u.email === email) ?? null,
    // pickDefaultDispatcherUserId опирается на порядок listAdmins (createdAt asc) —
    // здесь порядок массива = порядок «первый админ».
    listAdmins: async () => users.filter((u) => u.isAdmin),
  } as unknown as UserRepository;

  const agentTokens = {
    countActiveByUser: async (userId: string) => activeTokensByUser[userId] ?? 0,
  } as unknown as AgentTokenRepository;

  return { userRepo, agentTokens };
}

const ADMIN: FakeUser = { id: 'admin-1', email: 'admin@projectsflow.ru', isAdmin: true };
const NON_ADMIN: FakeUser = { id: 'user-1', email: 'bugdenes@gmail.com', isAdmin: false };

test('email указывает на юзера с активным токеном → возвращает его', async () => {
  const { userRepo, agentTokens } = fakes([ADMIN, NON_ADMIN], { 'admin-1': 1 });
  const got = await resolveDefaultAiDispatcher({
    email: 'admin@projectsflow.ru',
    users: userRepo,
    agentTokens,
  });
  assert.equal(got, 'admin-1');
});

test('email-override работает и для не-админа, если у него есть токен', async () => {
  // Будущий сценарий: bugdenes получает токен и под ним крутится воркер.
  const { userRepo, agentTokens } = fakes([ADMIN, NON_ADMIN], { 'user-1': 2, 'admin-1': 1 });
  const got = await resolveDefaultAiDispatcher({
    email: 'bugdenes@gmail.com',
    users: userRepo,
    agentTokens,
  });
  assert.equal(got, 'user-1');
});

test('email указывает на юзера БЕЗ токена → фоллбэк на первого админа с токеном', async () => {
  // Это ровно кейс bugdenes@gmail.com на проде сегодня: юзер есть, токен есть,
  // но... тут моделируем «токена нет» → должны упасть на admin.
  const { userRepo, agentTokens } = fakes([ADMIN, NON_ADMIN], { 'admin-1': 1 });
  const got = await resolveDefaultAiDispatcher({
    email: 'bugdenes@gmail.com',
    users: userRepo,
    agentTokens,
  });
  assert.equal(got, 'admin-1');
});

test('email указывает на несуществующего юзера → фоллбэк на админа', async () => {
  const { userRepo, agentTokens } = fakes([ADMIN], { 'admin-1': 1 });
  const got = await resolveDefaultAiDispatcher({
    email: 'ghost@nowhere.test',
    users: userRepo,
    agentTokens,
  });
  assert.equal(got, 'admin-1');
});

test('env не задан (пустая строка) → фоллбэк на первого админа с токеном (регрессия исходного бага)', async () => {
  // Раньше пустой env давал null → AiPromptDispatcherNotConfiguredError → «AI не настроен».
  const { userRepo, agentTokens } = fakes([ADMIN, NON_ADMIN], { 'admin-1': 1 });
  const got = await resolveDefaultAiDispatcher({ email: '', users: userRepo, agentTokens });
  assert.equal(got, 'admin-1');
});

test('нет ни одного админа с активным токеном → null', async () => {
  const { userRepo, agentTokens } = fakes([ADMIN, NON_ADMIN], { 'user-1': 3 });
  const got = await resolveDefaultAiDispatcher({ email: '', users: userRepo, agentTokens });
  assert.equal(got, null);
});

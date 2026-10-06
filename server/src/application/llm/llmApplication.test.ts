import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LlmAccessService } from './LlmAccessService.js';
import { LlmConnectionService } from './LlmConnectionService.js';
import { LlmRouter } from './LlmRouter.js';
import { LlmSettingsService } from './LlmSettingsService.js';
import { LlmTextGenerator } from './LlmTextGenerator.js';
import type { LlmDeviceAuthClient, LlmTokenGrant } from './LlmDeviceAuthClient.js';
import type { LlmAccess, LlmTextRequest, LlmTextResult, LlmTransport } from './LlmTransport.js';
import { InMemoryLlmConnections, InMemoryLlmDeviceLogins, InMemoryLlmSettings } from './llmTestDoubles.js';
import {
  LlmNotConnectedError,
  LlmRateLimitedError,
  LlmReauthRequiredError,
  LlmRefreshRejectedError,
  LlmUnauthorizedError,
} from '../../domain/llm/errors.js';

const NOW = new Date('2026-10-06T10:00:00Z');
const now = (): Date => NOW;

function grant(access: string, refresh: string | null = 'refresh-2'): LlmTokenGrant {
  return {
    credentials: { accessToken: access, refreshToken: refresh, idToken: null },
    account: { accountId: 'acc_1', email: 'owner@example.com', planType: 'plus', accessExpiresAt: new Date('2026-10-16T10:00:00Z') },
  };
}

function authClient(overrides: Partial<LlmDeviceAuthClient> = {}): LlmDeviceAuthClient & { refreshCalls: number } {
  const client = {
    refreshCalls: 0,
    async requestDeviceCode() {
      return { userCode: 'ABCD-1234', deviceAuthId: 'dev-1', verificationUrl: 'https://auth.openai.com/codex/device', intervalSec: 5, expiresInSec: 900 };
    },
    async pollDeviceCode() {
      return { status: 'pending' as const };
    },
    async refresh(): Promise<LlmTokenGrant> {
      client.refreshCalls++;
      await new Promise((r) => setTimeout(r, 5));
      return grant(`access-refreshed-${client.refreshCalls}`);
    },
    ...overrides,
  };
  return client;
}

test('access: свежий токен отдаётся без обновления', async () => {
  const connections = new InMemoryLlmConnections();
  const conn = connections.seed({});
  const client = authClient();
  const access = new LlmAccessService({ connections, authClient: client, now });
  const result = await access.acquire(conn.id);
  assert.equal(result.access.accessToken, 'access-1');
  assert.equal(client.refreshCalls, 0);
});

test('access: истекающий токен обновляется один раз даже при параллельных запросах', async () => {
  const connections = new InMemoryLlmConnections();
  const conn = connections.seed({ accessExpiresAt: new Date(NOW.getTime() + 60_000) });
  const client = authClient();
  const access = new LlmAccessService({ connections, authClient: client, now });
  const results = await Promise.all([access.acquire(conn.id), access.acquire(conn.id), access.acquire(conn.id)]);
  assert.equal(client.refreshCalls, 1);
  for (const r of results) assert.equal(r.access.accessToken, 'access-refreshed-1');
  const creds = await connections.getCredentials(conn.id);
  assert.equal(creds?.refreshToken, 'refresh-2');
});

test('access: после 401 обновляет, но не повторяет обновление, если токен уже сменили', async () => {
  const connections = new InMemoryLlmConnections();
  const conn = connections.seed({});
  const client = authClient();
  const access = new LlmAccessService({ connections, authClient: client, now });
  const first = await access.acquire(conn.id, { rejectedAccessToken: 'access-1' });
  assert.equal(first.access.accessToken, 'access-refreshed-1');
  // Второй запрос получил 401 на старый токен, но в БД уже новый — обновлять снова нельзя.
  const second = await access.acquire(conn.id, { rejectedAccessToken: 'access-1' });
  assert.equal(second.access.accessToken, 'access-refreshed-1');
  assert.equal(client.refreshCalls, 1);
});

test('access: отказ refresh-токена переводит подключение в reauth_required', async () => {
  const connections = new InMemoryLlmConnections();
  const conn = connections.seed({ accessExpiresAt: new Date(NOW.getTime() - 1000) });
  const client = authClient({
    async refresh(): Promise<LlmTokenGrant> {
      throw new LlmRefreshRejectedError('refresh_token_reused');
    },
  });
  const access = new LlmAccessService({ connections, authClient: client, now });
  await assert.rejects(access.acquire(conn.id), LlmReauthRequiredError);
  const after = await connections.findById(conn.id);
  assert.equal(after?.status, 'reauth_required');
  assert.equal(after?.lastError, 'refresh_token_reused');
});

test('router: без подключения — LlmNotConnectedError, в лимите — LlmRateLimitedError', async () => {
  const connections = new InMemoryLlmConnections();
  const router = new LlmRouter({ connections, provider: 'chatgpt', now });
  await assert.rejects(router.resolve({ billedUserId: 'u1' }), LlmNotConnectedError);
  connections.seed({ rateLimitedUntil: new Date(NOW.getTime() + 60_000) });
  await assert.rejects(router.resolve({ billedUserId: 'u1' }), LlmRateLimitedError);
});

test('router: личное подключение пользователя важнее платформенного', async () => {
  const connections = new InMemoryLlmConnections();
  const platform = connections.seed({});
  const own = connections.seed({ owner: { scope: 'user', userId: 'u1' } });
  const router = new LlmRouter({ connections, provider: 'chatgpt', now });
  assert.equal((await router.resolve({ billedUserId: 'u1' })).id, own.id);
  assert.equal((await router.resolve({ billedUserId: 'u2' })).id, platform.id);
});

function makeGenerator(transport: LlmTransport, connections = new InMemoryLlmConnections()) {
  const client = authClient();
  const access = new LlmAccessService({ connections, authClient: client, now });
  const settings = new LlmSettingsService({ settings: new InMemoryLlmSettings() });
  const generator = new LlmTextGenerator({
    router: new LlmRouter({ connections, provider: 'chatgpt', now }),
    access,
    transport,
    settings,
    connections,
    now,
  });
  return { generator, connections, client };
}

const okResult = (text: string): LlmTextResult => ({
  text,
  model: 'gpt-6-luna',
  usage: { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000, reasoningTokens: 0 },
  rateLimits: null,
});

test('generator: быстрая модель для tier=fast и стоимость по прайсу', async () => {
  const requests: LlmTextRequest[] = [];
  const transport: LlmTransport = {
    async generateText(_a: LlmAccess, req: LlmTextRequest) {
      requests.push(req);
      return okResult('ответ');
    },
    async forward() {
      throw new Error('not used');
    },
  };
  const { generator, connections } = makeGenerator(transport);
  connections.seed({});
  const result = await generator.generate({ billedUserId: 'u1', tier: 'fast', instructions: 'i', input: 'x', timeoutMs: 1000 });
  assert.equal(requests[0]?.model, 'gpt-6-luna');
  assert.equal(requests[0]?.reasoningEffort, 'low');
  assert.equal(result.text, 'ответ');
  // gpt-6-luna: $0.10 за 1M входа + $0.50 за 1M выхода.
  assert.ok(Math.abs((result.costUsd ?? 0) - 0.6) < 1e-9);
});

test('generator: на 401 обновляет токен и повторяет запрос один раз', async () => {
  const seen: string[] = [];
  const transport: LlmTransport = {
    async generateText(access: LlmAccess) {
      seen.push(access.accessToken);
      if (access.accessToken === 'access-1') throw new LlmUnauthorizedError();
      return okResult('ok');
    },
    async forward() {
      throw new Error('not used');
    },
  };
  const { generator, connections, client } = makeGenerator(transport);
  connections.seed({});
  const result = await generator.generate({ billedUserId: null, tier: 'default', instructions: 'i', input: 'x', timeoutMs: 1000 });
  assert.equal(result.text, 'ok');
  assert.deepEqual(seen, ['access-1', 'access-refreshed-1']);
  assert.equal(client.refreshCalls, 1);
});

test('generator: 429 ставит подключение на паузу до времени сброса', async () => {
  const resetsAt = new Date(NOW.getTime() + 3_600_000);
  const transport: LlmTransport = {
    async generateText() {
      throw new LlmRateLimitedError(resetsAt);
    },
    async forward() {
      throw new Error('not used');
    },
  };
  const { generator, connections } = makeGenerator(transport);
  const conn = connections.seed({});
  await assert.rejects(
    generator.generate({ billedUserId: null, tier: 'fast', instructions: 'i', input: 'x', timeoutMs: 1000 }),
    LlmRateLimitedError,
  );
  assert.deepEqual((await connections.findById(conn.id))?.rateLimitedUntil, resetsAt);
});

test('connection service: код → ожидание → подключено, вход удаляется', async () => {
  const connections = new InMemoryLlmConnections();
  const deviceLogins = new InMemoryLlmDeviceLogins();
  let approved = false;
  const client = authClient({
    async pollDeviceCode() {
      return approved ? { status: 'approved' as const, grant: grant('access-new') } : { status: 'pending' as const };
    },
  });
  const settings = new LlmSettingsService({ settings: new InMemoryLlmSettings() });
  const service = new LlmConnectionService({
    provider: 'chatgpt',
    connections,
    deviceLogins,
    authClient: client,
    access: new LlmAccessService({ connections, authClient: client, now }),
    transport: { generateText: async () => okResult('готово'), forward: async () => { throw new Error('x'); } },
    settings,
    now,
  });
  const owner = { scope: 'platform' } as const;
  const login = await service.startLogin({ owner, actorUserId: 'admin' });
  assert.equal(login.userCode, 'ABCD-1234');
  assert.deepEqual(login.expiresAt, new Date(NOW.getTime() + 900_000));
  assert.equal((await service.pollLogin(owner)).status, 'pending');
  approved = true;
  const done = await service.pollLogin(owner);
  assert.equal(done.status, 'connected');
  assert.equal((await service.getStatus(owner)).pendingLogin, null);
  assert.equal((await connections.getCredentials((await connections.findByOwner(owner, 'chatgpt'))!.id))?.accessToken, 'access-new');
  assert.equal((await service.pollLogin(owner)).status, 'idle');
});

test('settings: умолчания, проверка очередей и имён моделей', async () => {
  const service = new LlmSettingsService({ settings: new InMemoryLlmSettings() });
  const initial = await service.get();
  assert.equal(initial.defaultModel, 'gpt-6.1-sol');
  assert.equal(initial.fastModel, 'gpt-6-luna');
  assert.deepEqual(initial.serverQueues, []);
  const updated = await service.update({ actorUserId: 'admin', serverQueues: ['ai_prompt', 'ai_prompt'], fastModel: 'gpt-5.6-luna' });
  assert.deepEqual(updated.serverQueues, ['ai_prompt']);
  assert.equal(updated.fastModel, 'gpt-5.6-luna');
  await assert.rejects(service.update({ actorUserId: 'admin', serverQueues: ['bogus'] }));
  await assert.rejects(service.update({ actorUserId: 'admin', defaultModel: 'bad model; drop' }));
});

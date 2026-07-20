import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import type { ProjectWebhookRecord, ProjectWebhookRepository } from './ManageWebhooks.js';
import {
  DispatchWebhook,
  assertPublicWebhookTarget,
  isPrivateAddress,
  signWebhookPayload,
} from './DispatchWebhook.js';

const NOW = new Date('2026-07-20T10:00:00.000Z');
// Литеральный публичный IPv4: dns.lookup резолвит его без сети, поэтому SSRF-гейт проходит
// детерминированно (fetch всё равно замокан — реальная сеть не задействуется).
const PUBLIC_URL = 'https://93.184.216.34/hook';

function makeRecord(overrides: Partial<ProjectWebhookRecord> = {}): ProjectWebhookRecord {
  return {
    id: 'wh-1',
    projectId: 'project-1',
    url: PUBLIC_URL,
    events: ['task.created'],
    enabled: true,
    lastStatus: null,
    lastAt: null,
    createdAt: NOW.toISOString(),
    secretHash: 'a'.repeat(64),
    ...overrides,
  };
}

class FakeWebhookRepo implements ProjectWebhookRepository {
  constructor(private records: ProjectWebhookRecord[]) {}
  deliveries: { id: string; status: string }[] = [];
  async listByProject(): Promise<readonly ProjectWebhookRecord[]> {
    return this.records;
  }
  async getById(): Promise<ProjectWebhookRecord | null> {
    return this.records[0] ?? null;
  }
  async countByProject(): Promise<number> {
    return this.records.length;
  }
  async insert(): Promise<void> {}
  async update(): Promise<ProjectWebhookRecord | null> {
    return null;
  }
  async delete(): Promise<boolean> {
    return false;
  }
  async recordDelivery(id: string, status: string): Promise<void> {
    this.deliveries.push({ id, status });
  }
}

// --- SSRF guard (обязательный тест раздела 6) ---------------------------------------------

test('isPrivateAddress ловит приватные/loopback/link-local диапазоны', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.10.10',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
  ]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} должен считаться приватным`);
  }
});

test('isPrivateAddress пропускает публичные адреса', () => {
  for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, `${ip} должен считаться публичным`);
  }
});

test('assertPublicWebhookTarget отклоняет http://127.0.0.1:4317 (SSRF)', async () => {
  await assert.rejects(
    () => assertPublicWebhookTarget('http://127.0.0.1:4317'),
    /blocked_/,
  );
});

test('assertPublicWebhookTarget отклоняет https loopback и приватные IP', async () => {
  await assert.rejects(() => assertPublicWebhookTarget('https://127.0.0.1/hook'), /blocked_private_ip/);
  await assert.rejects(() => assertPublicWebhookTarget('https://10.0.0.9/hook'), /blocked_private_ip/);
  await assert.rejects(() => assertPublicWebhookTarget('https://[::1]/hook'), /blocked_private_ip/);
});

test('assertPublicWebhookTarget отклоняет не-https и креды в URL', async () => {
  await assert.rejects(() => assertPublicWebhookTarget('http://93.184.216.34/hook'), /blocked_scheme/);
  await assert.rejects(() => assertPublicWebhookTarget('https://user:pw@93.184.216.34/hook'), /blocked_credentials/);
});

test('assertPublicWebhookTarget пропускает публичный литеральный IP и ВОЗВРАЩАЕТ его для pinning', async () => {
  // Возврат валидированных адресов закрывает DNS-rebinding (TOCTOU): доставка коннектится
  // к этим IP, а не резолвит хост заново между проверкой и fetch. Без возврата гард
  // проверял бы один адрес, а undici соединялся бы с другим (приватным).
  const ips = await assertPublicWebhookTarget(PUBLIC_URL);
  assert.deepEqual([...ips], ['93.184.216.34']);
});

// --- Доставка ------------------------------------------------------------------------------

test('dispatch доставляет подписанный POST подписанному вебхуку', async () => {
  const repo = new FakeWebhookRepo([makeRecord()]);
  const captured: { url?: string; init?: RequestInit } = {};
  const dispatcher = new DispatchWebhook({
    webhooks: repo,
    now: () => NOW,
    idGen: () => 'delivery-1',
    fetchImpl: async (url, init) => {
      captured.url = url;
      captured.init = init;
      return new Response('ok', { status: 200 });
    },
  });

  await dispatcher.dispatch('project-1', 'task.created', { taskId: 't-1' });

  assert.equal(captured.url, PUBLIC_URL);
  assert.equal(captured.init?.method, 'POST');
  assert.equal(captured.init?.redirect, 'error');
  const headers = captured.init?.headers as Record<string, string>;
  assert.equal(headers['x-projectsflow-event'], 'task.created');
  const body = captured.init?.body as string;
  const parsed = JSON.parse(body) as { event: string; data: { taskId: string } };
  assert.equal(parsed.event, 'task.created');
  assert.equal(parsed.data.taskId, 't-1');

  // Подпись = HMAC-SHA256(key=secretHash, `${timestamp}.${body}`), проверяемо получателем.
  const expected = createHmac('sha256', 'a'.repeat(64))
    .update(`${NOW.toISOString()}.${body}`)
    .digest('hex');
  assert.equal(headers['x-projectsflow-signature'], `sha256=${expected}`);
  assert.equal(signWebhookPayload('a'.repeat(64), NOW.toISOString(), body), expected);

  assert.deepEqual(repo.deliveries, [{ id: 'wh-1', status: 'ok:200' }]);
});

test('dispatch не шлёт вебхуку без подписки на событие и выключенному', async () => {
  let calls = 0;
  const repo = new FakeWebhookRepo([
    makeRecord({ id: 'a', events: ['task.updated'] }),
    makeRecord({ id: 'b', events: ['*'], enabled: false }),
  ]);
  const dispatcher = new DispatchWebhook({
    webhooks: repo,
    fetchImpl: async () => {
      calls += 1;
      return new Response('ok', { status: 200 });
    },
  });
  await dispatcher.dispatch('project-1', 'task.created', {});
  assert.equal(calls, 0);
});

test('dispatch к приватной цели не делает сетевой вызов и пишет error:private_ip', async () => {
  let calls = 0;
  const repo = new FakeWebhookRepo([makeRecord({ url: 'https://127.0.0.1/hook' })]);
  const dispatcher = new DispatchWebhook({
    webhooks: repo,
    now: () => NOW,
    fetchImpl: async () => {
      calls += 1;
      return new Response('ok', { status: 200 });
    },
  });
  await dispatcher.dispatch('project-1', 'task.created', {});
  assert.equal(calls, 0);
  assert.deepEqual(repo.deliveries, [{ id: 'wh-1', status: 'error:private_ip' }]);
});

test('deliverTest шлёт событие webhook.ping', async () => {
  const repo = new FakeWebhookRepo([makeRecord()]);
  let event: string | undefined;
  const dispatcher = new DispatchWebhook({
    webhooks: repo,
    fetchImpl: async (_url, init) => {
      const headers = init.headers as Record<string, string>;
      event = headers['x-projectsflow-event'];
      return new Response(null, { status: 204 });
    },
  });
  const result = await dispatcher.deliverTest(makeRecord());
  assert.equal(event, 'webhook.ping');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ok:204');
});

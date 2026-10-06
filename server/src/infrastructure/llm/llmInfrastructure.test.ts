import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenCipher } from './TokenCipher.js';
import { chatgptAccountInfo, readJwtClaims } from './chatgptClaims.js';
import { parseSseEvents } from './sse.js';
import { extractResponse, rateLimitResetFrom, toTransportError } from './ChatGptCodexTransport.js';
import {
  LlmEmptyResponseError,
  LlmRateLimitedError,
  LlmUnauthorizedError,
  LlmUpstreamBlockedError,
} from '../../domain/llm/errors.js';

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: unknown): string => `${b64({ alg: 'none' })}.${b64(payload)}.sig`;

test('TokenCipher: шифрует с ключом и не расшифровывает чужим ключом', () => {
  const a = new TokenCipher('key-a');
  const stored = a.encrypt('secret-token');
  assert.ok(stored.startsWith('enc:v1:'));
  assert.ok(!stored.includes('secret-token'));
  assert.equal(a.decrypt(stored), 'secret-token');
  assert.equal(new TokenCipher('key-b').decrypt(stored), null);
  assert.equal(new TokenCipher(null).decrypt(stored), null);
});

test('TokenCipher: без ключа хранит plain и читает его при любом ключе', () => {
  const plain = new TokenCipher('').encrypt('tok');
  assert.equal(plain, 'plain:tok');
  assert.equal(new TokenCipher('any').decrypt(plain), 'tok');
});

test('chatgptAccountInfo: account id, email, тариф и срок из токенов', () => {
  const exp = 1_900_000_000;
  const access = jwt({ exp, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc_1' } });
  const id = jwt({ email: 'a@b.c', 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } });
  const info = chatgptAccountInfo(access, id);
  assert.deepEqual(info, {
    accountId: 'acc_1',
    email: 'a@b.c',
    planType: 'plus',
    accessExpiresAt: new Date(exp * 1000),
  });
  assert.equal(readJwtClaims('not-a-jwt'), null);
});

test('extractResponse: склеивает дельты и читает usage из response.completed', () => {
  const raw = [
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","delta":"При"}',
    '',
    'data: {"type":"response.output_text.delta","delta":"вет"}',
    '',
    'data: {"type":"response.completed","response":{"model":"gpt-6-luna","usage":{"input_tokens":120,"input_tokens_details":{"cached_tokens":20},"output_tokens":7,"output_tokens_details":{"reasoning_tokens":3}}}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  const result = extractResponse(parseSseEvents(raw), raw);
  assert.equal(result.text, 'Привет');
  assert.equal(result.model, 'gpt-6-luna');
  assert.deepEqual(result.usage, { inputTokens: 120, cachedInputTokens: 20, outputTokens: 7, reasoningTokens: 3 });
});

test('extractResponse: без дельт берёт текст из output_item.done, пустой ответ — ошибка', () => {
  const raw =
    'data: {"type":"response.output_item.done","item":{"type":"message","content":[{"type":"output_text","text":"Готово"}]}}\n\n';
  assert.equal(extractResponse(parseSseEvents(raw), raw).text, 'Готово');
  assert.throws(() => extractResponse([], ''), LlmEmptyResponseError);
});

test('extractResponse: событие лимита превращается в LlmRateLimitedError', () => {
  const raw = 'data: {"type":"response.failed","response":{"error":{"code":"usage_limit_reached","message":"limit"}}}\n\n';
  assert.throws(() => extractResponse(parseSseEvents(raw), raw), LlmRateLimitedError);
});

test('toTransportError: 401/403/429 в доменные ошибки, время сброса из тела', () => {
  const now = new Date('2026-10-06T10:00:00Z');
  assert.ok(toTransportError(401, '{"detail":"Unauthorized"}', {}) instanceof LlmUnauthorizedError);
  const blocked = toTransportError(403, '<html>Just a moment...</html>', {});
  assert.ok(blocked instanceof LlmUpstreamBlockedError);
  assert.match(blocked.message, /блокировку по IP/);
  const limited = toTransportError(429, '{"error":{"type":"usage_limit_reached","message":"limit","resets_at":1791300000}}', {});
  assert.ok(limited instanceof LlmRateLimitedError);
  assert.deepEqual((limited as LlmRateLimitedError).resetsAt, new Date(1_791_300_000 * 1000));
  assert.deepEqual(
    rateLimitResetFrom('{"error":{"resets_in_seconds":60}}', {}, now),
    new Date(now.getTime() + 60_000),
  );
  assert.deepEqual(rateLimitResetFrom('oops', { 'retry-after': '30' }, now), new Date(now.getTime() + 30_000));
  assert.equal(rateLimitResetFrom('oops', {}, now), null);
});

test('forward: вызов вне рабочей папки подменяется, даже если бэкенд не прислал content-type', async () => {
  const { createServer } = await import('node:http');
  const { ChatGptCodexTransport } = await import('./ChatGptCodexTransport.js');
  const call = { type: 'function_call', id: 'fc_1', call_id: 'c1', name: 'exec_command', arguments: '{"cmd":"type x","workdir":"C:\\other"}' };
  const sse =
    `event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: 'r1' } })}\n\n` +
    `event: response.output_item.done\ndata: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: call })}\n\n`;
  // Как у бэкенда Codex: поток SSE без заголовка content-type.
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.end(sse);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const transport = new ChatGptCodexTransport({ baseUrl: `http://127.0.0.1:${port}` });
    const response = await transport.forward(
      { accessToken: 'a', accountId: 'acc' },
      {
        subpath: '',
        body: Buffer.from('{}'),
        headers: {},
        transformOutputItem: (item) => {
          const record = item as Record<string, unknown>;
          return record['name'] === 'exec_command' ? { ...record, name: 'blocked_by_projectsflow__workdir_outside_workspace' } : null;
        },
      },
    );
    const text = await new Response(response.body).text();
    assert.match(text, /"name":"blocked_by_projectsflow__workdir_outside_workspace"/);
    assert.doesNotMatch(text, /"name":"exec_command"/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformSseOutputItems } from './sse.js';

const encoder = new TextEncoder();

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

const event = (type: string, extra: Record<string, unknown>, sep = '\n\n'): string =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}${sep}`;

const blockExec = (item: unknown): Record<string, unknown> | null => {
  const record = item as Record<string, unknown>;
  return record['name'] === 'exec_command' ? { ...record, name: 'blocked' } : null;
};

test('SSE: заменяется только готовый элемент вывода, остальное идёт байт в байт', async () => {
  const created = event('response.created', { response: { id: 'r1' } });
  const delta = event('response.function_call_arguments.delta', { item_id: 'fc_1', delta: '{"cmd":"dir"}' });
  const done = event('response.output_item.done', { output_index: 0, item: { type: 'function_call', name: 'exec_command', arguments: '{}' } });
  const message = event('response.output_item.done', { output_index: 1, item: { type: 'message', content: [] } });
  const completed = event('response.completed', { response: { id: 'r1', status: 'completed' } });
  const raw = created + delta + done + message + completed;

  // Режем поток в произвольных местах, в том числе посреди события и разделителя.
  const chunks = [raw.slice(0, 7), raw.slice(7, created.length + 3), raw.slice(created.length + 3, raw.length - 40), raw.slice(raw.length - 40)];
  const out = await readAll(transformSseOutputItems(streamOf(chunks), blockExec));

  const expectedDone = `event: response.output_item.done\ndata: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', name: 'blocked', arguments: '{}' } })}\n\n`;
  assert.equal(out, created + delta + expectedDone + message + completed);
});

test('SSE: CRLF-разделители и хвост без пустой строки сохраняются', async () => {
  const done = event('response.output_item.done', { item: { type: 'function_call', name: 'exec_command' } }, '\r\n\r\n');
  const tail = 'data: {"type":"response.completed"}';
  const out = await readAll(transformSseOutputItems(streamOf([done, tail]), blockExec));
  assert.match(out, /^event: response\.output_item\.done\ndata: \{"type":"response\.output_item\.done","item":\{"type":"function_call","name":"blocked"\}\}\r\n\r\n/);
  assert.ok(out.endsWith(tail));
});

test('SSE: многобайтовые символы на границе кусков не ломаются', async () => {
  const text = event('response.output_text.delta', { delta: 'Готово: файл создан 👍' });
  const bytes = encoder.encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    },
  });
  assert.equal(await readAll(transformSseOutputItems(stream, blockExec)), text);
});

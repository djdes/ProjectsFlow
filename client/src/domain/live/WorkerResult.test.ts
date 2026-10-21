import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWorkerResult } from './WorkerResult';

test('worker protocol retains the status and readable summary, omitting internal fields', () => {
  const result = { status: 'error', sha: '1b62166d231643b4c22778ecc196d3fc88368c4e', summary: 'Сборка прошла. Нужно обновить MCP.', question_id: 'secret-question' };
  assert.deepEqual(parseWorkerResult(JSON.stringify(result)), { status: 'error', summary: result.summary });
  assert.deepEqual(parseWorkerResult('```json\n' + JSON.stringify({ ...result, status: 'done' }) + '\n```'), { status: 'done', summary: result.summary });
});

test('a trailing final result is readable without losing preceding explanations', () => {
  const json = JSON.stringify({ status: 'blocked', summary: 'Нужен доступ к репозиторию.', sha: '', question_id: '' });
  assert.deepEqual(parseWorkerResult('Сборка прошла.\n' + json), { status: 'blocked', summary: 'Сборка прошла.\n\nНужен доступ к репозиторию.' });
  assert.deepEqual(parseWorkerResult('Сборка прошла.\n```json\n' + json + '\n```'), { status: 'blocked', summary: 'Сборка прошла.\n\nНужен доступ к репозиторию.' });
});

test('ordinary messages, arbitrary JSON, incomplete streaming JSON and unknown statuses remain ordinary text', () => {
  for (const text of ['Работаю…', '{"status":"done","summary":"example"}', '{"status":"error",', '[]', 'null', '{"status":"new-status","summary":"Итог","sha":"","question_id":""}']) {
    assert.equal(parseWorkerResult(text), null, text);
  }
});

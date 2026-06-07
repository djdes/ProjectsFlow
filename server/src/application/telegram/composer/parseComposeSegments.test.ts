import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComposeSegments, ComposeParseError } from './parseComposeSegments.js';

test('парсит валидный compose-JSON в сегменты', () => {
  const raw = JSON.stringify({
    version: 1,
    segments: [
      {
        id: 's1',
        title: 'Обновить билд',
        simpleBody: 'Собрать и выложить.',
        projectId: 'p1',
        projectName: 'Альфа',
        confidence: 0.9,
        assigneeUserId: 'u2',
        assigneeName: 'Вася',
        deadline: '2026-06-09',
      },
    ],
  });
  const segs = parseComposeSegments(raw);
  assert.equal(segs.length, 1);
  assert.equal(segs[0]!.title, 'Обновить билд');
  assert.equal(segs[0]!.body, 'Собрать и выложить.');
  assert.equal(segs[0]!.projectId, 'p1');
  assert.equal(segs[0]!.assigneeUserId, 'u2');
  assert.equal(segs[0]!.deadline, '2026-06-09');
});

test('устойчив к ```-обёртке и тексту вокруг JSON', () => {
  const raw = 'Вот результат:\n```json\n{"segments":[{"id":"s1","title":"Т","simpleBody":"тело"}]}\n```\nготово';
  const segs = parseComposeSegments(raw);
  assert.equal(segs.length, 1);
  assert.equal(segs[0]!.title, 'Т');
});

test('невалидный дедлайн → null (не утечёт в DATE)', () => {
  const raw = JSON.stringify({ segments: [{ id: 's1', title: 'Т', simpleBody: 'тело', deadline: '2026-13-40' }] });
  const segs = parseComposeSegments(raw);
  assert.equal(segs[0]!.deadline, null);
});

test('пустой simpleBody → body = title', () => {
  const raw = JSON.stringify({ segments: [{ id: 's1', title: 'Только заголовок', simpleBody: '' }] });
  const segs = parseComposeSegments(raw);
  assert.equal(segs[0]!.body, 'Только заголовок');
});

test('сегменты без текста выкидываются; пустой результат → ошибка', () => {
  const raw = JSON.stringify({ segments: [{ id: 's1', title: '', simpleBody: '' }] });
  assert.throws(() => parseComposeSegments(raw), ComposeParseError);
});

test('не-JSON → ComposeParseError', () => {
  assert.throws(() => parseComposeSegments('совсем не json'), ComposeParseError);
});

test('JSON без segments → ComposeParseError', () => {
  assert.throws(() => parseComposeSegments('{"version":1}'), ComposeParseError);
});

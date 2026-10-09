import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PendingReplyComments,
  matchQuotedTasks,
  resolveReplyCommentTarget,
  type ReplyCommentCandidate,
} from './replyCommentTarget.js';

const candidates: ReplyCommentCandidate[] = [
  { taskId: 't1', projectId: 'p1', title: 'Настроить печать заказов' },
  { taskId: 't2', projectId: 'p1', title: 'Настроить печать этикеток' },
  { taskId: 't3', projectId: 'p2', title: 'Опубликовать приложение WESETUP' },
];

test('цитата строки таблицы с соседними ячейками находит задачу', () => {
  const quoted = 'Опубликовать приложение WESETUP\n✓ · ↗\tДенис Волков\tосталось 9 дней';
  assert.deepEqual(resolveReplyCommentTarget(candidates, quoted), { kind: 'one', task: candidates[2] });
});

test('цитата части названия или усечённого «…» заголовка находит задачу', () => {
  assert.deepEqual(
    resolveReplyCommentTarget(candidates, 'печать этикеток'),
    { kind: 'one', task: candidates[1] },
  );
  assert.deepEqual(
    resolveReplyCommentTarget(candidates, 'Опубликовать прилож…'),
    { kind: 'one', task: candidates[2] },
  );
});

test('цитата подходит к нескольким задачам — спрашиваем только среди совпавших', () => {
  assert.deepEqual(resolveReplyCommentTarget(candidates, 'Настроить печать'), {
    kind: 'choose',
    options: [candidates[0], candidates[1]],
  });
});

test('из нескольких заголовков внутри цитаты берётся самый длинный', () => {
  const nested: ReplyCommentCandidate[] = [
    { taskId: 'a', projectId: 'p', title: 'Отчёт' },
    { taskId: 'b', projectId: 'p', title: 'Отчёт по продажам' },
  ];
  assert.deepEqual(matchQuotedTasks(nested, 'Отчет по продажам — Олег'), [nested[1]]);
});

test('без цитаты: одна задача — она, несколько — выбор кнопками', () => {
  assert.deepEqual(resolveReplyCommentTarget([candidates[0]!], null), {
    kind: 'one',
    task: candidates[0],
  });
  assert.deepEqual(resolveReplyCommentTarget(candidates, null), { kind: 'choose', options: candidates });
});

test('слишком короткая или чужая цитата не выбирает задачу', () => {
  assert.deepEqual(matchQuotedTasks(candidates, 'на'), []);
  assert.deepEqual(resolveReplyCommentTarget(candidates, 'совсем другое'), {
    kind: 'choose',
    options: candidates,
  });
});

test('ожидающий выбор комментарий живёт 30 минут и удаляется', () => {
  let now = 1_000;
  const pending = new PendingReplyComments(() => now, () => 'id1');
  const id = pending.add({
    tgUserId: 1,
    senderUserId: 'u1',
    chatId: -100,
    text: 'готово к приёмке',
    options: candidates,
  });
  assert.equal(id, 'id1');
  assert.equal(pending.get(id)?.text, 'готово к приёмке');
  now += 30 * 60 * 1000;
  assert.equal(pending.get(id), null);

  const again = pending.add({ tgUserId: 1, senderUserId: 'u1', chatId: -100, text: 'x', options: [] });
  pending.delete(again);
  assert.equal(pending.get(again), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWorkerMention } from './workerMention.js';
import { parseComposerMessage } from './parseComposerMessage.js';

test('worker handles are recognized in either mention order', () => {
  for (const handles of ['@worker @oleg', '@oleg @ВОРКЕР', '@RalPh, @oleg']) {
    const result = extractWorkerMention(`+Project Исправить кнопку ${handles}`);
    assert.equal(result.requested, true);
    assert.deepEqual(parseComposerMessage(result.text), {
      projectQuery: 'Project', taskText: 'Исправить кнопку', assigneeQuery: 'oleg',
    });
  }
});

test('standalone Russian worker keyword is recognized without altering the task text', () => {
  for (const text of ['воркер исправь кнопку', 'Исправить кнопку — воркер', 'Передать воркеру исправление', 'Для ВОРКЕРА: поправить отступ', 'Нужно протестировать воркер', 'Проверить воркером, потом сдать']) {
    assert.deepEqual(extractWorkerMention(text), { text, requested: true });
  }
});

test('similar usernames, parts of words and email addresses do not assign work to the worker', () => {
  for (const text of ['@worker_team починить', '@ralph123', 'воркеризация очереди', 'суперворкер', '@воркер_team', 'mail@worker.ru', 'mail@воркер.ru']) {
    assert.deepEqual(extractWorkerMention(text), { text, requested: false });
  }
});

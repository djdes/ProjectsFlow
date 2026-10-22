import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workerSessionPrompt } from './WorkerSessionMode';

test('continuation preserves the prompt; an explicit reset stays attached to its prompt', () => {
  assert.equal(workerSessionPrompt('Продолжи проверку', 'continue'), 'Продолжи проверку');
  assert.equal(workerSessionPrompt('Начни заново', 'new'), '<!-- ralph-session:new -->\nНачни заново');
});

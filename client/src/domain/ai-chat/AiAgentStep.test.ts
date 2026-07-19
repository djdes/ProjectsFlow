import assert from 'node:assert/strict';
import test from 'node:test';
import { pluralizeSteps, readAiAgentSteps } from './AiAgentStep';

test('reads agent steps from message metadata', () => {
  const steps = readAiAgentSteps({
    steps: [
      { id: 's1', kind: 'thought', label: 'Размышление', detail: 'Разбираю запрос', durationMs: 800 },
      { id: 's2', kind: 'query', label: 'Запрос к базе', detail: null, durationMs: null },
    ],
  });
  assert.equal(steps.length, 2);
  assert.equal(steps[0]?.label, 'Размышление');
  assert.equal(steps[0]?.detail, 'Разбираю запрос');
  assert.equal(steps[1]?.detail, null);
});

test('degrades silently for messages without steps', () => {
  assert.deepEqual(readAiAgentSteps(null), []);
  assert.deepEqual(readAiAgentSteps({}), []);
  assert.deepEqual(readAiAgentSteps({ steps: 'nope' }), []);
});

test('drops unknown step kinds instead of failing the whole message', () => {
  const steps = readAiAgentSteps({
    steps: [{ kind: 'exec_shell', label: 'rm -rf' }, { kind: 'read', label: 'Изучение данных' }],
  });
  assert.equal(steps.length, 1);
  assert.equal(steps[0]?.kind, 'read');
});

test('falls back to a Russian label when metadata carries none', () => {
  const steps = readAiAgentSteps({ steps: [{ kind: 'review' }] });
  assert.equal(steps[0]?.label, 'Требуется подтверждение');
  assert.equal(steps[0]?.id, 'step-1');
});

test('pluralizes the step counter in Russian', () => {
  assert.equal(pluralizeSteps(1), 'шаг');
  assert.equal(pluralizeSteps(2), 'шага');
  assert.equal(pluralizeSteps(5), 'шагов');
  assert.equal(pluralizeSteps(11), 'шагов');
  assert.equal(pluralizeSteps(21), 'шаг');
  assert.equal(pluralizeSteps(112), 'шагов');
});

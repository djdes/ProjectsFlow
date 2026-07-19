import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_AI_AGENT_STEPS, agentStepLabel, normalizeAgentSteps } from './AiAgentStep.js';

test('labels every step kind in Russian regardless of what the worker sent', () => {
  const steps = normalizeAgentSteps([
    { kind: 'thought', label: 'Thought' },
    { kind: 'query', label: 'Queried database' },
  ]);
  assert.deepEqual(steps.map((step) => step.label), ['Размышление', 'Запрос к базе']);
  assert.equal(agentStepLabel('review'), 'Требуется подтверждение');
});

test('drops unknown step kinds without failing the completion', () => {
  const steps = normalizeAgentSteps([{ kind: 'exec_shell' }, { kind: 'write' }, null, 'nope']);
  assert.equal(steps.length, 1);
  assert.equal(steps[0]?.kind, 'write');
});

test('keeps free-form worker text in detail and assigns a stable id', () => {
  const steps = normalizeAgentSteps([{ kind: 'read', detail: '  посмотрел задачи  ', durationMs: 12.7 }]);
  assert.equal(steps[0]?.detail, 'посмотрел задачи');
  assert.equal(steps[0]?.durationMs, 12);
  assert.equal(steps[0]?.id, 'step-1');
});

test('caps the number of steps', () => {
  const raw = Array.from({ length: MAX_AI_AGENT_STEPS + 20 }, () => ({ kind: 'thought' }));
  assert.equal(normalizeAgentSteps(raw).length, MAX_AI_AGENT_STEPS);
});

test('treats a missing steps payload as no steps', () => {
  assert.deepEqual(normalizeAgentSteps(undefined), []);
  assert.deepEqual(normalizeAgentSteps({}), []);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAiActionPlan } from './AiActionPlanCard';

test('extracts a bounded ProjectsFlow action plan and keeps visible explanation', () => {
  const result = extractAiActionPlan(`Сначала подготовлю изменения.\n\n\`\`\`projectsflow-actions
{"title":"Новый проект","actions":[{"id":"project-1","type":"create_project","name":"Docs"},{"id":"task-1","type":"create_task","projectRef":"project-1","description":"Настроить главную страницу","status":"todo"}]}
\`\`\``);
  assert.equal(result.text, 'Сначала подготовлю изменения.');
  assert.equal(result.plan?.actions.length, 2);
  assert.equal(result.plan?.actions[1]?.type, 'create_task');
});

test('does not expose malformed or unsupported mutation blocks as executable plans', () => {
  const result = extractAiActionPlan('```projectsflow-actions\n{"title":"x","actions":[{"id":"x","type":"shell","command":"rm"}]}\n```');
  assert.equal(result.plan, null);
  assert.match(result.text, /shell/);
});

test('accepts an explicitly confirmed bulk task deletion action', () => {
  const result = extractAiActionPlan('```projectsflow-actions\n{"title":"Cleanup","actions":[{"id":"cleanup-1","type":"delete_all_tasks","projectId":"project-1"}]}\n```');
  assert.equal(result.plan?.actions[0]?.type, 'delete_all_tasks');
});

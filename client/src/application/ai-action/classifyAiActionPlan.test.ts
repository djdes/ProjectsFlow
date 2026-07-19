import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiAction, AiActionPlan } from '@/domain/ai-action/AiAction';
import { aiActionRisk, isDestructiveActionType } from '@/domain/ai-action/AiAction';
import { classifyAiActionPlan } from './classifyAiActionPlan';

function plan(...actions: AiAction[]): AiActionPlan {
  return { title: 'План', actions };
}

const createProject: AiAction = { id: 'p1', type: 'create_project', name: 'Docs' };
const createTask: AiAction = { id: 't1', type: 'create_task', projectRef: 'p1', description: 'Сверстать макет' };
const updateTask: AiAction = { id: 'u1', type: 'update_task', projectId: 'project-1', taskId: 'task-1', status: 'done' };
const deleteTask: AiAction = { id: 'd1', type: 'delete_task', projectId: 'project-1', taskId: 'task-1' };
const deleteAll: AiAction = { id: 'd2', type: 'delete_all_tasks', projectId: 'project-1' };

test('reading and creating actions are classified as safe', () => {
  assert.equal(aiActionRisk(createProject), 'safe');
  assert.equal(aiActionRisk(createTask), 'safe');
  assert.equal(aiActionRisk(updateTask), 'safe');
  assert.equal(isDestructiveActionType('create_task'), false);
  assert.equal(isDestructiveActionType('update_task'), false);
});

test('task deletion is classified as destructive', () => {
  assert.equal(aiActionRisk(deleteTask), 'destructive');
  assert.equal(aiActionRisk(deleteAll), 'destructive');
  assert.equal(isDestructiveActionType('delete_task'), true);
  assert.equal(isDestructiveActionType('delete_all_tasks'), true);
});

test('a fully creative plan runs without review', () => {
  const result = classifyAiActionPlan(plan(createProject, createTask));
  assert.equal(result.risk, 'safe');
  assert.equal(result.requiresReview, false);
  assert.equal(result.autoActions.length, 2);
  assert.equal(result.reviewActions.length, 0);
});

test('a single destructive action makes the whole plan reviewable', () => {
  const result = classifyAiActionPlan(plan(createProject, deleteAll));
  assert.equal(result.risk, 'destructive');
  assert.equal(result.requiresReview, true);
  assert.deepEqual(result.autoActions.map((action) => action.id), ['p1']);
  assert.deepEqual(result.reviewActions.map((action) => action.id), ['d2']);
});

test('classification keeps the relative order inside each stage', () => {
  const second: AiAction = { id: 't2', type: 'create_task', projectRef: 'p1', description: 'Протестировать' };
  const result = classifyAiActionPlan(plan(createProject, deleteTask, createTask, deleteAll, second));
  assert.deepEqual(result.autoActions.map((action) => action.id), ['p1', 't1', 't2']);
  assert.deepEqual(result.reviewActions.map((action) => action.id), ['d1', 'd2']);
});

test('an empty plan requires no review', () => {
  const result = classifyAiActionPlan(plan());
  assert.equal(result.risk, 'safe');
  assert.equal(result.requiresReview, false);
});

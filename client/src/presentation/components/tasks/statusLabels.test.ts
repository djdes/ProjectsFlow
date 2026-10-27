import assert from 'node:assert/strict';
import test from 'node:test';
import { TASK_STATUSES } from '../../../domain/task/Task';
import { canSendToWorker } from './statusLabels';

test('worker handoff is offered only for drafts and custom columns', () => {
  assert.deepEqual(
    TASK_STATUSES.filter(canSendToWorker),
    ['backlog', 'custom_1', 'custom_2', 'custom_3', 'custom_4', 'custom_5'],
  );
});

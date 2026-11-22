import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canLeaveTaskPage } from './edgeBack';

test('a task page with in-app history can go back', () => {
  assert.equal(canLeaveTaskPage('/projects/p1/tasks/t1', { idx: 2 }), true);
});

test('a task page opened directly (first entry) stays put', () => {
  assert.equal(canLeaveTaskPage('/projects/p1/tasks/t1', { idx: 0 }), false);
  assert.equal(canLeaveTaskPage('/projects/p1/tasks/t1', null), false);
});

test('other pages are not «back» targets', () => {
  assert.equal(canLeaveTaskPage('/projects/p1', { idx: 3 }), false);
  assert.equal(canLeaveTaskPage('/', { idx: 3 }), false);
});

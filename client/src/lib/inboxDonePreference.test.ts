import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inboxHidesDone, inboxShowDoneValue } from './inboxDonePreference';

const store = (values: Record<string, string>) => ({ getItem: (k: string) => values[k] ?? null });

test('a fresh device (empty storage) hides done tasks', () => {
  assert.equal(inboxHidesDone(store({})), true);
  assert.equal(inboxHidesDone(null), true);
});

test('the old «0» under inbox.hide-done no longer shows done tasks', () => {
  assert.equal(inboxHidesDone(store({ 'inbox.hide-done': '0' })), true);
});

test('only an explicit «show done» shows them, and the toggle round-trips', () => {
  assert.equal(inboxHidesDone(store({ 'inbox.show-done': inboxShowDoneValue(false) })), false);
  assert.equal(inboxHidesDone(store({ 'inbox.show-done': inboxShowDoneValue(true) })), true);
});

test('unreadable storage hides done tasks', () => {
  assert.equal(inboxHidesDone({ getItem: () => { throw new Error('denied'); } }), true);
});

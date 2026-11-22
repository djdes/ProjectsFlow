import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextScrollHidden } from './scrollHide';

test('scrolling down past the top hides, scrolling up shows', () => {
  assert.equal(nextScrollHidden(false, 100, 160), true);
  assert.equal(nextScrollHidden(true, 400, 360), false);
});

test('jitter keeps the current state', () => {
  assert.equal(nextScrollHidden(true, 300, 304), true);
  assert.equal(nextScrollHidden(false, 300, 296), false);
});

test('near the top the button is always visible', () => {
  assert.equal(nextScrollHidden(true, 200, 20), false);
});

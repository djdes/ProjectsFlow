import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SWIPE_MAX_PX, SWIPE_REPLY_PX, lockSwipeAxis, swipeCommitsReply, swipeOffset } from './commentGesture';

test('small jitter keeps the gesture undecided (long press still possible)', () => {
  assert.equal(lockSwipeAxis(3, -4), 'undecided');
});

test('a clear rightward move is a swipe, vertical or leftward moves are scrolling', () => {
  assert.equal(lockSwipeAxis(30, 5), 'horizontal');
  assert.equal(lockSwipeAxis(10, 40), 'vertical');
  assert.equal(lockSwipeAxis(-40, 0), 'vertical');
  assert.equal(lockSwipeAxis(20, 18), 'vertical');
});

test('offset follows the finger, then rubber-bands past the maximum', () => {
  assert.equal(swipeOffset(-20), 0);
  assert.equal(swipeOffset(40), 40);
  assert.ok(swipeOffset(SWIPE_MAX_PX + 100) < SWIPE_MAX_PX + 20);
});

test('reply commits only past the threshold', () => {
  assert.equal(swipeCommitsReply(SWIPE_REPLY_PX - 1), false);
  assert.equal(swipeCommitsReply(SWIPE_REPLY_PX), true);
});

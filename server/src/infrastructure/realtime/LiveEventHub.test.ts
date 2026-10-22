import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveEventHub } from './LiveEventHub.js';
import type { LiveEvent } from '../../domain/live/LiveEvent.js';

test('a new attempt cannot replay its messages or completion into the previous attempt', () => {
  const hub = new LiveEventHub();
  const first: number[] = [], second: number[] = [], ended: string[] = [];
  const stopFirst = hub.subscribe('attempt-1', events => first.push(...events.map(e => e.seq)));
  hub.subscribe('attempt-2', events => second.push(...events.map(e => e.seq)));
  hub.subscribeEnd('attempt-1', status => ended.push(`first:${status}`));
  hub.subscribeEnd('attempt-2', status => ended.push(`second:${status}`));
  const event = (seq: number): LiveEvent => ({ seq, kind: 'assistant_text', text: 'Проверяю', payload: null, createdAt: new Date() });
  hub.publish('attempt-1', [event(1)]);
  hub.publish('attempt-2', [event(2)]);
  hub.publishEnd('attempt-2', 'completed');
  assert.deepEqual(first, [1]);
  assert.deepEqual(second, [2]);
  assert.deepEqual(ended, ['second:completed']);
  // Identical content from distinct model actions must remain visible.
  hub.publish('attempt-2', [event(3)]);
  assert.deepEqual(second, [2, 3]);
  stopFirst();
  hub.publish('attempt-1', [event(4)]);
  assert.deepEqual(first, [1]);
});

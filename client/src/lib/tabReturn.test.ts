import test from 'node:test';
import assert from 'node:assert/strict';
import { TabReturnSignal } from './tabReturn';

function setup(): { win: EventTarget; doc: EventTarget & { visibilityState: DocumentVisibilityState }; advance: (ms: number) => void; signal: TabReturnSignal } {
  let t = 0;
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const signal = new TabReturnSignal(win as unknown as Window, doc as unknown as Document, () => t);
  return { win, doc, advance: (ms) => { t += ms; }, signal };
}

test('coming back after a while fires once, even though focus and visibility both arrive', () => {
  const { win, doc, advance, signal } = setup();
  let calls = 0;
  signal.subscribe(() => calls++, 15_000);
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('blur'));
  advance(60_000);
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('focus'));
  assert.equal(calls, 1);
});

test('a short glance elsewhere (or a click into an iframe) re-reads nothing', () => {
  const { win, advance, signal } = setup();
  let calls = 0;
  signal.subscribe(() => calls++, 15_000);
  win.dispatchEvent(new Event('blur'));
  advance(3_000);
  win.dispatchEvent(new Event('focus'));
  assert.equal(calls, 0);
  win.dispatchEvent(new Event('focus'));
  assert.equal(calls, 0, 'a focus without leaving first is not a return');
});

test('each subscriber keeps its own threshold and can unsubscribe', () => {
  const { win, advance, signal } = setup();
  const calls: string[] = [];
  const stop = signal.subscribe(() => calls.push('slow'), 30_000);
  signal.subscribe(() => calls.push('fast'), 5_000);
  win.dispatchEvent(new Event('blur'));
  advance(10_000);
  win.dispatchEvent(new Event('focus'));
  assert.deepEqual(calls, ['fast']);
  stop();
  win.dispatchEvent(new Event('blur'));
  advance(40_000);
  win.dispatchEvent(new Event('focus'));
  assert.deepEqual(calls, ['fast', 'fast']);
});

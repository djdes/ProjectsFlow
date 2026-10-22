import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test from 'node:test';
import { isLiveNearBottom, scrollLiveToBottom } from './liveScroll';

function viewport(height: number, contentHeight: number): HTMLDivElement {
  const element = document.createElement('div');
  element.style.overflowY = 'auto';
  let top = 0;
  Object.defineProperties(element, {
    clientHeight: { value: height },
    scrollHeight: { value: contentHeight },
    scrollTop: {
      get: () => top,
      set: (value: number) => { top = Math.max(0, Math.min(value, contentHeight - height)); },
    },
  });
  return element;
}

test('jump reaches the feed tail without moving the task panel', () => {
  const panel = viewport(500, 900);
  const feed = viewport(300, 1200);
  panel.append(feed);
  document.body.append(panel);
  try {
    feed.scrollTop = 900;
    assert.equal(isLiveNearBottom(feed), true, 'task panel position does not control chat following');
    feed.scrollTop = 100;
    scrollLiveToBottom(feed);
    assert.equal(feed.scrollTop, 900);
    assert.equal(panel.scrollTop, 0, 'jump never scrolls task/page ancestors');
    assert.equal(isLiveNearBottom(feed), true);
    feed.scrollTop = 850;
    assert.equal(isLiveNearBottom(feed), false, 'small scrolls up must pause following');
    scrollLiveToBottom(feed);
    assert.equal(feed.scrollTop, 900, 'explicit jump also covers the last 80 px');
  } finally {
    panel.remove();
  }
});

test('short and hidden feeds never move the outer task panel', () => {
  const panel = viewport(500, 900);
  const feed = viewport(700, 700);
  const hidden = viewport(0, 700);
  panel.append(feed, hidden);
  document.body.append(panel);
  try {
    scrollLiveToBottom(hidden);
    assert.equal(panel.scrollTop, 0);
    scrollLiveToBottom(feed);
    assert.equal(panel.scrollTop, 0);
    assert.equal(isLiveNearBottom(feed), true);
  } finally {
    panel.remove();
  }
});

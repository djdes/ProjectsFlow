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

test('jump reaches the end of both the feed and the outer task panel', () => {
  const panel = viewport(500, 900);
  const feed = viewport(300, 1200);
  panel.append(feed);
  document.body.append(panel);
  try {
    feed.scrollTop = 900;
    assert.equal(isLiveNearBottom(feed), false, 'outer panel is still scrolled up');
    feed.scrollTop = 100;
    scrollLiveToBottom(feed);
    assert.equal(feed.scrollTop, 900);
    assert.equal(panel.scrollTop, 400);
    assert.equal(isLiveNearBottom(feed), true);
    feed.scrollTop = 850;
    scrollLiveToBottom(feed);
    assert.equal(feed.scrollTop, 900, 'explicit jump also covers the last 80 px');
  } finally {
    panel.remove();
  }
});

test('naturally growing feed scrolls its outer panel; hidden feed does not move it', () => {
  const panel = viewport(500, 900);
  const feed = viewport(700, 700);
  const hidden = viewport(0, 700);
  panel.append(feed, hidden);
  document.body.append(panel);
  try {
    scrollLiveToBottom(hidden);
    assert.equal(panel.scrollTop, 0);
    scrollLiveToBottom(feed);
    assert.equal(panel.scrollTop, 400);
    assert.equal(isLiveNearBottom(feed), true);
  } finally {
    panel.remove();
  }
});

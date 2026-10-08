import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mayStartPull,
  pullRefreshDistance,
  PULL_REFRESH_THRESHOLD,
} from './pullRefreshGesture';

test('pull resists long drags and rejects horizontal/upward intent', () => {
  assert.equal(pullRefreshDistance(100, 30), 0);
  assert.equal(pullRefreshDistance(0, -30), 0);
  assert.ok(pullRefreshDistance(2, 100) < PULL_REFRESH_THRESHOLD);
  assert.ok(pullRefreshDistance(2, 150) >= PULL_REFRESH_THRESHOLD);
  assert.equal(pullRefreshDistance(0, 1000), 88);
});

test('pull does not steal controls or nested scrolling', () => {
  const main = document.createElement('main');
  main.innerHTML =
    '<section><span>content</span><button><i>icon</i></button><div contenteditable>text</div></section>';
  document.body.append(main);
  try {
    assert.equal(mayStartPull(main.querySelector('span')!, main), true);
    assert.equal(mayStartPull(main.querySelector('i')!, main), false);
    assert.equal(
      mayStartPull(main.querySelector('[contenteditable]')!, main),
      false,
    );
    main.scrollTop = 2;
    assert.equal(mayStartPull(main.querySelector('span')!, main), false);
    main.scrollTop = 0;
    const section = main.querySelector('section')!;
    section.style.overflowY = 'auto';
    Object.defineProperties(section, {
      scrollHeight: { value: 500 },
      clientHeight: { value: 100 },
    });
    section.scrollTop = 10;
    assert.equal(mayStartPull(main.querySelector('span')!, main), false);
    section.scrollTop = 0;
    assert.equal(mayStartPull(main.querySelector('span')!, main), true);
  } finally {
    main.remove();
  }
});

import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import test from 'node:test';
import assert from 'node:assert/strict';
import { canDragSheetFrom, shouldDismissSheet } from './mobileSheetGesture';

test('a deliberate pull or quick flick closes; jitter and reversing direction do not', () => {
  assert.equal(shouldDismissSheet(20, 2, 800), false);
  assert.equal(shouldDismissSheet(45, 0.7, 800), true);
  assert.equal(shouldDismissSheet(45, 0, 800), false);
  assert.equal(shouldDismissSheet(121, 0, 800), true);
  assert.equal(shouldDismissSheet(65, 0, 220), true);
  assert.equal(shouldDismissSheet(-60, -1, 800), false);
});

test('scrolling owns the gesture until every scroll ancestor is at the top', () => {
  const sheet = document.createElement('div');
  sheet.innerHTML =
    '<div class="scroll"><p>Описание задачи</p><button>Сохранить</button><div contenteditable="true"><strong>Выделение</strong></div></div><button data-pf-sheet-handle>Закрыть</button>';
  document.body.append(sheet);
  const scroll = sheet.firstElementChild as HTMLElement;
  scroll.style.overflowY = 'auto';
  Object.defineProperties(scroll, {
    scrollHeight: { value: 1000 },
    clientHeight: { value: 400 },
  });
  const text = scroll.querySelector('p')!;
  assert.equal(canDragSheetFrom(text, sheet), true);
  scroll.scrollTop = 150;
  assert.equal(canDragSheetFrom(text, sheet), false);
  assert.equal(canDragSheetFrom(sheet.lastElementChild!, sheet), true);
  scroll.scrollTop = 0;
  assert.equal(canDragSheetFrom(text, sheet), true);
  assert.equal(canDragSheetFrom(scroll.querySelector('button')!, sheet), false);
  assert.equal(canDragSheetFrom(scroll.querySelector('strong')!, sheet), false);
  assert.equal(canDragSheetFrom(document.body, sheet), false);
  sheet.remove();
});

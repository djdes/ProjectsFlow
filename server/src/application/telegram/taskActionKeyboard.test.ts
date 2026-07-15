import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestTaskActionsKeyboard } from './taskActionKeyboard.js';

test('digestTaskActionsKeyboard: complete and open actions are bound to each task', () => {
  const keyboard = digestTaskActionsKeyboard([
    { taskId: 'task-1', name: 'Проверить ежедневную сводку', openLink: 'https://example.test/task-1' },
  ]);

  assert.deepEqual(keyboard.inline_keyboard, [
    [
      { text: '✅ Завершить · Проверить ежедневную св…', callback_data: 'nd:task-1' },
      { text: '↗ Перейти', url: 'https://example.test/task-1' },
    ],
  ]);
});

test('digestTaskActionsKeyboard: respects limit and provides a fallback task name', () => {
  const keyboard = digestTaskActionsKeyboard(
    [
      { taskId: 'task-1', name: '   ', openLink: 'https://example.test/task-1' },
      { taskId: 'task-2', name: 'Вторая', openLink: 'https://example.test/task-2' },
    ],
    1,
  );

  assert.equal(keyboard.inline_keyboard.length, 1);
  assert.equal(keyboard.inline_keyboard[0]![0]!.text, '✅ Завершить · Задача');
});

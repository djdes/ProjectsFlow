import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collapsedTelegramDigestKeyboard,
  expandedTelegramDigestKeyboard,
  sortTelegramDigestTasks,
  type TelegramDigestKeyboardTask,
} from './TelegramDigestKeyboard.js';

const tasks: TelegramDigestKeyboardTask[] = [
  {
    taskId: '11111111-1111-4111-8111-111111111111',
    name: 'Без дедлайна',
    openLink: 'https://projectsflow.ru/projects/banana?task=1',
    projectName: 'Banana',
    assigneeName: 'Ярослав',
    deadline: null,
    priority: 3,
    position: 0,
    completed: false,
  },
  {
    taskId: '22222222-2222-4222-8222-222222222222',
    name: 'Срочная задача',
    openLink: 'https://projectsflow.ru/projects/docs?task=2',
    projectName: 'DocsFlow',
    assigneeName: 'Денис',
    deadline: '2026-07-17',
    priority: 1,
    position: 1,
    completed: false,
  },
  {
    taskId: '33333333-3333-4333-8333-333333333333',
    name: 'Уже выполнено',
    openLink: 'https://projectsflow.ru/projects/docs?task=3',
    projectName: 'DocsFlow',
    assigneeName: 'Анна',
    deadline: '2026-07-16',
    priority: 2,
    position: 2,
    completed: true,
  },
];

test('collapsed digest shows one native expand callback', () => {
  assert.deepEqual(collapsedTelegramDigestKeyboard(3), {
    inline_keyboard: [[{
      text: 'Показать задачи (3)',
      callback_data: 'dgx:default',
      style: 'primary',
    }]],
  });
});

test('expanded digest has large task buttons and native sort controls', () => {
  const keyboard = expandedTelegramDigestKeyboard(tasks, 'deadline');
  const flat = keyboard.inline_keyboard.flat();

  assert.ok(flat.some((button) => button.callback_data === 'dgs:deadline'));
  assert.ok(flat.some((button) => button.callback_data === 'dgs:priority'));
  assert.ok(flat.some((button) => button.callback_data === 'dgs:project'));
  assert.ok(flat.some((button) => button.callback_data === 'dgs:assignee'));
  assert.ok(flat.some((button) =>
    button.callback_data === 'dgc:deadline:22222222-2222-4222-8222-222222222222' &&
    button.text === '○',
  ));
  assert.ok(flat.some((button) =>
    button.url === 'https://projectsflow.ru/projects/docs?task=2' &&
    button.text.startsWith('Срочная задача'),
  ));
  assert.ok(flat.some((button) =>
    button.callback_data === 'dgc:deadline:33333333-3333-4333-8333-333333333333' &&
    button.text === '●' &&
    button.style === 'success',
  ));
  assert.equal(flat.at(-1)?.callback_data, 'dgh:deadline');
});

test('deadline and priority sorting keep completed tasks at the bottom', () => {
  assert.deepEqual(
    sortTelegramDigestTasks(tasks, 'deadline').map((task) => task.taskId),
    [
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
    ],
  );
  assert.deepEqual(
    sortTelegramDigestTasks(tasks, 'priority').map((task) => task.taskId),
    [
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
    ],
  );
});

test('large digest stays within Telegram inline-keyboard button limit', () => {
  const many = Array.from({ length: 120 }, (_, index) => ({
    ...tasks[0]!,
    taskId: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
    name: `Задача ${index + 1}`,
    position: index,
  }));
  const keyboard = expandedTelegramDigestKeyboard(many, 'default');
  assert.ok(keyboard.inline_keyboard.flat().length <= 100);
  assert.ok(
    keyboard.inline_keyboard.flat().some((button) =>
      button.text.startsWith('Ещё 75 задач'),
    ),
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskExcerpt, taskTitleExcerpt } from './taskExcerpt.js';

const FIGURE =
  '<figure data-figure-image><img src="/api/attachments/836a74ce-1dba-41c9-8fbd-b1caa39ea136" alt="" /></figure>';

test('картинка в начале не съедает лимит: заголовок целиком', () => {
  const description = `${FIGURE}\n\n\nИсправить отображение уведомлений`;
  assert.equal(taskExcerpt(description), 'Исправить отображение уведомлений');
  assert.equal(taskTitleExcerpt(description), 'Исправить отображение уведомлений');
});

test('HTML цвета/подчёркивания срезан, переводы строк сохранены', () => {
  assert.equal(
    taskExcerpt('<span style="color: red">Срочно</span> <u>оплата</u>\nтело'),
    'Срочно оплата\nтело',
  );
});

test('лимит считается по тексту, а не по разметке', () => {
  assert.equal(taskExcerpt(`${FIGURE}\nабвгд`, 3), 'абв');
});

test('только картинки — «Скриншот», пусто — пусто', () => {
  assert.equal(taskExcerpt(`${FIGURE}\n\n${FIGURE}`), 'Скриншот');
  assert.equal(taskExcerpt(''), '');
  assert.equal(taskExcerpt(null), '');
});

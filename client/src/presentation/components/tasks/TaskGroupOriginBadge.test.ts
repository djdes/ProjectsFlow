import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskGroupOriginBadge } from './TaskGroupOriginBadge';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const origin = { chatId: -100200, title: 'Скрипты', authorUserId: 'u1', authorName: 'Ольга' };

test('бейдж группы: подпись «из группы «Скрипты»» и подсказка с автором и временем', () => {
  const html = renderToStaticMarkup(
    React.createElement(TaskGroupOriginBadge, { origin, createdAt: new Date('2026-11-18T09:30:00Z') }),
  );
  assert.match(html, /из группы «Скрипты»/);
  assert.match(html, /title="[^"]*Автор: Ольга[^"]*"/);
  assert.match(html, /title="[^"]*18 ноября[^"]*12:30[^"]*"/);
});

test('бейдж группы: без названия — нейтральная подпись; без пометки — ничего', () => {
  const noTitle = renderToStaticMarkup(
    React.createElement(TaskGroupOriginBadge, { origin: { ...origin, title: null } }),
  );
  assert.match(noTitle, /из Telegram-группы/);
  assert.equal(renderToStaticMarkup(React.createElement(TaskGroupOriginBadge, { origin: null })), '');
});

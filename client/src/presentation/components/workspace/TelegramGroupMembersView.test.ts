import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TelegramGroupMembersView, groupMembersLabel } from './TelegramGroupMembersView';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const render = (members: Parameters<typeof TelegramGroupMembersView>[0]['members']): string =>
  renderToStaticMarkup(React.createElement(TelegramGroupMembersView, { members }));

test('участники группы: «N в Telegram, M связаны с PF» и список связанных', () => {
  const html = render({
    telegramCount: 7,
    linked: [
      { userId: 'u1', displayName: 'Ольга', avatarUrl: null, status: 'admin' },
      { userId: 'u2', displayName: 'Иван', avatarUrl: null, status: 'member' },
    ],
    botIsAdmin: true,
  });
  assert.match(html, /Участники: 7 в Telegram, 2 связаны с PF/);
  assert.match(html, /Ольга<span[^>]*> · админ группы<\/span>/);
  assert.match(html, /<li[^>]*>Иван<\/li>/);
  assert.doesNotMatch(html, /Бот не администратор/);
});

test('участники группы: бот не администратор — подсказка; нет связанных — без списка', () => {
  const html = render({ telegramCount: 3, linked: [], botIsAdmin: false });
  assert.match(html, /Участники: 3 в Telegram, 0 связаны с PF/);
  assert.match(html, /Бот не администратор группы/);
  assert.doesNotMatch(html, /<ul/);
  assert.doesNotMatch(render({ telegramCount: 3, linked: [], botIsAdmin: null }), /Бот не администратор/);
});

test('участники группы: пока грузится — заглушка', () => {
  assert.match(render(null), /Участники: загрузка/);
  assert.equal(groupMembersLabel({ telegramCount: 0, linked: [] }), 'Участники: 0 в Telegram, 0 связаны с PF');
});

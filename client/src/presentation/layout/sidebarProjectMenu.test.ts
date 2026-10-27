import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSidebarProjectMenu } from './sidebarProjectMenu';

type ProjectInput = Parameters<typeof buildSidebarProjectMenu>[0]['project'];

const project = (overrides: Partial<ProjectInput> = {}): ProjectInput => ({
  role: 'owner',
  isInbox: false,
  status: 'active',
  isFavorite: false,
  ...overrides,
});

const labels = (p: ProjectInput): string[] =>
  buildSidebarProjectMenu({ project: p, canMoveUp: true, canMoveDown: true }).map((i) => i.label);

test('меню проекта: настройки и избранное сверху, удаление последним', () => {
  assert.deepEqual(labels(project({ isFavorite: true })), [
    'Изменить имя',
    'Настройки',
    'Убрать из избранного',
    'База знаний',
    'Общий доступ',
    'Переместить выше',
    'Переместить ниже',
    'Дублировать',
    'В архив',
    'Удалить проект…',
  ]);
});

test('не избранный проект можно добавить в избранное', () => {
  assert.ok(labels(project()).includes('Добавить в избранное'));
});

test('архивный проект: без переключателя избранного, с возвратом из архива', () => {
  const list = labels(project({ status: 'archived', isFavorite: true }));
  assert.ok(!list.some((l) => l.includes('избранн')));
  assert.ok(list.includes('Вернуть из архива'));
});

test('наблюдатель видит настройки, но не управление и не удаление', () => {
  const list = labels(project({ role: 'viewer' }));
  assert.ok(list.includes('Настройки'));
  assert.ok(!list.includes('Дублировать'));
  assert.ok(!list.includes('Удалить проект…'));
});

test('крайние позиции отключают перемещение', () => {
  const items = buildSidebarProjectMenu({ project: project(), canMoveUp: false, canMoveDown: true });
  assert.equal(items.find((i) => i.action === 'moveUp')?.disabled, true);
  assert.equal(items.find((i) => i.action === 'moveDown')?.disabled, false);
});

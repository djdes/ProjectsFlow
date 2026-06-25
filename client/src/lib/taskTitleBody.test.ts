// Тесты split/join заголовок↔тело. Главная гарантия: round-trip через `description`
// без потерь (markdown тела сохраняется), при этом смена заголовка не трогает тело.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  splitTitleBody,
  joinTitleBody,
  parseTitleHeading,
  formatTitleHeading,
} from './taskTitleBody';

test('parseTitleHeading: срезает ведущие ## и отдаёт уровень', () => {
  assert.deepEqual(parseTitleHeading('## История постов'), { text: 'История постов', level: 2 });
  assert.deepEqual(parseTitleHeading('# Заголовок'), { text: 'Заголовок', level: 1 });
  assert.deepEqual(parseTitleHeading('### Малый'), { text: 'Малый', level: 3 });
  assert.deepEqual(parseTitleHeading('Без решётки'), { text: 'Без решётки', level: 0 });
  // 4+ решёток клампим к 3 (в UI только H1–H3).
  assert.equal(parseTitleHeading('###### Глубокий').level, 3);
});

test('formatTitleHeading: восстанавливает префикс по уровню', () => {
  assert.equal(formatTitleHeading('Текст', 0), 'Текст');
  assert.equal(formatTitleHeading('Текст', 2), '## Текст');
  // Переносы схлопываются (заголовок однострочный).
  assert.equal(formatTitleHeading('а\nб', 1), '# а б');
});

test('parse/format round-trip заголовка без потерь', () => {
  for (const raw of ['## История', '# A', 'plain', '### x']) {
    const { text, level } = parseTitleHeading(raw);
    assert.equal(formatTitleHeading(text, level), raw);
  }
});

test('split: нет переноса строки → всё это заголовок, тело пустое', () => {
  assert.deepEqual(splitTitleBody('Купить молоко'), {
    title: 'Купить молоко',
    body: '',
  });
});

test('split: первая строка → title, остаток → body', () => {
  assert.deepEqual(splitTitleBody('Заголовок\nстрока тела'), {
    title: 'Заголовок',
    body: 'строка тела',
  });
});

test('split: только первый перенос строки делит, остальные остаются в теле', () => {
  assert.deepEqual(splitTitleBody('Заголовок\n## Подзаголовок\n\n- пункт'), {
    title: 'Заголовок',
    body: '## Подзаголовок\n\n- пункт',
  });
});

test('split: пустое описание → пустые title и body', () => {
  assert.deepEqual(splitTitleBody(''), { title: '', body: '' });
});

test('split: описание начинается с переноса строки → пустой заголовок', () => {
  assert.deepEqual(splitTitleBody('\nтолько тело'), { title: '', body: 'только тело' });
});

test('join: пустое тело → description это только заголовок (без хвостового \\n)', () => {
  assert.equal(joinTitleBody('Заголовок', ''), 'Заголовок');
});

test('join: заголовок + тело склеиваются через один \\n', () => {
  assert.equal(joinTitleBody('Заголовок', 'тело'), 'Заголовок\nтело');
});

test('join: заголовок тримится, тело — нет', () => {
  assert.equal(joinTitleBody('  Заголовок  ', '  тело  '), 'Заголовок\n  тело  ');
});

test('round-trip: split → join возвращает исходник (с многострочным markdown-телом)', () => {
  const cases = [
    'Однострочный заголовок',
    'Заголовок\nтело',
    'Заголовок\n## Раздел\n\n- [ ] пункт\n- [x] готово\n\n```js\ncode\n```',
    'Заголовок\n\nпустая строка над телом',
  ];
  for (const md of cases) {
    const { title, body } = splitTitleBody(md);
    assert.equal(joinTitleBody(title, body), md, `round-trip потерял данные: «${md}»`);
  }
});

test('round-trip: смена заголовка сохраняет тело без изменений', () => {
  const original = 'Старый заголовок\n## Тело\nстрока с **markdown**';
  const { body } = splitTitleBody(original);
  const next = joinTitleBody('Новый заголовок', body);
  assert.equal(next, 'Новый заголовок\n## Тело\nстрока с **markdown**');
  // Тело по-прежнему отделяется корректно.
  assert.equal(splitTitleBody(next).body, body);
});

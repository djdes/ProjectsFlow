// Тесты split/join заголовок↔тело. Главная гарантия: round-trip через `description`
// без потерь (markdown тела сохраняется), при этом смена заголовка не трогает тело.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  splitTitleBody,
  joinTitleBody,
  parseTitleHeading,
  formatTitleHeading,
  stripInlineMarkdown,
  plainTaskTitle,
} from './taskTitleBody';

const FIGURE = '<figure data-figure-image><img src="/api/attachments/x" alt="" /></figure>';

test('stripInlineMarkdown: срезает парные маркеры, оставляет текст', () => {
  assert.equal(stripInlineMarkdown('**жирный**'), 'жирный');
  assert.equal(stripInlineMarkdown('*курсив*'), 'курсив');
  assert.equal(stripInlineMarkdown('__bold__'), 'bold');
  assert.equal(stripInlineMarkdown('~~зач~~'), 'зач');
  assert.equal(stripInlineMarkdown('==выд=='), 'выд');
  assert.equal(stripInlineMarkdown('`код`'), 'код');
  assert.equal(stripInlineMarkdown('**жирный** и `код`'), 'жирный и код');
});

test('stripInlineMarkdown: ссылки и картинки → видимый текст', () => {
  assert.equal(stripInlineMarkdown('[ProjectsFlow](https://x.ru)'), 'ProjectsFlow');
  assert.equal(stripInlineMarkdown('![аватар](https://x.ru/a.png)'), 'аватар');
});

test('stripInlineMarkdown: вложенность ***x*** раскрывается', () => {
  assert.equal(stripInlineMarkdown('***важно***'), 'важно');
});

test('stripInlineMarkdown: не ломает snake_case и одиночные символы', () => {
  assert.equal(stripInlineMarkdown('foo_bar_baz'), 'foo_bar_baz');
  assert.equal(stripInlineMarkdown('5 * 3 = 15'), '5 * 3 = 15');
  assert.equal(stripInlineMarkdown('обычный текст'), 'обычный текст');
});

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

// --- BUG E: скриншот первым действием не должен становиться заголовком-мусором ---

test('split: описание — целиком одна figure-картинка (Ctrl+V первым действием, без текста) → пустой заголовок, картинка остаётся в теле', () => {
  assert.deepEqual(splitTitleBody(FIGURE), { title: '', body: FIGURE });
});

test('split: несколько figure-картинок подряд без текста → пустой заголовок, обе картинки в теле', () => {
  const desc = `${FIGURE}\n\n${FIGURE}`;
  const { title, body } = splitTitleBody(desc);
  assert.equal(title, '');
  assert.match(body, /<figure/);
  assert.equal((body.match(/<figure/g) ?? []).length, 2, 'обе картинки сохранились в теле');
});

test('split: figure-картинка, затем реальный текст → заголовком становится текст, картинка остаётся в теле', () => {
  const desc = `${FIGURE}\n\nЗаголовок из головы`;
  const { title, body } = splitTitleBody(desc);
  assert.equal(title, 'Заголовок из головы');
  assert.match(body, /<figure/);
});

test('split: одинокая пустая первая строка БЕЗ figure — заголовок по-прежнему пустой (не путать с BUG E)', () => {
  // Регрессия: скип-логика для figure не должна начать «прыгать» через обычные пустые
  // строки без картинки — это отдельный, уже покрытый случай (см. тест выше в файле).
  assert.deepEqual(splitTitleBody('\nПросто текст'), { title: '', body: 'Просто текст' });
});

test('plainTaskTitle: описание — только скриншот(ы) без текста → фолбэк «Скриншот»', () => {
  assert.equal(plainTaskTitle(FIGURE), 'Скриншот');
  assert.equal(plainTaskTitle(`${FIGURE}\n\n${FIGURE}`), 'Скриншот');
});

test('plainTaskTitle: полностью пустое описание — фолбэк не подставляем (остаётся пустая строка)', () => {
  assert.equal(plainTaskTitle(''), '');
});

test('plainTaskTitle: figure + реальный текст → реальный текст, без фолбэка', () => {
  assert.equal(plainTaskTitle(`${FIGURE}\n\nНастоящий заголовок`), 'Настоящий заголовок');
});

test('round-trip: смена заголовка сохраняет тело без изменений', () => {
  const original = 'Старый заголовок\n## Тело\nстрока с **markdown**';
  const { body } = splitTitleBody(original);
  const next = joinTitleBody('Новый заголовок', body);
  assert.equal(next, 'Новый заголовок\n## Тело\nстрока с **markdown**');
  // Тело по-прежнему отделяется корректно.
  assert.equal(splitTitleBody(next).body, body);
});

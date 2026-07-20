import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyProjectRuntime, detectProjectRuntime } from './projectRuntimeKind.js';

const json = (value: unknown): string => JSON.stringify(value);

// Реальный package.json проекта MagFlow — с него и начался разбор: студия бесконечно
// обещала ему «Preview появится после первого запуска», хотя исполнять его негде.
const MAGFLOW = json({
  scripts: {
    start: 'node server.js',
    dev: 'node --watch server.js',
    check: 'node --check server.js && node --check public/app.js',
    test: 'node tests/production/root-order-flow.mjs',
  },
  dependencies: { mysql2: '^3.9.0' },
});

test('проект со своим сервером и внешней БД распознаётся и объясняет причину', () => {
  const result = detectProjectRuntime(MAGFLOW);
  assert.equal(result.kind, 'server_app');
  // Причины показываются пользователю: «не поддерживается» без объяснения читается
  // как поломка платформы.
  assert.ok(result.reasons.some((r) => /mysql2/.test(r)), `нет причины про драйвер: ${result.reasons.join(' | ')}`);
  assert.ok(result.reasons.some((r) => /server\.js/.test(r)), `нет причины про скрипт: ${result.reasons.join(' | ')}`);
});

test('обычная статика с сборкой сервером не считается', () => {
  const vite = json({
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    devDependencies: { vite: '^5.0.0', typescript: '^5.0.0' },
  });
  assert.equal(classifyProjectRuntime(vite), 'static');
});

test('сборочный скрипт на node не превращает проект в серверный', () => {
  const built = json({ scripts: { build: 'node build.js', start: 'node build.js --watch' } });
  assert.equal(classifyProjectRuntime(built), 'static');
});

test('серверный фреймворк — достаточный признак сам по себе', () => {
  assert.equal(classifyProjectRuntime(json({ dependencies: { express: '^4' } })), 'server_app');
  assert.equal(classifyProjectRuntime(json({ dependencies: { next: '^14' } })), 'server_app');
});

// SQLite — это то, что платформа даёт приложению сама. Ловить на него нельзя, иначе
// правильно сконвертированный проект объявили бы неподдерживаемым.
test('sqlite в зависимостях не признак чужого сервера', () => {
  const app = json({
    scripts: { build: 'vite build' },
    devDependencies: { 'better-sqlite3': '^11', vite: '^5' },
  });
  assert.equal(classifyProjectRuntime(app), 'static');
});

// Классификатор существует ради честного статуса, поэтому в сомнении он обязан молчать,
// а не пугать пользователя ложным «не поддерживается».
test('без package.json или на мусоре — unknown, а не догадка', () => {
  assert.equal(classifyProjectRuntime(null), 'unknown');
  assert.equal(classifyProjectRuntime(undefined), 'unknown');
  assert.equal(classifyProjectRuntime(''), 'unknown');
  assert.equal(classifyProjectRuntime('не json'), 'unknown');
  assert.equal(classifyProjectRuntime('[]'), 'unknown');
  assert.equal(classifyProjectRuntime('"строка"'), 'unknown');
});

test('пустой package.json — статика, а не серверное приложение', () => {
  assert.equal(classifyProjectRuntime(json({})), 'static');
});

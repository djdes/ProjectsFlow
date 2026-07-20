import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FilePlatformBackendContract } from './FilePlatformBackendContract.js';

/**
 * Путь до контракта вычисляется относительно этого модуля и одинаков для dev и прода. Если
 * он разъедется (переезд файла, смена структуры dist, выпадение docs/ из деплой-тарбола),
 * кнопка перевода начнёт отвечать 503 — и узнают об этом от пользователя. Тест ловит раньше.
 */

test('контракт находится по дефолтному пути и выглядит контрактом', () => {
  const text = new FilePlatformBackendContract().read();

  assert.ok(text, 'docs/app-backend-contract.md не найден по вычисленному пути');
  // Не просто «файл существует»: воркеру нужны сами маршруты, иначе бриф бесполезен.
  assert.ok(/\/api\/auth/.test(text), 'в контракте нет /api/auth');
  assert.ok(/\/api\/data/.test(text), 'в контракте нет /api/data');
});

test('отсутствующий файл даёт null, а не исключение', () => {
  // Сервер не должен падать из-за недоехавшего документа: отваливается одна кнопка,
  // а не платформа. Отказ обрабатывает use-case.
  assert.equal(new FilePlatformBackendContract('C:/nope/does-not-exist.md').read(), null);
});

test('файл читается один раз', () => {
  const source = new FilePlatformBackendContract();
  assert.equal(source.read(), source.read());
});

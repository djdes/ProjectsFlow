import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { appRuntimeRouter } from './appRuntimeRouter.js';

/**
 * Документ docs/app-backend-contract.md — единственный источник правды для агента,
 * который переводит приложение со своего сервера на бэкенд платформы.
 *
 * Расхождение документа с кодом уже случалось и стоило дорого: спека обещала JWT, тогда как
 * рантайм использует серверные сессии. Конвертация по такому документу молча ломается —
 * ошибку увидит не разработчик, а пользователь на живом приложении.
 *
 * Поэтому список маршрутов сверяется автоматически. Добавил роут — допиши строку в таблицу
 * контракта; удалил — убери. Красный тест здесь дешевле сломанной конверсии через месяц.
 */

const CONTRACT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/app-backend-contract.md',
);

type Route = { method: string; path: string };

// Express не отдаёт таблицу маршрутов публично: достаём её из router.stack, где каждый
// слой-роут хранит путь и словарь методов.
function actualRoutes(): Route[] {
  const router = appRuntimeRouter({
    authService: {} as never,
    runQuery: {} as never,
    settings: {} as never,
  });
  const stack = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack;
  const out: Route[] = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (enabled) out.push({ method: method.toUpperCase(), path: layer.route.path });
    }
  }
  return out;
}

// В контракте маршруты живут в таблицах вида `| GET | \`/api/data/:table\` | … |`.
function documentedRoutes(): Route[] {
  const md = readFileSync(CONTRACT, 'utf8');
  const out: Route[] = [];
  for (const line of md.split('\n')) {
    const m = /^\|\s*(GET|POST|PATCH|PUT|DELETE)\s*\|\s*`([^`]+)`\s*\|/.exec(line.trim());
    if (m) out.push({ method: m[1]!, path: m[2]! });
  }
  return out;
}

const key = (r: Route): string => `${r.method} ${r.path}`;

test('контракт приложения описывает ровно те маршруты, что есть в рантайме', () => {
  const actual = new Set(actualRoutes().map(key));
  const documented = new Set(documentedRoutes().map(key));

  const undocumented = [...actual].filter((r) => !documented.has(r)).sort();
  const phantom = [...documented].filter((r) => !actual.has(r)).sort();

  assert.deepEqual(
    undocumented,
    [],
    `Роуты есть в коде, но не описаны в docs/app-backend-contract.md:\n  ${undocumented.join('\n  ')}`,
  );
  assert.deepEqual(
    phantom,
    [],
    `Контракт обещает маршруты, которых в рантайме нет (агент будет конвертировать под них):\n  ${phantom.join('\n  ')}`,
  );
});

test('контракт не описывает приложению путь к чужому проекту', () => {
  const md = readFileSync(CONTRACT, 'utf8');
  // projectId приходит из поддомена и подделать его нельзя — если контракт начнёт учить
  // приложение слать идентификатор проекта самому, это прямая дыра в изоляции.
  const routeLines = md.split('\n').filter((l) => /^\|\s*(GET|POST|PATCH|PUT|DELETE)\s*\|/.test(l.trim()));
  for (const line of routeLines) {
    assert.ok(
      !/:projectId|\bprojectId=/.test(line),
      `Маршрут контракта не должен принимать projectId от клиента: ${line.trim()}`,
    );
  }
});

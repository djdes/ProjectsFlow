import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GithubProjectPackageJsonReader } from './GithubProjectPackageJsonReader.js';

/**
 * Reader зовётся при каждом открытии вкладки превью, поэтому проверяется в первую очередь то,
 * что защищает GitHub от лишних запросов, а пользователя — от чужого токена в своём вердикте.
 */

type Call = { token: string; fullName: string; path: string };

function build(options: {
  gitRepoUrl?: string | null;
  token?: string | null;
  file?: string | null;
  now?: () => number;
  onGet?: () => void;
}): { reader: GithubProjectPackageJsonReader; calls: Call[] } {
  const calls: Call[] = [];
  const reader = new GithubProjectPackageJsonReader({
    projects: {
      async getById() {
        // `??` здесь нельзя: тесту нужно отличать «поле не задано» от заданного null.
        const url = 'gitRepoUrl' in options ? options.gitRepoUrl : 'https://github.com/acme/magflow';
        return { id: 'p1', gitRepoUrl: url } as never;
      },
    },
    tokens: {
      async getWithTokenByUserId() {
        return options.token === null
          ? null
          : ({ accessToken: options.token ?? 'tok', githubLogin: 'acme' } as never);
      },
    },
    api: {
      async getRepoFile(token: string, fullName: string, path: string) {
        calls.push({ token, fullName, path });
        options.onGet?.();
        return options.file === null || options.file === undefined
          ? null
          : { path, sha: 's', size: options.file.length, content: options.file };
      },
    },
    ...(options.now ? { now: options.now } : {}),
  });
  return { reader, calls };
}

test('читает package.json из репозитория проекта токеном смотрящего', async () => {
  const { reader, calls } = build({ file: '{"name":"magflow"}' });
  assert.equal(await reader.read('p1', 'u1'), '{"name":"magflow"}');
  assert.deepEqual(calls, [{ token: 'tok', fullName: 'acme/magflow', path: 'package.json' }]);
});

test('повторный запрос за TTL берётся из кэша, а не из GitHub', async () => {
  let time = 1_000;
  const { reader, calls } = build({ file: '{}', now: () => time });

  await reader.read('p1', 'u1');
  time += 60_000;
  await reader.read('p1', 'u1');
  assert.equal(calls.length, 1, 'превью открывают часто — второй поход в GitHub лишний');

  // TTL 5 минут: за ним package.json перечитывается, иначе конверсию проекта студия
  // заметит только после перезапуска сервера.
  time += 5 * 60_000;
  await reader.read('p1', 'u1');
  assert.equal(calls.length, 2);
});

// Отрицательный ответ кэшируется тоже: у проекта без package.json иначе каждый показ превью
// превращается в 404-запрос к GitHub.
test('отсутствующий файл кэшируется наравне с найденным', async () => {
  let time = 0;
  const { reader, calls } = build({ file: null, now: () => time });
  assert.equal(await reader.read('p1', 'u1'), null);
  time += 1_000;
  assert.equal(await reader.read('p1', 'u1'), null);
  assert.equal(calls.length, 1);
});

test('без своего GitHub-токена в репозиторий не ходим', async () => {
  const { reader, calls } = build({ token: null, file: '{}' });
  assert.equal(await reader.read('p1', 'u1'), null);
  // Ключевое: чужой (делегированный) токен здесь не подбирается. Делегация выдаётся под
  // аудит, и тратить её на подсказку в интерфейсе — не тот размен.
  assert.equal(calls.length, 0);
});

test('проект без репозитория не вызывает GitHub', async () => {
  const { reader, calls } = build({ gitRepoUrl: null, file: '{}' });
  assert.equal(await reader.read('p1', 'u1'), null);
  assert.equal(calls.length, 0);
});

test('нераспознанный URL репозитория не вызывает GitHub', async () => {
  const { reader, calls } = build({ gitRepoUrl: 'https://gitlab.com/acme/magflow', file: '{}' });
  assert.equal(await reader.read('p1', 'u1'), null);
  assert.equal(calls.length, 0);
});

test('ошибка GitHub не глотается тихо — её обрабатывает вызывающий use-case', async () => {
  const { reader } = build({ file: '{}', onGet: () => { throw new Error('GitHub 503'); } });
  await assert.rejects(() => reader.read('p1', 'u1'), /GitHub 503/);
});

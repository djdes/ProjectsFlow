import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConvertProjectToPlatformBackend } from './ConvertProjectToPlatformBackend.js';
import {
  ProjectAlreadyStaticError,
  PlatformBackendContractUnavailableError,
  InsufficientProjectRoleError,
} from '../../domain/project/errors.js';

/**
 * Кнопка создаёт задачу в чужом канбане и запускает прогон воркера. Поэтому проверяется в
 * первую очередь то, при каких условиях задача создаваться НЕ должна.
 */

const SERVER_APP = JSON.stringify({ scripts: { start: 'node server.js' }, dependencies: { mysql2: '^3' } });
const STATIC_APP = JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^5' } });

type Created = { projectId: string; description: string; status: string; ownerUserId: string };

function build(options: {
  packageJson?: string | null;
  deployed?: boolean;
  role?: 'owner' | 'editor' | 'viewer';
  contract?: string | null;
  existingTasks?: Array<{ id: string; description: string; status: string }>;
}): { useCase: ConvertProjectToPlatformBackend; created: Created[] } {
  const created: Created[] = [];
  const role = options.role ?? 'owner';
  const useCase = new ConvertProjectToPlatformBackend({
    projects: { async getById() { return { id: 'p1', ownerId: 'u1' } as never; } } as never,
    members: {
      async findForProject(projectId: string, userId: string) {
        return { projectId, userId, role, joinedAt: new Date() };
      },
    } as never,
    sites: {
      async getByProject() {
        return options.deployed ? ({ slug: 'demo', publishedAt: new Date(), fileCount: 3 } as never) : null;
      },
    },
    tasks: {
      async listByProject() {
        return (options.existingTasks ?? []) as never;
      },
    },
    createTask: {
      async execute(input: never) {
        const command = input as unknown as Created;
        created.push(command);
        return { id: 't-new' } as never;
      },
    },
    // `??` здесь нельзя: тесту нужно отличать «поле не задано» от заданного null.
    packageJson: { async read() { return 'packageJson' in options ? options.packageJson! : SERVER_APP; } },
    contract: { read() { return options.contract === undefined ? '## Контракт\n\n| GET | `/api/data/:table` |' : options.contract; } },
  });
  return { useCase, created };
}

test('серверному проекту без деплоя создаётся задача с контрактом и причинами', async () => {
  const { useCase, created } = build({});
  const result = await useCase.execute('p1', 'u1');

  assert.equal(result.created, true);
  assert.equal(created.length, 1);
  const description = created[0]!.description;
  // Воркер должен получить и вердикт, и контракт: без причин непонятно что чинить,
  // без контракта — под что конвертировать.
  assert.ok(/mysql2/.test(description), 'в брифе нет причин вердикта');
  assert.ok(/\/api\/data\/:table/.test(description), 'в брифе нет контракта');
  assert.equal(created[0]!.status, 'todo');
});

// Главная проверка: вердикт пересчитывается на сервере. Клиент присылает только id проекта,
// и то, что он показывал плашку «нужен собственный сервер», ничего не доказывает.
test('обычной статике задача не создаётся, даже если клиент попросил', async () => {
  const { useCase, created } = build({ packageJson: STATIC_APP });
  await assert.rejects(() => useCase.execute('p1', 'u1'), ProjectAlreadyStaticError);
  assert.equal(created.length, 0);
});

test('нераспознанному проекту задача не создаётся', async () => {
  const { useCase, created } = build({ packageJson: null });
  await assert.rejects(() => useCase.execute('p1', 'u1'), ProjectAlreadyStaticError);
  assert.equal(created.length, 0);
});

test('уже задеплоенному проекту переезжать некуда', async () => {
  const { useCase, created } = build({ deployed: true });
  await assert.rejects(() => useCase.execute('p1', 'u1'), ProjectAlreadyStaticError);
  assert.equal(created.length, 0);
});

// Пользователь нажмёт второй раз, не найдя задачу глазами. Вторая копия того же брифа —
// это второй прогон воркера по тому же коду.
test('повторный клик возвращает существующую задачу, а не создаёт вторую', async () => {
  const { useCase, created } = build({
    existingTasks: [
      { id: 't-old', status: 'in_progress', description: '# Перевести проект на бэкенд платформы\n<!-- pf:convert-to-platform-backend -->\n…' },
    ],
  });

  const result = await useCase.execute('p1', 'u1');
  assert.equal(result.created, false);
  assert.equal(result.taskId, 't-old');
  assert.equal(created.length, 0);
});

// Задачу считаем актуальной только пока она открыта: закрытая означает, что переезд уже
// пробовали, и повторить его пользователь вправе.
test('закрытая задача не блокирует новую', async () => {
  const { useCase, created } = build({
    existingTasks: [
      { id: 't-old', status: 'done', description: '<!-- pf:convert-to-platform-backend -->' },
    ],
  });

  const result = await useCase.execute('p1', 'u1');
  assert.equal(result.created, true);
  assert.equal(created.length, 1);
});

// Бриф без контракта — задача, которую воркер завалит, потратив прогон. Явная ошибка дешевле.
test('без контракта задача не создаётся вовсе', async () => {
  const { useCase, created } = build({ contract: null });
  await assert.rejects(() => useCase.execute('p1', 'u1'), PlatformBackendContractUnavailableError);
  assert.equal(created.length, 0);
});

test('viewer не может поставить задачу воркеру', async () => {
  const { useCase, created } = build({ role: 'viewer' });
  await assert.rejects(() => useCase.execute('p1', 'u-viewer'), InsufficientProjectRoleError);
  assert.equal(created.length, 0);
});

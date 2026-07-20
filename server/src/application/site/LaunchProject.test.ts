import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LaunchProject } from './LaunchProject.js';
import { InsufficientProjectRoleError } from '../../domain/project/errors.js';

/**
 * Смысл use-case'а — не «создать задачу», а «создать задачу, которую нельзя закрыть по
 * зелёной сборке». Поэтому проверяется содержимое брифа, а не факт вызова createTask.
 */

const SERVER_APP = JSON.stringify({ scripts: { start: 'node server.js' }, dependencies: { mysql2: '^3' } });
const STATIC_APP = JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^5' } });

type Created = { projectId: string; description: string; status: string; ownerUserId: string };

function build(options: {
  packageJson?: string | null;
  packageJsonThrows?: boolean;
  siteSlug?: string | null;
  role?: 'owner' | 'editor' | 'viewer';
  existingTasks?: Array<{ id: string; description: string; status: string }>;
} = {}): { useCase: LaunchProject; created: Created[] } {
  const created: Created[] = [];
  const role = options.role ?? 'owner';
  const useCase = new LaunchProject({
    projects: {
      async getById() {
        return { id: 'p1', ownerId: 'u1', siteSlug: options.siteSlug === undefined ? 'demo-shop' : options.siteSlug } as never;
      },
    } as never,
    members: {
      async findForProject(projectId: string, userId: string) {
        return { projectId, userId, role, joinedAt: new Date() };
      },
    } as never,
    tasks: {
      async listByProject() {
        return (options.existingTasks ?? []) as never;
      },
    },
    createTask: {
      async execute(input: never) {
        created.push(input as unknown as Created);
        return { id: 't-new' } as never;
      },
    },
    packageJson: {
      async read() {
        if (options.packageJsonThrows) throw new Error('github down');
        // `??` здесь нельзя: тесту нужно отличать «поле не задано» от заданного null.
        return 'packageJson' in options ? options.packageJson! : STATIC_APP;
      },
    },
    baseDomain: 'projectsflow.ru',
  });
  return { useCase, created };
}

test('бриф несёт slug, id проекта и шаг публикации', async () => {
  const { useCase, created } = build();
  const result = await useCase.execute('p1', 'u1');

  assert.equal(result.created, true);
  assert.equal(created.length, 1);
  const description = created[0]!.description;

  // Агент не должен искать адрес собственного проекта — он подставлен.
  assert.ok(description.includes('https://demo-shop.projectsflow.ru'), 'в брифе нет адреса сайта');
  assert.ok(description.includes('p1'), 'в брифе нет id проекта');
  // Публикация — единственный шаг, без которого «запуск» не наступает.
  assert.ok(description.includes('pf_publish_site'), 'в брифе нет шага публикации');
  assert.ok(
    description.includes('/api/agent/projects/p1/site-artifact'),
    'в брифе нет фолбэка на прямую публикацию',
  );
  assert.equal(created[0]!.status, 'todo');
});

// Ровно тот провал, из-за которого бриф и появился: зелёная сборка принималась за запуск.
test('бриф явно объявляет критерий готовности и запрещает закрытие по сборке', async () => {
  const { useCase, created } = build();
  await useCase.execute('p1', 'u1');
  const description = created[0]!.description;

  assert.ok(description.includes('deployedAt != null'), 'в брифе нет критерия deployedAt');
  assert.ok(/Definition of Done/i.test(description), 'в брифе нет секции DoD');
  assert.ok(
    description.includes('Зелёная локальная сборка запуском НЕ является'),
    'бриф не запрещает закрывать задачу по зелёной сборке',
  );
  assert.ok(description.includes('сайт в разработке'), 'в брифе нет упоминания заглушки');
});

// Пользователь нажмёт второй раз, не найдя задачу глазами. Вторая копия того же брифа —
// это второй прогон воркера по тому же коду.
test('повторный клик возвращает существующую задачу, а не создаёт вторую', async () => {
  const { useCase, created } = build({
    existingTasks: [
      { id: 't-old', status: 'in_progress', description: '# Запустить проект\n<!-- pf:launch-project -->\n…' },
    ],
  });

  const result = await useCase.execute('p1', 'u1');
  assert.equal(result.created, false);
  assert.equal(result.taskId, 't-old');
  assert.equal(created.length, 0);
});

// Задачи, созданные до брифа: описание было ровно из двух слов, маркера в них нет.
test('старая двухсловная задача тоже блокирует дубликат', async () => {
  const { useCase, created } = build({
    existingTasks: [{ id: 't-legacy', status: 'todo', description: 'Запустить проект' }],
  });

  const result = await useCase.execute('p1', 'u1');
  assert.equal(result.created, false);
  assert.equal(result.taskId, 't-legacy');
  assert.equal(created.length, 0);
});

// Закрытая задача означает, что запуск уже пробовали — повторить пользователь вправе.
test('закрытая задача не блокирует новую', async () => {
  const { useCase, created } = build({
    existingTasks: [{ id: 't-old', status: 'done', description: '<!-- pf:launch-project -->' }],
  });

  const result = await useCase.execute('p1', 'u1');
  assert.equal(result.created, true);
  assert.equal(created.length, 1);
});

// Проекту со своим сервером опубликовать всё равно надо статику — но сказать об этом
// нужно заранее, иначе агент потратит прогон на попытку поднять процесс.
test('проекту со своим сервером бриф добавляет предупреждение с причинами', async () => {
  const { useCase, created } = build({ packageJson: SERVER_APP });
  await useCase.execute('p1', 'u1');
  const description = created[0]!.description;

  assert.ok(/mysql2/.test(description), 'в брифе нет причин вердикта');
  assert.ok(description.includes('pf_declare_app_schema'), 'в брифе нет шага объявления схемы');
});

test('обычной статике предупреждение про свой сервер не добавляется', async () => {
  const { useCase, created } = build({ packageJson: STATIC_APP });
  await useCase.execute('p1', 'u1');
  assert.ok(!created[0]!.description.includes('собственный серверный процесс'));
});

// Недоступный GitHub не должен мешать поставить задачу: определение вида проекта — бонус.
test('недоступный package.json не мешает создать задачу', async () => {
  const { useCase, created } = build({ packageJsonThrows: true });
  const result = await useCase.execute('p1', 'u1');
  assert.equal(result.created, true);
  assert.ok(created[0]!.description.includes('pf_publish_site'));
});

// Slug проставляется миграцией, но тип допускает null — бриф не должен превращаться в
// "https://null.projectsflow.ru".
test('без slug бриф подсказывает, где его взять', async () => {
  const { useCase, created } = build({ siteSlug: null });
  await useCase.execute('p1', 'u1');
  const description = created[0]!.description;
  assert.ok(!description.includes('https://null.'), 'в брифе оказался slug null');
  assert.ok(description.includes('/api/projects/p1/site'));
});

test('viewer не может поставить задачу воркеру', async () => {
  const { useCase, created } = build({ role: 'viewer' });
  await assert.rejects(() => useCase.execute('p1', 'u-viewer'), InsufficientProjectRoleError);
  assert.equal(created.length, 0);
});

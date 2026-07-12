# Project Overview Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Привести страницу «Обзор» проекта к плоскому Notion-стилю (отступы как у «Входящих») и добавить кнопку «Создать репо» — создание нового GitHub-репозитория с автозаполнением имени по названию проекта.

**Architecture:** Спека — `docs/superpowers/specs/2026-07-12-project-overview-redesign-design.md`. Сервер: новый use-case `CreateProjectRepo` (Clean Architecture, зеркало `EnsureProjectAppRepo`, но БЕЗ побочных эффектов воркер-флоу), маршрут `POST /api/projects/:id/repo`. Клиент: новый метод порта `ProjectRepository.createRepo`, диалог `CreateRepoDialog`, плоский компонент-обёртка `OverviewSection` вместо shadcn `Card` на всех секциях обзора, переключатель статуса (PATCH уже принимает `status` — бэкенд не нужен).

**Tech Stack:** Express 4 + zod (server), node:test + tsx (server-тесты), React 19 + Tailwind + shadcn/ui (client), typecheck/lint (client, юнит-тестов на клиенте нет).

## Global Constraints

- Работать в отдельном worktree и ветке `feature/overview-redesign` (superpowers:using-git-worktrees). **НЕ пушить в `main`** до явного «выкатываем» — push в main триггерит автодеплой на прод.
- `git add` — только явные пути, НИКОГДА `git add -A` (в основном worktree параллельная сессия держит свои правки).
- Пользовательские строки — на русском; код/комментарии — на английском (техкомменты в этом репо исторически на русском — следуй стилю файла).
- `presentation` НЕ импортирует из `infrastructure/http|mock` — только `useContainer()`.
- Не переиспользовать `POST /:id/app-repo` / `EnsureProjectAppRepo` для пользовательской кнопки: это воркер-флоу с побочками (делегация, KB, workflow).
- Серверные тесты: из `server/` — `npm test` (все) или `node --import tsx --test <file>` (один файл). Клиент: `npm run typecheck` и `npm run lint` из корня.
- Локальный full-stack сломан (миграция 054) — E2E только через vite preview + прод-прокси (см. память `local-ui-verify-via-prod-proxy`).

---

### Task 1: Вынести slugify в общий серверный модуль

**Files:**
- Create: `server/src/application/project/slugifyRepoName.ts`
- Create: `server/src/application/project/slugifyRepoName.test.ts`
- Modify: `server/src/application/project/EnsureProjectAppRepo.ts:18-39` (убрать локальные TRANSLIT/slugify), `:104` (вызов)

**Interfaces:**
- Produces: `slugifyRepoName(name: string): string` — транслит кириллицы + `[a-z0-9-]`, схлопывание дефисов, fallback `'project'`. Task 2 не использует (имя приходит с клиента), клиентская копия — Task 4.

- [ ] **Step 1: Написать падающий тест**

```ts
// server/src/application/project/slugifyRepoName.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugifyRepoName } from './slugifyRepoName.js';

test('slugifyRepoName: транслит кириллицы', () => {
  assert.equal(slugifyRepoName('Обувь Лендинг'), 'obuv-lending');
});

test('slugifyRepoName: спецсимволы и пробелы схлопываются в дефисы', () => {
  assert.equal(slugifyRepoName('My  Shop!!'), 'my-shop');
});

test('slugifyRepoName: пустой результат → project', () => {
  assert.equal(slugifyRepoName('!!!'), 'project');
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run (из `server/`): `node --import tsx --test src/application/project/slugifyRepoName.test.ts`
Expected: FAIL — `Cannot find module './slugifyRepoName.js'`

- [ ] **Step 3: Создать модуль (перенос из EnsureProjectAppRepo как есть)**

```ts
// server/src/application/project/slugifyRepoName.ts
// Транслит кириллицы → латиница + slugify для имён GitHub-репо. Общий для
// app-репо воркера (EnsureProjectAppRepo) и кнопки «Создать репо» (клиент
// держит свою копию в client/src/lib/slugifyRepoName.ts — слои не шарятся).
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugifyRepoName(name: string): string {
  const translit = name
    .toLowerCase()
    .split('')
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('');
  return (
    translit
      .trim()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
  );
}
```

В `EnsureProjectAppRepo.ts`: удалить блок `const TRANSLIT ... function slugify(...)` (строки 18–39), добавить `import { slugifyRepoName } from './slugifyRepoName.js';`, заменить `slugify(project.name)` → `slugifyRepoName(project.name)` (строка 104).

- [ ] **Step 4: Прогнать тесты — новый файл и регрессию EnsureProjectAppRepo**

Run (из `server/`): `node --import tsx --test src/application/project/slugifyRepoName.test.ts src/application/project/EnsureProjectAppRepo.test.ts`
Expected: PASS все (в т.ч. существующий кейс `pf-obuv-lending-p1` — поведение не изменилось)

- [ ] **Step 5: Commit**

```bash
git add server/src/application/project/slugifyRepoName.ts server/src/application/project/slugifyRepoName.test.ts server/src/application/project/EnsureProjectAppRepo.ts
git commit -m "refactor(server): вынести транслит-slugify имён репо в общий модуль"
```

---

### Task 2: Доменные ошибки + use-case CreateProjectRepo (TDD)

**Files:**
- Modify: `server/src/domain/github/errors.ts` (добавить `GithubRepoNameTakenError`)
- Modify: `server/src/domain/project/errors.ts` (добавить `ProjectRepoAlreadyConnectedError`)
- Create: `server/src/application/project/CreateProjectRepo.ts`
- Test: `server/src/application/project/CreateProjectRepo.test.ts`

**Interfaces:**
- Consumes: `requireProjectAccess(deps, projectId, userId, 'update_project')` из `./projectAccess.js`; `GithubApiClient.createRepo(accessToken, {name, description?, privateRepo, autoInit})` → `{fullName, htmlUrl}`; `GithubTokenRepository.getWithTokenByUserId(userId)` → `{accessToken, ...} | null`; `GithubApiError` имеет `public readonly status: number`.
- Produces: `class CreateProjectRepo { execute(projectId: string, callerUserId: string, input: {name: string; privateRepo: boolean}): Promise<{fullName: string; gitRepoUrl: string}> }`; ошибки `GithubRepoNameTakenError(repoName)`, `ProjectRepoAlreadyConnectedError` — Task 3 мапит их на HTTP.

- [ ] **Step 1: Написать падающие тесты**

```ts
// server/src/application/project/CreateProjectRepo.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateProjectRepo } from './CreateProjectRepo.js';
import {
  GithubApiError,
  GithubNotConnectedError,
  GithubRepoNameTakenError,
} from '../../domain/github/errors.js';
import {
  InsufficientProjectRoleError,
  ProjectRepoAlreadyConnectedError,
} from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectRole } from '../../domain/project/ProjectMembership.js';

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1', ownerId: 'owner1', name: 'Обувь Лендинг', icon: null, status: 'active',
    gitRepoUrl: null, kbRepoFullName: null, kbKind: 'none', financeVisibility: 'owner',
    dispatcherUserId: null, multiTaskWorker: false, isInbox: false,
    description: null, coverUrl: null, coverPosition: 50,
    publicSlug: null, isPublic: false, publicIndexing: false, appRepoFullName: null, siteSlug: null,
    createdAt: new Date('2026-01-01'), ...over,
  };
}

type CreateRepoCall = { name: string; description?: string; privateRepo: boolean; autoInit: boolean };

function makeDeps(opts: {
  project: Project;
  role: ProjectRole | null;
  connected: boolean;
  createRepoImpl?: (name: string) => Promise<{ fullName: string; htmlUrl: string }>;
}) {
  const calls = {
    createRepo: [] as CreateRepoCall[],
    updates: [] as Array<{ gitRepoUrl?: string | null }>,
  };
  const projects = {
    async getById(id: string) {
      return opts.project.id === id ? opts.project : null;
    },
    async update(_id: string, patch: { gitRepoUrl?: string | null }) {
      calls.updates.push(patch);
      return { ...opts.project, ...patch };
    },
  } as any;
  const members = {
    async findForProject(projectId: string, userId: string) {
      return opts.role ? { projectId, userId, role: opts.role, joinedAt: new Date() } : null;
    },
  } as any;
  const tokens = {
    async getWithTokenByUserId(userId: string) {
      return opts.connected ? { accessToken: `tok-${userId}`, githubLogin: 'octocat' } : null;
    },
  } as any;
  const api = {
    async createRepo(_token: string, input: CreateRepoCall) {
      calls.createRepo.push(input);
      if (opts.createRepoImpl) return opts.createRepoImpl(input.name);
      return { fullName: `octocat/${input.name}`, htmlUrl: `https://github.com/octocat/${input.name}` };
    },
  } as any;
  return { deps: { projects, members, tokens, api }, calls };
}

test('CreateProjectRepo: editor + connected → создаёт репо и пишет gitRepoUrl', async () => {
  const { deps, calls } = makeDeps({ project: makeProject(), role: 'editor', connected: true });
  const out = await new CreateProjectRepo(deps).execute('p1', 'u1', {
    name: 'obuv-lending', privateRepo: true,
  });
  assert.equal(out.fullName, 'octocat/obuv-lending');
  assert.equal(out.gitRepoUrl, 'https://github.com/octocat/obuv-lending');
  assert.deepEqual(calls.createRepo, [{
    name: 'obuv-lending',
    description: 'ProjectsFlow: Обувь Лендинг',
    privateRepo: true,
    autoInit: true,
  }]);
  assert.deepEqual(calls.updates, [{ gitRepoUrl: 'https://github.com/octocat/obuv-lending' }]);
});

test('CreateProjectRepo: репо уже подключён → ProjectRepoAlreadyConnectedError, GitHub не зовём', async () => {
  const project = makeProject({ gitRepoUrl: 'https://github.com/x/y' });
  const { deps, calls } = makeDeps({ project, role: 'owner', connected: true });
  await assert.rejects(
    () => new CreateProjectRepo(deps).execute('p1', 'owner1', { name: 'z', privateRepo: true }),
    ProjectRepoAlreadyConnectedError,
  );
  assert.equal(calls.createRepo.length, 0);
});

test('CreateProjectRepo: viewer → InsufficientProjectRoleError', async () => {
  const { deps } = makeDeps({ project: makeProject(), role: 'viewer', connected: true });
  await assert.rejects(
    () => new CreateProjectRepo(deps).execute('p1', 'u1', { name: 'z', privateRepo: true }),
    InsufficientProjectRoleError,
  );
});

test('CreateProjectRepo: GitHub не привязан у вызывающего → GithubNotConnectedError', async () => {
  const { deps } = makeDeps({ project: makeProject(), role: 'editor', connected: false });
  await assert.rejects(
    () => new CreateProjectRepo(deps).execute('p1', 'u1', { name: 'z', privateRepo: true }),
    GithubNotConnectedError,
  );
});

test('CreateProjectRepo: GitHub 422 (имя занято) → GithubRepoNameTakenError, gitRepoUrl не пишем', async () => {
  const { deps, calls } = makeDeps({
    project: makeProject(), role: 'editor', connected: true,
    createRepoImpl: async () => { throw new GithubApiError(422, 'name already exists'); },
  });
  await assert.rejects(
    () => new CreateProjectRepo(deps).execute('p1', 'u1', { name: 'taken', privateRepo: true }),
    GithubRepoNameTakenError,
  );
  assert.equal(calls.updates.length, 0);
});

test('CreateProjectRepo: прочие ошибки GitHub пробрасываются как есть', async () => {
  const { deps } = makeDeps({
    project: makeProject(), role: 'editor', connected: true,
    createRepoImpl: async () => { throw new GithubApiError(500, 'boom'); },
  });
  await assert.rejects(
    () => new CreateProjectRepo(deps).execute('p1', 'u1', { name: 'z', privateRepo: true }),
    (e: unknown) => e instanceof GithubApiError && e.status === 500,
  );
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run (из `server/`): `node --import tsx --test src/application/project/CreateProjectRepo.test.ts`
Expected: FAIL — `Cannot find module './CreateProjectRepo.js'`

- [ ] **Step 3: Добавить доменные ошибки**

В `server/src/domain/github/errors.ts` (в конец файла):

```ts
export class GithubRepoNameTakenError extends Error {
  constructor(public readonly repoName: string) {
    super(`Repository name already taken: ${repoName}`);
    this.name = 'GithubRepoNameTakenError';
  }
}
```

В `server/src/domain/project/errors.ts` (в конец файла, стиль остальных ошибок файла):

```ts
export class ProjectRepoAlreadyConnectedError extends Error {
  constructor() {
    super('Project already has a connected git repo');
    this.name = 'ProjectRepoAlreadyConnectedError';
  }
}
```

- [ ] **Step 4: Реализовать use-case**

```ts
// server/src/application/project/CreateProjectRepo.ts
import type { GithubApiClient } from '../github/GithubApiClient.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import {
  GithubNotConnectedError,
  GithubRepoNameTakenError,
} from '../../domain/github/errors.js';
import { ProjectRepoAlreadyConnectedError } from '../../domain/project/errors.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tokens: GithubTokenRepository;
  readonly api: GithubApiClient;
};

export type CreateProjectRepoInput = {
  readonly name: string;
  readonly privateRepo: boolean;
};

// GitHub возвращает 422, когда имя репо уже занято у пользователя.
function isNameTaken(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 422;
}

// Кнопка «Создать репо» на обзоре проекта: создаёт НОВЫЙ репо под аккаунтом
// ВЫЗЫВАЮЩЕГО (не владельца проекта) его токеном и подключает как gitRepoUrl.
// Editor+. Никаких побочных эффектов app-repo-флоу (делегация, KB, workflow) —
// это отдельная кнопка воркера (EnsureProjectAppRepo).
export class CreateProjectRepo {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    callerUserId: string,
    input: CreateProjectRepoInput,
  ): Promise<{ fullName: string; gitRepoUrl: string }> {
    const { project } = await requireProjectAccess(
      this.deps,
      projectId,
      callerUserId,
      'update_project',
    );
    if (project.gitRepoUrl) throw new ProjectRepoAlreadyConnectedError();

    const token = await this.deps.tokens.getWithTokenByUserId(callerUserId);
    if (!token) throw new GithubNotConnectedError();

    let created: { fullName: string; htmlUrl: string };
    try {
      created = await this.deps.api.createRepo(token.accessToken, {
        name: input.name,
        description: `ProjectsFlow: ${project.name}`,
        privateRepo: input.privateRepo,
        autoInit: true,
      });
    } catch (err) {
      if (isNameTaken(err)) throw new GithubRepoNameTakenError(input.name);
      throw err;
    }

    await this.deps.projects.update(projectId, { gitRepoUrl: created.htmlUrl });
    return { fullName: created.fullName, gitRepoUrl: created.htmlUrl };
  }
}
```

- [ ] **Step 5: Прогнать тесты**

Run (из `server/`): `node --import tsx --test src/application/project/CreateProjectRepo.test.ts`
Expected: PASS (6 тестов)

- [ ] **Step 6: Commit**

```bash
git add server/src/domain/github/errors.ts server/src/domain/project/errors.ts server/src/application/project/CreateProjectRepo.ts server/src/application/project/CreateProjectRepo.test.ts
git commit -m "feat(server): use-case CreateProjectRepo — создание GitHub-репо из проекта"
```

---

### Task 3: Схема, маршрут POST /:id/repo, errorHandler, wiring

**Files:**
- Modify: `server/src/presentation/projects/schemas.ts` (новая схема)
- Modify: `server/src/presentation/projects/routes.ts` (import типа + схемы, поле в `Deps`, маршрут после `/:id/app-repo`, т.е. после строки 427)
- Modify: `server/src/presentation/middleware/errorHandler.ts` (два маппинга, рядом с GitHub-блоком ~строка 321)
- Modify: `server/src/index.ts` (import + wiring рядом с `ensureAppRepo`, ~строка 1418)

**Interfaces:**
- Consumes: `CreateProjectRepo` из Task 2; паттерн маршрутов/`deps.notifyProjectChanged(id)` как у `POST /:id/app-repo` (routes.ts:417-427).
- Produces: `POST /api/projects/:id/repo` body `{name, privateRepo}` → 200 `{fullName, gitRepoUrl}`; ошибки: 409 `repo_already_connected`, 409 `github_not_connected`, 422 `github_repo_name_taken`, 403 `insufficient_role`. Клиент (Task 4/5) опирается на эти коды.

- [ ] **Step 1: Схема запроса**

В `server/src/presentation/projects/schemas.ts` (рядом с другими project-схемами):

```ts
// Имя нового GitHub-репо: латиница/цифры/._-, как валидирует сам GitHub.
export const createProjectRepoSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  privateRepo: z.boolean(),
});
```

- [ ] **Step 2: Маппинг ошибок**

В `server/src/presentation/middleware/errorHandler.ts`: добавить в существующие import-блоки `GithubRepoNameTakenError` (из `domain/github/errors.js`) и `ProjectRepoAlreadyConnectedError` (из `domain/project/errors.js`), после ветки `GithubNotConnectedError` (строка 327) вставить:

```ts
  if (err instanceof GithubRepoNameTakenError) {
    res.status(422).json({
      error: 'github_repo_name_taken',
      message: 'Репозиторий с таким именем уже существует.',
    });
    return;
  }

  if (err instanceof ProjectRepoAlreadyConnectedError) {
    res.status(409).json({
      error: 'repo_already_connected',
      message: 'У проекта уже подключён репозиторий.',
    });
    return;
  }
```

- [ ] **Step 3: Маршрут + Deps**

В `server/src/presentation/projects/routes.ts`:
- import: `import type { CreateProjectRepo } from '../../application/project/CreateProjectRepo.js';` и `createProjectRepoSchema` в список импортов из `./schemas.js`;
- в `type Deps` рядом с `ensureAppRepo: EnsureProjectAppRepo;` добавить `createProjectRepo: CreateProjectRepo;`;
- после маршрута `/:id/app-repo` (строка 427):

```ts
  // === Создать НОВЫЙ GitHub-репо и подключить к проекту (кнопка на «Обзоре»). ===
  // Репо создаётся под аккаунтом вызывающего его токеном. Editor+. 409 если уже подключён.
  router.post('/:id/repo', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const { name, privateRepo } = createProjectRepoSchema.parse(req.body);
      const result = await deps.createProjectRepo.execute(id, req.user!.id, { name, privateRepo });
      deps.notifyProjectChanged(id);
      res.json({ fullName: result.fullName, gitRepoUrl: result.gitRepoUrl });
    } catch (e) {
      next(e);
    }
  });
```

- [ ] **Step 4: Wiring в composition root**

В `server/src/index.ts`: import `CreateProjectRepo` рядом с `EnsureProjectAppRepo` (строка 69); в объект deps проект-роутера после `ensureAppRepo: new EnsureProjectAppRepo({...})` добавить:

```ts
    createProjectRepo: new CreateProjectRepo({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      api: githubApi,
    }),
```

- [ ] **Step 5: Компиляция и все серверные тесты**

Run (из `server/`): `npm run build` затем `npm test`
Expected: tsc без ошибок; все тесты PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/presentation/projects/schemas.ts server/src/presentation/projects/routes.ts server/src/presentation/middleware/errorHandler.ts server/src/index.ts
git commit -m "feat(server): POST /api/projects/:id/repo — создать и подключить GitHub-репо"
```

---

### Task 4: Клиентский порт createRepo + slugify-утилита

**Files:**
- Modify: `client/src/application/project/ProjectRepository.ts` (метод интерфейса, рядом с `ensureAppRepo`, строка 151)
- Modify: `client/src/infrastructure/http/HttpProjectRepository.ts` (реализация, рядом со строкой 277)
- Modify: `client/src/infrastructure/mock/MockProjectRepository.ts` (заглушка, рядом со строкой 210)
- Create: `client/src/lib/slugifyRepoName.ts`

**Interfaces:**
- Produces: `ProjectRepository.createRepo(projectId: string, input: {name: string; privateRepo: boolean}): Promise<{fullName: string; gitRepoUrl: string}>`; `slugifyRepoName(name: string): string` из `@/lib/slugifyRepoName`. Оба использует Task 5.

- [ ] **Step 1: Метод порта**

В `client/src/application/project/ProjectRepository.ts` после `ensureAppRepo` (строка 151):

```ts
  // Создать НОВЫЙ GitHub-репо под аккаунтом текущего юзера и подключить как gitRepoUrl.
  // Editor+. Ошибки: 409 repo_already_connected|github_not_connected, 422 github_repo_name_taken.
  createRepo(
    projectId: string,
    input: { name: string; privateRepo: boolean },
  ): Promise<{ fullName: string; gitRepoUrl: string }>;
```

- [ ] **Step 2: HTTP-реализация**

В `client/src/infrastructure/http/HttpProjectRepository.ts` после `ensureAppRepo` (строка 279):

```ts
  async createRepo(
    projectId: string,
    input: { name: string; privateRepo: boolean },
  ): Promise<{ fullName: string; gitRepoUrl: string }> {
    return httpClient.post<{ fullName: string; gitRepoUrl: string }>(
      `/projects/${projectId}/repo`,
      input,
    );
  }
```

- [ ] **Step 3: Mock-заглушка**

В `client/src/infrastructure/mock/MockProjectRepository.ts` после `ensureAppRepo` (строка 212):

```ts
  createRepo(): Promise<never> {
    return Promise.reject(new Error('Mock.createRepo: not implemented'));
  }
```

- [ ] **Step 4: Клиентский slugify (копия серверного — слои не шарятся)**

```ts
// client/src/lib/slugifyRepoName.ts
// Транслит кириллицы → латиница + slugify для автоподстановки имени GitHub-репо.
// Копия server/src/application/project/slugifyRepoName.ts (клиент и сервер не шарят код).
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugifyRepoName(name: string): string {
  const translit = name
    .toLowerCase()
    .split('')
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('');
  return (
    translit
      .trim()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
  );
}
```

- [ ] **Step 5: Typecheck**

Run (из корня): `npm run typecheck`
Expected: без ошибок (интерфейс и обе реализации согласованы)

- [ ] **Step 6: Commit**

```bash
git add client/src/application/project/ProjectRepository.ts client/src/infrastructure/http/HttpProjectRepository.ts client/src/infrastructure/mock/MockProjectRepository.ts client/src/lib/slugifyRepoName.ts
git commit -m "feat(client): порт createRepo + транслит-slugify для имени репо"
```

---

### Task 5: CreateRepoDialog + интеграция в GitRepoSection и RepoPickerDialog

**Files:**
- Create: `client/src/presentation/components/github/CreateRepoDialog.tsx`
- Modify: `client/src/presentation/components/forms/GitRepoSection.tsx` (кнопка «Создать новый» в empty-state, строки 133–153; state + рендер диалога)
- Modify: `client/src/presentation/components/github/RepoPickerDialog.tsx` (опциональный `onCreateNew` в футере, строки 172–176)

**Interfaces:**
- Consumes: `projectRepository.createRepo` и `slugifyRepoName` (Task 4); `HttpError` из `@/lib/HttpError` (`e.body.error` — код с сервера, Task 3); `useProjectsContext().refresh` (уже есть); `Switch` из `@/components/ui/switch`.
- Produces: `CreateRepoDialog({open, onOpenChange, projectId, projectName})`; `RepoPickerDialog` получает новый опциональный проп `onCreateNew?: () => void`.

- [ ] **Step 1: Компонент диалога**

```tsx
// client/src/presentation/components/github/CreateRepoDialog.tsx
import { useEffect, useState } from 'react';
import { Github, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { HttpError } from '@/lib/HttpError';
import { slugifyRepoName } from '@/lib/slugifyRepoName';
import { useContainer } from '@/infrastructure/di/container';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
};

const NAME_RE = /^[a-zA-Z0-9._-]+$/;

// «Создать новый репозиторий»: имя предзаполнено slug'ом названия проекта,
// приватность — по умолчанию включена. 422 «имя занято» показываем inline.
export function CreateRepoDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const { refresh } = useProjectsContext();
  const [name, setName] = useState('');
  const [privateRepo, setPrivateRepo] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Автозаполнение при каждом открытии (название проекта могло смениться).
  useEffect(() => {
    if (open) {
      setName(slugifyRepoName(projectName));
      setPrivateRepo(true);
      setError(null);
    }
  }, [open, projectName]);

  const invalid = name.length === 0 || name.length > 100 || !NAME_RE.test(name);

  const handleCreate = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const { fullName } = await projectRepository.createRepo(projectId, { name, privateRepo });
      refresh();
      toast.success(`Репозиторий ${fullName} создан и подключён`);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof HttpError && e.body.error === 'github_repo_name_taken') {
        setError('Репозиторий с таким именем уже существует — поменяй имя.');
      } else {
        setError((e as Error).message || 'Не удалось создать репозиторий');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="size-5" />
            Новый репозиторий
          </DialogTitle>
          <DialogDescription>
            Создам репозиторий на&nbsp;твоём GitHub-аккаунте и&nbsp;подключу к&nbsp;проекту.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="new-repo-name" className="text-sm font-medium">
              Имя репозитория
            </label>
            <Input
              id="new-repo-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              autoFocus
              spellCheck={false}
              className="font-mono"
            />
            {invalid && name.length > 0 && (
              <p className="text-xs text-destructive">
                Только латиница, цифры и&nbsp;символы . _ -
              </p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <Lock className="size-4 text-muted-foreground" />
              Приватный
            </span>
            <Switch checked={privateRepo} onCheckedChange={setPrivateRepo} />
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="button" onClick={() => void handleCreate()} disabled={saving || invalid}>
            {saving ? 'Создаю…' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Кнопка в GitRepoSection**

В `GitRepoSection.tsx`:
- добавить state `const [createOpen, setCreateOpen] = useState(false);` и `const canEdit = project.role === 'owner' || project.role === 'editor';`;
- в empty-state заменить ветку `connection ? (...)` (строки 140–145) на:

```tsx
              ) : connection ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setPickerOpen(true)}>
                    <Github />
                    Выбрать из GitHub
                  </Button>
                  {canEdit && (
                    <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                      Создать новый
                    </Button>
                  )}
                </div>
              ) : (
```

- рядом с `<RepoPickerDialog ...>` (строка 158) отрендерить диалог и связать «не нашёл → создать»:

```tsx
      <RepoPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        projectId={project.id}
        currentRepoUrl={project.gitRepoUrl}
        onCreateNew={
          canEdit
            ? () => {
                setPickerOpen(false);
                setCreateOpen(true);
              }
            : undefined
        }
      />
      <CreateRepoDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={project.id}
        projectName={project.name}
      />
```

плюс `import { CreateRepoDialog } from '@/presentation/components/github/CreateRepoDialog';`.

- [ ] **Step 3: Футер RepoPickerDialog**

В `RepoPickerDialog.tsx`: добавить в `Props` `onCreateNew?: () => void;`, принять в аргументах компонента, футер (строки 172–176) заменить на:

```tsx
        <DialogFooter className="gap-2 sm:justify-between">
          {onCreateNew ? (
            <Button type="button" variant="outline" onClick={onCreateNew}>
              Создать новый
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
```

- [ ] **Step 4: Typecheck + lint**

Run (из корня): `npm run typecheck` и `npm run lint`
Expected: без ошибок (boundaries не нарушены: presentation → di/container, lib)

- [ ] **Step 5: Commit**

```bash
git add client/src/presentation/components/github/CreateRepoDialog.tsx client/src/presentation/components/forms/GitRepoSection.tsx client/src/presentation/components/github/RepoPickerDialog.tsx
git commit -m "feat(tasks): кнопка «Создать репо» на обзоре — диалог с автоименем и приватностью"
```

---

### Task 6: Каркас ProjectPage — отступы, статус-переключатель, порядок секций

**Files:**
- Create: `client/src/presentation/components/project/ProjectStatusSelect.tsx`
- Modify: `client/src/presentation/pages/ProjectPage.tsx` (весь layout: строки 18–30 убрать Badge/statusLabel, 78–150 каркас)
- Modify: `client/src/presentation/components/project/TeamSection.tsx` (убрать рендер `<NotificationPrefsCard ...>`, строка 323, и его import, строка 23)

**Interfaces:**
- Consumes: `useUpdateProject().submit(id, {status})` — PATCH уже принимает `status` (server schemas.ts:51); `NotificationPrefsCard({projectId})` — уже плоский, без Card.
- Produces: `ProjectStatusSelect({project: Project})` — самодостаточный dropdown; ProjectPage рендерит секции в порядке: title/meta → Team → GitRepo → RecentCommits → Kb → Dispatcher → NotificationPrefs → danger.

- [ ] **Step 1: Компонент статуса**

```tsx
// client/src/presentation/components/project/ProjectStatusSelect.tsx
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import type { Project, ProjectStatus } from '@/domain/project/Project';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Активен',
  paused: 'На паузе',
  archived: 'Архив',
};

const STATUS_DOT: Record<ProjectStatus, string> = {
  active: 'bg-emerald-500',
  paused: 'bg-amber-500',
  archived: 'bg-muted-foreground/50',
};

// Статус проекта как рабочий переключатель (вместо мёртвого бейджа).
// Viewer видит статичный бейдж без dropdown.
export function ProjectStatusSelect({ project }: { project: Project }): React.ReactElement {
  const { submit, saving } = useUpdateProject();
  const canEdit = project.role === 'owner' || project.role === 'editor';

  const handleChange = async (value: string): Promise<void> => {
    try {
      await submit(project.id, { status: value as ProjectStatus });
    } catch {
      toast.error('Не удалось сменить статус');
    }
  };

  const badge = (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <span className={`size-1.5 rounded-full ${STATUS_DOT[project.status]}`} />
      {STATUS_LABEL[project.status]}
      {canEdit && <ChevronDown className="size-3" />}
    </span>
  );

  if (!canEdit) return badge;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={saving} className="rounded-md disabled:opacity-60">
        {badge}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={project.status} onValueChange={(v) => void handleChange(v)}>
          {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              <span className={`mr-2 size-1.5 rounded-full ${STATUS_DOT[s]}`} />
              {STATUS_LABEL[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Переписать каркас ProjectPage**

В `ProjectPage.tsx`:
- удалить локальные `statusLabel` и `Badge` (строки 18–30) и import `ProjectStatus`;
- добавить импорты `ProjectStatusSelect`, `NotificationPrefsCard`;
- заменить контейнер и порядок (строки 78–150) на:

```tsx
      {/* Тело: отступы как у Входящих/доски (px-6/14/24), контент прижат влево,
          текстовым секциям — max-w-3xl для читаемости строк. */}
      <div className="px-6 pb-12 pt-1 sm:px-14 lg:px-24">
        <div className="max-w-3xl space-y-6">
          <div className="space-y-3">
            <EditableProjectTitle projectId={data.id} name={data.name} />
            <div className="flex flex-wrap items-center gap-2">
              <ProjectStatusSelect project={data} />
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                <Link to={`/projects/${data.id}`}>
                  <LayoutGrid className="size-4" />
                  Доска задач
                </Link>
              </Button>
            </div>
          </div>

          <TeamSection project={data} />

          <GitRepoSection project={data} />

          {data.gitRepoUrl && (
            <RecentCommitsSection projectId={data.id} gitRepoUrl={data.gitRepoUrl} />
          )}

          <KbSection project={data} />

          {/* Ralph-диспетчер — не для inbox-проекта (он персональный, нет команды). */}
          {!data.isInbox && (
            <DispatcherSection project={data} onChanged={(p) => applyReplace(p)} />
          )}

          {/* Личная настройка юзера — отдельным блоком, не внутри «Команды». */}
          {!data.isInbox && (
            <section className="border-t pt-5">
              <NotificationPrefsCard projectId={data.id} />
            </section>
          )}

          {/* Опасная зона — только владелец, не для inbox. Тихая строка вместо красной карточки. */}
          {data.role === 'owner' && !data.isInbox && (
            <>
              <section className="border-t pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-medium">Удалить проект</p>
                    <p className="text-muted-foreground">
                      Безвозвратно: задачи, KB-документы, секреты и финансы. Подключённый
                      GitHub-репозиторий не затрагивается.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteOpen(true)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    Удалить проект
                  </Button>
                </div>
              </section>

              <DeleteProjectDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                projectId={data.id}
                projectName={data.name}
                otherMemberCount={Math.max(0, (data.memberCount ?? 1) - 1)}
                onDeleted={() => {
                  refreshProjects();
                  navigate('/');
                }}
              />
            </>
          )}
        </div>
      </div>
```

- убрать из импортов `Card, CardContent, CardHeader, CardTitle` (после удаления «опасной» карточки они в файле больше не нужны).

- [ ] **Step 3: Убрать NotificationPrefsCard из TeamSection**

В `TeamSection.tsx`: удалить строку 323 `<NotificationPrefsCard projectId={project.id} />` и import на строке 23.

- [ ] **Step 4: Typecheck + lint**

Run (из корня): `npm run typecheck` и `npm run lint`
Expected: без ошибок

- [ ] **Step 5: Commit**

```bash
git add client/src/presentation/components/project/ProjectStatusSelect.tsx client/src/presentation/pages/ProjectPage.tsx client/src/presentation/components/project/TeamSection.tsx
git commit -m "feat(project): обзор — широкий каркас как у Входящих, рабочий статус, порядок секций"
```

---

### Task 7: OverviewSection — плоские секции вместо Card

**Files:**
- Create: `client/src/presentation/components/project/OverviewSection.tsx`
- Modify: `client/src/presentation/components/forms/GitRepoSection.tsx` (Card-обёртка → OverviewSection, строки 76–81 и 155–156)
- Modify: `client/src/presentation/components/github/RecentCommitsSection.tsx` (3 Card-обёртки: строки ~76, ~94, ~109)
- Modify: `client/src/presentation/components/kb/KbSection.tsx` (строки 90–95, закрытие ~160)
- Modify: `client/src/presentation/components/project/DispatcherSection.tsx` (строки 90–101, закрытие ~231; CardDescription → `<p>`)
- Modify: `client/src/presentation/components/project/TeamSection.tsx` (его Card-обёртку — по тому же паттерну)

**Interfaces:**
- Produces: `OverviewSection({icon?, title, actions?, children})` — единственный новый экспорт; все секции обзора визуально однородны.

- [ ] **Step 1: Компонент**

```tsx
// client/src/presentation/components/project/OverviewSection.tsx
type Props = {
  icon?: React.ReactNode;
  title: string;
  // Правый слот строки заголовка — кнопки-действия секции.
  actions?: React.ReactNode;
  children: React.ReactNode;
};

// Плоская секция обзора проекта (замена shadcn Card): строка заголовка + контент.
// Разделение секций — border-t; отступы между ними задаёт space-y контейнера страницы.
export function OverviewSection({ icon, title, actions, children }: Props): React.ReactElement {
  return (
    <section className="border-t pt-5">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-medium">{title}</h2>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Перевести GitRepoSection (эталон трансформации)**

Было (строки 76–81 и 155–156):

```tsx
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <Github className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">GitHub репозиторий</CardTitle>
        </CardHeader>
        <CardContent>
          ...
        </CardContent>
      </Card>
```

Стало:

```tsx
      <OverviewSection
        icon={<Github className="size-4 text-muted-foreground" />}
        title="GitHub репозиторий"
      >
        ...
      </OverviewSection>
```

Внутренний контент — без изменений. Убрать import `Card, CardContent, CardHeader, CardTitle`, добавить `import { OverviewSection } from '@/presentation/components/project/OverviewSection';`. Заодно смягчить empty-state текст (строка 135–137) на одну muted-строку: `Не подключён — репозиторий с кодом проекта.`

- [ ] **Step 3: Перевести остальные секции тем же паттерном**

По одному файлу, читая текущий JSX (номера строк — ориентиры, файлы могли сдвинуться):
- `RecentCommitsSection.tsx` — ТРИ состояния с Card (loading ~76, error ~94, данные ~109). Третье имеет `justify-between`-заголовок с action-кнопкой — её в слот `actions`.
- `KbSection.tsx` — заголовок «База знаний» с иконкой (строки 90–95).
- `DispatcherSection.tsx` — есть `CardDescription` (строки 96–99): заменить на `<p className="mb-3 text-sm text-muted-foreground">` сразу после строки заголовка (передать контент как первый элемент children, до остального контента).
- `TeamSection.tsx` — заголовок «Команда» и кнопка «Пригласить» в слот `actions`.

Правило: меняется ТОЛЬКО обёртка (Card* → OverviewSection); внутренняя разметка и логика не трогаются. Исключение (по спеке): громкие onboarding-тексты пустых состояний можно сократить до одной muted-строки, кнопки при этом остаются `size="sm"`. В каждом файле убрать неиспользуемые Card-импорты.

- [ ] **Step 4: Typecheck + lint**

Run (из корня): `npm run typecheck` и `npm run lint`
Expected: без ошибок; eslint `no-unused-vars` подтвердит, что Card-импорты вычищены

- [ ] **Step 5: Commit**

```bash
git add client/src/presentation/components/project/OverviewSection.tsx client/src/presentation/components/forms/GitRepoSection.tsx client/src/presentation/components/github/RecentCommitsSection.tsx client/src/presentation/components/kb/KbSection.tsx client/src/presentation/components/project/DispatcherSection.tsx client/src/presentation/components/project/TeamSection.tsx
git commit -m "feat(project): обзор — плоские секции OverviewSection вместо карточек"
```

---

### Task 8: Визуальная верификация и финальный прогон

**Files:**
- Никаких новых; скриншоты — в scratchpad, не в репо.

- [ ] **Step 1: Полный прогон проверок**

Run (из корня): `npm run typecheck && npm run lint`; из `server/`: `npm test && npm run build`
Expected: всё зелёное

- [ ] **Step 2: Собрать клиент и поднять preview с прод-прокси**

Локальный full-stack сломан (миграция 054). По памяти `local-ui-verify-via-prod-proxy`: `npm run build -w client`, поднять `vite preview` с прокси `/api` на прод, залогиниться demo-аккаунтом.

- [ ] **Step 3: Прогнать состояния и снять скриншоты**

Одноразовый playwright-core скрипт (Chromium из `%LOCALAPPDATA%\ms-playwright`, `--use-gl=swiftshader --no-sandbox`), вьюпорты 375×812 и 1280×900, light+dark:
- обзор проекта БЕЗ репо: видны «Выбрать из GitHub» + «Создать новый», секции плоские, отступы совпадают с «Входящими» (открыть рядом для сравнения);
- диалог «Создать новый»: имя предзаполнено slug'ом, «Приватный» включён; ввести занятое имя → inline-ошибка 422;
- happy-path: создать репо с уникальным именем `pf-test-<случайный суффикс>` на demo-аккаунте → toast, секция показывает URL; удалить тестовый репо на GitHub после проверки;
- статус-dropdown: active → paused → active;
- «Мои уведомления» — отдельная секция; опасная зона — тихая строка; DeleteProjectDialog открывается.

Expected: вёрстка не съезжает на 375px, тёмная тема без белых вспышек. Скрипт и выхлоп удалить, браузер закрыть.

- [ ] **Step 4: Финальный коммит (если были правки по итогам проверки) и стоп**

НЕ мержить в `main` и НЕ пушить без явного «выкатываем» от юзера (автодеплой). Дальше — superpowers:finishing-a-development-branch.

---

## Порядок и зависимости

- Task 1 → Task 2 (независимы, но 1 первым — меньше конфликтов в EnsureProjectAppRepo) → Task 3 (нужны 2).
- Task 4 (нужен 3 для смысла, компилируется независимо) → Task 5 (нужен 4).
- Task 6, 7 — только клиент, независимы от 1–5; 6 перед 7 (каркас до конверсии секций).
- Task 8 — последним.

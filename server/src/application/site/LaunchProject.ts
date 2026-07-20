import { requireProjectAccess } from '../project/projectAccess.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { CreateTask } from '../task/CreateTask.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { ProjectPackageJsonReader } from './GetProjectSite.js';
import { detectProjectRuntime, type ProjectRuntimeSignals } from '../../domain/project/projectRuntimeKind.js';
import { siteUrl } from '../../domain/site/SiteArtifact.js';

/**
 * Ставит воркеру задачу «Запустить проект» с готовым брифом.
 *
 * Появилось из разбора провала: кнопка в студии создавала задачу с описанием из двух слов —
 * «Запустить проект». Воркер собирал фронтенд, видел зелёный `npm run build` и закрывал
 * задачу, формально не нарушив ни одной инструкции. Пользователь при этом получал заглушку
 * «сайт в разработке», потому что строки в `site_artifacts` так и не появилось.
 *
 * Поэтому бриф генерируется СЕРВЕРОМ и всегда несёт три вещи:
 *
 * 1. **Единственный критерий готовности.** Проект запущен тогда и только тогда, когда
 *    `GET /api/projects/:id/site` отдаёт `deployedAt != null`, а поддомен отдаёт сайт.
 *    Зелёная локальная сборка в критерий не входит — это прямым текстом в тексте задачи.
 * 2. **Шаг публикации.** Без явного «опубликуй через `pf_publish_site`» агент не догадается,
 *    что артефакт надо залить: сборка сама никуда не уезжает.
 * 3. **Готовые id и slug.** Агенту незачем искать адрес собственного проекта — подставляем.
 *
 * Повторный клик задачу не дублирует: ищем маркер в описании открытых задач.
 */

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: Pick<TaskRepository, 'listByProject'>;
  readonly createTask: Pick<CreateTask, 'execute'>;
  // Best-effort: по package.json различаем статику и проект со своим серверным процессом.
  // Недоступен GitHub — бриф просто без этой ветки, задача всё равно создаётся.
  readonly packageJson?: ProjectPackageJsonReader;
  // Базовый домен сайтов: <site_slug>.<baseDomain>.
  readonly baseDomain: string;
};

export type LaunchTaskResult = {
  readonly taskId: string;
  readonly title: string;
  /** false — задача уже была, вернули существующую. UI на это говорит «уже отправлена». */
  readonly created: boolean;
};

// Маркер в тексте задачи: по нему находим уже созданную. Заголовок для этого ненадёжен —
// пользователь его переименует, и кнопка начнёт плодить дубликаты.
const MARKER = '<!-- pf:launch-project -->';

const TITLE = 'Запустить проект';

// Задачи, созданные до появления брифа: описание было ровно из двух слов. Учитываем их,
// иначе первый же клик после обновления создаст вторую задачу поверх работающей.
const LEGACY_TITLE = TITLE.toLocaleLowerCase('ru-RU');

export class LaunchProject {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, callerUserId: string): Promise<LaunchTaskResult> {
    const { project } = await requireProjectAccess(this.deps, projectId, callerUserId, 'create_task');

    const existing = await this.findExisting(projectId);
    if (existing) return { taskId: existing.id, title: existing.title, created: false };

    const runtime = await this.detectRuntime(projectId, callerUserId);
    const task = await this.deps.createTask.execute({
      projectId,
      ownerUserId: callerUserId,
      status: 'todo',
      assigneeUserId: callerUserId,
      description: brief({
        projectId,
        siteSlug: project.siteSlug,
        baseDomain: this.deps.baseDomain,
        runtime,
      }),
    });

    return { taskId: task.id, title: TITLE, created: true };
  }

  private async findExisting(projectId: string): Promise<{ id: string; title: string } | null> {
    const tasks = await this.deps.tasks.listByProject(projectId);
    const open = tasks.find((task) => {
      if (task.status === 'done') return false;
      const description = task.description ?? '';
      if (description.includes(MARKER)) return true;
      return firstLine(description).toLocaleLowerCase('ru-RU') === LEGACY_TITLE;
    });
    if (!open) return null;
    // Заголовок берём из первой строки описания — пользователь мог его отредактировать,
    // и в ответе честнее показать то, что реально лежит на доске.
    return { id: open.id, title: firstLine(open.description ?? '') || TITLE };
  }

  // Best-effort: недоступный GitHub или отозванный токен не должны мешать поставить задачу.
  private async detectRuntime(
    projectId: string,
    callerUserId: string,
  ): Promise<ProjectRuntimeSignals | null> {
    if (!this.deps.packageJson) return null;
    try {
      const signals = detectProjectRuntime(await this.deps.packageJson.read(projectId, callerUserId));
      return signals.kind === 'unknown' ? null : signals;
    } catch {
      return null;
    }
  }
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/, 1)[0] ?? '').replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim();
}

function brief(input: {
  projectId: string;
  siteSlug: string | null;
  baseDomain: string;
  runtime: ProjectRuntimeSignals | null;
}): string {
  const { projectId, siteSlug, baseDomain, runtime } = input;
  const url = siteSlug
    ? siteUrl(baseDomain, siteSlug)
    : `https://<site_slug>.${baseDomain} (slug вернёт GET /api/projects/${projectId}/site)`;

  return [
    `# ${TITLE}`,
    MARKER,
    '',
    `- **id проекта:** \`${projectId}\``,
    `- **site_slug:** \`${siteSlug ?? '(ещё не назначен)'}\``,
    `- **адрес сайта:** ${url}`,
    '',
    'Платформа НЕ исполняет пользовательский код: она раздаёт статическую сборку и обслуживает',
    'вход и данные приложения сама. «Запустить проект» здесь означает ровно одно — собрать',
    'статику и **опубликовать** её артефактом. Пока артефакт не залит, пользователь видит',
    'заглушку «сайт в разработке», сколько бы раз сборка ни прошла успешно.',
    '',
    ...runtimeSection(runtime),
    '## Что сделать',
    '',
    '1. Поставить зависимости: `npm ci` (если lock-файла нет — `npm install`).',
    '2. Собрать статику: `npm run build`. Найти каталог сборки (`dist/`, `build/`, `out/` —',
    '   смотри конфиг сборщика). В корне каталога обязан лежать `index.html`.',
    '3. **Опубликовать сборку** MCP-тулом `pf_publish_site`: передать ему id проекта и каталог',
    '   собранной статики. Тул заливает файлы и возвращает адрес сайта и время публикации.',
    '   Это обязательный шаг — без него запуска не произошло.',
    '   Если тул почему-то недоступен, фолбэк — тот же приём напрямую:',
    '',
    '   ```',
    `   POST /api/agent/projects/${projectId}/site-artifact`,
    '   Authorization: Bearer <agent-token>',
    '   Content-Type: multipart/form-data',
    '',
    '   Каждый файл сборки — отдельным полем `files`; относительный путь внутри каталога',
    '   сборки кладётся в filename (например `index.html`, `assets/app.js`).',
    '   ```',
    '',
    '4. Проверить результат: `GET /api/projects/' + projectId + '/site` должен вернуть',
    '   `deployedAt != null` и ненулевой `fileCount`.',
    `5. Открыть ${url} и убедиться, что отдаётся сайт проекта, а не заглушка «сайт в разработке».`,
    '',
    '## Нужны ли приложению логин и данные',
    '',
    'Если приложению нужны авторизация пользователей или хранение данных — объяви схему через',
    'MCP-тул `pf_declare_app_schema` и переведи фронтенд на `/api/auth/*` и `/api/data/*`.',
    'Обычному статическому сайту (лендинг, портфолио, документация) это НЕ нужно —',
    'лишний вызов не делай.',
    '',
    '## Definition of Done',
    '',
    'Задачу можно закрыть ТОЛЬКО когда выполнены оба условия одновременно:',
    '',
    `1. \`GET /api/projects/${projectId}/site\` вернул \`deployedAt != null\`.`,
    `2. ${url} отдаёт сайт проекта, а не заглушку «сайт в разработке».`,
    '',
    '**Зелёная локальная сборка запуском НЕ является и основанием закрыть задачу НЕ считается.**',
    'Успешный `npm run build`, поднятый `npm run dev`, работающее превью на своей машине —',
    'ничто из этого не публикует сайт. Нет записи в `site_artifacts` — проект не запущен.',
    '',
    'Если опубликовать не получается — не закрывай задачу и не подменяй критерий. Опиши в',
    'комментарии к задаче, что именно мешает (ошибка сборки, нет каталога с `index.html`,',
    'ошибка публикации), и оставь задачу открытой.',
  ].join('\n');
}

function runtimeSection(runtime: ProjectRuntimeSignals | null): string[] {
  if (runtime?.kind !== 'server_app') return [];
  return [
    '## Внимание: проект приносит собственный серверный процесс',
    '',
    ...runtime.reasons.map((reason) => `- ${reason}`),
    '',
    'Исполнять его здесь негде. Не запускай сервер локально и не считай это результатом:',
    'опубликовать всё равно нужно статическую сборку. Если без своего сервера часть логики',
    'не работает — переведи её на `/api/auth/*` и `/api/data/*` (схема объявляется через',
    '`pf_declare_app_schema`), а что не переносится — опиши в комментарии к задаче, не',
    'выдумывай обход.',
    '',
  ];
}

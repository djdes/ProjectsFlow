import { requireProjectAccess } from '../project/projectAccess.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { CreateTask } from '../task/CreateTask.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { ProjectPackageJsonReader } from './GetProjectSite.js';
import type { SiteArtifactRepository } from './SiteArtifactRepository.js';
import { detectProjectRuntime } from '../../domain/project/projectRuntimeKind.js';
import {
  ProjectAlreadyStaticError,
  PlatformBackendContractUnavailableError,
} from '../../domain/project/errors.js';

/**
 * Ставит воркеру задачу «перевести проект со своего сервера на бэкенд платформы».
 *
 * Появилось из простого наблюдения: студия честно говорит проекту вроде MagFlow, что здесь он
 * не запустится, — но сам переезд пользователю приходилось объяснять воркеру словами, каждый
 * раз заново и без контракта под рукой. Кнопка собирает бриф за него.
 *
 * Три вещи, которые здесь важнее удобства:
 *
 * 1. **Вердикт перепроверяется на сервере.** Клиент присылает только id проекта; то, что он
 *    показывал плашку «нужен собственный сервер», ничего не доказывает. Задачи в чужом канбане
 *    не создаются по утверждению браузера.
 * 2. **Повторный клик не плодит задачи.** Пользователь нажмёт ещё раз, не найдя задачу глазами;
 *    вторая копия того же брифа — это второй прогон воркера по тому же коду.
 * 3. **Без контракта задача не создаётся вовсе.** Бриф без описания /api/auth и /api/data — это
 *    задача, которую воркер завалит, потратив прогон. Лучше явная ошибка сразу.
 */

export type PlatformBackendContractSource = {
  /** Текст контракта бэкенда платформы. null — файл недоступен в этой сборке. */
  read(): string | null;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly sites: Pick<SiteArtifactRepository, 'getByProject'>;
  readonly tasks: Pick<TaskRepository, 'listByProject'>;
  readonly createTask: Pick<CreateTask, 'execute'>;
  readonly packageJson: ProjectPackageJsonReader;
  readonly contract: PlatformBackendContractSource;
};

export type ConversionTaskResult = {
  readonly taskId: string;
  readonly title: string;
  /** false — задача уже была, вернули существующую. UI на это говорит «уже в работе». */
  readonly created: boolean;
};

// Маркер в тексте задачи: по нему находим уже созданную. Заголовок для этого ненадёжен —
// пользователь его переименует, и кнопка начнёт плодить дубликаты.
const MARKER = '<!-- pf:convert-to-platform-backend -->';

const TITLE = 'Перевести проект на бэкенд платформы';

export class ConvertProjectToPlatformBackend {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, callerUserId: string): Promise<ConversionTaskResult> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'create_task');

    // Уже задеплоен — переводить нечего, что бы ни лежало в package.json.
    const artifact = await this.deps.sites.getByProject(projectId);
    if (artifact) throw new ProjectAlreadyStaticError();

    const runtime = detectProjectRuntime(await this.deps.packageJson.read(projectId, callerUserId));
    if (runtime.kind !== 'server_app') throw new ProjectAlreadyStaticError();

    const existing = await this.findExisting(projectId);
    if (existing) return { taskId: existing.id, title: existing.title, created: false };

    const contract = this.deps.contract.read();
    if (!contract) throw new PlatformBackendContractUnavailableError();

    const task = await this.deps.createTask.execute({
      projectId,
      ownerUserId: callerUserId,
      status: 'todo',
      description: brief(runtime.reasons, contract),
    });

    return { taskId: task.id, title: TITLE, created: true };
  }

  private async findExisting(projectId: string): Promise<{ id: string; title: string } | null> {
    const tasks = await this.deps.tasks.listByProject(projectId);
    const open = tasks.find(
      (task) => task.status !== 'done' && (task.description ?? '').includes(MARKER),
    );
    if (!open) return null;
    // Заголовок берём из первой строки брифа — пользователь мог его отредактировать,
    // и в ответе честнее показать то, что реально лежит на доске.
    const heading = (open.description ?? '').split('\n')[0]?.replace(/^#+\s*/, '').trim();
    return { id: open.id, title: heading || TITLE };
  }
}

function brief(reasons: readonly string[], contract: string): string {
  return [
    `# ${TITLE}`,
    MARKER,
    '',
    'Проект приносит собственный серверный процесс. Платформа пользовательский код не исполняет:',
    'она раздаёт статическую сборку и обслуживает вход и данные приложения сама. Поэтому превью',
    'проекта не появится, пока он не переедет на бэкенд платформы.',
    '',
    '## Почему проект считается серверным',
    '',
    ...reasons.map((reason) => `- ${reason}`),
    '',
    '## Что нужно сделать',
    '',
    '1. Заменить собственные HTTP-обработчики на вызовы `/api/auth/*` и `/api/data/*` по контракту ниже.',
    '2. Перевести обращения к внешней БД на данные приложения (таблицы объявляются в `AppSchema`).',
    '3. Убедиться, что `npm run build` даёт статическую сборку без запуска своего сервера.',
    '4. Опубликовать результат — после этого превью в студии включится само.',
    '',
    'Чего делать НЕ нужно: поднимать процесс, слушать порт, ходить в MySQL/Postgres напрямую.',
    'Если какая-то часть логики без своего сервера не переносится — не выдумывай обход, опиши',
    'это в комментарии к задаче.',
    '',
    '## Контракт бэкенда платформы',
    '',
    contract,
  ].join('\n');
}

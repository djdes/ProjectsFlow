import type { ProjectRole } from './ProjectMembership';

export type ProjectStatus = 'active' | 'paused' | 'archived';

export type FinanceVisibility = 'owner' | 'members';

export type KbKind = 'none' | 'github' | 'local';

export type Project = {
  readonly id: string;
  // Создатель проекта (projects.owner_id). Для не-inbox после workspace-merge пространство
  // может принадлежать другому — но создатель остаётся «Создал» и вправе удалить свой проект.
  readonly ownerId: string;
  readonly name: string;
  // Эмодзи-иконка проекта (Notion-style). null = дефолтная папка в UI.
  readonly icon: string | null;
  readonly status: ProjectStatus;
  readonly gitRepoUrl: string | null;
  readonly kbRepoFullName: string | null;
  // Тип Базы знаний: none / github / local. Индикатор «есть KB» = kbKind !== 'none'.
  readonly kbKind: KbKind;
  // True для phantom-проекта «Входящие». Из обычных списков (sidebar, HomePage) такие
  // проекты надо фильтровать — у них отдельная вкладка /inbox.
  readonly isInbox: boolean;
  // Multi-tenancy: роль ТЕКУЩЕГО юзера в проекте (для owner = создатель, для editor/viewer
  // — пришёл через invite). UI рисует бейдж + блокирует кнопки на основе этого поля.
  readonly role: ProjectRole;
  // Read-model счётчики для sidebar. Приходят только из list-эндпоинта (на get/create —
  // отсутствуют). memberCount > 1 ⇒ совместный проект (иконка участников).
  readonly memberCount?: number;
  readonly taskCount?: number;
  // Кто видит финансы: 'owner' (по умолчанию) или 'members'. На list-эндпоинте может
  // отсутствовать в старых ответах — дефолт 'owner'.
  readonly financeVisibility: FinanceVisibility;
  // Ralph-диспетчер: какой member автономно выполняет задачи (MCP /loop). null = ручной.
  readonly dispatcherUserId: string | null;
  // Мультизадачный воркер: true ⇒ диспетчер выполняет до 3 задач проекта параллельно.
  // На list-эндпоинте может отсутствовать в старых ответах — дефолт false на маппинге.
  readonly multiTaskWorker: boolean;
  // Персональный favorite-флаг + порядок в секции «Избранное» (см. db/040 + spec). На
  // get/create/update эндпоинтах сервер их не отдаёт — клиент использует поля только из
  // списка `GET /api/projects`. Дефолты применяются на маппинге, чтобы тип оставался строгим.
  readonly isFavorite: boolean;
  readonly favoriteSortOrder: number;
  // Notion-style шапка проекта: описание под названием + обложка. coverUrl —
  // `gradient:<id>` (градиент из палитры coverGallery) ИЛИ URL картинки (внешняя ссылка /
  // загруженный файл `/api/projects/:id/cover/...`). coverPosition — % по вертикали (0–100).
  readonly description: string | null;
  readonly coverUrl: string | null;
  readonly coverPosition: number;
  // Публичная ссылка доски (Publish to web). publicSlug — случайный slug (URL: /p/<slug>),
  // null = не публиковали. isPublic — опубликовано ли сейчас. publicIndexing — тоггл
  // индексации поисковиками. На list-эндпоинте могут отсутствовать — дефолты на маппинге.
  readonly publicSlug: string | null;
  readonly isPublic: boolean;
  readonly publicIndexing: boolean;
  // GitHub-репо приложения проекта (self-serve воркер-раннер). "owner/repo" или null,
  // если GitHub ещё не привязан / репо не создан. Используется для гейта колонки «Воркер».
  readonly appRepoFullName: string | null;
  readonly createdAt: Date;
};

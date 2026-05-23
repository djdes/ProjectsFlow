import type { ProjectRole } from './ProjectMembership';

export type ProjectStatus = 'active' | 'paused' | 'archived';

export type FinanceVisibility = 'owner' | 'members';

export type KbKind = 'none' | 'github' | 'local';

export type Project = {
  readonly id: string;
  readonly name: string;
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
  readonly createdAt: Date;
};

import type { ProjectRole } from './ProjectMembership';

export type ProjectStatus = 'active' | 'paused' | 'archived';

export type Project = {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly gitRepoUrl: string | null;
  readonly kbRepoFullName: string | null;
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
  readonly createdAt: Date;
};

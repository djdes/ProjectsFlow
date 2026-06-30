import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type { DigestSettings } from '../../domain/digest/DigestSettings.js';
import type { DigestGroupHistory, DigestSettingsRepository } from './DigestSettingsRepository.js';

type Deps = ProjectAccessDeps & { readonly settings: DigestSettingsRepository };

export class GetDigestSettings {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string): Promise<DigestSettings> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    return this.deps.settings.getByProject(projectId);
  }

  // История ранее введённых Telegram-групп (подсказки в окне автоматизации). Гейтим
  // доступом к проекту, из которого открыто окно; выборка — объединение групп юзера
  // (по всем его проектам) и групп всего пространства этого проекта (см. listGroupsForUser).
  async listUserGroups(projectId: string, userId: string): Promise<DigestGroupHistory[]> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    return this.deps.settings.listGroupsForUser(userId, projectId);
  }
}

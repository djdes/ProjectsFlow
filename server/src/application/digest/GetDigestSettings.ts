import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type { DigestSettings } from '../../domain/digest/DigestSettings.js';
import type { DigestSettingsRepository } from './DigestSettingsRepository.js';

type Deps = ProjectAccessDeps & { readonly settings: DigestSettingsRepository };

export class GetDigestSettings {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string): Promise<DigestSettings> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    return this.deps.settings.getByProject(projectId);
  }
}

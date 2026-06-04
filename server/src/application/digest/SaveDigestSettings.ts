import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type { DigestSettings } from '../../domain/digest/DigestSettings.js';
import type { DigestSettingsRepository, SaveDigestSettingsInput } from './DigestSettingsRepository.js';

type Deps = ProjectAccessDeps & { readonly settings: DigestSettingsRepository };

export class SaveDigestSettings {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    userId: string,
    input: SaveDigestSettingsInput,
  ): Promise<DigestSettings> {
    // Editor+ может настраивать сводку/группу проекта (как update_project).
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    return this.deps.settings.save(projectId, input);
  }
}

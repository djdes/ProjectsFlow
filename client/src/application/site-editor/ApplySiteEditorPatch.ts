import type { SiteEditorPatch, SiteEditorRepository, SiteEditorSnapshot } from './SiteEditorRepository';

export class ApplySiteEditorPatch {
  constructor(private readonly repository: SiteEditorRepository) {}

  execute(projectId: string, sessionId: string, revision: number, snapshot: SiteEditorSnapshot, patch: SiteEditorPatch): Promise<{ revision: number }> {
    return this.repository.applyPatch(projectId, sessionId, { revision, snapshot, patch });
  }
}

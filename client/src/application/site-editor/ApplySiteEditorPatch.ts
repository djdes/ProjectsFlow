import type { SiteEditorMutationState, SiteEditorPatch, SiteEditorRepository, SiteEditorSnapshot } from './SiteEditorRepository';

export class ApplySiteEditorPatch {
  constructor(private readonly repository: SiteEditorRepository) {}

  execute(projectId: string, sessionId: string, revision: number, snapshot: SiteEditorSnapshot, patch: SiteEditorPatch): Promise<SiteEditorMutationState> {
    return this.repository.applyPatch(projectId, sessionId, { revision, snapshot, patch });
  }
}

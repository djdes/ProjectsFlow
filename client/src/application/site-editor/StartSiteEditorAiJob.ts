import type { SiteEditorAiJob, SiteEditorRepository, SiteEditorSnapshot } from './SiteEditorRepository';

export class StartSiteEditorAiJob {
  constructor(private readonly repository: SiteEditorRepository) {}

  execute(projectId: string, sessionId: string, prompt: string, snapshot: SiteEditorSnapshot, idempotencyKey: string): Promise<SiteEditorAiJob> {
    return this.repository.startAiJob(projectId, sessionId, { prompt, snapshot, idempotencyKey });
  }
}

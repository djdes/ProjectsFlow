import type { SiteEditorRepository, SiteEditorSession } from './SiteEditorRepository';

export class OpenSiteEditorSession {
  constructor(private readonly repository: SiteEditorRepository) {}

  execute(projectId: string, previewUrl: string, path: string): Promise<SiteEditorSession> {
    return this.repository.openSession(projectId, { previewUrl, path });
  }
}

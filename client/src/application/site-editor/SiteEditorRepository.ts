export type SiteEditorLocator = {
  selector: string;
  tagName: string;
  text?: string;
  attributes?: Record<string, string>;
};

export type SiteEditorSnapshot = {
  locator: SiteEditorLocator;
  source?: string;
  styles?: Record<string, string>;
};

export type SiteEditorPatch =
  | { kind: 'text'; value: string }
  | { kind: 'style'; property: string; value: string }
  | { kind: 'attribute'; name: string; value: string | null }
  | { kind: 'visibility'; hidden: boolean }
  | { kind: 'command'; command: 'duplicate' | 'delete' | 'toggle-visibility' | 'layout' };

export type SiteEditorSession = {
  id: string;
  nonce: string;
  revision: number;
  canEdit: boolean;
  expiresAt: string;
};

export type SiteEditorAiJob = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: number;
  message?: string;
  error?: string;
};

export type SiteEditorPersistedPatch = {
  id: string;
  selector: string;
  patch: SiteEditorPatch;
  createdRevision: number;
};

export type SiteEditorPatchSnapshot = {
  revision: number;
  patches: readonly SiteEditorPersistedPatch[];
};

export interface SiteEditorRepository {
  openSession(projectId: string, input: { previewUrl: string; path: string }): Promise<SiteEditorSession>;
  closeSession(projectId: string, sessionId: string): Promise<void>;
  getPatches(projectId: string, route: string): Promise<SiteEditorPatchSnapshot>;
  applyPatch(projectId: string, sessionId: string, input: { revision: number; snapshot: SiteEditorSnapshot; patch: SiteEditorPatch }): Promise<{ revision: number }>;
  undo(projectId: string, sessionId: string, revision: number): Promise<{ revision: number }>;
  redo(projectId: string, sessionId: string, revision: number): Promise<{ revision: number }>;
  startAiJob(projectId: string, sessionId: string, input: { prompt: string; snapshot: SiteEditorSnapshot }): Promise<SiteEditorAiJob>;
  getAiJob(projectId: string, sessionId: string, jobId: string): Promise<SiteEditorAiJob>;
}

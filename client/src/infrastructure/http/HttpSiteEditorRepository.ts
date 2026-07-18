import type {
  SiteEditorAiJob,
  SiteEditorPatch,
  SiteEditorPatchSnapshot,
  SiteEditorRepository,
  SiteEditorSession,
  SiteEditorSnapshot,
} from '@/application/site-editor/SiteEditorRepository';
import { httpClient } from './httpClient';

const base = (projectId: string): string => `/projects/${encodeURIComponent(projectId)}/site-editor`;

type PersistedPatchDto = {
  id: string;
  locator: { cssPath: string };
  kind: 'text' | 'style' | 'attribute' | 'visibility' | 'command';
  payload: Record<string, unknown>;
  createdRevision: number;
};

function toPatch(dto: PersistedPatchDto): SiteEditorPatch | null {
  if (dto.kind === 'text' && typeof dto.payload.text === 'string') return { kind: 'text', value: dto.payload.text };
  if (dto.kind === 'attribute' && typeof dto.payload.name === 'string') {
    return { kind: 'attribute', name: dto.payload.name, value: typeof dto.payload.value === 'string' ? dto.payload.value : null };
  }
  if (dto.kind === 'visibility' && typeof dto.payload.hidden === 'boolean') {
    return { kind: 'visibility', hidden: dto.payload.hidden };
  }
  if (dto.kind === 'command' && ['duplicate', 'delete', 'toggle-visibility', 'layout'].includes(String(dto.payload.command))) {
    return { kind: 'command', command: dto.payload.command as 'duplicate' | 'delete' | 'toggle-visibility' | 'layout' };
  }
  if (dto.kind === 'style' && dto.payload.styles && typeof dto.payload.styles === 'object' && !Array.isArray(dto.payload.styles)) {
    const entry = Object.entries(dto.payload.styles as Record<string, unknown>).find((item): item is [string, string] => typeof item[1] === 'string');
    if (entry) return { kind: 'style', property: entry[0], value: entry[1] };
  }
  return null;
}

export class HttpSiteEditorRepository implements SiteEditorRepository {
  async openSession(projectId: string, input: { previewUrl: string; path: string }): Promise<SiteEditorSession> {
    const result = await httpClient.post<{ session: SiteEditorSession }>(`${base(projectId)}/sessions`, input);
    return result.session;
  }

  async closeSession(projectId: string, sessionId: string): Promise<void> {
    await httpClient.delete<void>(`${base(projectId)}/sessions/${encodeURIComponent(sessionId)}`);
  }

  async getPatches(projectId: string, route: string): Promise<SiteEditorPatchSnapshot> {
    const result = await httpClient.get<{ revision: number; patches: PersistedPatchDto[] }>(`${base(projectId)}/patches?route=${encodeURIComponent(route)}`);
    return {
      revision: result.revision,
      patches: result.patches.flatMap((dto) => {
        const patch = toPatch(dto);
        return patch ? [{ id: dto.id, selector: dto.locator.cssPath, patch, createdRevision: dto.createdRevision }] : [];
      }),
    };
  }

  async applyPatch(projectId: string, sessionId: string, input: { revision: number; snapshot: SiteEditorSnapshot; patch: SiteEditorPatch }): Promise<{ revision: number }> {
    return httpClient.post<{ revision: number }>(`${base(projectId)}/sessions/${encodeURIComponent(sessionId)}/patches`, input);
  }

  async undo(projectId: string, sessionId: string, revision: number): Promise<{ revision: number }> {
    return httpClient.post<{ revision: number }>(`${base(projectId)}/sessions/${encodeURIComponent(sessionId)}/undo`, { revision });
  }

  async redo(projectId: string, sessionId: string, revision: number): Promise<{ revision: number }> {
    return httpClient.post<{ revision: number }>(`${base(projectId)}/sessions/${encodeURIComponent(sessionId)}/redo`, { revision });
  }

  async startAiJob(projectId: string, sessionId: string, input: { prompt: string; snapshot: SiteEditorSnapshot }): Promise<SiteEditorAiJob> {
    const result = await httpClient.post<{ job: SiteEditorAiJob }>(`${base(projectId)}/sessions/${encodeURIComponent(sessionId)}/jobs`, input);
    return result.job;
  }

  async getAiJob(projectId: string, sessionId: string, jobId: string): Promise<SiteEditorAiJob> {
    const result = await httpClient.get<{ job: SiteEditorAiJob }>(`${base(projectId)}/sessions/${encodeURIComponent(sessionId)}/jobs/${encodeURIComponent(jobId)}`);
    return result.job;
  }
}

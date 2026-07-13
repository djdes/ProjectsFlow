import type {
  InviteAcceptResult,
  InvitePreview,
  InviteRole,
} from '@/domain/invite/InvitePreview';
import type { InviteRepository } from '@/application/project/InviteRepository';
import { httpClient } from './httpClient';

// Сервер отдаёт kind/targetName (dual-token: workspace-инвайт или legacy project-инвайт) +
// legacy-алиас projectName=targetName для обратной совместимости — используем kind/targetName.
type PreviewDto = {
  kind?: 'workspace' | 'project';
  targetName?: string;
  projectName?: string | null;
  role: InviteRole;
  inviterDisplayName: string | null;
  inviteEmail: string | null;
  expiresAt: string;
};

export class HttpInviteRepository implements InviteRepository {
  async getPreview(token: string): Promise<InvitePreview> {
    const { preview } = await httpClient.get<{ preview: PreviewDto }>(`/invites/${token}`);
    return {
      kind: preview.kind ?? 'project',
      targetName: preview.targetName ?? preview.projectName ?? '',
      role: preview.role,
      inviterDisplayName: preview.inviterDisplayName,
      inviteEmail: preview.inviteEmail,
      expiresAt: new Date(preview.expiresAt),
    };
  }

  async accept(token: string): Promise<InviteAcceptResult> {
    const res = await httpClient.post<{ workspaceId?: string | null; projectId?: string | null }>(
      `/invites/${token}/accept`,
    );
    return { workspaceId: res.workspaceId ?? null, projectId: res.projectId ?? null };
  }
}

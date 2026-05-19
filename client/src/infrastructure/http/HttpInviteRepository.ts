import type { ProjectInvitePreview, ProjectInviteRole } from '@/domain/project/ProjectInvite';
import type { InviteRepository } from '@/application/project/InviteRepository';
import { httpClient } from './httpClient';

type PreviewDto = {
  projectName: string;
  role: ProjectInviteRole;
  inviterDisplayName: string | null;
  inviteEmail: string | null;
  expiresAt: string;
};

export class HttpInviteRepository implements InviteRepository {
  async getPreview(token: string): Promise<ProjectInvitePreview> {
    const { preview } = await httpClient.get<{ preview: PreviewDto }>(`/invites/${token}`);
    return {
      projectName: preview.projectName,
      role: preview.role,
      inviterDisplayName: preview.inviterDisplayName,
      inviteEmail: preview.inviteEmail,
      expiresAt: new Date(preview.expiresAt),
    };
  }

  async accept(token: string): Promise<{ projectId: string }> {
    return httpClient.post<{ projectId: string }>(`/invites/${token}/accept`);
  }
}

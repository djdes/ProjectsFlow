import type { ProjectInvitePreview } from '@/domain/project/ProjectInvite';

// Anon-friendly: GET preview не требует логина, accept — требует.
// Используется страницей /invite/:token (см. presentation/pages/InvitePage.tsx).
export interface InviteRepository {
  getPreview(token: string): Promise<ProjectInvitePreview>;
  accept(token: string): Promise<{ projectId: string }>;
}

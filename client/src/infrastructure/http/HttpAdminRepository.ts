import type {
  AdminProject,
  AdminRepository,
  AdminUser,
  AdminUserPatch,
  AdminUserProjectDispatcher,
  AdminUserProjectFavorite,
  EmailTemplateMeta,
  EmailPreview,
} from '@/application/admin/AdminRepository';
import { httpClient } from './httpClient';

export class HttpAdminRepository implements AdminRepository {
  async listProjects(): Promise<AdminProject[]> {
    const { projects } = await httpClient.get<{ projects: AdminProject[] }>('/admin/projects');
    return projects;
  }

  async listUsers(): Promise<AdminUser[]> {
    const { users } = await httpClient.get<{ users: AdminUser[] }>('/admin/users');
    return users;
  }

  async updateUser(id: string, patch: AdminUserPatch): Promise<void> {
    await httpClient.patch<unknown>(`/admin/users/${id}`, patch);
  }

  async listUserProjectsWithDispatcher(userId: string): Promise<AdminUserProjectDispatcher[]> {
    const { projects } = await httpClient.get<{ projects: AdminUserProjectDispatcher[] }>(
      `/admin/users/${userId}/projects-with-dispatcher`,
    );
    return projects;
  }

  async listUserProjectsWithFavorites(userId: string): Promise<AdminUserProjectFavorite[]> {
    const { projects } = await httpClient.get<{ projects: AdminUserProjectFavorite[] }>(
      `/admin/users/${userId}/projects-with-favorites`,
    );
    return projects;
  }

  async setUserProjectFavorite(
    userId: string,
    projectId: string,
    favorite: boolean,
  ): Promise<void> {
    await httpClient.put<unknown>(`/admin/users/${userId}/projects/${projectId}/favorite`, {
      favorite,
    });
  }

  async listEmailTemplates(): Promise<EmailTemplateMeta[]> {
    const { templates } = await httpClient.get<{ templates: EmailTemplateMeta[] }>(
      '/admin/email/templates',
    );
    return templates;
  }

  async previewEmail(templateKey: string): Promise<EmailPreview> {
    return httpClient.post<EmailPreview>('/admin/email/preview', { templateKey });
  }

  async sendTestEmail(templateKey: string, recipientEmail: string): Promise<void> {
    await httpClient.post<unknown>('/admin/email/send', { templateKey, recipientEmail });
  }
}

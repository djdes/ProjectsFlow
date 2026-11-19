import type {
  AdminProject,
  AdminRepository,
  PlatformStats,
  AdminPlanTerm,
  AdminUserListQuery,
  AdminUserOverview,
  AdminUserPage,
  AdminUserPatch,
  AdminUserDeletionPreview,
  AdminUserProjectDispatcher,
  AdminUserProjectFavorite,
  EmailTemplateMeta,
  EmailPreview,
  AdminSupportTicket,
} from '@/application/admin/AdminRepository';
import type { PlanId } from '@/domain/usage/Usage';
import { httpClient } from './httpClient';

export class HttpAdminRepository implements AdminRepository {
  getPlatformStats(): Promise<PlatformStats> {
    return httpClient.get<PlatformStats>('/admin/stats');
  }

  async listProjects(): Promise<AdminProject[]> {
    const { projects } = await httpClient.get<{ projects: AdminProject[] }>('/admin/projects');
    return projects;
  }

  listUsers(query: AdminUserListQuery): Promise<AdminUserPage> {
    const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
    return httpClient.get<AdminUserPage>(`/admin/users?${params.toString()}`);
  }

  getUserOverview(id: string): Promise<AdminUserOverview> {
    return httpClient.get<AdminUserOverview>(`/admin/users/${id}/overview`);
  }

  async signOutEverywhere(id: string): Promise<void> {
    await httpClient.post<unknown>(`/admin/users/${id}/sign-out-all`, {});
  }

  sendPasswordReset(id: string): Promise<{ email: string }> {
    return httpClient.post<{ email: string }>(`/admin/users/${id}/password-reset`, {});
  }

  bulkSetPlan(input: { userIds: readonly string[]; plan: 'prime' | 'vip'; term: AdminPlanTerm }): Promise<{ updated: number; missing: readonly string[] }> {
    return httpClient.post<{ updated: number; missing: readonly string[] }>('/admin/users/bulk/plan', input);
  }

  async updateUser(id: string, patch: AdminUserPatch): Promise<void> {
    await httpClient.patch<unknown>(`/admin/users/${id}`, patch);
  }

  getUserDeletionPreview(id: string): Promise<AdminUserDeletionPreview> {
    return httpClient.get<AdminUserDeletionPreview>(`/admin/users/${id}/deletion-preview`);
  }

  async deleteUser(id: string): Promise<void> {
    await httpClient.delete<unknown>(`/admin/users/${id}`);
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

  async listSupportTickets(): Promise<AdminSupportTicket[]> {
    const { tickets } = await httpClient.get<{ tickets: AdminSupportTicket[] }>(
      '/admin/support-tickets',
    );
    return tickets;
  }

  async setSupportTicketStatus(id: string, status: 'open' | 'closed'): Promise<void> {
    await httpClient.patch<unknown>(`/admin/support-tickets/${id}`, { status });
  }

  async setUserPlan(id: string, plan: PlanId, subscriptionExpiresAt?: string | null): Promise<void> {
    await httpClient.patch<unknown>(`/admin/users/${id}/plan`, { plan, subscriptionExpiresAt });
  }
}

import type { ProjectAnalytics } from '../../domain/project/ProjectView.js';

export interface ProjectViewRepository {
  // Записать просмотр проекта юзером. Дедуп: если тот же юзер смотрел этот проект в
  // последние ~30 мин — не пишем новую строку (иначе аналитику раздует рендерами).
  recordView(userId: string, projectId: string): Promise<void>;
  // Аналитика за последние windowDays: суммарные просмотры, разбивка по дням, список зрителей.
  getAnalytics(projectId: string, windowDays: number): Promise<ProjectAnalytics>;
}

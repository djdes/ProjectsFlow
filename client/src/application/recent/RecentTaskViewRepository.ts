import type { RecentTaskView } from '@/domain/recent/RecentTaskView';

export interface RecentTaskViewRepository {
  // Зафиксировать открытие задачи (fire-and-forget на клиенте). Сервер апсертит viewed_at.
  record(taskId: string): Promise<void>;
  // Последние открытые задачи текущего юзера (по убыванию времени).
  list(limit: number): Promise<RecentTaskView[]>;
}

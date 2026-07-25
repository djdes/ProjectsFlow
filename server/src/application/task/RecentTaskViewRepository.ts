import type { RecentTaskView } from '../../domain/task/RecentTaskView.js';

export interface RecentTaskViewRepository {
  // Апсерт «юзер открыл задачу». Тихо игнорирует, если задачи нет или юзер не участник
  // её проекта (не палим чужие задачи). Идемпотентно бампит viewed_at = CURRENT_TIMESTAMP.
  recordView(userId: string, taskId: string): Promise<void>;
  // Последние открытые задачи юзера, по убыванию viewed_at. Только доступные сейчас
  // (юзер — участник проекта); удалённые задачи отсекаются JOIN'ом. workspaceId задан ⇒
  // ограничиваем проектами этого пространства (изоляция по активному team-пространству);
  // undefined ⇒ по всем пространствам юзера (дефолт-хаб).
  listRecent(userId: string, limit: number, workspaceId?: string): Promise<RecentTaskView[]>;
}

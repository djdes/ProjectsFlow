import type { RecentTaskViewRepository } from './RecentTaskViewRepository.js';

type Deps = {
  readonly views: RecentTaskViewRepository;
};

// Сколько дней задача считается «новой». Окно нужно по двум причинам: на раскатке строк
// просмотра ещё нет ни у кого, и без окна подсветилась бы разом вся история; а задача,
// которую не открыли за две недели, уже не «новая» — свечение перестало бы что-либо
// значить и превратилось бы в фон.
export const UNREAD_WINDOW_DAYS = 14;

// Непрочитанные задачи текущего пользователя: назначены на него и ни разу им не открыты.
// Подсветка нужна, чтобы занятый человек не пропустил появившуюся задачу — поэтому
// «прочитано» наступает от ОТКРЫТИЯ задачи, а не от какого-либо действия над ней.
export class ListUnreadTasks {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, now: Date = new Date()): Promise<string[]> {
    const since = new Date(now.getTime() - UNREAD_WINDOW_DAYS * 24 * 3600_000);
    return this.deps.views.listUnreadAssignedTaskIds(userId, since);
  }
}

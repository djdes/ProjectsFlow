import type { ActivityRepository } from '../activity/ActivityRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';

// Журнал активности чистится раз в сутки, всё старше 30 дней удаляется (sweepActivity в
// index.ts). Поэтому «за период» честно считается только внутри этого окна — цифру за всё
// время берём из состояния досок.
export const RECENT_WINDOW_DAYS = 30;

export type WorkspaceCompletedStats = {
  readonly workspaceId: string;
  readonly name: string;
  // Задачи в статусе «Готово», где пользователь — ответственный. Состояние досок на сейчас:
  // вернули задачу в работу — цифра уменьшилась.
  readonly doneTotal: number;
  // Сколько пользователь закрыл своими руками за последние RECENT_WINDOW_DAYS — из журнала.
  readonly completedRecent: number;
};

type Deps = {
  readonly tasks: Pick<TaskRepository, 'countDoneByWorkspaceForAssignee'>;
  readonly activity: Pick<ActivityRepository, 'countCompletedByActorPerWorkspaceSince'>;
  readonly workspaces: Pick<WorkspaceRepository, 'listForUser'>;
  readonly now?: () => Date;
};

/**
 * Личная статистика «сколько задач я выполнил и в каких пространствах».
 *
 * Две цифры на пространство, потому что честного одного числа тут нет:
 *  • doneTotal — снимок досок за всё время, но это «моё в Готово», а не «я закрыл»:
 *    задачу могли назначить на меня уже выполненной;
 *  • completedRecent — «закрыл именно я», но только за окно журнала (30 дней).
 * Смешивать их в одно значение значило бы соврать в обе стороны сразу.
 *
 * Список пространств — из членства пользователя: показываем и те, где он ещё ничего не
 * закрыл (нули), иначе пустая вкладка выглядит как поломка. Пространства, где он больше не
 * участник, в выдачу не попадают, даже если задачи там за ним числятся.
 */
export class GetMyCompletedStats {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<WorkspaceCompletedStats[]> {
    const now = this.deps.now?.() ?? new Date();
    const since = new Date(now.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [workspaces, doneRows, recentRows] = await Promise.all([
      this.deps.workspaces.listForUser(userId),
      this.deps.tasks.countDoneByWorkspaceForAssignee(userId),
      this.deps.activity.countCompletedByActorPerWorkspaceSince(userId, since),
    ]);

    const doneById = new Map(doneRows.map((r) => [r.workspaceId, r.count]));
    const recentById = new Map(recentRows.map((r) => [r.workspaceId, r.count]));

    return workspaces
      .map((workspace) => ({
        workspaceId: workspace.id,
        name: workspace.name,
        doneTotal: doneById.get(workspace.id) ?? 0,
        completedRecent: recentById.get(workspace.id) ?? 0,
      }))
      .sort(
        (left, right) =>
          right.doneTotal - left.doneTotal ||
          right.completedRecent - left.completedRecent ||
          left.name.localeCompare(right.name, 'ru'),
      );
  }
}

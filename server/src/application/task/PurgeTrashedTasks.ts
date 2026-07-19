import type { TaskRepository } from './TaskRepository.js';

type Deps = {
  readonly tasks: TaskRepository;
  // Инъекция часов — тест не должен ждать реальных 30 дней.
  readonly now?: () => Date;
};

// Сколько задача лежит в корзине до физического удаления, если не задано иное.
export const DEFAULT_TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60_000;

/**
 * Автоочистка корзины (db/134): задачи, пролежавшие в корзине дольше retentionDays,
 * удаляются ФИЗИЧЕСКИ вместе со всеми child-строками. Без этого мягко удалённые задачи
 * копились бы в tasks бессрочно — вместе с комментариями, версиями и вложениями.
 *
 * Системный use-case: гейта доступа нет, вызывается по расписанию из index.ts
 * (зеркало siteEditorService.sweepStaleRunningJobs), а не из HTTP-роута.
 */
export class PurgeTrashedTasks {
  constructor(private readonly deps: Deps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async execute(
    retentionDays: number = DEFAULT_TRASH_RETENTION_DAYS,
    limit = 200,
  ): Promise<number> {
    // Отрицательный retention снёс бы всю корзину целиком — страхуемся.
    const days = Math.max(1, retentionDays);
    const cutoff = new Date(this.now().getTime() - days * DAY_MS);

    const stale = await this.deps.tasks.listTrashedBefore(cutoff, Math.max(1, limit));
    let purged = 0;
    for (const ref of stale) {
      // Одна упавшая задача не должна ронять весь проход — остальные всё равно чистим.
      try {
        if (await this.deps.tasks.deleteWithChildren(ref.id)) purged += 1;
      } catch {
        // best-effort
      }
    }
    return purged;
  }
}

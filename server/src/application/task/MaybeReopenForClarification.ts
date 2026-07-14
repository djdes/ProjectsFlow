import type { TaskStatus } from '../../domain/task/Task.js';
import type { TaskRepository } from './TaskRepository.js';

// Маркеры в body коммента, которые серверу нужно распознать чтобы вернуть задачу
// awaiting_clarification → in_progress. Подстрочный поиск (не regex) — формат маркера
// `<!-- ralph-answer {json} -->` или `<!-- ralph-grillme-summary {json} -->`.
const RALPH_ANSWER_MARKERS = ['<!-- ralph-answer ', '<!-- ralph-grillme-summary '] as const;

type Deps = {
  readonly tasks: TaskRepository;
};

// Авто-возврат задачи из awaiting_clarification в in_progress когда юзер (или диспетчер)
// пишет коммент с ралф-ответом. Системное действие — НЕ проходит через permission-check
// MoveTask: коммент-автор уже доказал право комментировать; авто-перевод — следствие.
//
// Возвращает { old, new } если транзишен случился (для SSE-broadcast'а), иначе null.
export class MaybeReopenForClarification {
  constructor(private readonly deps: Deps) {}

  async execute(
    taskId: string,
    commentBody: string,
    actorUserId: string | null = null,
  ): Promise<{ readonly oldStatus: TaskStatus; readonly newStatus: TaskStatus } | null> {
    const hasMarker = RALPH_ANSWER_MARKERS.some((m) => commentBody.includes(m));
    if (!hasMarker) return null;

    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.status !== 'awaiting_clarification') return null;

    // Кладём в конец колонки in_progress: max(position)+1024, либо 1024 если колонка пуста.
    const bounds = await this.deps.tasks.getPositionBounds(task.projectId, 'in_progress');
    const nextPosition = bounds ? bounds.max + 1024 : 1024;

    await this.deps.tasks.update(taskId, {
      status: 'in_progress',
      position: nextPosition,
    }, actorUserId);

    return { oldStatus: 'awaiting_clarification', newStatus: 'in_progress' };
  }
}

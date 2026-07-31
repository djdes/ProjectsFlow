import { NotTaskAssigneeError, TaskNotFoundError } from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import { isRestorableStatus, type MoveTask } from './MoveTask.js';
import type { TaskRepository } from './TaskRepository.js';

type Deps = {
  readonly tasks: TaskRepository;
  readonly moveTask: MoveTask;
};

export type WithdrawTaskApprovalCommand = {
  readonly projectId: string;
  readonly taskId: string;
  readonly actorUserId: string;
};

// Отзыв работы из очереди приёмки самим исполнителем: «случайно нажал выполнено».
//
// Это НЕ правка задачи, а изъятие её из очереди целиком, поэтому заморозка на время
// приёмки здесь не действует (MoveTask снимает её ровно для этого перехода). Возврат
// руководителем — отдельная операция (RejectTaskApproval) и требует комментария: там
// решение принимает другой человек, и исполнителю нужно объяснение. Своей задаче
// объяснять нечего, комментарий не просим.
export class WithdrawTaskApproval {
  constructor(private readonly deps: Deps) {}

  async execute(input: WithdrawTaskApprovalCommand): Promise<Task> {
    const task = await this.deps.tasks.getById(input.taskId);
    if (!task || task.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    // Забрать задачу может только тот, кто её и отправил на утверждение — текущий
    // ответственный. Остальным путь один: RejectTaskApproval с комментарием.
    if (task.assignee.userId !== input.actorUserId) throw new NotTaskAssigneeError();

    // Возвращаем туда, откуда отправили. Непригодный снимок (сама очередь, 'done',
    // мусор) → 'in_progress': работа продолжается, а не начинается заново.
    const snapshot = task.statusBeforeDone;
    const target = snapshot && isRestorableStatus(snapshot) ? snapshot : 'in_progress';

    return this.deps.moveTask.execute({
      projectId: input.projectId,
      ownerUserId: input.actorUserId,
      taskId: input.taskId,
      targetStatus: target,
      beforeTaskId: null,
      afterTaskId: null,
      withdrawFromApproval: true,
    });
  }
}

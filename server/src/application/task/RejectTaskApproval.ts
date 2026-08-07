import { ApprovalCommentRequiredError, NotTaskApproverError } from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { CreateTaskComment } from './CreateTaskComment.js';
import { isRestorableStatus, type MoveTask } from './MoveTask.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskApprovalService } from './TaskApprovalService.js';
import type { TaskRepository } from './TaskRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly approval: TaskApprovalService;
  readonly createComment: CreateTaskComment;
  readonly moveTask: MoveTask;
};

export type RejectTaskApprovalCommand = {
  readonly projectId: string;
  readonly taskId: string;
  readonly actorUserId: string;
  // Почему работа не принята. Обязателен: без объяснения исполнитель не знает, что
  // доделать, и задача уходит по кругу.
  readonly comment: string;
};

// Что вернул возврат: сама задача + id созданного комментария. Комментарий нужен наружу,
// чтобы клиент мог доложить в него вложения (скриншот «что доделать») — грузятся они
// отдельными multipart-запросами уже ПОСЛЕ того, как комментарий существует.
export type RejectTaskApprovalResult = {
  readonly task: Task;
  readonly commentId: string;
};

// Возврат задачи из приёмки в работу (db/150). Комментарий обязателен и пишется в тред
// задачи ДО переноса — так исполнитель, получив уведомление о смене статуса, уже видит
// причину. Порядок важен: если бы сначала двигали, а комментарий упал, человек получил бы
// «вернули» без объяснения.
export class RejectTaskApproval {
  constructor(private readonly deps: Deps) {}

  async execute(input: RejectTaskApprovalCommand): Promise<RejectTaskApprovalResult> {
    const body = input.comment.trim();
    if (body.length === 0) throw new ApprovalCommentRequiredError();

    const task = await this.deps.tasks.getById(input.taskId);
    if (!task || task.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    const project = await this.deps.projects.getById(input.projectId);
    if (!project) throw new TaskNotFoundError(input.taskId);

    // Возвращать работу вправе только тот, кто её принимает. Сам исполнитель забирает
    // задачу назад обычным переносом — там объяснение никому не нужно.
    if (!(await this.deps.approval.canApprove(project, input.actorUserId))) {
      throw new NotTaskApproverError();
    }

    const comment = await this.deps.createComment.execute({
      projectId: input.projectId,
      ownerUserId: input.actorUserId,
      taskId: input.taskId,
      body,
    });

    // Возвращаем туда, откуда задачу отправили (снимок в status_before_done), фолбэк —
    // 'in_progress': работа продолжается, а не начинается заново. Снимок может оказаться
    // непригодной целью ('done' или сама очередь приёмки — так делали строки, записанные
    // до гейта в MoveTask): тогда тоже фолбэк, иначе «вернуть в работу» возвращало бы
    // задачу в то же состояние и выглядело сломанной кнопкой.
    const snapshot = task.statusBeforeDone;
    const target = snapshot && isRestorableStatus(snapshot) ? snapshot : 'in_progress';
    const moved = await this.deps.moveTask.execute({
      projectId: input.projectId,
      ownerUserId: input.actorUserId,
      taskId: input.taskId,
      targetStatus: target,
      beforeTaskId: null,
      afterTaskId: null,
    });
    return { task: moved, commentId: comment.id };
  }
}

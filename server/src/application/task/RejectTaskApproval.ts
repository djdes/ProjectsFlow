import { ApprovalCommentRequiredError, NotTaskApproverError, TaskNotFoundError, TaskNotPendingApprovalError } from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type { CreateTaskComment, CreateTaskCommentCommand } from './CreateTaskComment.js';
import { isRestorableStatus, type MoveTask } from './MoveTask.js';
import type { ApprovalGuard } from './TaskApprovalService.js';
import { checkTaskModifyAccess, type TaskAccessDeps } from './taskAuthorization.js';

type Deps = TaskAccessDeps & {
  readonly approval: ApprovalGuard;
  readonly createComment: CreateTaskComment;
  readonly moveTask: MoveTask;
};

export type RejectTaskApprovalCommand = Pick<CreateTaskCommentCommand,
  'notifyMode' | 'notifyUserIds' | 'replyToCommentId' | 'quotedText'
> & {
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
  readonly comment: TaskComment;
  readonly returned: boolean;
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

    await checkTaskModifyAccess(this.deps, project, task, input.actorUserId, 'move_task');
    // Возвращать работу вправе только тот, кто её принимает. Сам исполнитель забирает
    // задачу назад обычным переносом — там объяснение никому не нужно.
    if (!(await this.deps.approval.canApprove(project, input.actorUserId, task.originWorkspaceId ?? null))) {
      throw new NotTaskApproverError();
    }
    if (task.status !== 'pending_approval') throw new TaskNotPendingApprovalError();

    const comment = await this.deps.createComment.execute({
      projectId: input.projectId,
      ownerUserId: input.actorUserId,
      taskId: input.taskId,
      body,
      notifyMode: input.notifyMode,
      notifyUserIds: input.notifyUserIds,
      replyToCommentId: input.replyToCommentId,
      quotedText: input.quotedText,
    });

    // Возвращаем туда, откуда задачу отправили (снимок в status_before_done), фолбэк —
    // 'in_progress': работа продолжается, а не начинается заново. Снимок может оказаться
    // непригодной целью ('done' или сама очередь приёмки — так делали строки, записанные
    // до гейта в MoveTask): тогда тоже фолбэк, иначе «вернуть в работу» возвращало бы
    // задачу в то же состояние и выглядело сломанной кнопкой.
    const snapshot = task.statusBeforeDone;
    const target = snapshot && isRestorableStatus(snapshot) ? snapshot : 'in_progress';
    try {
      const moved = await this.deps.moveTask.execute({
        projectId: input.projectId,
        ownerUserId: input.actorUserId,
        taskId: input.taskId,
        targetStatus: target,
        beforeTaskId: null,
        afterTaskId: null,
        requirePendingApproval: true,
      });
      return { task: moved, comment, returned: true };
    } catch (error) {
      // The comment is already visible. Acknowledge it so retrying does not post it again.
      if (!(error instanceof TaskNotPendingApprovalError)) console.warn('[approval] return failed:', error);
      return { task, comment, returned: false };
    }
  }
}

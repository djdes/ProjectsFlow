import type { TaskRepository } from '../task/TaskRepository.js';
import type { MoveTask } from '../task/MoveTask.js';
import type { CreateTaskComment } from '../task/CreateTaskComment.js';
import type {
  EmailActionToken,
  EmailActionTokenRepository,
  EmailActionType,
} from './EmailActionTokenRepository.js';

const MAX_COMMENT = 5000;

export type EmailActionPreview =
  | { kind: 'ok'; action: EmailActionType; taskName: string; alreadyUsed: boolean }
  | { kind: 'invalid' }
  | { kind: 'expired' };

export type EmailActionRun =
  | { kind: 'done'; projectId: string; taskId: string }
  | { kind: 'commented'; projectId: string; taskId: string }
  | { kind: 'invalid' | 'expired' | 'used' | 'empty' | 'error'; message?: string };

type Deps = {
  readonly tokens: EmailActionTokenRepository;
  readonly tasks: TaskRepository;
  readonly moveTask: MoveTask;
  readonly createTaskComment: CreateTaskComment;
  readonly now: () => Date;
};

function taskTitle(description: string | null | undefined): string {
  const first = (description ?? '').split('\n')[0]?.trim() ?? '';
  return first.length > 0 ? first.slice(0, 140) : 'задача';
}

// Выполнение действий из писем-сводок по токену. GET-страница зовёт preview (без мутаций),
// POST — complete/comment (мутация). Доступ к задаче проверяют сами MoveTask/CreateTaskComment
// по userId токена (получатель сводки = член проекта) — defense in depth.
export class EmailActionService {
  constructor(private readonly deps: Deps) {}

  private expired(t: EmailActionToken): boolean {
    return t.expiresAt.getTime() <= this.deps.now().getTime();
  }

  async preview(token: string): Promise<EmailActionPreview> {
    const t = await this.deps.tokens.findByToken(token);
    if (!t) return { kind: 'invalid' };
    if (this.expired(t)) return { kind: 'expired' };
    const task = await this.deps.tasks.getById(t.taskId).catch(() => null);
    return {
      kind: 'ok',
      action: t.action,
      taskName: taskTitle(task?.description),
      alreadyUsed: t.usedAt != null,
    };
  }

  async complete(token: string): Promise<EmailActionRun> {
    const t = await this.deps.tokens.findByToken(token);
    if (!t || t.action !== 'complete') return { kind: 'invalid' };
    if (this.expired(t)) return { kind: 'expired' };
    if (t.usedAt) return { kind: 'used' };
    try {
      await this.deps.moveTask.execute({
        projectId: t.projectId,
        ownerUserId: t.userId,
        taskId: t.taskId,
        targetStatus: 'done',
        beforeTaskId: null,
        afterTaskId: null,
      });
    } catch (e) {
      return { kind: 'error', message: (e as Error).message };
    }
    await this.deps.tokens.markUsed(t.id, this.deps.now());
    return { kind: 'done', projectId: t.projectId, taskId: t.taskId };
  }

  async comment(token: string, body: string): Promise<EmailActionRun> {
    const t = await this.deps.tokens.findByToken(token);
    if (!t || t.action !== 'comment') return { kind: 'invalid' };
    if (this.expired(t)) return { kind: 'expired' };
    const text = body.trim().slice(0, MAX_COMMENT);
    if (text.length === 0) return { kind: 'empty' };
    try {
      await this.deps.createTaskComment.execute({
        projectId: t.projectId,
        ownerUserId: t.userId,
        taskId: t.taskId,
        body: text,
      });
    } catch (e) {
      return { kind: 'error', message: (e as Error).message };
    }
    // comment не одноразовый — можно оставить несколько до истечения токена.
    return { kind: 'commented', projectId: t.projectId, taskId: t.taskId };
  }
}

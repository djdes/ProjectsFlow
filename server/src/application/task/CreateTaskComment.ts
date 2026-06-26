import { TaskCommentBodyEmptyError, TaskNotFoundError } from '../../domain/task/errors.js';
import type { TaskComment, TaskCommentActorKind } from '../../domain/task/TaskComment.js';
import type { CommentNotifyMode } from '../../domain/task/TaskComment.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import { requireTaskModifyAccess } from './taskAuthorization.js';
import { parseMentions } from './parseMentions.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly comments: TaskCommentRepository;
  readonly notifications: NotificationRepository;
  readonly delegations: TaskDelegationRepository;
  readonly idGen: () => string;
  // Лента действий (best-effort). Опционально.
  readonly activityRecorder?: ActivityRecorder;
};

export type CreateTaskCommentCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
  readonly body: string;
  // Кто пишет. По умолчанию 'user' — обратная совместимость со всеми существующими caller'ами.
  // Agent-роутер передаёт 'agent' + agentName. См. spec comment-actor-kind.md.
  readonly actorKind?: TaskCommentActorKind;
  readonly agentName?: string | null;
  // Режим адресации уведомления (из композера). По умолчанию 'all'. Сохраняется на
  // комментарии для меню ⋮ «Кто уведомлён». Сама рассылка — в DispatchCommentNotifications.
  readonly notifyMode?: CommentNotifyMode;
  // Ответ/цитата (db/080). NULL по умолчанию.
  readonly replyToCommentId?: string | null;
  readonly quotedText?: string | null;
};

const EXCERPT_LIMIT = 80;

function excerpt(text: string | null, limit = EXCERPT_LIMIT): string {
  const s = (text ?? '').trim().replace(/\s+/g, ' ');
  return s.length <= limit ? s : s.slice(0, limit - 1).trimEnd() + '…';
}

export class CreateTaskComment {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateTaskCommentCommand): Promise<TaskComment> {
    const body = input.body.trim();
    if (body.length === 0) throw new TaskCommentBodyEmptyError();

    const { project } = await requireTaskModifyAccess(
      this.deps,
      input.projectId,
      input.taskId,
      input.ownerUserId,
      'create_comment',
    );
    const task = await this.deps.tasks.getById(input.taskId);
    if (!task || task.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    const comment = await this.deps.comments.create({
      id: this.deps.idGen(),
      taskId: input.taskId,
      ownerUserId: input.ownerUserId,
      body,
      actorKind: input.actorKind,
      agentName: input.agentName,
      notifyMode: input.notifyMode,
      replyToCommentId: input.replyToCommentId ?? null,
      quotedText: input.quotedText ?? null,
    });

    // Лента действий (best-effort): комментарий = активность проекта. Агентские
    // (Ralph) комменты НЕ пишем — их прогресс уже стримит LIVE-вкладка, иначе лента
    // забивается именем владельца токена во время авто-прогона.
    if (input.actorKind !== 'agent') {
      void this.deps.activityRecorder?.record({
        projectId: input.projectId,
        actorUserId: input.ownerUserId,
        kind: 'task_commented',
        payload: { taskId: task.id, commentId: comment.id, taskExcerpt: excerpt(task.description), commentExcerpt: excerpt(body) },
      });
    }

    // Mention-парсинг. Уведомления — best-effort: если что-то упадёт здесь, комментарий
    // уже сохранён и пользователь увидит успех. Логируем ошибку, но не reject'им.
    try {
      const members = await this.deps.members.listByProject(input.projectId);
      const mentionedUserIds = parseMentions(body, members, input.ownerUserId);
      if (mentionedUserIds.length > 0) {
        const actor = members.find((m) => m.userId === input.ownerUserId);
        // Для agent-комментов displayName в members — это owner проекта (от чьего имени
        // ходит agent-токен), а нам в UI нужно показать «Диспетчер · Claude Code». Поэтому
        // явно делегируем actorDisplayName: для 'agent' — agentName или generic; для людей —
        // member.displayName.
        const actorDisplayName =
          input.actorKind === 'agent'
            ? (input.agentName ?? 'Агент')
            : (actor?.user.displayName ?? 'Кто-то');
        const taskExcerpt = excerpt(task.description);
        const commentExcerpt = excerpt(body);
        for (const recipientId of mentionedUserIds) {
          await this.deps.notifications.create({
            id: this.deps.idGen(),
            userId: recipientId,
            payload: {
              type: 'comment_mention',
              projectId: project.id,
              projectName: project.name,
              taskId: task.id,
              taskExcerpt,
              taskStatus: task.status,
              commentId: comment.id,
              commentExcerpt,
              actorUserId: input.ownerUserId,
              actorDisplayName,
              actorKind: input.actorKind ?? 'user',
              agentName: input.agentName ?? null,
            },
          });
        }
      }
    } catch (err) {
      console.warn('[CreateTaskComment] mention-notification failed:', err);
    }

    return comment;
  }
}

import { TaskCommentBodyEmptyError, TaskNotFoundError } from '../../domain/task/errors.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type {
  ProjectMemberRepository,
  ProjectMemberWithUser,
} from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly comments: TaskCommentRepository;
  readonly notifications: NotificationRepository;
  readonly idGen: () => string;
};

export type CreateTaskCommentCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
  readonly body: string;
};

// Парсит @-mentions из body против списка members. Один член может быть упомянут
// несколько раз — возвращаем уникальные user-id (исключая self). Алгоритм: для каждого
// member'а ищем `@${displayName}` как substring (case-insensitive). Это просто и
// предсказуемо: client-picker всегда вставляет exact-match по displayName.
function parseMentions(
  body: string,
  members: readonly ProjectMemberWithUser[],
  authorUserId: string,
): string[] {
  const lower = body.toLowerCase();
  const seen = new Set<string>();
  for (const m of members) {
    if (m.userId === authorUserId) continue;
    const needle = `@${m.user.displayName.toLowerCase()}`;
    if (lower.includes(needle)) seen.add(m.userId);
  }
  return [...seen];
}

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

    const { project, membership } = await requireProjectAccess(
      this.deps,
      input.projectId,
      input.ownerUserId,
      'create_comment',
    );
    void membership;
    const task = await this.deps.tasks.getById(input.taskId);
    if (!task || task.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    const comment = await this.deps.comments.create({
      id: this.deps.idGen(),
      taskId: input.taskId,
      ownerUserId: input.ownerUserId,
      body,
    });

    // Mention-парсинг. Уведомления — best-effort: если что-то упадёт здесь, комментарий
    // уже сохранён и пользователь увидит успех. Логируем ошибку, но не reject'им.
    try {
      const members = await this.deps.members.listByProject(input.projectId);
      const mentionedUserIds = parseMentions(body, members, input.ownerUserId);
      if (mentionedUserIds.length > 0) {
        const actor = members.find((m) => m.userId === input.ownerUserId);
        const actorDisplayName = actor?.user.displayName ?? 'Кто-то';
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
              commentId: comment.id,
              commentExcerpt,
              actorUserId: input.ownerUserId,
              actorDisplayName,
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

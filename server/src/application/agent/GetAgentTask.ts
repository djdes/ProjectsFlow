import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskAttachmentRepository } from '../task/TaskAttachmentRepository.js';
import type { TaskCommentRepository } from '../task/TaskCommentRepository.js';
import type { AttachmentStorage } from '../task/AttachmentStorage.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly comments: TaskCommentRepository;
  readonly storage: AttachmentStorage;
};

export type AgentTaskAttachmentWithData = TaskAttachment & {
  readonly data: Buffer;
};

export type AgentTaskResult = {
  readonly task: Task;
  readonly attachments: AgentTaskAttachmentWithData[];
  readonly comments: TaskComment[];
};

// Агрегатор для pf_get_task: task + binary'и всех аттачей + список комментариев.
// Юзер сказал «передавать все вложения», cap не ставим — sanity-чек уже стоит в
// UploadTaskAttachment (MAX_ATTACHMENT_BYTES + ALLOWED_ATTACHMENT_MIME), так что
// неконтролируемого роста быть не должно. Битые storageKey'и (read возвращает null)
// пропускаем, не валим ответ — лучше отдать что есть, чем 500'ить всю задачу.
// Comments возвращаем по порядку (старые сверху, как в TaskCommentRepository).
export class GetAgentTask {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    ownerUserId: string,
    taskId: string,
  ): Promise<AgentTaskResult> {
    await requireProjectAccess(this.deps, projectId, ownerUserId, 'read_project');
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);

    const [attachmentsMeta, comments] = await Promise.all([
      this.deps.attachments.listByTask(taskId),
      this.deps.comments.listByTask(taskId),
    ]);

    const attachments: AgentTaskAttachmentWithData[] = [];
    for (const att of attachmentsMeta) {
      const read = await this.deps.storage.read(att.storageKey);
      if (!read) continue;
      attachments.push({ ...att, data: read.data });
    }
    return { task, attachments, comments };
  }
}

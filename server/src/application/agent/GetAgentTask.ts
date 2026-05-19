import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskAttachmentRepository } from '../task/TaskAttachmentRepository.js';
import type { AttachmentStorage } from '../task/AttachmentStorage.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly storage: AttachmentStorage;
};

export type AgentTaskAttachmentWithData = TaskAttachment & {
  readonly data: Buffer;
};

export type AgentTaskResult = {
  readonly task: Task;
  readonly attachments: AgentTaskAttachmentWithData[];
};

// Агрегатор для pf_get_task: task + binary'и всех аттачей. Юзер сказал «передавать
// все вложения», cap не ставим — sanity-чек уже стоит в UploadTaskAttachment
// (MAX_ATTACHMENT_BYTES + ALLOWED_ATTACHMENT_MIME), так что неконтролируемого роста
// быть не должно. Битые storageKey'и (read возвращает null) пропускаем, не валим
// ответ — лучше отдать что есть, чем 500'ить всю задачу.
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

    const meta = await this.deps.attachments.listByTask(taskId);
    const results: AgentTaskAttachmentWithData[] = [];
    for (const att of meta) {
      const read = await this.deps.storage.read(att.storageKey);
      if (!read) continue;
      results.push({ ...att, data: read.data });
    }
    return { task, attachments: results };
  }
}

import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { TaskAttachmentNotFoundError } from '../../domain/task/errors.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { AttachmentStorage, ReadResult } from './AttachmentStorage.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly storage: AttachmentStorage;
};

export type GetTaskAttachmentResult = {
  readonly attachment: TaskAttachment;
  readonly data: ReadResult;
};

// Auth-gated download — проверяем что юзер — owner проекта-таска-аттача.
// Без этого пришлось бы делать /uploads статикой и доверять unguessability'ю UUID,
// что для personal-data так себе.
export class GetTaskAttachment {
  constructor(private readonly deps: Deps) {}

  async execute(ownerUserId: string, attachmentId: string): Promise<GetTaskAttachmentResult> {
    const att = await this.deps.attachments.getById(attachmentId);
    if (!att) throw new TaskAttachmentNotFoundError(attachmentId);
    const task = await this.deps.tasks.getById(att.taskId);
    if (!task) throw new TaskAttachmentNotFoundError(attachmentId);
    const project = await this.deps.projects.getByIdForOwner(task.projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    const data = await this.deps.storage.read(att.storageKey);
    if (!data) throw new TaskAttachmentNotFoundError(attachmentId);
    return { attachment: att, data };
  }
}

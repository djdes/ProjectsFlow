import { TaskAttachmentNotFoundError } from '../../domain/task/errors.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { AttachmentStorage, ReadResult } from './AttachmentStorage.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly storage: AttachmentStorage;
};

export type GetTaskAttachmentResult = {
  readonly attachment: TaskAttachment;
  readonly data: ReadResult;
};

// Auth-gated download — проверяем что юзер является member'ом проекта-таска-аттача.
// Без этого пришлось бы делать /uploads статикой и доверять unguessability'ю UUID,
// что для personal-data так себе.
export class GetTaskAttachment {
  constructor(private readonly deps: Deps) {}

  async execute(ownerUserId: string, attachmentId: string): Promise<GetTaskAttachmentResult> {
    const att = await this.deps.attachments.getById(attachmentId);
    if (!att) throw new TaskAttachmentNotFoundError(attachmentId);
    const task = await this.deps.tasks.getById(att.taskId);
    if (!task) throw new TaskAttachmentNotFoundError(attachmentId);
    await requireProjectAccess(this.deps, task.projectId, ownerUserId, 'read_project');
    const data = await this.deps.storage.read(att.storageKey);
    if (!data) throw new TaskAttachmentNotFoundError(attachmentId);
    return { attachment: att, data };
  }
}

import {
  TaskAttachmentNotFoundError,
  TaskNotFoundError,
} from '../../domain/task/errors.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { AttachmentStorage } from './AttachmentStorage.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import { requireTaskModifyAccess } from './taskAuthorization.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly storage: AttachmentStorage;
  readonly delegations: TaskDelegationRepository;
};

export class DeleteTaskAttachment {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, taskId: string, attachmentId: string): Promise<void> {
    await requireTaskModifyAccess(
      this.deps,
      projectId,
      taskId,
      ownerUserId,
      'manage_attachments',
    );
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);
    const att = await this.deps.attachments.getById(attachmentId);
    if (!att || att.taskId !== taskId) throw new TaskAttachmentNotFoundError(attachmentId);

    await this.deps.attachments.delete(attachmentId);
    // Файл удаляем после DB-записи — если упадёт, останется orphan на диске.
    // Это лучше чем удалить файл, а потом провалить DB-операцию (тогда задача указывала бы
    // на несуществующий файл). Orphan'ы можно периодически зачищать отдельно.
    await this.deps.storage.delete(att.storageKey).catch((e: unknown) => {
      console.warn(`[delete-attachment] storage cleanup failed for ${att.storageKey}:`, e);
    });
  }
}

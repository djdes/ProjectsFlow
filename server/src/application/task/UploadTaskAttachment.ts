import { TaskAttachmentTooLargeError, TaskNotFoundError } from '../../domain/task/errors.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
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
  readonly idGen: () => string;
  readonly maxBytes: number;
};

export type UploadTaskAttachmentCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly data: Buffer;
  // Если задан — вложение принадлежит комментарию (а не самой задаче).
  readonly commentId?: string;
};

// Расширение из исходного имени файла (любой тип разрешён). Безопасное: только буквы/цифры,
// иначе fallback. Используется лишь для storageKey на диске; mimeType хранится отдельно.
function extFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return 'bin';
  const ext = filename.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(ext) ? ext : 'bin';
}

export class UploadTaskAttachment {
  constructor(private readonly deps: Deps) {}

  async execute(input: UploadTaskAttachmentCommand): Promise<TaskAttachment> {
    if (input.data.byteLength > this.deps.maxBytes) {
      throw new TaskAttachmentTooLargeError(input.data.byteLength, this.deps.maxBytes);
    }

    await requireTaskModifyAccess(
      this.deps,
      input.projectId,
      input.taskId,
      input.ownerUserId,
      'manage_attachments',
    );
    const task = await this.deps.tasks.getById(input.taskId);
    if (!task || task.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    const id = this.deps.idGen();
    const ext = extFromFilename(input.filename);
    const storageKey = input.commentId
      ? `comments/${input.commentId}/${id}.${ext}`
      : `tasks/${input.taskId}/${id}.${ext}`;

    await this.deps.storage.put({ storageKey, data: input.data, mimeType: input.mimeType });

    return this.deps.attachments.create({
      id,
      taskId: input.taskId,
      commentId: input.commentId ?? null,
      filename: input.filename.slice(0, 255),
      mimeType: input.mimeType,
      sizeBytes: input.data.byteLength,
      storageKey,
    });
  }
}

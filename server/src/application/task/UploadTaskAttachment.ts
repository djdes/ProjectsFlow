import { ProjectNotFoundError } from '../../domain/project/errors.js';
import {
  TaskAttachmentTooLargeError,
  TaskAttachmentTypeNotAllowedError,
  TaskNotFoundError,
} from '../../domain/task/errors.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { AttachmentStorage } from './AttachmentStorage.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly storage: AttachmentStorage;
  readonly idGen: () => string;
  readonly maxBytes: number;
  readonly allowedMimeTypes: ReadonlySet<string>;
};

export type UploadTaskAttachmentCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly data: Buffer;
};

// Деривим расширение по MIME, не доверяя клиентскому filename
// (он может прийти как "screenshot" без расширения).
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export class UploadTaskAttachment {
  constructor(private readonly deps: Deps) {}

  async execute(input: UploadTaskAttachmentCommand): Promise<TaskAttachment> {
    if (input.data.byteLength > this.deps.maxBytes) {
      throw new TaskAttachmentTooLargeError(input.data.byteLength, this.deps.maxBytes);
    }
    if (!this.deps.allowedMimeTypes.has(input.mimeType)) {
      throw new TaskAttachmentTypeNotAllowedError(input.mimeType);
    }

    const project = await this.deps.projects.getByIdForOwner(input.projectId, input.ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    const task = await this.deps.tasks.getById(input.taskId);
    if (!task || task.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    const id = this.deps.idGen();
    const ext = MIME_TO_EXT[input.mimeType] ?? 'bin';
    const storageKey = `tasks/${input.taskId}/${id}.${ext}`;

    await this.deps.storage.put({ storageKey, data: input.data, mimeType: input.mimeType });

    return this.deps.attachments.create({
      id,
      taskId: input.taskId,
      filename: input.filename.slice(0, 255),
      mimeType: input.mimeType,
      sizeBytes: input.data.byteLength,
      storageKey,
    });
  }
}

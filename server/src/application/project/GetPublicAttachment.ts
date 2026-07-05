import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskAttachmentRepository } from '../task/TaskAttachmentRepository.js';
import type { AttachmentStorage, ReadResult } from '../task/AttachmentStorage.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly storage: AttachmentStorage;
};

export type PublicAttachmentResult = {
  readonly attachment: TaskAttachment;
  readonly data: ReadResult;
};

// Отдача вложения (картинки) задачи ОПУБЛИКОВАННОЙ доски анониму. Гейт — не membership, а
// цепочка attachment → task → project с project.isPublic И совпадением slug'а (нельзя тянуть
// вложение чужого проекта через свой slug). Зеркало GetTaskAttachment.executeSigned + публичного
// cover-роута. Возвращает null → роут отдаёт 404. См. db/096.
export class GetPublicAttachment {
  constructor(private readonly deps: Deps) {}

  async execute(slug: string, attachmentId: string): Promise<PublicAttachmentResult | null> {
    const project = await this.deps.projects.getBySlug(slug);
    if (!project || !project.isPublic) return null;

    const att = await this.deps.attachments.getById(attachmentId);
    if (!att) return null;

    const task = await this.deps.tasks.getById(att.taskId);
    if (!task || task.projectId !== project.id) return null;

    const data = await this.deps.storage.read(att.storageKey);
    if (!data) return null;

    return { attachment: att, data };
  }
}

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

// data === null — файл существует, но в этот ответ не влез (см. INLINE_BUDGET_BYTES).
// Клиент скачивает такие поштучно: GET .../attachments/:attachmentId.
export type AgentTaskAttachmentWithData = TaskAttachment & {
  readonly data: Buffer | null;
};

// Потолок суммарных байтов, которые кладём в один ответ. Отдельный файл может весить
// до 100 MB (MAX_ATTACHMENT_BYTES), а в base64 это ×1.33 — без бюджета длинный тред со
// скринами и голосовыми раздувал бы ответ до сотен мегабайт и вешал MCP-процесс.
const INLINE_BUDGET_BYTES = 24 * 1024 * 1024;

export type AgentTaskResult = {
  readonly task: Task;
  readonly attachments: AgentTaskAttachmentWithData[];
  readonly comments: TaskComment[];
};

// Агрегатор для pf_get_task: task + binary'и аттачей + список комментариев.
// Аттачи берём ВСЕ — и приложенные к самой задаче, и приложенные к комментариям треда:
// для агента файл из обсуждения ровно такой же контекст, а раньше он их вообще не видел.
// Байты отдаём в пределах INLINE_BUDGET_BYTES (по порядку загрузки), остальным ставим
// data=null — клиент дотянет их поштучным download-эндпоинтом. Битые storageKey'и (read
// возвращает null) пропускаем, не валим ответ — лучше отдать что есть, чем 500'ить всю
// задачу. Comments возвращаем по порядку (старые сверху, как в TaskCommentRepository).
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
      this.deps.attachments.listAllByTask(taskId),
      this.deps.comments.listByTask(taskId),
    ]);

    const attachments: AgentTaskAttachmentWithData[] = [];
    let spentBytes = 0;
    for (const att of attachmentsMeta) {
      if (spentBytes + att.sizeBytes > INLINE_BUDGET_BYTES) {
        attachments.push({ ...att, data: null });
        continue;
      }
      const read = await this.deps.storage.read(att.storageKey);
      if (!read) continue;
      spentBytes += read.data.byteLength;
      attachments.push({ ...att, data: read.data });
    }
    return { task, attachments, comments };
  }
}

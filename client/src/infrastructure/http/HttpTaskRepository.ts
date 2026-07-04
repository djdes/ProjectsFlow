import type { Task } from '@/domain/task/Task';
import type { TaskCommit } from '@/domain/task/TaskCommit';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import type { TaskSnapshot, TaskVersionsResult } from '@/domain/task/TaskVersion';
import type { PlanId } from '@/domain/usage/Usage';
import type {
  CommentNotification,
  CommentNotifications,
  NotifyAudience,
  TaskComment,
} from '@/domain/task/TaskComment';
import type {
  CreateTaskInput,
  MoveTaskInput,
  SyncCommitsResult,
  TaskDigestInput,
  TaskDigestResult,
  TaskRepository,
  UpdateTaskInput,
} from '@/application/task/TaskRepository';
import { httpClient } from './httpClient';

type DelegationDto = {
  id: string;
  taskId: string;
  delegateUserId: string;
  delegateDisplayName: string;
  creatorUserId: string;
  creatorDisplayName: string;
  status: import('@/domain/task/TaskDelegation').TaskDelegationStatus;
  createdAt: string;
  respondedAt: string | null;
};

export type TaskDto = Omit<
  Task,
  | 'createdAt'
  | 'updatedAt'
  | 'ralphMode'
  | 'ralphCancelRequestedAt'
  | 'ralphCancelRequestedBy'
  | 'ralphCancelRequestedByDisplayName'
  | 'delegation'
  | 'deadline'
  | 'priority'
  | 'statusBeforeDone'
  | 'icon'
  | 'cover'
  | 'coverPosition'
> & {
  createdAt: string;
  updatedAt: string;
  // Optional — старый backend без db/093 не присылает.
  icon?: string | null;
  // Optional — старый backend без db/094 не присылает.
  cover?: string | null;
  coverPosition?: number;
  // Optional — старый backend без db/055 не присылает.
  statusBeforeDone?: import('@/domain/task/Task').TaskStatus | null;
  // Optional на проводе — старый backend без миграции 035 не присылает.
  ralphMode?: import('@/domain/task/Task').RalphMode;
  // Optional — старый backend без 037 не отдаёт эти поля.
  ralphCancelRequestedAt?: string | null;
  ralphCancelRequestedBy?: string | null;
  ralphCancelRequestedByDisplayName?: string | null;
  // Optional — старый backend без db/039 не присылает.
  delegation?: DelegationDto | null;
  // Optional — старый backend без db/041 не присылает.
  deadline?: string | null;
  priority?: import('@/domain/task/Task').TaskPriority | null;
};

type CommitDto = Omit<TaskCommit, 'committedAt' | 'linkedAt'> & {
  committedAt: string;
  linkedAt: string;
};

type AttachmentDto = Omit<TaskAttachment, 'uploadedAt'> & {
  uploadedAt: string;
};

type CommentDto = Omit<TaskComment, 'createdAt' | 'updatedAt' | 'attachments'> & {
  createdAt: string;
  updatedAt: string;
  attachments?: AttachmentDto[];
};

export function fromDto(dto: TaskDto): Task {
  return {
    ...dto,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    icon: dto.icon ?? null,
    cover: dto.cover ?? null,
    coverPosition: dto.coverPosition ?? 50,
    statusBeforeDone: dto.statusBeforeDone ?? null,
    // Graceful default — backend без 035 продолжает работать (mode = текущее поведение).
    ralphMode: dto.ralphMode ?? 'normal',
    ralphCancelRequestedAt: dto.ralphCancelRequestedAt
      ? new Date(dto.ralphCancelRequestedAt)
      : null,
    ralphCancelRequestedBy: dto.ralphCancelRequestedBy ?? null,
    ralphCancelRequestedByDisplayName: dto.ralphCancelRequestedByDisplayName ?? null,
    deadline: dto.deadline ?? null,
    priority: dto.priority ?? null,
    delegation: dto.delegation
      ? {
          ...dto.delegation,
          createdAt: new Date(dto.delegation.createdAt),
          respondedAt: dto.delegation.respondedAt ? new Date(dto.delegation.respondedAt) : null,
        }
      : null,
  };
}

function commitFromDto(dto: CommitDto): TaskCommit {
  return { ...dto, committedAt: new Date(dto.committedAt), linkedAt: new Date(dto.linkedAt) };
}

function attachmentFromDto(dto: AttachmentDto): TaskAttachment {
  return { ...dto, uploadedAt: new Date(dto.uploadedAt) };
}

// multipart/form-data upload: httpClient рассчитан под JSON, поэтому XHR вручную.
// XHR (а не fetch) — чтобы получать события прогресса аплоада (upload.onprogress);
// fetch их не отдаёт. withCredentials для cookie-сессии. Content-Type браузер
// выставит сам с boundary.
function uploadFile(
  url: string,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<TaskAttachment> {
  return new Promise<TaskAttachment>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;

    if (onProgress) {
      xhr.upload.onprogress = (e: ProgressEvent): void => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }

    xhr.onload = (): void => {
      const text = xhr.responseText;
      type UploadResponse = { attachment?: AttachmentDto; error?: string; message?: string };
      let data: UploadResponse | null;
      try {
        data = text ? (JSON.parse(text) as UploadResponse) : null;
      } catch {
        data = null;
      }
      if (xhr.status < 200 || xhr.status >= 300 || !data?.attachment) {
        reject(new Error(data?.message ?? data?.error ?? `HTTP ${xhr.status}`));
        return;
      }
      resolve(attachmentFromDto(data.attachment));
    };
    xhr.onerror = (): void => reject(new Error('Сетевая ошибка при загрузке'));
    xhr.onabort = (): void => reject(new Error('Загрузка отменена'));

    xhr.send(form);
  });
}

function commentFromDto(dto: CommentDto): TaskComment {
  return {
    ...dto,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    // Fallback 'user' — старый backend без миграции 034 не присылает поле.
    actorKind: dto.actorKind ?? 'user',
    agentName: dto.agentName ?? null,
    // Fallback 'all' — старый backend без db/047 не присылает поле.
    notifyMode: dto.notifyMode ?? 'all',
    // Ответ/цитата (db/080). Старый backend без миграции → null.
    replyToCommentId: dto.replyToCommentId ?? null,
    quotedText: dto.quotedText ?? null,
    attachments: (dto.attachments ?? []).map(attachmentFromDto),
  };
}

type CommentNotificationDto = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  channel: CommentNotification['channel'];
  status: CommentNotification['status'];
  reason: string | null;
  createdAt: string;
};

export class HttpTaskRepository implements TaskRepository {
  async list(projectId: string): Promise<Task[]> {
    const { tasks } = await httpClient.get<{ tasks: TaskDto[] }>(`/projects/${projectId}/tasks`);
    return tasks.map(fromDto);
  }
  async create(projectId: string, input: CreateTaskInput): Promise<Task> {
    const { task } = await httpClient.post<{ task: TaskDto }>(
      `/projects/${projectId}/tasks`,
      input,
    );
    return fromDto(task);
  }
  async update(projectId: string, taskId: string, input: UpdateTaskInput): Promise<Task> {
    const { task } = await httpClient.patch<{ task: TaskDto }>(
      `/projects/${projectId}/tasks/${taskId}`,
      input,
    );
    return fromDto(task);
  }
  async move(projectId: string, taskId: string, input: MoveTaskInput): Promise<Task> {
    const { task } = await httpClient.post<{ task: TaskDto }>(
      `/projects/${projectId}/tasks/${taskId}/move`,
      input,
    );
    return fromDto(task);
  }
  async delete(projectId: string, taskId: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/tasks/${taskId}`);
  }
  async getVersions(projectId: string, taskId: string): Promise<TaskVersionsResult> {
    const res = await httpClient.get<{
      plan: PlanId;
      cutoffAt: string | null;
      versions: Array<{
        id: string;
        taskId: string;
        actorUserId: string | null;
        createdAt: string;
        snapshot: TaskSnapshot;
      }>;
    }>(`/projects/${projectId}/tasks/${taskId}/versions`);
    return {
      plan: res.plan,
      cutoffAt: res.cutoffAt ? new Date(res.cutoffAt) : null,
      versions: res.versions.map((v) => ({ ...v, createdAt: new Date(v.createdAt) })),
    };
  }
  async restoreVersion(projectId: string, taskId: string, versionId: string): Promise<Task> {
    const { task } = await httpClient.post<{ task: TaskDto }>(
      `/projects/${projectId}/tasks/${taskId}/versions/${versionId}/restore`,
      {},
    );
    return fromDto(task);
  }
  async listCommits(projectId: string, taskId: string): Promise<TaskCommit[]> {
    const { commits } = await httpClient.get<{ commits: CommitDto[] }>(
      `/projects/${projectId}/tasks/${taskId}/commits`,
    );
    return commits.map(commitFromDto);
  }
  async linkCommit(projectId: string, taskId: string, sha: string): Promise<TaskCommit> {
    const { commit } = await httpClient.post<{ commit: CommitDto }>(
      `/projects/${projectId}/tasks/${taskId}/commits`,
      { sha },
    );
    return commitFromDto(commit);
  }
  async unlinkCommit(projectId: string, taskId: string, sha: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/tasks/${taskId}/commits/${sha}`);
  }
  async syncCommits(projectId: string): Promise<SyncCommitsResult> {
    return httpClient.post<SyncCommitsResult>(`/projects/${projectId}/tasks/sync-commits`);
  }
  async listAttachments(projectId: string, taskId: string): Promise<TaskAttachment[]> {
    const { attachments } = await httpClient.get<{ attachments: AttachmentDto[] }>(
      `/projects/${projectId}/tasks/${taskId}/attachments`,
    );
    return attachments.map(attachmentFromDto);
  }
  async uploadAttachment(
    projectId: string,
    taskId: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<TaskAttachment> {
    return uploadFile(`/api/projects/${projectId}/tasks/${taskId}/attachments`, file, onProgress);
  }
  async deleteAttachment(projectId: string, taskId: string, attachmentId: string): Promise<void> {
    await httpClient.delete<void>(
      `/projects/${projectId}/tasks/${taskId}/attachments/${attachmentId}`,
    );
  }
  async uploadCommentAttachment(
    projectId: string,
    taskId: string,
    commentId: string,
    file: File,
  ): Promise<TaskAttachment> {
    return uploadFile(
      `/api/projects/${projectId}/tasks/${taskId}/comments/${commentId}/attachments`,
      file,
    );
  }
  async deleteCommentAttachment(
    projectId: string,
    taskId: string,
    commentId: string,
    attachmentId: string,
  ): Promise<void> {
    await httpClient.delete<void>(
      `/projects/${projectId}/tasks/${taskId}/comments/${commentId}/attachments/${attachmentId}`,
    );
  }
  async listComments(projectId: string, taskId: string): Promise<TaskComment[]> {
    const { comments } = await httpClient.get<{ comments: CommentDto[] }>(
      `/projects/${projectId}/tasks/${taskId}/comments`,
    );
    return comments.map(commentFromDto);
  }
  async createComment(
    projectId: string,
    taskId: string,
    body: string,
    notify?: NotifyAudience,
    reply?: { replyToCommentId?: string | null; quotedText?: string | null },
  ): Promise<TaskComment> {
    const payload: Record<string, unknown> = { body };
    if (notify) payload['notify'] = notify;
    if (reply?.replyToCommentId) payload['replyToCommentId'] = reply.replyToCommentId;
    if (reply?.quotedText) payload['quotedText'] = reply.quotedText;
    const { comment } = await httpClient.post<{ comment: CommentDto }>(
      `/projects/${projectId}/tasks/${taskId}/comments`,
      payload,
    );
    return commentFromDto(comment);
  }
  async listCommentNotifications(
    projectId: string,
    taskId: string,
    commentId: string,
  ): Promise<CommentNotifications> {
    const res = await httpClient.get<{
      notifyMode: CommentNotifications['notifyMode'];
      recipients: CommentNotificationDto[];
    }>(`/projects/${projectId}/tasks/${taskId}/comments/${commentId}/notifications`);
    return {
      notifyMode: res.notifyMode,
      recipients: res.recipients.map((r) => ({
        userId: r.userId,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        channel: r.channel,
        status: r.status,
        reason: r.reason,
        createdAt: new Date(r.createdAt),
      })),
    };
  }
  async updateComment(
    projectId: string,
    taskId: string,
    commentId: string,
    body: string,
  ): Promise<TaskComment> {
    const { comment } = await httpClient.patch<{ comment: CommentDto }>(
      `/projects/${projectId}/tasks/${taskId}/comments/${commentId}`,
      { body },
    );
    return commentFromDto(comment);
  }
  async deleteComment(projectId: string, taskId: string, commentId: string): Promise<void> {
    await httpClient.delete<void>(
      `/projects/${projectId}/tasks/${taskId}/comments/${commentId}`,
    );
  }

  async requestRalphCancel(projectId: string, taskId: string): Promise<Task> {
    const { task } = await httpClient.post<{ task: TaskDto }>(
      `/projects/${projectId}/tasks/${taskId}/ralph-cancel`,
      {},
    );
    return fromDto(task);
  }

  async revokeRalphCancel(projectId: string, taskId: string): Promise<Task> {
    const { task } = await httpClient.delete<{ task: TaskDto }>(
      `/projects/${projectId}/tasks/${taskId}/ralph-cancel`,
    );
    return fromDto(task);
  }

  async assignToProject(projectId: string, taskId: string, targetProjectId: string): Promise<Task> {
    const { task } = await httpClient.post<{ task: TaskDto }>(
      `/projects/${projectId}/tasks/${taskId}/assign-to-project`,
      { targetProjectId },
    );
    return fromDto(task);
  }

  async delegate(projectId: string, taskId: string, delegateUserId: string): Promise<Task> {
    const { task } = await httpClient.post<{ task: TaskDto }>(
      `/projects/${projectId}/tasks/${taskId}/delegate`,
      { delegateUserId },
    );
    return fromDto(task);
  }

  async digest(projectId: string, input: TaskDigestInput): Promise<TaskDigestResult> {
    return httpClient.post<TaskDigestResult>(`/projects/${projectId}/tasks/digest`, input);
  }
}

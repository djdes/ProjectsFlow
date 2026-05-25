import type { Task } from '@/domain/task/Task';
import type { TaskCommit } from '@/domain/task/TaskCommit';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import type { TaskComment } from '@/domain/task/TaskComment';
import type {
  CreateTaskInput,
  MoveTaskInput,
  SyncCommitsResult,
  TaskRepository,
  UpdateTaskInput,
} from '@/application/task/TaskRepository';
import { httpClient } from './httpClient';

type TaskDto = Omit<
  Task,
  'createdAt' | 'updatedAt' | 'delegatedToAgent' | 'agentJob' | 'ralphMode'
> & {
  createdAt: string;
  updatedAt: string;
  delegatedToAgent?: boolean;
  agentJob?: import('@/domain/agentJob/AgentJob').AgentJob | null;
  // Optional на проводе — старый backend без миграции 035 не присылает.
  ralphMode?: import('@/domain/task/Task').RalphMode;
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

function fromDto(dto: TaskDto): Task {
  return {
    ...dto,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    delegatedToAgent: dto.delegatedToAgent ?? false,
    agentJob: dto.agentJob ?? null,
    // Graceful default — backend без 035 продолжает работать (mode = текущее поведение).
    ralphMode: dto.ralphMode ?? 'normal',
  };
}

function commitFromDto(dto: CommitDto): TaskCommit {
  return { ...dto, committedAt: new Date(dto.committedAt), linkedAt: new Date(dto.linkedAt) };
}

function attachmentFromDto(dto: AttachmentDto): TaskAttachment {
  return { ...dto, uploadedAt: new Date(dto.uploadedAt) };
}

// multipart/form-data upload: httpClient рассчитан под JSON, поэтому fetch вручную.
// credentials:'include' для cookie-сессии. Content-Type браузер выставит сам с boundary.
async function uploadFile(url: string, file: File): Promise<TaskAttachment> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(url, { method: 'POST', credentials: 'include', body: form });
  const text = await res.text();
  const data = text
    ? (JSON.parse(text) as { attachment?: AttachmentDto; error?: string; message?: string })
    : null;
  if (!res.ok || !data?.attachment) {
    const msg = data?.message ?? data?.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return attachmentFromDto(data.attachment);
}

function commentFromDto(dto: CommentDto): TaskComment {
  return {
    ...dto,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    // Fallback 'user' — старый backend без миграции 034 не присылает поле.
    actorKind: dto.actorKind ?? 'user',
    agentName: dto.agentName ?? null,
    attachments: (dto.attachments ?? []).map(attachmentFromDto),
  };
}

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
  async uploadAttachment(projectId: string, taskId: string, file: File): Promise<TaskAttachment> {
    return uploadFile(`/api/projects/${projectId}/tasks/${taskId}/attachments`, file);
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
  async createComment(projectId: string, taskId: string, body: string): Promise<TaskComment> {
    const { comment } = await httpClient.post<{ comment: CommentDto }>(
      `/projects/${projectId}/tasks/${taskId}/comments`,
      { body },
    );
    return commentFromDto(comment);
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
}

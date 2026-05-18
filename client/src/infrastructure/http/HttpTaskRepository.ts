import type { Task } from '@/domain/task/Task';
import type { TaskCommit } from '@/domain/task/TaskCommit';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import type {
  CreateTaskInput,
  MoveTaskInput,
  SyncCommitsResult,
  TaskRepository,
  UpdateTaskInput,
} from '@/application/task/TaskRepository';
import { httpClient } from './httpClient';

type TaskDto = Omit<Task, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

type CommitDto = Omit<TaskCommit, 'committedAt' | 'linkedAt'> & {
  committedAt: string;
  linkedAt: string;
};

type AttachmentDto = Omit<TaskAttachment, 'uploadedAt'> & {
  uploadedAt: string;
};

function fromDto(dto: TaskDto): Task {
  return { ...dto, createdAt: new Date(dto.createdAt), updatedAt: new Date(dto.updatedAt) };
}

function commitFromDto(dto: CommitDto): TaskCommit {
  return { ...dto, committedAt: new Date(dto.committedAt), linkedAt: new Date(dto.linkedAt) };
}

function attachmentFromDto(dto: AttachmentDto): TaskAttachment {
  return { ...dto, uploadedAt: new Date(dto.uploadedAt) };
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
    // multipart/form-data: httpClient рассчитан под JSON, поэтому пишем fetch вручную.
    // credentials: 'include' нужен для cookie-сессии. Content-Type браузер выставит сам
    // вместе с boundary — НЕ выставлять руками, иначе сервер не сможет распарсить.
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}/attachments`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
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
  async deleteAttachment(projectId: string, taskId: string, attachmentId: string): Promise<void> {
    await httpClient.delete<void>(
      `/projects/${projectId}/tasks/${taskId}/attachments/${attachmentId}`,
    );
  }
}

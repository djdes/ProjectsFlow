import type { Task } from '@/domain/task/Task';
import type { TaskCommit } from '@/domain/task/TaskCommit';
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

function fromDto(dto: TaskDto): Task {
  return { ...dto, createdAt: new Date(dto.createdAt), updatedAt: new Date(dto.updatedAt) };
}

function commitFromDto(dto: CommitDto): TaskCommit {
  return { ...dto, committedAt: new Date(dto.committedAt), linkedAt: new Date(dto.linkedAt) };
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
}

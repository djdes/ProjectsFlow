import type { Project, ProjectStatus } from '@/domain/project/Project';
import { ProjectNameAlreadyExistsError } from '@/domain/project/errors';
import type {
  CreateProjectInput,
  ProjectRepository,
  UpdateProjectInput,
} from '@/application/project/ProjectRepository';
import { HttpError, httpClient } from './httpClient';

type ProjectDto = {
  id: string;
  ownerId: string;
  name: string;
  status: ProjectStatus;
  gitRepoUrl: string | null;
  kbRepoFullName: string | null;
  createdAt: string;
};

function fromDto(dto: ProjectDto): Project {
  return {
    id: dto.id,
    name: dto.name,
    status: dto.status,
    gitRepoUrl: dto.gitRepoUrl,
    kbRepoFullName: dto.kbRepoFullName ?? null,
    createdAt: new Date(dto.createdAt),
  };
}

export class HttpProjectRepository implements ProjectRepository {
  async list(): Promise<Project[]> {
    const { projects } = await httpClient.get<{ projects: ProjectDto[] }>('/projects');
    return projects.map(fromDto);
  }

  async getById(id: string): Promise<Project | null> {
    try {
      const { project } = await httpClient.get<{ project: ProjectDto }>(`/projects/${id}`);
      return fromDto(project);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }

  async create(input: CreateProjectInput): Promise<Project> {
    try {
      const { project } = await httpClient.post<{ project: ProjectDto }>('/projects', {
        name: input.name,
      });
      return fromDto(project);
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        throw new ProjectNameAlreadyExistsError(input.name);
      }
      throw err;
    }
  }

  async update(id: string, patch: UpdateProjectInput): Promise<Project> {
    try {
      const { project } = await httpClient.patch<{ project: ProjectDto }>(
        `/projects/${id}`,
        patch,
      );
      return fromDto(project);
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        throw new ProjectNameAlreadyExistsError(patch.name ?? '');
      }
      throw err;
    }
  }
}

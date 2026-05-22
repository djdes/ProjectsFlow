import type { Project } from '@/domain/project/Project';
import type { ProjectMember, ProjectRole } from '@/domain/project/ProjectMembership';
import type { ProjectInvite } from '@/domain/project/ProjectInvite';
import { ProjectNameAlreadyExistsError } from '@/domain/project/errors';
import type {
  CreateInviteInput,
  GitCollision,
  ProjectRepository,
  CreateProjectInput,
  UpdateProjectInput,
} from '@/application/project/ProjectRepository';
import { seedProjects } from './seed-data';

const LATENCY_MS = 120;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase('ru');
}

// Mock сейчас не подключён в DI-контейнере (используется HttpProjectRepository) — оставлен
// под потенциальный demo/preview-режим. Методы members/invites не реализованы — кинут
// «not implemented», если кто-то всё же его подключит.
export class MockProjectRepository implements ProjectRepository {
  private projects: Project[] = [...seedProjects];

  list(): Promise<Project[]> {
    return delay([...this.projects]);
  }

  getById(id: string): Promise<Project | null> {
    return delay(this.projects.find((p) => p.id === id) ?? null);
  }

  async getInbox(): Promise<Project> {
    let inbox = this.projects.find((p) => p.isInbox);
    if (inbox) return delay(inbox);
    inbox = {
      id: crypto.randomUUID(),
      name: 'Входящие',
      status: 'active',
      gitRepoUrl: null,
      kbRepoFullName: null,
      isInbox: true,
      role: 'owner',
      financeVisibility: 'owner',
      createdAt: new Date(),
    };
    this.projects.unshift(inbox);
    return delay(inbox);
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const normalized = normalizeName(input.name);
    const duplicate = this.projects.some((p) => normalizeName(p.name) === normalized);
    if (duplicate) throw new ProjectNameAlreadyExistsError(input.name);

    const project: Project = {
      id: crypto.randomUUID(),
      name: input.name,
      status: 'active',
      gitRepoUrl: null,
      kbRepoFullName: null,
      isInbox: false,
      role: 'owner',
      financeVisibility: 'owner',
      createdAt: new Date(),
    };
    // Новые проекты — наверху списка: user видит результат там, где он его ждёт
    this.projects.unshift(project);
    return delay(project);
  }

  async update(id: string, patch: UpdateProjectInput): Promise<Project> {
    const idx = this.projects.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error('project not found');
    const current = this.projects[idx]!;

    if (patch.name !== undefined && normalizeName(patch.name) !== normalizeName(current.name)) {
      const normalized = normalizeName(patch.name);
      const dup = this.projects.some(
        (p) => p.id !== id && normalizeName(p.name) === normalized,
      );
      if (dup) throw new ProjectNameAlreadyExistsError(patch.name);
    }

    const next: Project = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.gitRepoUrl !== undefined ? { gitRepoUrl: patch.gitRepoUrl } : {}),
      ...(patch.kbRepoFullName !== undefined ? { kbRepoFullName: patch.kbRepoFullName } : {}),
    };
    this.projects = this.projects.map((p) => (p.id === id ? next : p));
    return delay(next);
  }

  // Multi-tenancy stubs — mock пока не моделирует members/invites. Если кому-то понадобится
  // мокать «команду» — реализовать здесь по аналогии с projects[]. Параметры в payload'е
  // ошибки, чтобы лог дал понять что не так.
  listMembers(projectId: string): Promise<ProjectMember[]> {
    return Promise.reject(new Error(`Mock.listMembers(${projectId}): not implemented`));
  }
  updateMemberRole(
    projectId: string,
    userId: string,
    role: Exclude<ProjectRole, 'owner'>,
  ): Promise<void> {
    return Promise.reject(
      new Error(`Mock.updateMemberRole(${projectId}, ${userId}, ${role}): not implemented`),
    );
  }
  removeMember(projectId: string, userId: string): Promise<void> {
    return Promise.reject(new Error(`Mock.removeMember(${projectId}, ${userId}): not implemented`));
  }
  transferOwnership(projectId: string, toUserId: string): Promise<void> {
    return Promise.reject(
      new Error(`Mock.transferOwnership(${projectId} → ${toUserId}): not implemented`),
    );
  }
  listInvites(projectId: string): Promise<ProjectInvite[]> {
    return Promise.reject(new Error(`Mock.listInvites(${projectId}): not implemented`));
  }
  createInvite(projectId: string, input: CreateInviteInput): Promise<ProjectInvite> {
    return Promise.reject(
      new Error(`Mock.createInvite(${projectId}, role=${input.role}): not implemented`),
    );
  }
  deleteInvite(projectId: string, inviteId: string): Promise<void> {
    return Promise.reject(
      new Error(`Mock.deleteInvite(${projectId}, ${inviteId}): not implemented`),
    );
  }
  checkGitCollision(): Promise<GitCollision> {
    return Promise.resolve({ exists: false });
  }
  requestJoin(projectId: string): Promise<void> {
    return Promise.reject(new Error(`Mock.requestJoin(${projectId}): not implemented`));
  }
  resolveJoinRequest(requestId: string, accept: boolean): Promise<void> {
    return Promise.reject(
      new Error(`Mock.resolveJoinRequest(${requestId}, ${accept}): not implemented`),
    );
  }
}

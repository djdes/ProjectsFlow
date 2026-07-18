import {
  DEFAULT_PUBLIC_APPEARANCE,
  type Project,
} from '@/domain/project/Project';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { ProjectNameAlreadyExistsError } from '@/domain/project/errors';
import type {
  GitCollision,
  ProjectRepository,
  CreateProjectInput,
  UpdateProjectInput,
} from '@/application/project/ProjectRepository';
import type { NotificationPrefs } from '@/domain/notifications/NotificationPrefs';
import type { KanbanBoardSettings } from '@/domain/kanban/KanbanSettings';
import { seedProjects } from './seed-data';

const LATENCY_MS = 120;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase('ru');
}

// Mock сейчас не подключён в DI-контейнере (используется HttpProjectRepository) — оставлен
// под потенциальный demo/preview-режим. Методы members не реализованы — кинут
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
      ownerId: '01HUSR0000000000000000001',
      name: 'Входящие',
      icon: null,
      status: 'active',
      gitRepoUrl: null,
      kbRepoFullName: null,
      isInbox: true,
      role: 'owner',
      kbKind: 'none',
      financeVisibility: 'owner',
      dispatcherUserId: null,
      multiTaskWorker: false,
      isFavorite: false,
      favoriteSortOrder: 0,
      description: null,
      coverUrl: null,
      coverPosition: 50,
      publicSlug: null,
      isPublic: false,
      publicIndexing: false,
      publicAppearance: DEFAULT_PUBLIC_APPEARANCE,
      appRepoFullName: null,
      createdAt: new Date(),
    };
    this.projects.unshift(inbox);
    return delay(inbox);
  }

  async getNotificationPrefs(): Promise<NotificationPrefs> {
    return delay({});
  }

  async setNotificationPrefs(_projectId: string, prefs: NotificationPrefs): Promise<NotificationPrefs> {
    return delay(prefs);
  }

  private kanbanSettings: KanbanBoardSettings = {};

  async getKanbanSettings(): Promise<KanbanBoardSettings> {
    return delay(this.kanbanSettings);
  }

  async setKanbanSettings(_projectId: string, settings: KanbanBoardSettings): Promise<KanbanBoardSettings> {
    this.kanbanSettings = settings;
    return delay(this.kanbanSettings);
  }

  async reorder(orderedIds: readonly string[]): Promise<void> {
    const byId = new Map(this.projects.map((p) => [p.id, p]));
    const reordered = orderedIds
      .map((id) => byId.get(id))
      .filter((p): p is Project => p !== undefined);
    const idSet = new Set(orderedIds);
    const rest = this.projects.filter((p) => !idSet.has(p.id));
    this.projects = [...reordered, ...rest];
    await delay(undefined);
  }

  async toggleFavorite(projectId: string, favorite: boolean): Promise<void> {
    const maxFav = this.projects
      .filter((p) => p.isFavorite)
      .reduce((max, p) => Math.max(max, p.favoriteSortOrder), -1);
    this.projects = this.projects.map((p) =>
      p.id === projectId
        ? favorite
          ? { ...p, isFavorite: true, favoriteSortOrder: maxFav + 1 }
          : { ...p, isFavorite: false }
        : p,
    );
    await delay(undefined);
  }

  async reorderFavorites(orderedIds: readonly string[]): Promise<void> {
    const orderById = new Map(orderedIds.map((id, i) => [id, i] as const));
    this.projects = this.projects.map((p) => {
      const idx = orderById.get(p.id);
      return idx !== undefined && p.isFavorite
        ? { ...p, favoriteSortOrder: idx }
        : p;
    });
    await delay(undefined);
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const normalized = normalizeName(input.name);
    const duplicate = this.projects.some((p) => normalizeName(p.name) === normalized);
    if (duplicate) throw new ProjectNameAlreadyExistsError(input.name);

    const project: Project = {
      id: crypto.randomUUID(),
      ownerId: '01HUSR0000000000000000001',
      name: input.name,
      icon: null,
      status: 'active',
      gitRepoUrl: null,
      kbRepoFullName: null,
      isInbox: false,
      role: 'owner',
      kbKind: 'none',
      financeVisibility: 'owner',
      dispatcherUserId: null,
      multiTaskWorker: false,
      isFavorite: false,
      favoriteSortOrder: 0,
      description: null,
      coverUrl: null,
      coverPosition: 50,
      publicSlug: null,
      isPublic: false,
      publicIndexing: false,
      publicAppearance: DEFAULT_PUBLIC_APPEARANCE,
      appRepoFullName: null,
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
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.gitRepoUrl !== undefined ? { gitRepoUrl: patch.gitRepoUrl } : {}),
      ...(patch.kbRepoFullName !== undefined ? { kbRepoFullName: patch.kbRepoFullName } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };
    this.projects = this.projects.map((p) => (p.id === id ? next : p));
    return delay(next);
  }

  async delete(id: string): Promise<void> {
    this.projects = this.projects.filter((p) => p.id !== id);
    await delay(undefined);
  }

  // Mock: на этапе UI-скелета (Spec #1) HTTP-сервера ещё не было — здесь только
  // заглушки. Реальная логика живёт в HttpProjectRepository.
  listDispatcherCandidates(): Promise<never> {
    return Promise.reject(new Error('Mock.listDispatcherCandidates: not implemented'));
  }
  setDispatcher(): Promise<never> {
    return Promise.reject(new Error('Mock.setDispatcher: not implemented'));
  }
  setMultiTaskWorker(): Promise<never> {
    return Promise.reject(new Error('Mock.setMultiTaskWorker: not implemented'));
  }
  publish(): Promise<never> {
    return Promise.reject(new Error('Mock.publish: not implemented'));
  }
  unpublish(): Promise<never> {
    return Promise.reject(new Error('Mock.unpublish: not implemented'));
  }
  setPublicIndexing(): Promise<never> {
    return Promise.reject(new Error('Mock.setPublicIndexing: not implemented'));
  }
  setPublicAppearance(): Promise<never> {
    return Promise.reject(new Error('Mock.setPublicAppearance: not implemented'));
  }
  ensureAppRepo(): Promise<never> {
    return Promise.reject(new Error('Mock.ensureAppRepo: not implemented'));
  }
  createRepo(): Promise<never> {
    return Promise.reject(new Error('Mock.createRepo: not implemented'));
  }
  importRepo(): Promise<never> {
    return Promise.reject(new Error('Mock.importRepo: not implemented'));
  }
  analyzeRepoImport(): Promise<never> {
    return Promise.reject(new Error('Mock.analyzeRepoImport: not implemented'));
  }
  getProjectSite(): Promise<{ siteSlug: string | null; deployedAt: string | null; fileCount: number; routes: readonly string[] }> {
    return Promise.resolve({ siteSlug: null, deployedAt: null, fileCount: 0, routes: ['/'] });
  }
  getAppBackendStatus(): Promise<{
    status: 'none' | 'active';
    usageBytes: number;
    storageLimitBytes: number;
    tables: readonly string[];
  }> {
    return Promise.resolve({ status: 'none', usageBytes: 0, storageLimitBytes: 0, tables: [] });
  }
  getAppBackendDashboard(): Promise<never> { return Promise.reject(new Error('Mock.getAppBackendDashboard: not implemented')); }
  getAppDashboardSettings(): Promise<never> { return Promise.reject(new Error('Mock.getAppDashboardSettings: not implemented')); }
  updateAppDashboardSettings(): Promise<never> { return Promise.reject(new Error('Mock.updateAppDashboardSettings: not implemented')); }
  queryAppRows(): Promise<never> { return Promise.reject(new Error('Mock.queryAppRows: not implemented')); }
  createAppRow(): Promise<never> { return Promise.reject(new Error('Mock.createAppRow: not implemented')); }
  updateAppRow(): Promise<never> { return Promise.reject(new Error('Mock.updateAppRow: not implemented')); }
  deleteAppRow(): Promise<never> { return Promise.reject(new Error('Mock.deleteAppRow: not implemented')); }
  updateAppTablePermissions(): Promise<never> { return Promise.reject(new Error('Mock.updateAppTablePermissions: not implemented')); }
  getAppBackendLogs(): Promise<never> { return Promise.reject(new Error('Mock.getAppBackendLogs: not implemented')); }
  getGitTokenDelegation(): Promise<never> {
    return Promise.reject(new Error('Mock.getGitTokenDelegation: not implemented'));
  }
  setGitTokenDelegation(): Promise<never> {
    return Promise.reject(new Error('Mock.setGitTokenDelegation: not implemented'));
  }
  listGitTokenAccessLog(): Promise<never> {
    return Promise.reject(new Error('Mock.listGitTokenAccessLog: not implemented'));
  }

  // Multi-tenancy stubs — mock пока не моделирует members. Если кому-то понадобится
  // мокать «команду» — реализовать здесь по аналогии с projects[]. Параметры в payload'е
  // ошибки, чтобы лог дал понять что не так.
  listMembers(projectId: string): Promise<ProjectMember[]> {
    return Promise.reject(new Error(`Mock.listMembers(${projectId}): not implemented`));
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
  listSharedMembers() {
    return Promise.resolve([]);
  }
  recordProjectView(): Promise<void> {
    return Promise.resolve();
  }
  getProjectAnalytics(): Promise<never> {
    return Promise.reject(new Error('Mock.getProjectAnalytics: not implemented'));
  }
  getProjectActivity(): Promise<never> {
    return Promise.reject(new Error('Mock.getProjectActivity: not implemented'));
  }
  uploadCover(): Promise<never> {
    return Promise.reject(new Error('Mock.uploadCover: not implemented'));
  }
}

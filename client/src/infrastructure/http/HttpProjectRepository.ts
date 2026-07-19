import {
  DEFAULT_PUBLIC_APPEARANCE,
  type Project,
  type ProjectStatus,
  type PublicAppearance,
} from "@/domain/project/Project";
import type {
  ProjectMember,
  ProjectRole,
} from "@/domain/project/ProjectMembership";
import { ProjectNameAlreadyExistsError } from "@/domain/project/errors";
import type {
  CreateProjectInput,
  DispatcherCandidate,
  GitCollision,
  GitTokenAccessLogEntry,
  GitTokenDelegationStatus,
  ProjectRepository,
  ProjectSite,
  AppBackendStatus,
  AppBackendDashboard,
  AppDashboardSettings,
  AppDashboardSettingsPatch,
  AppSecurityScan,
  AppRuntimeUser,
  AppRowsQuery,
  AppRowsPage,
  AppDataRow,
  AppCrudRules,
  AppAuditPage,
  SharedMember,
} from "@/application/project/ProjectRepository";
import type { UpdateProjectInput } from "@/application/project/ProjectRepository";
import type { NotificationPrefs } from "@/domain/notifications/NotificationPrefs";
import type { KanbanBoardSettings } from "@/domain/kanban/KanbanSettings";
import type {
  ProjectAnalytics,
  ProjectActivity,
  ProjectActivityCursor,
} from "@/domain/project/ProjectAnalytics";
import type {
  ActivityKind,
  ActivityPayload,
} from "@/domain/activity/ActivityFeedItem";
import { HttpError, httpClient } from "./httpClient";

// Нормализует значение JSON-колонки в plain-объект: парсит строку (MariaDB longtext),
// отсекает не-объекты/массивы. Возвращает {} для всего невалидного.
function asPlainObject<T>(v: unknown): T {
  let val = v;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch {
      return {} as T;
    }
  }
  return val && typeof val === "object" && !Array.isArray(val)
    ? (val as T)
    : ({} as T);
}

type ProjectDto = {
  id: string;
  // Создатель проекта (projects.owner_id). Сервер отдаёт его на всех эндпоинтах проекта.
  ownerId: string;
  name: string;
  icon?: string | null;
  status: ProjectStatus;
  gitRepoUrl: string | null;
  kbRepoFullName: string | null;
  isInbox?: boolean;
  role?: ProjectRole;
  memberCount?: number;
  taskCount?: number;
  kbKind?: "none" | "github" | "local";
  financeVisibility?: "owner" | "members";
  dispatcherUserId?: string | null;
  // Мультизадачный воркер. На старых list-ответах может отсутствовать — дефолтим false.
  multiTaskWorker?: boolean;
  // Только на list-эндпоинте; на get/create/update сервер не отдаёт. Дефолтим false/0.
  isFavorite?: boolean;
  favoriteSortOrder?: number;
  // Notion-style шапка: описание + обложка (`gradient:<id>` или URL) + позиция (%).
  description?: string | null;
  coverUrl?: string | null;
  coverPosition?: number;
  // Публичная ссылка доски (Publish to web). Могут отсутствовать в старых ответах.
  publicSlug?: string | null;
  isPublic?: boolean;
  publicIndexing?: boolean;
  publicAppearance?: Partial<PublicAppearance> | null;
  appRepoFullName?: string | null;
  createdAt: string;
};

function fromDto(dto: ProjectDto): Project {
  return {
    id: dto.id,
    ownerId: dto.ownerId,
    name: dto.name,
    icon: dto.icon ?? null,
    status: dto.status,
    gitRepoUrl: dto.gitRepoUrl,
    kbRepoFullName: dto.kbRepoFullName ?? null,
    kbKind: dto.kbKind ?? (dto.kbRepoFullName ? "github" : "none"),
    isInbox: dto.isInbox ?? false,
    // Legacy-fallback: до P3-релиза сервера role могло не быть в ответе. Дефолт 'owner'
    // — для single-tenant юзеров это и так было true, UI не сломается.
    role: dto.role ?? "owner",
    memberCount: dto.memberCount,
    taskCount: dto.taskCount,
    financeVisibility: dto.financeVisibility ?? "owner",
    dispatcherUserId: dto.dispatcherUserId ?? null,
    multiTaskWorker: dto.multiTaskWorker ?? false,
    isFavorite: dto.isFavorite ?? false,
    favoriteSortOrder: dto.favoriteSortOrder ?? 0,
    description: dto.description ?? null,
    coverUrl: dto.coverUrl ?? null,
    coverPosition: dto.coverPosition ?? 50,
    publicSlug: dto.publicSlug ?? null,
    isPublic: dto.isPublic ?? false,
    publicIndexing: dto.publicIndexing ?? false,
    publicAppearance: {
      ...DEFAULT_PUBLIC_APPEARANCE,
      ...(dto.publicAppearance ?? {}),
    },
    appRepoFullName: dto.appRepoFullName ?? null,
    createdAt: new Date(dto.createdAt),
  };
}

type MemberDto = {
  projectId: string;
  userId: string;
  role: ProjectRole;
  joinedAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
  };
};

function memberFromDto(dto: MemberDto): ProjectMember {
  return {
    projectId: dto.projectId,
    userId: dto.userId,
    role: dto.role,
    joinedAt: new Date(dto.joinedAt),
    user: dto.user,
  };
}

export class HttpProjectRepository implements ProjectRepository {
  async list(): Promise<Project[]> {
    const { projects } = await httpClient.get<{ projects: ProjectDto[] }>(
      "/projects",
    );
    return projects.map(fromDto);
  }

  async getById(id: string): Promise<Project | null> {
    try {
      const { project } = await httpClient.get<{ project: ProjectDto }>(
        `/projects/${id}`,
      );
      return fromDto(project);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }

  async getInbox(): Promise<Project> {
    const { project } = await httpClient.get<{ project: ProjectDto }>("/inbox");
    return fromDto(project);
  }

  async create(input: CreateProjectInput): Promise<Project> {
    try {
      const { project } = await httpClient.post<{ project: ProjectDto }>(
        "/projects",
        {
          name: input.name,
        },
      );
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
        throw new ProjectNameAlreadyExistsError(patch.name ?? "");
      }
      throw err;
    }
  }

  async uploadCover(
    projectId: string,
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<Project> {
    // multipart/form-data через XHR (httpClient рассчитан под JSON). Content-Type с boundary
    // проставит браузер; withCredentials — для cookie-сессии. XHR (в отличие от fetch) даёт
    // событие прогресса аплоада — прокидываем в onProgress для живого прогресс-бара.
    return new Promise<Project>((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/projects/${projectId}/cover`);
      xhr.withCredentials = true;
      if (onProgress) {
        xhr.upload.onprogress = (e): void => {
          if (e.lengthComputable)
            onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      xhr.onload = (): void => {
        type Resp = { project?: ProjectDto; error?: string; message?: string };
        let data: Resp | null;
        try {
          data = xhr.responseText
            ? (JSON.parse(xhr.responseText) as Resp)
            : null;
        } catch {
          data = null;
        }
        if (xhr.status < 200 || xhr.status >= 300 || !data?.project) {
          reject(
            new Error(
              data?.message ??
                data?.error ??
                `Не удалось загрузить обложку (HTTP ${xhr.status})`,
            ),
          );
          return;
        }
        resolve(fromDto(data.project));
      };
      xhr.onerror = (): void =>
        reject(new Error("Сетевая ошибка при загрузке обложки"));
      xhr.send(form);
    });
  }

  async delete(id: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${id}`);
  }

  async listDispatcherCandidates(
    projectId: string,
  ): Promise<DispatcherCandidate[]> {
    const { candidates } = await httpClient.get<{
      candidates: DispatcherCandidate[];
    }>(`/projects/${projectId}/dispatcher-candidates`);
    return candidates;
  }

  async setDispatcher(
    projectId: string,
    userId: string | null,
  ): Promise<Project> {
    const { project } = await httpClient.put<{ project: ProjectDto }>(
      `/projects/${projectId}/dispatcher`,
      { userId },
    );
    return fromDto(project);
  }

  async setMultiTaskWorker(
    projectId: string,
    enabled: boolean,
  ): Promise<Project> {
    const { project } = await httpClient.put<{ project: ProjectDto }>(
      `/projects/${projectId}/multi-task-worker`,
      { enabled },
    );
    return fromDto(project);
  }

  async publish(projectId: string): Promise<{ slug: string; url: string }> {
    return httpClient.post<{ slug: string; url: string }>(
      `/projects/${projectId}/publish`,
    );
  }

  async unpublish(projectId: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/publish`);
  }

  async setPublicIndexing(projectId: string, indexing: boolean): Promise<void> {
    await httpClient.patch<void>(`/projects/${projectId}/publish`, {
      indexing,
    });
  }

  async setPublicAppearance(
    projectId: string,
    appearance: PublicAppearance,
  ): Promise<void> {
    await httpClient.patch<void>(`/projects/${projectId}/public-appearance`, {
      appearance,
    });
  }

  async ensureAppRepo(projectId: string): Promise<{ appRepoFullName: string }> {
    return httpClient.post<{ appRepoFullName: string }>(
      `/projects/${projectId}/app-repo`,
    );
  }

  async createRepo(
    projectId: string,
    input: { name: string; privateRepo: boolean },
  ): Promise<{ fullName: string; gitRepoUrl: string }> {
    return httpClient.post<{ fullName: string; gitRepoUrl: string }>(
      `/projects/${projectId}/repo`,
      input,
    );
  }

  async getProjectSite(projectId: string): Promise<ProjectSite> {
    return httpClient.get<ProjectSite>(`/projects/${projectId}/site`);
  }

  async getAppBackendStatus(projectId: string): Promise<AppBackendStatus> {
    return httpClient.get<AppBackendStatus>(
      `/projects/${projectId}/app-backend`,
    );
  }

  async getGitTokenDelegation(
    projectId: string,
  ): Promise<GitTokenDelegationStatus> {
    return httpClient.get<GitTokenDelegationStatus>(
      `/projects/${projectId}/git-token-delegation`,
    );
  }

  async setGitTokenDelegation(
    projectId: string,
    enabled: boolean,
    granterUserId?: string,
  ): Promise<{
    enabled: boolean;
    grantedAt: string | null;
    revokedAt: string | null;
    granterUserId: string;
  }> {
    return httpClient.put(`/projects/${projectId}/git-token-delegation`, {
      enabled,
      ...(granterUserId !== undefined ? { granterUserId } : {}),
    });
  }

  async listGitTokenAccessLog(
    projectId: string,
  ): Promise<GitTokenAccessLogEntry[]> {
    const { entries } = await httpClient.get<{
      entries: GitTokenAccessLogEntry[];
    }>(`/projects/${projectId}/git-token-delegation/access-log`);
    return entries;
  }

  async reorder(orderedIds: readonly string[]): Promise<void> {
    await httpClient.put<void>("/projects/reorder", { orderedIds });
  }

  async toggleFavorite(projectId: string, favorite: boolean): Promise<void> {
    await httpClient.put<void>(`/projects/${projectId}/favorite`, { favorite });
  }

  async reorderFavorites(orderedIds: readonly string[]): Promise<void> {
    await httpClient.put<void>("/projects/reorder-favorites", { orderedIds });
  }

  async getNotificationPrefs(projectId: string): Promise<NotificationPrefs> {
    const { prefs } = await httpClient.get<{ prefs: NotificationPrefs }>(
      `/projects/${projectId}/notification-prefs`,
    );
    return prefs;
  }

  async setNotificationPrefs(
    projectId: string,
    prefs: NotificationPrefs,
  ): Promise<NotificationPrefs> {
    const { prefs: saved } = await httpClient.put<{ prefs: NotificationPrefs }>(
      `/projects/${projectId}/notification-prefs`,
      { prefs },
    );
    return saved;
  }

  async getKanbanSettings(projectId: string): Promise<KanbanBoardSettings> {
    const { settings } = await httpClient.get<{ settings?: unknown }>(
      `/projects/${projectId}/kanban-settings`,
    );
    // Защита: старый сервер (до фикса) мог отдать JSON-колонку строкой — парсим/нормализуем
    // в объект, иначе спред строки в хук'е даст мусорные числовые ключи.
    return asPlainObject<KanbanBoardSettings>(settings);
  }

  async setKanbanSettings(
    projectId: string,
    settings: KanbanBoardSettings,
  ): Promise<KanbanBoardSettings> {
    const { settings: saved } = await httpClient.put<{
      settings?: KanbanBoardSettings;
    }>(`/projects/${projectId}/kanban-settings`, { settings });
    return saved ?? {};
  }

  async listMembers(projectId: string): Promise<ProjectMember[]> {
    const { members } = await httpClient.get<{ members: MemberDto[] }>(
      `/projects/${projectId}/members`,
    );
    return members.map(memberFromDto);
  }

  async checkGitCollision(gitRepoUrl: string): Promise<GitCollision> {
    return httpClient.get<GitCollision>(
      `/projects/git-collision?url=${encodeURIComponent(gitRepoUrl)}`,
    );
  }

  async requestJoin(projectId: string): Promise<void> {
    await httpClient.post<unknown>(`/projects/${projectId}/join-requests`);
  }

  async resolveJoinRequest(requestId: string, accept: boolean): Promise<void> {
    await httpClient.post<unknown>(
      `/projects/join-requests/${requestId}/resolve`,
      { accept },
    );
  }

  async listSharedMembers(): Promise<SharedMember[]> {
    const { members } = await httpClient.get<{ members: SharedMember[] }>(
      "/me/shared-members",
    );
    return members;
  }

  async recordProjectView(projectId: string): Promise<void> {
    await httpClient.post(`/projects/${projectId}/views`, {});
  }

  async getProjectAnalytics(
    projectId: string,
    days: number,
  ): Promise<ProjectAnalytics> {
    const { analytics } = await httpClient.get<{
      analytics: {
        totalViews: number;
        windowDays: number;
        perDay: { date: string; count: number; unique: number }[];
        viewers: {
          userId: string;
          displayName: string;
          avatarUrl: string | null;
          lastViewedAt: string;
          viewCount: number;
        }[];
      };
    }>(`/projects/${projectId}/analytics?days=${days}`);
    return {
      totalViews: analytics.totalViews,
      windowDays: analytics.windowDays,
      perDay: analytics.perDay,
      viewers: analytics.viewers.map((v) => ({
        ...v,
        lastViewedAt: new Date(v.lastViewedAt),
      })),
    };
  }

  async getProjectActivity(
    projectId: string,
    limit: number,
    before?: ProjectActivityCursor,
  ): Promise<ProjectActivity> {
    const res = await httpClient.get<{
      summary: {
        createdAt: string;
        createdByName: string | null;
        lastEditedAt: string | null;
        lastEditedByName: string | null;
      };
      items: Array<{
        id: string;
        kind: ActivityKind;
        projectId: string;
        actorUserId: string | null;
        actorDisplayName: string | null;
        actorAvatarUrl: string | null;
        targetDisplayName: string | null;
        payload: ActivityPayload | null;
        createdAt: string;
        hasVersions?: boolean;
        taskDeleted?: boolean;
      }>;
      hasMore: boolean;
      nextCursor: { createdAt: string; id: string } | null;
    }>(
      `/projects/${projectId}/activity?limit=${limit}${
        before
          ? `&before=${encodeURIComponent(before.createdAt.toISOString())}&beforeId=${encodeURIComponent(before.id)}`
          : ""
      }`,
    );
    return {
      summary: {
        createdAt: new Date(res.summary.createdAt),
        createdByName: res.summary.createdByName,
        lastEditedAt: res.summary.lastEditedAt
          ? new Date(res.summary.lastEditedAt)
          : null,
        lastEditedByName: res.summary.lastEditedByName,
      },
      items: res.items.map((it) => ({
        type: "activity" as const,
        ...it,
        createdAt: new Date(it.createdAt),
      })),
      hasMore: res.hasMore,
      nextCursor: res.nextCursor
        ? {
            createdAt: new Date(res.nextCursor.createdAt),
            id: res.nextCursor.id,
          }
        : null,
    };
  }

  async getAppBackendDashboard(
    projectId: string,
  ): Promise<AppBackendDashboard> {
    return httpClient.get<AppBackendDashboard>(
      `/projects/${projectId}/app-backend/dashboard`,
    );
  }

  async getAppDashboardSettings(
    projectId: string,
  ): Promise<AppDashboardSettings> {
    return httpClient.get<AppDashboardSettings>(
      `/projects/${projectId}/app-dashboard/settings`,
    );
  }

  async updateAppDashboardSettings(
    projectId: string,
    patch: AppDashboardSettingsPatch,
  ): Promise<AppDashboardSettings> {
    return httpClient.put<AppDashboardSettings>(
      `/projects/${projectId}/app-dashboard/settings`,
      patch,
    );
  }

  async verifyAppCustomDomain(
    projectId: string,
  ): Promise<AppDashboardSettings> {
    return httpClient.post<AppDashboardSettings>(
      `/projects/${projectId}/app-dashboard/domains/verify`,
      {},
    );
  }

  async testAppWebhook(projectId: string): Promise<AppDashboardSettings> {
    return httpClient.post<AppDashboardSettings>(
      `/projects/${projectId}/app-dashboard/integrations/webhooks/test`,
      {},
    );
  }

  async scanAppSecurity(projectId: string): Promise<AppSecurityScan> {
    return httpClient.post<AppSecurityScan>(
      `/projects/${projectId}/app-dashboard/security/scan`,
      {},
    );
  }

  async listAppRuntimeUsers(
    projectId: string,
  ): Promise<readonly AppRuntimeUser[]> {
    return (
      await httpClient.get<{ users: AppRuntimeUser[] }>(
        `/projects/${projectId}/app-backend/users`,
      )
    ).users;
  }

  async revokeAppRuntimeUserSessions(
    projectId: string,
    userId: string,
  ): Promise<number> {
    return (
      await httpClient.post<{ revoked: number }>(
        `/projects/${projectId}/app-backend/users/${encodeURIComponent(userId)}/revoke-sessions`,
        {},
      )
    ).revoked;
  }

  async deleteAppRuntimeUser(
    projectId: string,
    userId: string,
  ): Promise<number> {
    return (
      await httpClient.delete<{ deleted: number }>(
        `/projects/${projectId}/app-backend/users/${encodeURIComponent(userId)}`,
      )
    ).deleted;
  }

  async queryAppRows(
    projectId: string,
    table: string,
    query: AppRowsQuery,
  ): Promise<AppRowsPage> {
    return httpClient.post<AppRowsPage>(
      `/projects/${projectId}/app-backend/tables/${encodeURIComponent(table)}/query`,
      query,
    );
  }

  async createAppRow(
    projectId: string,
    table: string,
    values: AppDataRow,
  ): Promise<AppDataRow> {
    const result = await httpClient.post<{ row: AppDataRow }>(
      `/projects/${projectId}/app-backend/tables/${encodeURIComponent(table)}/rows`,
      { values },
    );
    return result.row;
  }

  async updateAppRow(
    projectId: string,
    table: string,
    rowId: string,
    values: AppDataRow,
  ): Promise<AppDataRow | null> {
    const result = await httpClient.patch<{ row: AppDataRow | null }>(
      `/projects/${projectId}/app-backend/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(rowId)}`,
      { values },
    );
    return result.row;
  }

  async deleteAppRow(
    projectId: string,
    table: string,
    rowId: string,
  ): Promise<number> {
    const result = await httpClient.delete<{ deleted: number }>(
      `/projects/${projectId}/app-backend/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(rowId)}`,
    );
    return result.deleted;
  }

  async revealAppRowValue(
    projectId: string,
    table: string,
    rowId: string,
    column: string,
  ): Promise<unknown> {
    const result = await httpClient.post<{ value: unknown }>(
      `/projects/${projectId}/app-backend/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(rowId)}/reveal`,
      { column },
    );
    return result.value;
  }

  async updateAppTablePermissions(
    projectId: string,
    table: string,
    rules: AppCrudRules,
  ): Promise<AppCrudRules> {
    const result = await httpClient.put<{ rules: AppCrudRules }>(
      `/projects/${projectId}/app-backend/tables/${encodeURIComponent(table)}/permissions`,
      rules,
    );
    return result.rules;
  }

  async getAppBackendLogs(
    projectId: string,
    filters: {
      readonly table?: string;
      readonly operation?: string;
      readonly actor?: string;
      readonly errorsOnly?: boolean;
      readonly limit?: number;
      readonly offset?: number;
    } = {},
  ): Promise<AppAuditPage> {
    const query = new URLSearchParams();
    if (filters.table) query.set("table", filters.table);
    if (filters.operation) query.set("operation", filters.operation);
    if (filters.actor) query.set("actor", filters.actor);
    if (filters.errorsOnly) query.set("errors", "1");
    if (filters.limit !== undefined) query.set("limit", String(filters.limit));
    if (filters.offset !== undefined)
      query.set("offset", String(filters.offset));
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return httpClient.get<AppAuditPage>(
      `/projects/${projectId}/app-backend/logs${suffix}`,
    );
  }

  async importRepo(
    projectId: string,
    input: import("@/application/project/ProjectRepository").ImportProjectRepoInput,
    onProgress?: (percent: number) => void,
  ): Promise<{ fullName: string; gitRepoUrl: string; fileCount: number }> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("targetMode", input.targetMode);
      if (input.targetMode === "new") {
        form.append("name", input.name);
        form.append("privateRepo", String(input.privateRepo));
      } else {
        form.append("existingRepoFullName", input.existingRepoFullName);
      }
      form.append("archive", input.archive);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/projects/${projectId}/repo/import`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event): void => {
        if (event.lengthComputable)
          onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = (): void => {
        type Response = {
          fullName?: string;
          gitRepoUrl?: string;
          fileCount?: number;
          error?: string;
          message?: string;
          details?: unknown;
        };
        let data: Response | null = null;
        try {
          data = xhr.responseText
            ? (JSON.parse(xhr.responseText) as Response)
            : null;
        } catch {
          // nginx может вернуть HTML — ниже покажем стабильную ошибку.
        }
        if (
          xhr.status < 200 ||
          xhr.status >= 300 ||
          !data?.fullName ||
          !data.gitRepoUrl ||
          data.fileCount === undefined
        ) {
          reject(
            new HttpError(xhr.status, {
              error: data?.error ?? "project_import_failed",
              message: data?.message ?? `Ошибка импорта (HTTP ${xhr.status})`,
              details: data?.details,
            }),
          );
          return;
        }
        resolve({
          fullName: data.fullName,
          gitRepoUrl: data.gitRepoUrl,
          fileCount: data.fileCount,
        });
      };
      xhr.onerror = (): void =>
        reject(new Error("Сетевая ошибка при импорте проекта"));
      xhr.send(form);
    });
  }

  async analyzeRepoImport(
    projectId: string,
    archive: File,
  ): Promise<
    import("@/application/project/ProjectRepository").ProjectImportAnalysis
  > {
    const form = new FormData();
    form.append("archive", archive);
    const response = await fetch(
      `/api/projects/${projectId}/repo/import/analyze`,
      {
        method: "POST",
        credentials: "include",
        body: form,
      },
    );
    type ErrorResponse = {
      error?: string;
      message?: string;
      details?: unknown;
    };
    if (!response.ok) {
      let body: ErrorResponse = {};
      try {
        body = (await response.json()) as ErrorResponse;
      } catch {
        /* nginx/html fallback */
      }
      throw new HttpError(response.status, {
        error: body.error ?? "project_import_analysis_failed",
        message:
          body.message ?? `Ошибка анализа архива (HTTP ${response.status})`,
        details: body.details,
      });
    }
    return response.json() as Promise<
      import("@/application/project/ProjectRepository").ProjectImportAnalysis
    >;
  }
}

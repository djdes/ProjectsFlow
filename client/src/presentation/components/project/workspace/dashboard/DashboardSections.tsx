import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  Check,
  CircleDashed,
  Clock,
  Copy,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Github,
  Globe2,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  UserPlus,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useContainer } from "@/infrastructure/di/container";
import {
  publicBoardDisplayUrl,
  publicBoardUrl,
  siteResultDisplayUrl,
  siteResultUrl,
} from "@/lib/publicBoardUrl";
import { emitPublishChanged } from "@/presentation/lib/publishEvents";
import { cn } from "@/lib/utils";
import type { Project } from "@/domain/project/Project";
import type {
  ProjectMember,
  ProjectRole,
} from "@/domain/project/ProjectMembership";
import type { ProjectAnalytics } from "@/domain/project/ProjectAnalytics";
import type { AutomationConfig } from "@/domain/automation/AutomationConfig";
import {
  WORKFLOW_PRIORITIES,
  WORKFLOW_TASK_STATUSES,
  WORKFLOW_WEBHOOK_EVENTS,
  type CreateWorkflowInput,
  type WorkflowAction,
  type WorkflowPriority,
  type WorkflowRule,
  type WorkflowTaskStatus,
  type WorkflowTrigger,
  type WorkflowWebhookEvent,
} from "@/application/automation/WorkflowRepository";
import { Input } from "@/components/ui/input";
import type {
  AppBackendDashboard,
  AppDashboardSettings,
  AppRuntimeUser,
  AppSecurityScan,
  AppTraffic,
  DispatcherCandidate,
  GoogleAuthProviderStatus,
  ProjectSite,
  ProjectWorkerOverview,
  ProjectWorkerRun,
} from "@/application/project/ProjectRepository";
import {
  buildProjectApiMarkdown,
  buildProjectOpenApi,
  formatDashboardBytes,
  normalizeCustomDomain,
} from "./dashboardConfig";
import { RepositoryCodeEditor } from "./RepositoryCodeEditor";
import { DeleteProjectDialog } from "@/presentation/components/project/DeleteProjectDialog";
import { ProjectIconPicker } from "@/presentation/components/project/ProjectIconPicker";

export type DashboardContentProps = {
  readonly project: Project;
  readonly dashboard: AppBackendDashboard;
  readonly site: ProjectSite | null;
  readonly analytics: ProjectAnalytics | null;
  readonly dashboardSettings: AppDashboardSettings;
  readonly members: readonly ProjectMember[];
  readonly canEdit: boolean;
  readonly onOpenPreview: () => void;
  readonly onOpenAutomation: () => void;
  readonly onProjectUpdated: (project: Project) => void;
  readonly onDashboardSettingsUpdated: (settings: AppDashboardSettings) => void;
  readonly onRefresh: () => void;
  readonly onToggleFavorite: (favorite: boolean) => Promise<void>;
};

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </header>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "muted";
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-1 text-xs font-medium",
        tone === "ok" &&
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "warn" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function NotConnected({
  title,
  description,
}: {
  title: string;
  description: string;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-dashed bg-muted/10 p-5">
      <div className="flex items-start gap-3">
        <CircleDashed className="mt-0.5 size-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

export function OverviewSection({
  project,
  dashboard,
  site,
  members,
  canEdit,
  onOpenPreview,
  onProjectUpdated,
  onToggleFavorite,
}: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(project.description ?? "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const isOwner = project.role === "owner";
  const deployed = Boolean(site?.siteSlug && site.deployedAt);
  const url = site?.siteSlug ? siteResultUrl(site.siteSlug) : null;
  const usagePercent =
    dashboard.storageLimitBytes > 0
      ? Math.min(
          100,
          (dashboard.usageBytes / dashboard.storageLimitBytes) * 100,
        )
      : 0;
  useEffect(() => {
    if (!editingDescription) setDescriptionDraft(project.description ?? "");
  }, [editingDescription, project.description]);

  const saveDescription = async (): Promise<void> => {
    if (!canEdit || profileBusy) return;
    setProfileBusy(true);
    try {
      const updated = await projectRepository.update(project.id, {
        description: descriptionDraft.trim() || null,
      });
      onProjectUpdated(updated);
      setEditingDescription(false);
      toast.success("Описание сохранено");
    } catch {
      toast.error("Не удалось сохранить описание");
    } finally {
      setProfileBusy(false);
    }
  };

  const toggleFavorite = async (): Promise<void> => {
    if (favoriteBusy) return;
    setFavoriteBusy(true);
    try {
      await onToggleFavorite(!project.isFavorite);
      toast.success(project.isFavorite ? "Убрано из избранного" : "Добавлено в избранное");
    } catch {
      toast.error("Не удалось изменить избранное");
    } finally {
      setFavoriteBusy(false);
    }
  };
  const copy = async (): Promise<void> => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Браузер не разрешил скопировать ссылку");
    }
  };
  // Публикация проекта — тот же путь, что и в окне «Поделиться» (ProjectPublishTab):
  // projectRepository.publish/unpublish + emitPublishChanged. Второй путь не заводим.
  const publish = async (): Promise<void> => {
    if (!isOwner || publishBusy) return;
    setPublishBusy(true);
    try {
      const { slug } = await projectRepository.publish(project.id);
      onProjectUpdated({ ...project, isPublic: true, publicSlug: slug });
      emitPublishChanged({
        projectId: project.id,
        isPublic: true,
        publicSlug: slug,
        publicIndexing: project.publicIndexing,
      });
      toast.success("Проект опубликован");
    } catch {
      toast.error("Не удалось опубликовать");
    } finally {
      setPublishBusy(false);
    }
  };
  const unpublish = async (): Promise<void> => {
    if (!isOwner || publishBusy) return;
    setPublishBusy(true);
    try {
      await projectRepository.unpublish(project.id);
      onProjectUpdated({ ...project, isPublic: false });
      emitPublishChanged({
        projectId: project.id,
        isPublic: false,
        publicSlug: project.publicSlug,
        publicIndexing: project.publicIndexing,
      });
      toast.success("Публикация снята");
    } catch {
      toast.error("Не удалось снять с публикации");
    } finally {
      setPublishBusy(false);
    }
  };
  const copyBoardLink = async (): Promise<void> => {
    if (!project.publicSlug) return;
    try {
      await navigator.clipboard.writeText(publicBoardUrl(project.publicSlug));
      toast.success("Ссылка доски скопирована");
    } catch {
      toast.error("Браузер не разрешил скопировать ссылку");
    }
  };
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-4">
        <span className="grid size-16 shrink-0 place-items-center rounded-2xl border bg-muted/25">
          <ProjectIconPicker
            projectId={project.id}
            icon={project.icon}
            big
            disabled={!canEdit}
            onChanged={(icon) => onProjectUpdated({ ...project, icon })}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-2xl font-semibold">{project.name}</h2>
            {canEdit && !editingDescription && (
              <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Редактировать описание" onClick={() => setEditingDescription(true)}>
                <Pencil className="size-4" />
              </button>
            )}
          </div>
          {editingDescription ? (
            <div className="mt-2 flex max-w-2xl items-start gap-2">
              <textarea
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value.slice(0, 500))}
                rows={3}
                autoFocus
                placeholder="Коротко опишите приложение…"
                className="min-h-20 flex-1 resize-y rounded-lg border bg-background px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring/25"
              />
              <div className="flex shrink-0 flex-col gap-1">
                <Button type="button" size="icon" className="size-8" aria-label="Сохранить описание" disabled={profileBusy} onClick={() => void saveDescription()}>
                  {profileBusy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Отменить" disabled={profileBusy} onClick={() => { setDescriptionDraft(project.description ?? ""); setEditingDescription(false); }}>
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {project.description || "Результат проекта, пользователи и данные приложения в одном месте."}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Создан{" "}
            {new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(
              project.createdAt,
            )}
          </p>
          {project.isPublic && project.publicSlug && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusPill tone="ok">Опубликован</StatusPill>
              <a
                href={publicBoardUrl(project.publicSlug)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1 truncate text-xs text-primary hover:underline"
              >
                <span className="truncate">
                  {publicBoardDisplayUrl(project.publicSlug)}
                </span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
              <button
                type="button"
                onClick={() => void copyBoardLink()}
                aria-label="Скопировать ссылку доски"
                className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Copy className="size-3.5" />
              </button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isOwner &&
            (project.isPublic ? (
              <Button
                variant="outline"
                size="sm"
                disabled={publishBusy}
                onClick={() => void unpublish()}
              >
                {publishBusy && (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                )}
                Снять с публикации
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={publishBusy}
                onClick={() => void publish()}
              >
                {publishBusy ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Globe2 className="mr-1.5 size-4" />
                )}
                Опубликовать
              </Button>
            ))}
          <Button
            variant="ghost"
            size="icon"
            disabled={favoriteBusy}
            onClick={() => void toggleFavorite()}
            aria-label={project.isFavorite ? "Убрать из избранного" : "Добавить в избранное"}
            className={project.isFavorite ? "text-amber-500 hover:text-amber-600" : undefined}
          >
            <Star className={cn("size-5", project.isFavorite && "fill-current")} />
          </Button>
        </div>
      </header>
      <div className="grid gap-3 lg:grid-cols-3">
        <section className="rounded-xl border p-4 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Результат проекта</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Опубликованный сайт воркера
              </p>
            </div>
            <StatusPill tone={deployed ? "ok" : "warn"}>
              {deployed ? "Опубликован" : "Ожидает запуска"}
            </StatusPill>
          </div>
          {url ? (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate rounded-lg bg-muted/45 px-3 py-2 text-sm">
                {siteResultDisplayUrl(site!.siteSlug!)}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void copy()}
                aria-label="Скопировать адрес"
              >
                <Copy className="size-4" />
              </Button>
              {deployed && (
                <Button size="sm" onClick={onOpenPreview}>
                  Открыть Preview
                </Button>
              )}
              <Button asChild variant="outline" size="icon">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Открыть результат отдельно"
                >
                  <ExternalLink className="size-4" />
                </a>
              </Button>
            </div>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">
              Адрес появится после настройки проекта.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span>{site?.fileCount ?? 0} файлов</span>
            <span>{site?.routes.length ?? 0} маршрутов</span>
            <span>
              {site?.deployedAt
                ? `Обновлено ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(site.deployedAt))}`
                : "Ещё не публиковался"}
            </span>
          </div>
        </section>
        <section className="rounded-xl border p-4">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Доступ</p>
          </div>
          <p className="mt-4 text-2xl font-semibold">{members.length}</p>
          <p className="text-xs text-muted-foreground">участников проекта</p>
          <button
            type="button"
            className="mt-4 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("pf:open-project-share", {
                  detail: { projectId: project.id },
                }),
              )
            }
          >
            Управлять доступом
          </button>
        </section>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Database className="size-4 text-muted-foreground" />
                <p className="text-sm font-semibold">База приложения</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {dashboard.status === "active"
                  ? `${dashboard.schema?.tables.length ?? 0} таблиц`
                  : "Не подключена"}
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              {formatDashboardBytes(dashboard.usageBytes)} /{" "}
              {formatDashboardBytes(dashboard.storageLimitBytes)}
            </span>
          </div>
          <div
            className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Использование хранилища"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(usagePercent)}
          >
            <span
              className="block h-full rounded-full bg-primary motion-safe:transition-[width]"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          {dashboard.schema && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {dashboard.schema.tables.slice(0, 8).map((table) => (
                <span
                  key={table.name}
                  className="rounded-md bg-muted/60 px-2 py-1 text-xs"
                >
                  {table.name}
                </span>
              ))}
            </div>
          )}
        </section>
        <section className="rounded-xl border p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Автоматические проверки</p>
          </div>
          <div className="mt-4 space-y-2.5">
            <HealthRow
              ok={Boolean(url?.startsWith("https://"))}
              label="HTTPS-адрес результата"
            />
            <HealthRow
              ok={Boolean(site?.siteSlug)}
              label="Изолированный поддомен проекта"
            />
            <HealthRow
              ok={deployed}
              label="Опубликованный артефакт"
              hint={
                site?.deployedAt
                  ? `${site.fileCount} файлов · ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(site.deployedAt))}`
                  : undefined
              }
            />
            <HealthRow
              ok={dashboard.status === "active"}
              label="Управляемая база данных"
              optional
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function HealthRow({
  ok,
  label,
  optional = false,
  hint,
}: {
  ok: boolean;
  label: string;
  optional?: boolean;
  hint?: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2 text-sm">
      <CheckCircle2
        className={cn(
          "size-4",
          ok ? "text-emerald-500" : "text-muted-foreground/40",
        )}
      />
      <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
      {hint ? (
        <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
          {hint}
        </span>
      ) : (
        optional &&
        !ok && (
          <span className="ml-auto text-xs text-muted-foreground">
            необязательно
          </span>
        )
      )}
    </div>
  );
}

export function UsersSection({
  project,
  members,
  canEdit,
}: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const [tab, setTab] = useState<"runtime" | "team">("runtime");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<ProjectRole | "">("");
  const [runtimeUsers, setRuntimeUsers] = useState<readonly AppRuntimeUser[]>(
    [],
  );
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(
    null,
  );

  const loadRuntimeUsers = async (): Promise<void> => {
    setRuntimeLoading(true);
    setRuntimeError(null);
    try {
      setRuntimeUsers(await projectRepository.listAppRuntimeUsers(project.id));
    } catch (error) {
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "Не удалось загрузить пользователей приложения",
      );
    } finally {
      setRuntimeLoading(false);
    }
  };

  useEffect(() => {
    void loadRuntimeUsers();
  }, [project.id]);

  const filteredMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          (!role || member.role === role) &&
          (!search.trim() ||
            `${member.user.displayName} ${member.user.email}`
              .toLowerCase()
              .includes(search.trim().toLowerCase())),
      ),
    [members, role, search],
  );
  const filteredRuntimeUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? runtimeUsers.filter((user) => user.email.toLowerCase().includes(query))
      : runtimeUsers;
  }, [runtimeUsers, search]);

  const revokeSessions = async (user: AppRuntimeUser): Promise<void> => {
    setBusyUserId(user.id);
    try {
      const revoked = await projectRepository.revokeAppRuntimeUserSessions(
        project.id,
        user.id,
      );
      toast.success(
        revoked ? `Сессии завершены: ${revoked}` : "Активных сессий нет",
      );
      await loadRuntimeUsers();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось завершить сессии",
      );
    } finally {
      setBusyUserId(null);
    }
  };

  const deleteRuntimeUser = async (user: AppRuntimeUser): Promise<void> => {
    if (deleteConfirmation !== user.id) {
      setDeleteConfirmation(user.id);
      return;
    }
    setBusyUserId(user.id);
    try {
      await projectRepository.deleteAppRuntimeUser(project.id, user.id);
      setRuntimeUsers((current) =>
        current.filter((candidate) => candidate.id !== user.id),
      );
      setDeleteConfirmation(null);
      toast.success("Пользователь приложения удалён");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось удалить пользователя",
      );
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Пользователи"
        description="Аккаунты опубликованного приложения, активные сессии и команда проекта — без смешивания двух разных систем доступа."
        action={
          tab === "runtime" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadRuntimeUsers()}
              disabled={runtimeLoading}
            >
              <RefreshCw
                className={cn(
                  "mr-1.5 size-3.5",
                  runtimeLoading && "animate-spin",
                )}
              />
              Обновить
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("pf:open-project-share", {
                    detail: { projectId: project.id },
                  }),
                )
              }
            >
              <UserPlus className="size-3.5" />
              Пригласить
            </Button>
          )
        }
      />
      <div className="overflow-hidden rounded-xl border">
        <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
          <div
            className="inline-flex rounded-lg bg-muted/50 p-0.5"
            role="tablist"
            aria-label="Тип пользователей"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "runtime"}
              onClick={() => {
                setTab("runtime");
                setRole("");
              }}
              className={cn(
                "h-9 rounded-md px-3 text-sm",
                tab === "runtime" && "bg-background shadow-sm",
              )}
            >
              Пользователи приложения ({runtimeUsers.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "team"}
              onClick={() => setTab("team")}
              className={cn(
                "h-9 rounded-md px-3 text-sm",
                tab === "team" && "bg-background shadow-sm",
              )}
            >
              Команда ({members.length})
            </button>
          </div>
          <label className="ml-auto flex h-9 min-w-[220px] items-center gap-2 rounded-md border px-2.5">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              placeholder={
                tab === "runtime" ? "Email пользователя…" : "Имя или email…"
              }
              aria-label="Поиск пользователей"
            />
          </label>
          {tab === "team" && (
            <select
              aria-label="Фильтр роли"
              value={role}
              onChange={(event) =>
                setRole(event.target.value as ProjectRole | "")
              }
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Все роли</option>
              <option value="owner">Владелец</option>
              <option value="editor">Редактор</option>
              <option value="viewer">Наблюдатель</option>
            </select>
          )}
        </div>
        <div className="divide-y">
          {tab === "runtime" ? (
            runtimeLoading ? (
              <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Загружаем пользователей приложения…
                </span>
              </div>
            ) : runtimeError ? (
              <div className="grid min-h-64 place-items-center gap-3 px-5 text-center text-sm text-muted-foreground">
                <div>
                  <AlertTriangle className="mx-auto mb-2 size-5 text-amber-500" />
                  <p>{runtimeError}</p>
                  <Button
                    className="mt-3"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadRuntimeUsers()}
                  >
                    Повторить
                  </Button>
                </div>
              </div>
            ) : filteredRuntimeUsers.length === 0 ? (
              <div className="grid min-h-64 place-items-center px-5 text-center text-sm text-muted-foreground">
                <div>
                  <Users className="mx-auto mb-2 size-6 opacity-50" />
                  <p>
                    {runtimeUsers.length
                      ? "Пользователи не найдены."
                      : "В опубликованном приложении пока никто не зарегистрировался."}
                  </p>
                </div>
              </div>
            ) : (
              filteredRuntimeUsers.map((user) => (
                <div
                  key={user.id}
                  className="grid min-h-16 grid-cols-[40px_minmax(180px,1fr)_160px_130px_auto] items-center gap-3 px-3 text-sm max-lg:grid-cols-[40px_minmax(150px,1fr)_100px_auto]"
                >
                  <span className="grid size-8 place-items-center rounded-full bg-primary/10 font-semibold text-primary">
                    {user.email.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{user.email}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      ID: {user.id}
                    </p>
                  </div>
                  <span className="text-muted-foreground max-lg:hidden">
                    {new Intl.DateTimeFormat("ru-RU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(user.createdAt))}
                  </span>
                  <span className="text-muted-foreground">
                    Сессий: {user.activeSessions}
                  </span>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={
                        !canEdit ||
                        busyUserId === user.id ||
                        !user.activeSessions
                      }
                      onClick={() => void revokeSessions(user)}
                    >
                      Завершить сессии
                    </Button>
                    <Button
                      variant={
                        deleteConfirmation === user.id ? "destructive" : "ghost"
                      }
                      size="sm"
                      disabled={!canEdit || busyUserId === user.id}
                      onBlur={() =>
                        setDeleteConfirmation((current) =>
                          current === user.id ? null : current,
                        )
                      }
                      onClick={() => void deleteRuntimeUser(user)}
                    >
                      {busyUserId === user.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : deleteConfirmation === user.id ? (
                        "Подтвердить"
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              ))
            )
          ) : filteredMembers.length === 0 ? (
            <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">
              Участники не найдены.
            </div>
          ) : (
            filteredMembers.map((member) => (
              <div
                key={member.userId}
                className="grid min-h-16 grid-cols-[40px_minmax(130px,1fr)_minmax(130px,1fr)_110px] items-center gap-3 px-3 text-sm max-sm:grid-cols-[40px_1fr_auto]"
              >
                <span className="grid size-8 place-items-center overflow-hidden rounded-full bg-muted font-medium">
                  {member.user.avatarUrl ? (
                    <img
                      src={member.user.avatarUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    member.user.displayName.slice(0, 1).toUpperCase()
                  )}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {member.user.displayName}
                  </p>
                  {member.userId === project.ownerId && (
                    <p className="text-xs text-muted-foreground">
                      Создатель проекта
                    </p>
                  )}
                </div>
                <span className="truncate text-muted-foreground max-sm:hidden">
                  {member.user.email}
                </span>
                <span className="w-fit rounded-full bg-muted/60 px-2 py-1 text-xs">
                  {member.role === "owner"
                    ? "Владелец"
                    : member.role === "editor"
                      ? "Редактор"
                      : "Наблюдатель"}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const APP_TRAFFIC_CLASS_LABELS: Record<
  "desktop" | "mobile" | "bot" | "other",
  string
> = {
  desktop: "Компьютеры",
  mobile: "Телефоны",
  bot: "Боты",
  other: "Другое",
};

// Аналитика раздваивается: «Приложение» — обезличенный трафик опубликованного сайта (db/137,
// без IP/raw UA), «Карточка проекта» — внутренние просмотры страницы проекта в ProjectsFlow.
export function AnalyticsSection({
  project,
  analytics,
  dashboard,
  site,
  members,
}: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const [scope, setScope] = useState<"app" | "project">("app");
  const published = Boolean(site?.deployedAt);
  const [traffic, setTraffic] = useState<AppTraffic | null>(null);
  const [trafficState, setTrafficState] = useState<
    "idle" | "loading" | "error"
  >("idle");

  useEffect(() => {
    if (scope !== "app" || !published) return;
    let cancelled = false;
    setTrafficState("loading");
    void projectRepository
      .getAppTraffic(project.id, 28)
      .then((next) => {
        if (cancelled) return;
        setTraffic(next);
        setTrafficState("idle");
      })
      .catch(() => {
        if (!cancelled) setTrafficState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [scope, published, project.id, projectRepository]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Аналитика"
        description="Трафик опубликованного приложения и внутренние просмотры карточки проекта."
        action={
          <div className="inline-flex rounded-lg border p-0.5">
            {(
              [
                ["app", "Приложение"],
                ["project", "Карточка проекта"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  scope === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />
      {scope === "app" ? (
        <AppTrafficView
          published={published}
          traffic={traffic}
          state={trafficState}
          routes={site?.routes.length ?? 0}
        />
      ) : (
        <ProjectCardAnalyticsView
          analytics={analytics}
          dashboard={dashboard}
          site={site}
          members={members}
        />
      )}
    </div>
  );
}

// Трафик опубликованного приложения. Только агрегаты (визиты/сессии по дням + грубые корзины
// клиента) — никаких «топ путей»/фасетов по данным приложения (раздел 4 плана).
function AppTrafficView({
  published,
  traffic,
  state,
  routes,
}: {
  published: boolean;
  traffic: AppTraffic | null;
  state: "idle" | "loading" | "error";
  routes: number;
}): React.ReactElement {
  if (!published) {
    return (
      <div className="grid min-h-64 place-items-center rounded-xl border border-dashed bg-muted/10 px-6 text-center">
        <div>
          <Globe2 className="mx-auto mb-3 size-7 text-muted-foreground opacity-60" />
          <p className="text-sm font-medium">Приложение ещё не опубликовано</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Как только вы опубликуете сайт, здесь появится обезличенный трафик:
            визиты, уникальные сессии и типы устройств. Мы не храним IP и
            User-Agent.
          </p>
        </div>
      </div>
    );
  }
  if (state === "loading" && !traffic) {
    return (
      <div className="grid min-h-64 place-items-center rounded-xl border text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="grid min-h-64 place-items-center rounded-xl border text-sm text-muted-foreground">
        Не удалось загрузить трафик приложения.
      </div>
    );
  }
  const perDay = traffic?.perDay ?? [];
  const dailyMax = Math.max(1, ...perDay.map((day) => day.visits), 0);
  const metrics = [
    { label: "Визиты", value: traffic?.totalVisits ?? 0 },
    { label: "Уникальные сессии", value: traffic?.totalSessions ?? 0 },
    { label: "Маршрутов сайта", value: routes },
    { label: "Окно, дней", value: traffic?.windowDays ?? 28 },
  ];
  const classes = (["desktop", "mobile", "bot", "other"] as const).map(
    (cls) => ({
      cls,
      label: APP_TRAFFIC_CLASS_LABELS[cls],
      value: traffic?.byClass[cls] ?? 0,
    }),
  );
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <section key={metric.label} className="rounded-xl border p-4">
            <p className="text-xs font-medium text-muted-foreground">
              {metric.label}
            </p>
            <p className="mt-3 text-2xl font-semibold">{metric.value}</p>
          </section>
        ))}
      </div>
      <section className="rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Визиты по дням</h3>
        </div>
        {perDay.length ? (
          <div
            className="mt-5 flex h-44 items-end gap-1 overflow-x-auto"
            aria-label="График визитов приложения"
          >
            {perDay.map((day) => (
              <div
                key={day.date}
                className="group flex min-w-3 flex-1 flex-col items-center justify-end gap-1"
                title={`${day.date}: ${day.visits} визитов, ${day.sessions} сессий`}
              >
                <span
                  className="w-full rounded-t bg-primary/75 transition-colors group-hover:bg-primary"
                  style={{
                    height: `${Math.max(day.visits ? 6 : 2, (day.visits / dailyMax) * 132)}px`,
                  }}
                />
                <span className="hidden text-[9px] text-muted-foreground xl:block">
                  {day.date.slice(5)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 grid min-h-28 place-items-center text-sm text-muted-foreground">
            За выбранный период визитов не было.
          </div>
        )}
      </section>
      <section className="rounded-xl border p-4">
        <h3 className="text-sm font-semibold">Типы клиентов</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {classes.map((item) => (
            <div key={item.cls} className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {item.value}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Обезличенная статистика: без IP и User-Agent, сессии считаются по
          посуточно ротируемому ключу.
        </p>
      </section>
    </>
  );
}

// Внутренние просмотры карточки проекта в ProjectsFlow (существующая метрика ProjectAnalytics).
function ProjectCardAnalyticsView({
  analytics,
  dashboard,
  site,
  members,
}: {
  analytics: DashboardContentProps["analytics"];
  dashboard: DashboardContentProps["dashboard"];
  site: DashboardContentProps["site"];
  members: DashboardContentProps["members"];
}): React.ReactElement {
  const tableCount = dashboard.schema?.tables.length ?? 0;
  const routes = site?.routes.length ?? 0;
  const dailyMax = Math.max(
    1,
    ...(analytics?.perDay.map((day) => day.count) ?? [0]),
  );
  const uniqueViewers = analytics?.viewers.length ?? 0;
  const metrics = [
    { label: "Просмотры", value: analytics?.totalViews ?? 0 },
    { label: "Зрители", value: uniqueViewers },
    { label: "Маршруты", value: routes },
    { label: "Таблицы", value: tableCount },
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <section key={metric.label} className="rounded-xl border p-4">
            <p className="text-xs font-medium text-muted-foreground">
              {metric.label}
            </p>
            <p className="mt-3 text-2xl font-semibold">{metric.value}</p>
          </section>
        ))}
      </div>
      <section className="rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Просмотры по дням</h3>
        </div>
        <div
          className="mt-5 flex h-44 items-end gap-1 overflow-x-auto"
          aria-label="График просмотров"
        >
          {analytics?.perDay.map((day) => (
            <div
              key={day.date}
              className="group flex min-w-3 flex-1 flex-col items-center justify-end gap-1"
              title={`${day.date}: ${day.count} просмотров, ${day.unique} зрителей`}
            >
              <span
                className="w-full rounded-t bg-primary/75 transition-colors group-hover:bg-primary"
                style={{
                  height: `${Math.max(day.count ? 6 : 2, (day.count / dailyMax) * 132)}px`,
                }}
              />
              <span className="hidden text-[9px] text-muted-foreground xl:block">
                {day.date.slice(5)}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="overflow-hidden rounded-xl border">
        <div className="border-b px-4 py-3 text-sm font-semibold">
          Последние зрители
        </div>
        {analytics?.viewers.length ? (
          <div className="divide-y">
            {analytics.viewers.slice(0, 8).map((viewer) => (
              <div
                key={viewer.userId}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className="grid size-8 place-items-center overflow-hidden rounded-full bg-muted text-xs font-semibold">
                  {viewer.avatarUrl ? (
                    <img
                      src={viewer.avatarUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    viewer.displayName.slice(0, 1).toUpperCase()
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {viewer.displayName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("ru-RU", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(viewer.lastViewedAt)}
                  </p>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {viewer.viewCount}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-h-28 place-items-center text-sm text-muted-foreground">
            За выбранный период просмотров не было.
          </div>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        В проекте {members.length} участников · опубликовано{" "}
        {site?.fileCount ?? 0} файлов.
      </p>
    </>
  );
}

export function MarketingSection({
  project,
  canEdit,
  dashboardSettings,
  onProjectUpdated,
  onDashboardSettingsUpdated,
}: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const [tab, setTab] = useState<"overview" | "meta" | "advanced" | "social">(
    "overview",
  );
  const [title, setTitle] = useState(
    dashboardSettings.seo.title || project.name,
  );
  const [description, setDescription] = useState(
    dashboardSettings.seo.description || project.description || "",
  );
  const [robotsIndex, setRobotsIndex] = useState(
    dashboardSettings.seo.robotsIndex,
  );
  const [canonicalUrl, setCanonicalUrl] = useState(
    dashboardSettings.seo.canonicalUrl,
  );
  const [structuredData, setStructuredData] = useState(
    dashboardSettings.seo.structuredData,
  );
  const [goal, setGoal] = useState(dashboardSettings.socialContent.goal);
  const [channels, setChannels] = useState<readonly string[]>(
    dashboardSettings.socialContent.channels,
  );
  const [generated, setGenerated] = useState<readonly string[]>(
    dashboardSettings.socialContent.generated,
  );
  const [saving, setSaving] = useState(false);
  const save = async (): Promise<void> => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const settings = await projectRepository.updateAppDashboardSettings(
        project.id,
        {
          seo: {
            title: title.trim(),
            description: description.trim(),
            robotsIndex,
            canonicalUrl: canonicalUrl.trim(),
            structuredData: structuredData.trim(),
          },
          socialContent: { goal: goal.trim(), channels, generated },
        },
      );
      let updated = project;
      if (project.description !== (description.trim() || null)) {
        updated = await projectRepository.update(project.id, {
          description: description.trim() || null,
        });
      }
      if (updated.isPublic && updated.publicIndexing !== robotsIndex) {
        await projectRepository.setPublicIndexing(project.id, robotsIndex);
        updated = { ...updated, publicIndexing: robotsIndex };
      }
      onDashboardSettingsUpdated(settings);
      onProjectUpdated(updated);
      toast.success("Данные публикации сохранены");
    } catch {
      toast.error("Не удалось сохранить данные публикации");
    } finally {
      setSaving(false);
    }
  };
  const generateSocial = async (): Promise<void> => {
    const subject = title.trim() || project.name;
    const details =
      description.trim() ||
      `Откройте ${subject} и попробуйте возможности приложения.`;
    const selectedChannels = channels.length ? channels : ["Telegram"];
    const next = selectedChannels.map((channel) => {
      if (channel === "Telegram")
        return `🚀 ${subject}\n\n${details}\n\n${goal.trim() || "Посмотрите приложение и поделитесь впечатлениями."}`;
      if (channel === "LinkedIn")
        return `${subject}: ${details} ${goal.trim() || "Будем рады обратной связи от профессионального сообщества."}`;
      if (channel === "VK")
        return `${subject}\n${details}\n${goal.trim() || "Переходите и оцените новую версию."}`;
      return `${subject} — ${details}`;
    });
    setGenerated(next);
    setSaving(true);
    try {
      const settings = await projectRepository.updateAppDashboardSettings(
        project.id,
        {
          socialContent: {
            goal: goal.trim(),
            channels: selectedChannels,
            generated: next,
          },
        },
      );
      setChannels(selectedChannels);
      onDashboardSettingsUpdated(settings);
      toast.success("Контент-план создан и сохранён");
    } catch {
      toast.error("Не удалось сохранить контент-план");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-5">
      <SectionHeader
        title="SEO и маркетинг"
        description="Поисковое представление, расширенная разметка и готовый контент-план для публикации."
        action={
          <Button
            size="sm"
            disabled={!canEdit || saving || !title.trim()}
            onClick={() => void save()}
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Сохранить
          </Button>
        }
      />
      <div
        className="inline-flex flex-wrap rounded-lg bg-muted/50 p-0.5"
        role="tablist"
        aria-label="SEO"
      >
        {(
          [
            ["overview", "Обзор"],
            ["meta", "Meta tags"],
            ["advanced", "Advanced"],
            ["social", "Соцсети"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "h-9 rounded-md px-3 text-sm",
              tab === id && "bg-background shadow-sm",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="rounded-xl border p-4">
            <Sparkles className="size-5 text-primary" />
            <h3 className="mt-4 font-medium">Поисковое представление</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Отдельные метаданные приложения, канонический адрес, JSON-LD и
              управление индексацией.
            </p>
          </section>
          <section className="rounded-xl border bg-muted/15 p-4">
            <p className="truncate text-lg text-blue-700 dark:text-blue-300">
              {title || project.name}
            </p>
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
              {canonicalUrl ||
                `projectsflow.ru › p › ${project.publicSlug ?? "preview"}`}
            </p>
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
              {description || "Описание пока не задано."}
            </p>
          </section>
        </div>
      )}
      {tab === "meta" && (
        <div className="max-w-2xl space-y-4 rounded-xl border p-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Title</span>
            <input
              value={title}
              maxLength={70}
              onChange={(event) => setTitle(event.target.value)}
              disabled={!canEdit}
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
            />
            <span className="text-xs text-muted-foreground">
              {title.length}/70
            </span>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Description</span>
            <textarea
              value={description}
              maxLength={180}
              onChange={(event) => setDescription(event.target.value)}
              disabled={!canEdit}
              rows={4}
              className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <span className="text-xs text-muted-foreground">
              {description.length}/180
            </span>
          </label>
        </div>
      )}
      {tab === "advanced" && (
        <div className="max-w-3xl space-y-4 rounded-xl border p-4">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">
                Разрешить индексацию
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Поисковики увидят настройку после публикации проекта.
              </span>
              {!project.isPublic && (
                <span className="mt-1 block text-xs text-amber-600">
                  Проект пока не опубликован.
                </span>
              )}
            </span>
            <input
              type="checkbox"
              checked={robotsIndex}
              onChange={(event) => setRobotsIndex(event.target.checked)}
              disabled={!canEdit}
              className="mt-1 size-4"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Canonical URL</span>
            <input
              value={canonicalUrl}
              onChange={(event) => setCanonicalUrl(event.target.value)}
              placeholder="https://example.com/page"
              disabled={!canEdit}
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">JSON-LD</span>
            <textarea
              value={structuredData}
              onChange={(event) => setStructuredData(event.target.value)}
              placeholder={'{\n  "@context": "https://schema.org"\n}'}
              disabled={!canEdit}
              rows={9}
              className="w-full resize-y rounded-lg border bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100"
            />
            <span className="text-xs text-muted-foreground">
              Перед сохранением JSON проверяется сервером.
            </span>
          </label>
        </div>
      )}
      {tab === "social" && (
        <div className="space-y-4">
          <section className="max-w-3xl space-y-4 rounded-xl border p-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Цель публикации</span>
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                rows={3}
                placeholder="Например: рассказать о запуске и получить первые отзывы"
                disabled={!canEdit}
                className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </label>
            <fieldset>
              <legend className="text-sm font-medium">Каналы</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {["Telegram", "VK", "LinkedIn"].map((channel) => (
                  <label
                    key={channel}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={channels.includes(channel)}
                      onChange={(event) =>
                        setChannels(
                          event.target.checked
                            ? [...channels, channel]
                            : channels.filter((item) => item !== channel),
                        )
                      }
                      disabled={!canEdit}
                    />
                    {channel}
                  </label>
                ))}
              </div>
            </fieldset>
            <Button
              onClick={() => void generateSocial()}
              disabled={!canEdit || saving}
            >
              <Sparkles className="mr-1.5 size-4" />
              Создать контент-план
            </Button>
          </section>
          {generated.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              {generated.map((post, index) => (
                <article
                  key={`${index}-${post.slice(0, 12)}`}
                  className="rounded-xl border p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {channels[index] ?? `Публикация ${index + 1}`}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(post)
                          .then(() => toast.success("Текст скопирован"))
                      }
                      aria-label="Скопировать публикацию"
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                    {post}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DomainsSection({
  project,
  site,
  canEdit,
  dashboardSettings,
  onDashboardSettingsUpdated,
}: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const builtIn = site?.siteSlug ? siteResultDisplayUrl(site.siteSlug) : null;
  const [hostname, setHostname] = useState(
    dashboardSettings.customDomain.hostname ?? "",
  );
  const [saving, setSaving] = useState(false);
  const copy = async (): Promise<void> => {
    if (!site?.siteSlug) return;
    await navigator.clipboard.writeText(siteResultUrl(site.siteSlug));
    toast.success("Адрес скопирован");
  };
  const custom = normalizeCustomDomain(hostname);
  const saveCustomDomain = async (): Promise<void> => {
    if (hostname.trim() && !custom) {
      toast.error("Введите домен вида app.example.com");
      return;
    }
    setSaving(true);
    try {
      const next = await projectRepository.updateAppDashboardSettings(
        project.id,
        { customDomain: { hostname: custom } },
      );
      onDashboardSettingsUpdated(next);
      setHostname(next.customDomain.hostname ?? "");
      toast.success(
        custom
          ? "Домен отправлен на проверку"
          : "Пользовательский домен удалён",
      );
    } catch {
      toast.error("Не удалось сохранить домен");
    } finally {
      setSaving(false);
    }
  };
  const verify = async (): Promise<void> => {
    setSaving(true);
    try {
      const next = await projectRepository.verifyAppCustomDomain(project.id);
      onDashboardSettingsUpdated(next);
      toast[next.customDomain.status === "verified" ? "success" : "error"](
        next.customDomain.status === "verified"
          ? "CNAME подтверждён"
          : (next.customDomain.error ?? "CNAME пока не подтверждён"),
      );
    } catch {
      toast.error("Не удалось проверить DNS");
    } finally {
      setSaving(false);
    }
  };
  const domainState = dashboardSettings.customDomain.status;
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Домены"
        description="Встроенный адрес работает сразу; пользовательский домен проверяется по реальной DNS-записи CNAME."
      />
      <section className="rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <Globe2 className="size-5" />
            </span>
            <div>
              <p className="text-sm font-medium">Встроенный URL</p>
              <p className="mt-1 break-all text-sm text-muted-foreground">
                {builtIn ?? "Появится после подготовки результата"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                HTTPS и поддомен выдаются автоматически.
              </p>
            </div>
          </div>
          {builtIn && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                <Copy className="mr-1.5 size-3.5" />
                Копировать
              </Button>
              <Button asChild size="sm">
                <a
                  href={siteResultUrl(site!.siteSlug!)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-1.5 size-3.5" />
                  Открыть
                </a>
              </Button>
            </div>
          )}
        </div>
      </section>
      <section className="max-w-3xl rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Пользовательский домен</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Добавьте CNAME на{" "}
              <code className="rounded bg-muted px-1">
                {site?.siteSlug ?? "project"}.projectsflow.ru
              </code>
              , затем нажмите «Проверить DNS».
            </p>
          </div>
          {domainState !== "none" && (
            <StatusPill tone={domainState === "verified" ? "ok" : "warn"}>
              {domainState === "verified"
                ? "Подтверждён"
                : domainState === "error"
                  ? "Нужна настройка"
                  : "Ожидает DNS"}
            </StatusPill>
          )}
        </div>
        <label className="mt-4 block">
          <span className="sr-only">Пользовательский домен</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              placeholder="app.example.com"
              disabled={!canEdit || saving}
              className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm"
            />
            <Button
              onClick={() => void saveCustomDomain()}
              disabled={!canEdit || saving}
            >
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Сохранить
            </Button>
            {dashboardSettings.customDomain.hostname && (
              <Button
                variant="outline"
                onClick={() => void verify()}
                disabled={!canEdit || saving}
              >
                <RefreshCw className="mr-1.5 size-4" />
                Проверить DNS
              </Button>
            )}
          </div>
        </label>
        {dashboardSettings.customDomain.error && (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
            {dashboardSettings.customDomain.error}
          </p>
        )}
        {dashboardSettings.customDomain.lastCheckedAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            Последняя проверка:{" "}
            {new Intl.DateTimeFormat("ru-RU", {
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(dashboardSettings.customDomain.lastCheckedAt))}
          </p>
        )}
      </section>
    </div>
  );
}

export function IntegrationsSection({
  project,
  dashboard,
  site,
  canEdit,
  dashboardSettings,
  onOpenPreview,
  onDashboardSettingsUpdated,
}: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const [saving, setSaving] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState(
    dashboardSettings.integrations.webhookUrl,
  );
  const [emailSender, setEmailSender] = useState(
    dashboardSettings.integrations.emailSender,
  );
  const [oauthIssuer, setOauthIssuer] = useState(
    dashboardSettings.integrations.oauthIssuer,
  );
  const integrations = [
    {
      id: "github",
      name: "GitHub",
      description: project.gitRepoUrl ?? "Репозиторий проекта не подключён.",
      icon: Github,
      connected: Boolean(project.gitRepoUrl),
      href: project.gitRepoUrl,
    },
    {
      id: "kb",
      name: "База знаний",
      description:
        project.kbKind === "github"
          ? "Документы синхронизируются с GitHub."
          : project.kbKind === "local"
            ? "Используется локальная база знаний ProjectsFlow."
            : "База знаний не создана.",
      icon: Link2,
      connected: project.kbKind !== "none",
      href: null,
    },
    {
      id: "database",
      name: "App Database",
      description:
        dashboard.status === "active"
          ? `${dashboard.schema?.tables.length ?? 0} таблиц · ${formatDashboardBytes(dashboard.usageBytes)}`
          : "Управляемая база приложения не создана.",
      icon: Database,
      connected: dashboard.status === "active",
      href: null,
    },
    {
      id: "site",
      name: "Публикация",
      description: site?.deployedAt
        ? `Обновлено ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(site.deployedAt))}`
        : "Результат ещё не опубликован.",
      icon: Globe2,
      connected: Boolean(site?.deployedAt),
      href: null,
    },
  ] as const;
  const requestIntegration = async (
    id: "email" | "webhooks" | "oauth",
  ): Promise<void> => {
    setSaving(id);
    try {
      const nextValue =
        dashboardSettings.integrations[id] === "pending"
          ? "disabled"
          : "pending";
      const next = await projectRepository.updateAppDashboardSettings(
        project.id,
        { integrations: { [id]: nextValue } },
      );
      onDashboardSettingsUpdated(next);
      toast.success(
        nextValue === "pending"
          ? "Запрос на подключение сохранён"
          : "Запрос отменён",
      );
    } catch {
      toast.error("Не удалось изменить интеграцию");
    } finally {
      setSaving(null);
    }
  };
  const saveConnections = async (): Promise<void> => {
    setSaving("config");
    try {
      const next = await projectRepository.updateAppDashboardSettings(
        project.id,
        {
          integrations: {
            emailSender: emailSender.trim(),
            webhookUrl: webhookUrl.trim(),
            oauthIssuer: oauthIssuer.trim(),
            email: emailSender.trim() ? "configured" : "disabled",
            webhooks: webhookUrl.trim() ? "pending" : "disabled",
            oauth: oauthIssuer.trim() ? "configured" : "disabled",
          },
        },
      );
      onDashboardSettingsUpdated(next);
      toast.success("Параметры подключений сохранены");
    } catch {
      toast.error("Проверьте HTTPS-адреса и повторите");
    } finally {
      setSaving(null);
    }
  };
  const testWebhook = async (): Promise<void> => {
    setSaving("webhook-test");
    try {
      let settings = dashboardSettings;
      if (webhookUrl.trim() !== dashboardSettings.integrations.webhookUrl) {
        settings = await projectRepository.updateAppDashboardSettings(
          project.id,
          {
            integrations: {
              webhookUrl: webhookUrl.trim(),
              webhooks: "pending",
            },
          },
        );
      }
      settings = await projectRepository.testAppWebhook(project.id);
      onDashboardSettingsUpdated(settings);
      toast[
        settings.integrations.webhooks === "configured" ? "success" : "error"
      ](
        settings.integrations.webhooks === "configured"
          ? "Тестовый webhook доставлен"
          : "Webhook ответил ошибкой",
      );
    } catch {
      toast.error("Тестовый webhook не доставлен");
    } finally {
      setSaving(null);
    }
  };
  const external = [
    {
      id: "email" as const,
      name: "Email",
      description: "Транзакционные письма и уведомления приложения.",
    },
    {
      id: "webhooks" as const,
      name: "Webhooks",
      description: "Исходящие события для внешних систем.",
    },
    {
      id: "oauth" as const,
      name: "OAuth",
      description: "Вход через внешних провайдеров.",
    },
  ];
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Интеграции"
        description="Подключённые ресурсы показаны сразу; внешние сервисы можно отправить на настройку без ложного статуса «готово»."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {integrations.map((integration) => {
          const Icon = integration.icon;
          const content = (
            <div className="flex items-start gap-3">
              <span className="grid size-10 place-items-center rounded-lg bg-muted">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{integration.name}</span>
                  <StatusPill tone={integration.connected ? "ok" : "muted"}>
                    {integration.connected ? "Подключено" : "Не настроено"}
                  </StatusPill>
                </span>
                <span className="mt-1 block break-all text-sm leading-6 text-muted-foreground">
                  {integration.description}
                </span>
              </span>
            </div>
          );
          return integration.href ? (
            <a
              key={integration.id}
              href={integration.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border p-4 transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {content}
            </a>
          ) : (
            <section key={integration.id} className="rounded-xl border p-4">
              {content}
              {integration.id === "site" && integration.connected && (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={onOpenPreview}
                >
                  Открыть Preview
                </Button>
              )}
            </section>
          );
        })}
      </div>
      <section className="overflow-hidden rounded-xl border">
        <div className="border-b bg-muted/15 px-4 py-3">
          <p className="text-sm font-semibold">Внешние подключения</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Статус «Ожидает настройки» означает сохранённый запрос, а не
            завершённое подключение.
          </p>
        </div>
        <div className="divide-y">
          {external.map((item) => {
            const state = dashboardSettings.integrations[item.id];
            const pending = state === "pending";
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-center gap-3 px-4 py-4"
              >
                <Plug className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{item.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </span>
                <StatusPill
                  tone={
                    state === "configured"
                      ? "ok"
                      : pending || state === "error"
                        ? "warn"
                        : "muted"
                  }
                >
                  {state === "configured"
                    ? "Настроено"
                    : state === "error"
                      ? "Ошибка"
                      : pending
                        ? "Ожидает настройки"
                        : "Выключено"}
                </StatusPill>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canEdit || saving !== null}
                  onClick={() => void requestIntegration(item.id)}
                >
                  {saving === item.id && (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  )}
                  {pending ? "Отменить" : "Запросить"}
                </Button>
              </div>
            );
          })}
        </div>
      </section>
      <section className="max-w-3xl space-y-4 rounded-xl border p-4">
        <div>
          <p className="text-sm font-semibold">Параметры подключений</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Секреты здесь не отображаются. Webhook проверяется реальным тестовым
            POST-запросом; локальные и приватные адреса сервер блокирует.
          </p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Webhook HTTPS URL</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              placeholder="https://hooks.example.com/projectsflow"
              disabled={!canEdit || saving !== null}
              className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!canEdit || saving !== null || !webhookUrl.trim()}
              onClick={() => void testWebhook()}
            >
              {saving === "webhook-test" && (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              )}
              Проверить
            </Button>
          </div>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Email отправителя</span>
          <input
            value={emailSender}
            onChange={(event) => setEmailSender(event.target.value)}
            placeholder="ProjectsFlow <hello@example.com>"
            disabled={!canEdit || saving !== null}
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">OAuth / OIDC issuer</span>
          <input
            value={oauthIssuer}
            onChange={(event) => setOauthIssuer(event.target.value)}
            placeholder="https://accounts.example.com"
            disabled={!canEdit || saving !== null}
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
          />
        </label>
        <Button
          disabled={!canEdit || saving !== null}
          onClick={() => void saveConnections()}
        >
          {saving === "config" && (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          )}
          Сохранить подключения
        </Button>
      </section>
    </div>
  );
}

export function SecuritySection({
  dashboard,
  site,
  project,
}: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const [scan, setScan] = useState<AppSecurityScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const url = site?.siteSlug ? siteResultUrl(site.siteSlug) : null;
  const checks = [
    {
      label: "Для результата настроен HTTPS-адрес",
      ok: Boolean(url?.startsWith("https://")),
    },
    {
      label: "Бэкенд базы данных подготовлен",
      ok: dashboard.status === "active",
    },
    { label: "Ссылка на репозиторий указана", ok: Boolean(project.gitRepoUrl) },
    { label: "Есть отметка времени публикации", ok: Boolean(site?.deployedAt) },
  ];
  const runScan = async (): Promise<void> => {
    setScanning(true);
    try {
      setScan(await projectRepository.scanAppSecurity(project.id));
    } catch {
      toast.error("Не удалось выполнить серверную проверку");
    } finally {
      setScanning(false);
    }
  };
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Безопасность"
        description="Серверная проверка репозитория, способов входа, домена, webhook, индексации и настроек приватности."
        action={
          <Button size="sm" disabled={scanning} onClick={() => void runScan()}>
            {scanning ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-1.5 size-4" />
            )}
            Проверить
          </Button>
        }
      />
      {scan && (
        <div
          role="status"
          className={cn(
            "rounded-xl border p-4",
            scan.findings.length
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-emerald-500/30 bg-emerald-500/5",
          )}
        >
          <p className="font-medium">
            {scan.findings.length
              ? `Найдено замечаний: ${scan.findings.length}`
              : "Проверка пройдена без замечаний"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Выполнено{" "}
            {new Intl.DateTimeFormat("ru-RU", {
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(scan.scannedAt))}
          </p>
        </div>
      )}
      {scan && scan.findings.length > 0 && (
        <section className="overflow-hidden rounded-xl border">
          <div className="border-b px-4 py-3 text-sm font-semibold">
            Результаты серверной проверки
          </div>
          <div className="divide-y">
            {scan.findings.map((finding) => (
              <div
                key={finding.code}
                className="flex items-start gap-3 px-4 py-4"
              >
                <AlertTriangle
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    finding.severity === "critical"
                      ? "text-red-500"
                      : finding.severity === "warning"
                        ? "text-amber-500"
                        : "text-blue-500",
                  )}
                />
                <div>
                  <p className="text-sm font-medium">{finding.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {finding.remediation}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="overflow-hidden rounded-xl border">
        <div className="border-b px-4 py-3 text-sm font-semibold">
          Контрольный список
        </div>
        <div className="divide-y">
          {checks.map((check) => (
            <div
              key={check.label}
              className="flex items-center gap-3 px-4 py-3 text-sm"
            >
              {check.ok ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="size-4 text-amber-500" />
              )}
              <span className="flex-1">{check.label}</span>
              <StatusPill tone={check.ok ? "ok" : "warn"}>
                {check.ok ? "Готово" : "Проверьте"}
              </StatusPill>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function CodeSection({
  project,
  canEdit,
}: DashboardContentProps): React.ReactElement {
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Код"
        description="Файлы подключённого GitHub-репозитория. Сохранение создаёт отдельный коммит и защищено SHA от перезаписи новой версии."
      />
      {project.gitRepoUrl ? (
        <RepositoryCodeEditor
          projectId={project.id}
          repoUrl={project.gitRepoUrl}
          canEdit={canEdit}
        />
      ) : (
        <NotConnected
          title="Репозиторий не подключён"
          description="Подключите GitHub-репозиторий проекта, чтобы просматривать и редактировать его текстовые файлы."
        />
      )}
    </div>
  );
}

const WORKER_RUN_STATUS: Record<
  ProjectWorkerRun["status"],
  { label: string; tone: "ok" | "warn" | "muted" }
> = {
  running: { label: "Выполняется", tone: "ok" },
  completed: { label: "Завершён", tone: "ok" },
  failed: { label: "Ошибка", tone: "warn" },
  timeout: { label: "Таймаут", tone: "warn" },
  canceled: { label: "Отменён", tone: "muted" },
};

function formatWorkerTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

function WorkerRunRow({
  run,
}: {
  run: ProjectWorkerRun;
}): React.ReactElement {
  const meta = WORKER_RUN_STATUS[run.status];
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      <Cpu className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {run.agentName ?? "Воркер"}
          {run.attempt > 1 ? ` · попытка ${run.attempt}` : ""}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {formatWorkerTime(run.startedAt)}
          {run.model ? ` · ${run.model}` : ""}
          {run.costUsd != null ? ` · $${run.costUsd.toFixed(4)}` : ""}
        </p>
      </div>
      <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
    </div>
  );
}

export function AgentsSection({
  project,
  onProjectUpdated,
}: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const [candidates, setCandidates] = useState<readonly DispatcherCandidate[]>(
    [],
  );
  const [selected, setSelected] = useState(project.dispatcherUserId ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [overview, setOverview] = useState<ProjectWorkerOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewNonce, setOverviewNonce] = useState(0);
  useEffect(() => {
    setSelected(project.dispatcherUserId ?? "");
  }, [project.dispatcherUserId]);
  useEffect(() => {
    let cancelled = false;
    setOverviewLoading(true);
    projectRepository
      .getProjectWorkerOverview(project.id)
      .then((value) => {
        if (!cancelled) setOverview(value);
      })
      .catch(() => {
        if (!cancelled) setOverview(null);
      })
      .finally(() => {
        if (!cancelled) setOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, projectRepository, overviewNonce]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    projectRepository
      .listDispatcherCandidates(project.id)
      .then((items) => {
        if (!cancelled) setCandidates(items);
      })
      .catch(() => {
        if (!cancelled) toast.error("Не удалось загрузить агентов");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, projectRepository]);
  const saveDispatcher = async (): Promise<void> => {
    setSaving(true);
    try {
      const updated = await projectRepository.setDispatcher(
        project.id,
        selected || null,
      );
      onProjectUpdated(updated);
      toast.success(
        selected ? "Диспетчер назначен" : "Автономный диспетчер отключён",
      );
    } catch {
      toast.error("Не удалось изменить диспетчера");
    } finally {
      setSaving(false);
    }
  };
  const toggleParallel = async (): Promise<void> => {
    setSaving(true);
    try {
      const updated = await projectRepository.setMultiTaskWorker(
        project.id,
        !project.multiTaskWorker,
      );
      onProjectUpdated(updated);
      toast.success(
        updated.multiTaskWorker
          ? "Параллельная работа включена"
          : "Параллельная работа выключена",
      );
    } catch {
      toast.error("Не удалось изменить режим воркера");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Агенты"
        description="Реальный ProjectsFlow-воркер: кто диспетчер, чем он сейчас занят, какими правами владеет и что запускал последним."
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={overviewLoading}
            onClick={() => setOverviewNonce((n) => n + 1)}
          >
            <RefreshCw
              className={cn(
                "mr-1.5 size-4",
                overviewLoading && "animate-spin",
              )}
            />
            Обновить
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <section className="space-y-4 rounded-xl border p-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Диспетчер проекта</span>
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={loading || saving || project.role !== "owner"}
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
            >
              <option value="">Работа вручную</option>
              {candidates.map((candidate) => (
                <option key={candidate.userId} value={candidate.userId}>
                  {candidate.displayName} · {candidate.activeTokenCount}{" "}
                  токен(а){candidate.isAdmin ? " · admin" : ""}
                </option>
              ))}
            </select>
          </label>
          {loading && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Проверяем активные agent tokens…
            </p>
          )}{" "}
          {!loading && candidates.length === 0 && (
            <p className="text-xs leading-5 text-muted-foreground">
              Нет участников с активным agent token. Подключите диспетчер в
              настройках аккаунта.
            </p>
          )}
          <Button
            disabled={
              saving ||
              loading ||
              project.role !== "owner" ||
              selected === (project.dispatcherUserId ?? "")
            }
            onClick={() => void saveDispatcher()}
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Сохранить диспетчера
          </Button>
        </section>
        <aside className="rounded-xl border bg-muted/10 p-4">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Режим выполнения</h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {project.dispatcherUserId
              ? "Диспетчер назначен и может получать задачи проекта."
              : "Задачи выполняются вручную, пока диспетчер не назначен."}
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={project.multiTaskWorker}
            disabled={
              saving || !project.dispatcherUserId || project.role !== "owner"
            }
            onClick={() => void toggleParallel()}
            className={cn(
              "mt-4 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm",
              !project.dispatcherUserId && "cursor-not-allowed opacity-50",
            )}
          >
            <span>До трёх задач параллельно</span>
            <span
              className={cn(
                "h-5 w-9 rounded-full p-0.5 transition-colors",
                project.multiTaskWorker
                  ? "bg-primary"
                  : "bg-muted-foreground/25",
              )}
            >
              <span
                className={cn(
                  "block size-4 rounded-full bg-white shadow transition-transform",
                  project.multiTaskWorker && "translate-x-4",
                )}
              />
            </span>
          </button>
        </aside>
      </div>
      <section className="rounded-xl border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Состояние воркера</h3>
          </div>
          {overview &&
            (overview.runningCount > 0 ? (
              <StatusPill tone="ok">
                Идёт работа: {overview.runningCount}
              </StatusPill>
            ) : (
              <StatusPill tone="muted">Простаивает</StatusPill>
            ))}
        </div>
        {overviewLoading && !overview ? (
          <p className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Загружаем состояние воркера…
          </p>
        ) : !overview ? (
          <p className="px-4 py-4 text-xs leading-5 text-muted-foreground">
            Состояние воркера пока недоступно.
          </p>
        ) : (
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <div className="rounded-lg border bg-muted/10 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="size-4 text-muted-foreground" />
                Права доступа (capabilities)
              </div>
              {overview.capabilities.active === 0 ? (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Сейчас у воркера нет активных прав. Они выдаются автоматически
                  на время выполнения задачи и истекают сами.
                </p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <li>
                    Активных прав:{" "}
                    <span className="font-medium text-foreground">
                      {overview.capabilities.active}
                    </span>
                  </li>
                  <li>
                    Привязано к задаче: {overview.capabilities.taskScoped} · ко
                    всему проекту: {overview.capabilities.projectScoped}
                  </li>
                  {overview.capabilities.nextExpiryAt && (
                    <li className="flex items-center gap-1">
                      <Clock className="size-3" />
                      Ближайшее истечение:{" "}
                      {formatWorkerTime(overview.capabilities.nextExpiryAt)}
                    </li>
                  )}
                </ul>
              )}
            </div>
            <div className="rounded-lg border bg-muted/10 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Bot className="size-4 text-muted-foreground" />
                Режим
              </div>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>
                  Диспетчер:{" "}
                  <span className="font-medium text-foreground">
                    {overview.dispatcherUserId ? "назначен" : "не назначен"}
                  </span>
                </li>
                <li>
                  Параллельность:{" "}
                  {overview.multiTaskWorker
                    ? "до трёх задач одновременно"
                    : "по одной задаче"}
                </li>
              </ul>
            </div>
          </div>
        )}
      </section>
      <section className="overflow-hidden rounded-xl border">
        <div className="border-b px-4 py-3 text-sm font-semibold">
          История запусков
        </div>
        {overviewLoading && !overview ? (
          <p className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Загружаем историю…
          </p>
        ) : overview && overview.recentRuns.length > 0 ? (
          <div className="divide-y">
            {overview.recentRuns.map((run) => (
              <WorkerRunRow key={run.id} run={run} />
            ))}
          </div>
        ) : (
          <p className="px-4 py-4 text-xs leading-5 text-muted-foreground">
            Воркер ещё ничего не запускал в этом проекте. Прогоны появятся здесь,
            когда диспетчер возьмёт задачу в работу.
          </p>
        )}
      </section>
    </div>
  );
}

// Человекочитаемые ярлыки замкнутых наборов правил (событие → действие).
const WORKFLOW_STATUS_LABELS: Record<WorkflowTaskStatus, string> = {
  backlog: "Бэклог",
  todo: "К выполнению",
  in_progress: "В работе",
  awaiting_clarification: "Ждёт уточнения",
  done: "Готово",
  manual: "Ручная",
};

const WORKFLOW_PRIORITY_LABELS: Record<WorkflowPriority, string> = {
  1: "Срочный",
  2: "Высокий",
  3: "Средний",
  4: "Низкий",
};

const WORKFLOW_TRIGGER_LABELS: Record<WorkflowTrigger["type"], string> = {
  task_created: "Задача создана",
  task_status_changed: "Задача перешла в статус",
  task_deadline_approaching: "До дедлайна осталось ≤ N часов",
  webhook_received: "Пришёл входящий вебхук",
};

const WORKFLOW_ACTION_LABELS: Record<WorkflowAction["type"], string> = {
  delegate: "Делегировать участнику",
  set_priority: "Выставить приоритет",
  send_telegram: "Отправить в Telegram",
  trigger_webhook: "Дёрнуть исходящий вебхук",
};

function describeTrigger(trigger: WorkflowTrigger): string {
  switch (trigger.type) {
    case "task_created":
      return "Когда задача создана";
    case "task_status_changed":
      return `Когда задача → «${WORKFLOW_STATUS_LABELS[trigger.status]}»`;
    case "task_deadline_approaching":
      return `Когда до дедлайна ≤ ${trigger.hoursBefore} ч`;
    case "webhook_received":
      return `Когда пришёл вебхук «${trigger.key}»`;
  }
}

function describeAction(action: WorkflowAction): string {
  switch (action.type) {
    case "delegate":
      return "делегировать участнику";
    case "set_priority":
      return `выставить приоритет «${WORKFLOW_PRIORITY_LABELS[action.priority]}»`;
    case "send_telegram":
      return "отправить в Telegram";
    case "trigger_webhook":
      return `дёрнуть вебхук на событии ${action.event}`;
  }
}

const selectCls = "h-9 w-full rounded-lg border bg-background px-2 text-sm";

// Конструктор правил «событие → действие» поверх статуса автономного цикла (срез 8).
// Замкнутые триггеры/действия — те же, что валидируются на сервере. Никаких выражений над
// данными: пользователь лишь выбирает тип события и тип действия из фиксированных списков.
function WorkflowRulesPanel({
  project,
  canEdit,
  members,
}: {
  project: Project;
  canEdit: boolean;
  members: readonly ProjectMember[];
}): React.ReactElement {
  const { workflowRepository } = useContainer();
  const [rules, setRules] = useState<readonly WorkflowRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Черновик нового правила.
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<WorkflowTrigger["type"]>("task_status_changed");
  const [status, setStatus] = useState<WorkflowTaskStatus>("done");
  const [hoursBefore, setHoursBefore] = useState(24);
  const [webhookKey, setWebhookKey] = useState("");
  const [actionType, setActionType] = useState<WorkflowAction["type"]>("send_telegram");
  const [assigneeUserId, setAssigneeUserId] = useState<string>(members[0]?.userId ?? "");
  const [priority, setPriority] = useState<WorkflowPriority>(2);
  const [message, setMessage] = useState("");
  const [event, setEvent] = useState<WorkflowWebhookEvent>("task.status_changed");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    void workflowRepository
      .list(project.id)
      .then((value) => {
        if (!cancelled) setRules(value);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workflowRepository, project.id]);

  function buildTrigger(): WorkflowTrigger {
    switch (triggerType) {
      case "task_created":
        return { type: "task_created" };
      case "task_status_changed":
        return { type: "task_status_changed", status };
      case "task_deadline_approaching":
        return { type: "task_deadline_approaching", hoursBefore };
      case "webhook_received":
        return { type: "webhook_received", key: webhookKey.trim() };
    }
  }

  function buildAction(): WorkflowAction {
    switch (actionType) {
      case "delegate":
        return { type: "delegate", assigneeUserId };
      case "set_priority":
        return { type: "set_priority", priority };
      case "send_telegram":
        return { type: "send_telegram", message: message.trim() };
      case "trigger_webhook":
        return { type: "trigger_webhook", event };
    }
  }

  async function handleCreate(): Promise<void> {
    const input: CreateWorkflowInput = {
      name: name.trim(),
      trigger: buildTrigger(),
      action: buildAction(),
    };
    if (!input.name) {
      toast.error("Укажите название правила");
      return;
    }
    setCreating(true);
    try {
      const created = await workflowRepository.create(project.id, input);
      setRules((prev) => [...prev, created]);
      setName("");
      setMessage("");
      toast.success("Правило создано");
    } catch {
      toast.error("Не удалось создать правило. Проверьте параметры.");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(rule: WorkflowRule): Promise<void> {
    setBusyId(rule.id);
    try {
      const updated = await workflowRepository.update(project.id, rule.id, {
        enabled: !rule.enabled,
      });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch {
      toast.error("Не удалось изменить правило");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(rule: WorkflowRule): Promise<void> {
    setBusyId(rule.id);
    try {
      await workflowRepository.remove(project.id, rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
    } catch {
      toast.error("Не удалось удалить правило");
    } finally {
      setBusyId(null);
    }
  }

  const memberLabel = (userId: string): string =>
    members.find((m) => m.userId === userId)?.user.displayName ?? userId;

  return (
    <section className="overflow-hidden rounded-xl border">
      <div className="border-b bg-muted/15 px-4 py-3">
        <p className="text-sm font-semibold">Правила «событие → действие»</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Конструктор поверх автономного цикла: замкнутый набор триггеров и действий над
          задачами, дедлайнами и вебхуками. Правило, зациклившее само себя, сервер отключает
          автоматически.
        </p>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Загружаем правила…
        </p>
      ) : loadError ? (
        <p className="px-4 py-4 text-sm text-amber-700 dark:text-amber-300">
          Не удалось прочитать правила. Проект и задачи не затронуты.
        </p>
      ) : rules.length === 0 ? (
        <p className="px-4 py-4 text-xs leading-5 text-muted-foreground">
          Правил пока нет. Соберите первое ниже — например «Задача → Готово ⇒ сообщение в
          Telegram».
        </p>
      ) : (
        <div className="divide-y">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  rule.enabled ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{rule.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {describeTrigger(rule.trigger)} ⇒ {describeAction(rule.action)}
                  {rule.action.type === "delegate"
                    ? ` (${memberLabel(rule.action.assigneeUserId)})`
                    : ""}
                </p>
                {rule.lastStatus ? (
                  <p
                    className={cn(
                      "mt-0.5 truncate text-[11px]",
                      rule.lastStatus.startsWith("error") ||
                        rule.lastStatus.startsWith("disabled")
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground",
                    )}
                  >
                    Последний запуск: {rule.lastStatus}
                  </p>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canEdit || busyId === rule.id}
                onClick={() => void handleToggle(rule)}
              >
                {rule.enabled ? "Выключить" : "Включить"}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={!canEdit || busyId === rule.id}
                onClick={() => void handleDelete(rule)}
                aria-label="Удалить правило"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="space-y-3 border-t bg-muted/10 p-4">
          <p className="text-xs font-semibold text-muted-foreground">Новое правило</p>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название правила"
            maxLength={120}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Событие (триггер)</label>
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as WorkflowTrigger["type"])}
                className={selectCls}
              >
                {(Object.keys(WORKFLOW_TRIGGER_LABELS) as WorkflowTrigger["type"][]).map((t) => (
                  <option key={t} value={t}>
                    {WORKFLOW_TRIGGER_LABELS[t]}
                  </option>
                ))}
              </select>
              {triggerType === "task_status_changed" && (
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as WorkflowTaskStatus)}
                  className={selectCls}
                >
                  {WORKFLOW_TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {WORKFLOW_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              )}
              {triggerType === "task_deadline_approaching" && (
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={hoursBefore}
                  onChange={(e) => setHoursBefore(Number(e.target.value))}
                  placeholder="Часов до дедлайна"
                />
              )}
              {triggerType === "webhook_received" && (
                <Input
                  value={webhookKey}
                  onChange={(e) => setWebhookKey(e.target.value)}
                  placeholder="ключ вебхука (a-z0-9_-)"
                  maxLength={64}
                />
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Действие</label>
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value as WorkflowAction["type"])}
                className={selectCls}
              >
                {(Object.keys(WORKFLOW_ACTION_LABELS) as WorkflowAction["type"][]).map((a) => (
                  <option key={a} value={a}>
                    {WORKFLOW_ACTION_LABELS[a]}
                  </option>
                ))}
              </select>
              {actionType === "delegate" && (
                <select
                  value={assigneeUserId}
                  onChange={(e) => setAssigneeUserId(e.target.value)}
                  className={selectCls}
                >
                  {members.length === 0 ? (
                    <option value="">Нет участников</option>
                  ) : (
                    members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.user.displayName}
                      </option>
                    ))
                  )}
                </select>
              )}
              {actionType === "set_priority" && (
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value) as WorkflowPriority)}
                  className={selectCls}
                >
                  {WORKFLOW_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {WORKFLOW_PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              )}
              {actionType === "send_telegram" && (
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Текст сообщения"
                  maxLength={1000}
                />
              )}
              {actionType === "trigger_webhook" && (
                <select
                  value={event}
                  onChange={(e) => setEvent(e.target.value as WorkflowWebhookEvent)}
                  className={selectCls}
                >
                  {WORKFLOW_WEBHOOK_EVENTS.map((ev) => (
                    <option key={ev} value={ev}>
                      {ev}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void handleCreate()} disabled={creating}>
              {creating ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Workflow className="mr-1.5 size-4" />
              )}
              Добавить правило
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export function WorkflowsSection({
  project,
  canEdit,
  members,
  onOpenAutomation,
}: DashboardContentProps): React.ReactElement {
  const { automationRepository } = useContainer();
  const [automation, setAutomation] = useState<AutomationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    void automationRepository
      .get(project.id)
      .then((value) => {
        if (!cancelled) setAutomation(value);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [automationRepository, project.id]);
  const states = [
    {
      label: "Автономный цикл",
      value: automation?.enabled
        ? automation.runStatus === "running"
          ? "Выполняется"
          : "Включён"
        : "Выключен",
      ok: Boolean(automation?.enabled),
    },
    {
      label: "Автономный диспетчер",
      value: project.dispatcherUserId ? "Назначен" : "Не назначен",
      ok: Boolean(project.dispatcherUserId),
    },
    {
      label: "Параллельная обработка",
      value: project.multiTaskWorker ? "До 3 задач" : "По одной задаче",
      ok: project.multiTaskWorker,
    },
    {
      label: "Репозиторий результата",
      value: project.gitRepoUrl ? "Подключён" : "Не подключён",
      ok: Boolean(project.gitRepoUrl),
    },
    {
      label: "Проверка коммитов",
      value: automation?.commitSyncEnabled
        ? `${String(automation.commitSyncHour).padStart(2, "0")}:${String(automation.commitSyncMinute).padStart(2, "0")}`
        : "Выключена",
      ok: Boolean(automation?.commitSyncEnabled),
    },
    {
      label: "Сводка по ответственным",
      value: automation?.assigneeDigestEnabled
        ? "Проект включён"
        : "Не включён",
      ok: Boolean(automation?.assigneeDigestEnabled),
    },
  ];
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Автоматизации"
        description="Единое окно существующего планировщика ProjectsFlow: лимиты, публикация, сводки и проверка коммитов."
        action={
          <Button size="sm" onClick={onOpenAutomation} disabled={!canEdit}>
            <Workflow className="mr-1.5 size-4" />
            Открыть настройки
          </Button>
        }
      />
      <WorkflowRulesPanel project={project} canEdit={canEdit} members={members} />
      {loading ? (
        <div className="grid min-h-44 place-items-center rounded-xl border text-sm text-muted-foreground">
          <span>
            <Loader2 className="mr-2 inline size-4 animate-spin" />
            Загружаем конфигурацию…
          </span>
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-800 dark:text-amber-200">
          Не удалось прочитать настройки автоматизации. Основной проект и задачи
          не затронуты.
        </div>
      ) : (
        automation && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <section className="rounded-xl border p-4">
              <p className="text-xs font-medium text-muted-foreground">
                Прогресс цикла
              </p>
              <p className="mt-2 text-lg font-semibold">
                {automation.tasksCreated} задач
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {automation.runStatus === "running"
                  ? "Сейчас выполняется"
                  : automation.lastTaskAt
                    ? `Последняя: ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(automation.lastTaskAt))}`
                    : "Запусков пока не было"}
              </p>
            </section>
            <section className="rounded-xl border p-4">
              <p className="text-xs font-medium text-muted-foreground">
                Лимит запуска
              </p>
              <p className="mt-2 text-lg font-semibold">
                {automation.limitKind === "count"
                  ? `${automation.limitCount ?? 0} задач`
                  : `${automation.limitMinutes ?? 0} минут`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Пауза {automation.pauseMinSeconds}–{automation.pauseMaxSeconds}{" "}
                сек.
              </p>
            </section>
            <section className="rounded-xl border p-4">
              <p className="text-xs font-medium text-muted-foreground">
                Публикация
              </p>
              <p className="mt-2 text-lg font-semibold">
                {automation.deployMethod === "github_auto"
                  ? "GitHub Actions"
                  : automation.deployMethod === "ssh_manual"
                    ? "SSH-команда"
                    : automation.deployMethod === "auto"
                      ? "По инструкции"
                      : "Без деплоя"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Review:{" "}
                {automation.ultracodeReviewEnabled ? "включён" : "выключен"}
              </p>
            </section>
            <section className="rounded-xl border p-4">
              <p className="text-xs font-medium text-muted-foreground">
                Активные критерии
              </p>
              <p className="mt-2 text-lg font-semibold">
                {
                  automation.criteria.filter((criterion) => criterion.enabled)
                    .length
                }{" "}
                из {automation.criteria.length}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Режим: {automation.ralphMode || "по умолчанию"}
              </p>
            </section>
          </div>
        )
      )}
      <section className="overflow-hidden rounded-xl border">
        <div className="border-b bg-muted/15 px-4 py-3">
          <p className="text-sm font-semibold">Готовность проекта</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Перед запуском планировщик проверит эти реальные настройки.
          </p>
        </div>
        <div className="divide-y">
          {states.map((state) => (
            <div
              key={state.label}
              className="flex items-center gap-3 px-4 py-4"
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  state.ok ? "bg-emerald-500" : "bg-amber-500",
                )}
              />
              <span className="min-w-0 flex-1 text-sm font-medium">
                {state.label}
              </span>
              <span className="text-sm text-muted-foreground">
                {state.value}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function ApiSection({
  project,
  dashboard,
  site,
}: DashboardContentProps): React.ReactElement {
  const [tab, setTab] = useState<"docs" | "sdk" | "openapi">("docs");
  const tableNames = dashboard.schema?.tables.map((table) => table.name) ?? [];
  const runtimeUrl = site?.siteSlug ? siteResultUrl(site.siteSlug) : null;
  const openApi = buildProjectOpenApi(
    project.id,
    tableNames,
    runtimeUrl ?? undefined,
  );
  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Скопировано");
    } catch {
      toast.error("Браузер не разрешил доступ к буферу обмена");
    }
  };
  const downloadOpenApi = (): void => {
    const url = URL.createObjectURL(
      new Blob([openApi], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[^a-zа-я0-9_-]+/gi, "-").toLowerCase() || "projectsflow-app"}-openapi.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const sdkSnippet = `const API_URL = ${JSON.stringify(runtimeUrl ?? "https://<ваш-сайт>.projectsflow.ru")};

export async function appRequest(path, options = {}) {
  const token = localStorage.getItem("app_token");
  const response = await fetch(\`\${API_URL}\${path}\`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: \`Bearer \${token}\` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? null : response.json();
}`;
  const llmContext = buildProjectApiMarkdown(
    project.name,
    project.id,
    tableNames,
    runtimeUrl ?? undefined,
  );
  const methods = [
    {
      method: "GET",
      suffix: "",
      label: "Получить и отфильтровать записи",
      tone: "text-emerald-700 bg-emerald-500/10 dark:text-emerald-300",
    },
    {
      method: "POST",
      suffix: "",
      label: "Создать запись",
      tone: "text-blue-700 bg-blue-500/10 dark:text-blue-300",
    },
    {
      method: "PATCH",
      suffix: "/{id}",
      label: "Изменить запись по ID",
      tone: "text-amber-700 bg-amber-500/10 dark:text-amber-300",
    },
    {
      method: "DELETE",
      suffix: "/{id}",
      label: "Удалить запись по ID (обратимо)",
      tone: "text-red-700 bg-red-500/10 dark:text-red-300",
    },
    {
      method: "POST",
      suffix: "/bulk",
      label: "Создать до 100 записей за запрос",
      tone: "text-blue-700 bg-blue-500/10 dark:text-blue-300",
    },
    {
      method: "PUT",
      suffix: "/bulk",
      label: "Обновить до 100 записей списком",
      tone: "text-violet-700 bg-violet-500/10 dark:text-violet-300",
    },
    {
      method: "POST",
      suffix: "/update-many",
      label: "Обновить записи по условию",
      tone: "text-violet-700 bg-violet-500/10 dark:text-violet-300",
    },
    {
      method: "POST",
      suffix: "/{id}/restore",
      label: "Восстановить удалённую запись",
      tone: "text-emerald-700 bg-emerald-500/10 dark:text-emerald-300",
    },
  ] as const;
  return (
    <div className="space-y-5">
      <SectionHeader
        title="API"
        description="Документация создаётся из опубликованной схемы приложения. Ключи и приватные значения не показываются."
      />
      <div
        className="inline-flex rounded-lg bg-muted/50 p-0.5"
        role="tablist"
        aria-label="API документация"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "docs"}
          onClick={() => setTab("docs")}
          className={cn(
            "h-9 rounded-md px-3 text-sm",
            tab === "docs" && "bg-background shadow-sm",
          )}
        >
          Endpoints
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "openapi"}
          onClick={() => setTab("openapi")}
          className={cn(
            "h-9 rounded-md px-3 text-sm",
            tab === "openapi" && "bg-background shadow-sm",
          )}
        >
          OpenAPI
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sdk"}
          onClick={() => setTab("sdk")}
          className={cn(
            "h-9 rounded-md px-3 text-sm",
            tab === "sdk" && "bg-background shadow-sm",
          )}
        >
          JavaScript SDK
        </button>
      </div>
      {tab === "docs" ? (
        <div className="space-y-3">
          {tableNames.length ? (
            tableNames.map((table) => (
              <section
                key={table}
                className="overflow-hidden rounded-xl border"
              >
                <div className="border-b bg-muted/15 px-3 py-2">
                  <p className="font-mono text-xs font-semibold">{table}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {runtimeUrl
                      ? siteResultDisplayUrl(site!.siteSlug!)
                      : "Полный адрес появится после публикации результата"}
                  </p>
                </div>
                <div className="divide-y">
                  {methods.map((endpoint) => (
                    <div
                      key={`${endpoint.method} ${endpoint.suffix}`}
                      className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5"
                    >
                      <span
                        className={cn(
                          "w-fit rounded px-2 py-1 font-mono text-[11px] font-semibold",
                          endpoint.tone,
                        )}
                      >
                        {endpoint.method}
                      </span>
                      <span className="min-w-0">
                        <code className="block truncate text-xs">
                          /api/data/{table}
                          {endpoint.suffix}
                        </code>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {endpoint.label}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() =>
                          void copy(
                            `${runtimeUrl ?? ""}/api/data/${table}${endpoint.suffix}`,
                          )
                        }
                        aria-label={`Скопировать ${endpoint.method} ${table}${endpoint.suffix}`}
                        disabled={!runtimeUrl}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <NotConnected
              title="API пока пуст"
              description="В приложении нет опубликованных таблиц, поэтому endpoints не генерируются."
            />
          )}
        </div>
      ) : tab === "sdk" ? (
        <div className="overflow-hidden rounded-xl border bg-zinc-950">
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs text-zinc-400">
            <span>projectsflow-app.js</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-zinc-200 hover:bg-white/10 hover:text-white"
              onClick={() => void copy(sdkSnippet)}
            >
              <Copy className="mr-1.5 size-3.5" />
              Копировать SDK
            </Button>
          </div>
          <pre className="max-h-[520px] overflow-auto p-4 font-mono text-xs leading-6 text-zinc-100">
            <code>{sdkSnippet}</code>
          </pre>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-zinc-950">
          <div className="flex h-11 items-center justify-between border-b border-white/10 px-3 text-xs text-zinc-400">
            <span>openapi.json</span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-200 hover:bg-white/10 hover:text-white"
                onClick={downloadOpenApi}
              >
                <Download className="mr-1.5 size-3.5" />
                Скачать
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-200 hover:bg-white/10 hover:text-white"
                onClick={() => void copy(openApi)}
              >
                <Copy className="mr-1.5 size-3.5" />
                Копировать
              </Button>
            </div>
          </div>
          <pre className="max-h-[520px] overflow-auto p-4 font-mono text-xs leading-6 text-zinc-100">
            <code>{openApi}</code>
          </pre>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void copy(llmContext)}
        >
          <Sparkles className="mr-1.5 size-3.5" />
          Скопировать для LLM
        </Button>
        {runtimeUrl && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={`${runtimeUrl}/api/auth/config`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="mr-1.5 size-3.5" />
              Проверить runtime
            </a>
          </Button>
        )}
      </div>
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Аутентификация</p>
        <p className="mt-1 text-muted-foreground">
          Runtime API использует сессию опубликованного приложения и правила
          доступа таблицы; приватные ключи здесь не показываются.
        </p>
      </div>
    </div>
  );
}

export function SettingsSection({
  project,
  site,
  dashboard,
  canEdit,
  dashboardSettings,
  members,
  onProjectUpdated,
  onDashboardSettingsUpdated,
}: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const [tab, setTab] = useState<"app" | "access" | "auth">("app");
  const [description, setDescription] = useState(
    dashboardSettings.profile.description || project.description || "",
  );
  const [mainRoute, setMainRoute] = useState(
    dashboardSettings.profile.mainRoute,
  );
  const [visibility, setVisibility] = useState(
    dashboardSettings.updatedAt
      ? dashboardSettings.profile.visibility
      : project.isPublic
        ? "public"
        : "private",
  );
  const [logoUrl, setLogoUrl] = useState(dashboardSettings.branding.logoUrl);
  const [socialImageUrl, setSocialImageUrl] = useState(
    dashboardSettings.branding.socialImageUrl,
  );
  const [showPlatformBadge, setShowPlatformBadge] = useState(
    dashboardSettings.branding.showPlatformBadge,
  );
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const saveProfile = async (): Promise<void> => {
    setSaving(true);
    try {
      let updated = project;
      if (project.description !== (description.trim() || null)) {
        updated = await projectRepository.update(project.id, {
          description: description.trim() || null,
        });
      }
      if (
        project.role === "owner" &&
        visibility === "public" &&
        !updated.isPublic
      ) {
        const published = await projectRepository.publish(project.id);
        updated = { ...updated, isPublic: true, publicSlug: published.slug };
      } else if (
        project.role === "owner" &&
        visibility === "private" &&
        updated.isPublic
      ) {
        await projectRepository.unpublish(project.id);
        updated = { ...updated, isPublic: false, publicIndexing: false };
      }
      const next = await projectRepository.updateAppDashboardSettings(
        project.id,
        {
          profile: { description: description.trim(), mainRoute, visibility },
          branding: {
            logoUrl: logoUrl.trim(),
            socialImageUrl: socialImageUrl.trim(),
            showPlatformBadge,
          },
        },
      );
      onDashboardSettingsUpdated(next);
      onProjectUpdated(updated);
      toast.success("Профиль и видимость приложения сохранены");
    } catch {
      toast.error("Не удалось сохранить настройки приложения");
    } finally {
      setSaving(false);
    }
  };
  const togglePublish = async (): Promise<void> => {
    setSaving(true);
    try {
      if (project.isPublic) {
        await projectRepository.unpublish(project.id);
        const next = await projectRepository.updateAppDashboardSettings(
          project.id,
          { profile: { visibility: "private" } },
        );
        onDashboardSettingsUpdated(next);
        setVisibility("private");
        onProjectUpdated({
          ...project,
          isPublic: false,
          publicIndexing: false,
        });
        toast.success("Публичная страница скрыта");
      } else {
        const published = await projectRepository.publish(project.id);
        const next = await projectRepository.updateAppDashboardSettings(
          project.id,
          { profile: { visibility: "public" } },
        );
        onDashboardSettingsUpdated(next);
        setVisibility("public");
        onProjectUpdated({
          ...project,
          isPublic: true,
          publicSlug: published.slug,
        });
        toast.success("Публичная страница опубликована");
      }
    } catch {
      toast.error("Не удалось изменить публикацию");
    } finally {
      setSaving(false);
    }
  };
  const toggleIndexing = async (): Promise<void> => {
    setSaving(true);
    try {
      await projectRepository.setPublicIndexing(
        project.id,
        !project.publicIndexing,
      );
      onProjectUpdated({ ...project, publicIndexing: !project.publicIndexing });
      toast.success(
        project.publicIndexing ? "Индексация отключена" : "Индексация включена",
      );
    } catch {
      toast.error("Не удалось изменить индексацию");
    } finally {
      setSaving(false);
    }
  };
  const updateAuth = async (
    patch: Partial<AppDashboardSettings["auth"]>,
  ): Promise<void> => {
    setSaving(true);
    try {
      const next = await projectRepository.updateAppDashboardSettings(
        project.id,
        { auth: patch },
      );
      onDashboardSettingsUpdated(next);
      toast.success("Настройки входа сохранены");
    } catch {
      toast.error("Не удалось сохранить настройки входа");
    } finally {
      setSaving(false);
    }
  };
  const downloadTemplate = (): void => {
    const payload = JSON.stringify(
      {
        version: 1,
        project: { name: project.name, icon: project.icon, description },
        dashboard: dashboardSettings,
      },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([payload], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[^a-zа-я0-9_-]+/gi, "-").toLowerCase() || "project"}.projectsflow-template.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Шаблон скачан");
  };
  const createCopy = async (): Promise<void> => {
    setSaving(true);
    try {
      const copy = await projectRepository.create({
        name: `${project.name} — копия ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`,
      });
      const updated = await projectRepository.update(copy.id, {
        icon: project.icon,
        description: description.trim() || null,
        coverUrl: project.coverUrl,
        coverPosition: project.coverPosition,
      });
      await projectRepository.updateAppDashboardSettings(updated.id, {
        profile: dashboardSettings.profile,
        branding: dashboardSettings.branding,
        seo: dashboardSettings.seo,
        auth: dashboardSettings.auth,
        advanced: dashboardSettings.advanced,
        socialContent: dashboardSettings.socialContent,
      });
      toast.success("Копия конфигурации создана");
      window.location.assign(`/projects/${updated.id}`);
    } catch {
      toast.error("Не удалось создать копию");
    } finally {
      setSaving(false);
    }
  };
  const routes = site?.routes.length ? site.routes : ["/"];
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Настройки"
        description="Профиль приложения, публикация и запросы на внешние способы входа."
      />
      <div
        className="inline-flex rounded-lg bg-muted/50 p-0.5"
        role="tablist"
        aria-label="Настройки"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "app"}
          onClick={() => setTab("app")}
          className={cn(
            "h-9 rounded-md px-3 text-sm",
            tab === "app" && "bg-background shadow-sm",
          )}
        >
          Приложение
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "access"}
          onClick={() => setTab("access")}
          className={cn(
            "h-9 rounded-md px-3 text-sm",
            tab === "access" && "bg-background shadow-sm",
          )}
        >
          Доступ
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "auth"}
          onClick={() => setTab("auth")}
          className={cn(
            "h-9 rounded-md px-3 text-sm",
            tab === "auth" && "bg-background shadow-sm",
          )}
        >
          Вход
        </button>
      </div>
      {tab === "app" && (
        <div className="space-y-4">
          <section className="max-w-3xl space-y-4 rounded-xl border p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Логотип приложения</span>
                <input
                  value={logoUrl}
                  onChange={(event) => setLogoUrl(event.target.value)}
                  placeholder="https://cdn.example.com/logo.png"
                  disabled={!canEdit || saving}
                  className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                />
                {logoUrl && (
                  <img
                    src={logoUrl}
                    alt="Предпросмотр логотипа"
                    className="size-14 rounded-xl border object-cover"
                  />
                )}
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Social image</span>
                <input
                  value={socialImageUrl}
                  onChange={(event) => setSocialImageUrl(event.target.value)}
                  placeholder="https://cdn.example.com/social-1200x630.png"
                  disabled={!canEdit || saving}
                  className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                />
                {socialImageUrl && (
                  <img
                    src={socialImageUrl}
                    alt="Предпросмотр social image"
                    className="h-20 w-full rounded-lg border object-cover"
                  />
                )}
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Описание приложения</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={!canEdit || saving}
                rows={4}
                className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">
                Начальная страница Preview
              </span>
              <select
                value={mainRoute}
                onChange={(event) => setMainRoute(event.target.value)}
                disabled={!canEdit || saving}
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
              >
                {routes.map((route) => (
                  <option key={route} value={route}>
                    {route}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">
                Видимость страницы проекта
              </span>
              <select
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.target.value as "public" | "private")
                }
                disabled={project.role !== "owner" || saving}
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
              >
                <option value="private">Только участники проекта</option>
                <option value="public">Публичная страница</option>
              </select>
              <span className="text-xs text-muted-foreground">
                Сохраняется вместе с профилем и реально публикует либо скрывает
                общую страницу проекта.
              </span>
            </label>
            <Button
              disabled={!canEdit || saving || !mainRoute.startsWith("/")}
              onClick={() => void saveProfile()}
            >
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Сохранить профиль
            </Button>
            <button
              type="button"
              role="switch"
              aria-checked={showPlatformBadge}
              disabled={!canEdit || saving}
              onClick={() => setShowPlatformBadge((value) => !value)}
              className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm"
            >
              <span>
                <span className="block font-medium">
                  Badge «Создано в ProjectsFlow»
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Настройка сохраняется вместе с профилем и доступна
                  публикатору.
                </span>
              </span>
              <span
                className={cn(
                  "h-5 w-9 rounded-full p-0.5 transition-colors",
                  showPlatformBadge ? "bg-primary" : "bg-muted-foreground/25",
                )}
              >
                <span
                  className={cn(
                    "block size-4 rounded-full bg-white shadow transition-transform",
                    showPlatformBadge && "translate-x-4",
                  )}
                />
              </span>
            </button>
          </section>
          <section className="max-w-3xl rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">
                  Публичная страница проекта
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {project.isPublic
                    ? `Опубликована${project.publicSlug ? ` · /p/${project.publicSlug}` : ""}`
                    : "Доступна только участникам проекта"}
                </p>
              </div>
              <Button
                variant={project.isPublic ? "outline" : "default"}
                size="sm"
                disabled={saving || project.role !== "owner"}
                onClick={() => void togglePublish()}
              >
                {project.isPublic ? "Скрыть" : "Опубликовать"}
              </Button>
            </div>
            {project.isPublic && (
              <button
                type="button"
                role="switch"
                aria-checked={project.publicIndexing}
                disabled={saving || project.role !== "owner"}
                onClick={() => void toggleIndexing()}
                className="mt-4 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm"
              >
                <span>
                  <span className="block font-medium">
                    Индексация поисковиками
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Управляет реальным publicIndexing проекта.
                  </span>
                </span>
                <span
                  className={cn(
                    "h-5 w-9 rounded-full p-0.5 transition-colors",
                    project.publicIndexing
                      ? "bg-primary"
                      : "bg-muted-foreground/25",
                  )}
                >
                  <span
                    className={cn(
                      "block size-4 rounded-full bg-white shadow transition-transform",
                      project.publicIndexing && "translate-x-4",
                    )}
                  />
                </span>
              </button>
            )}
          </section>
          <section className="max-w-3xl overflow-hidden rounded-xl border">
            <div className="border-b bg-muted/15 px-4 py-3">
              <p className="text-sm font-semibold">Копирование и шаблоны</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Копия переносит профиль и конфигурацию Dashboard в новый проект.
                Репозиторий и рабочие данные не дублируются скрытно.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 p-4">
              <Button
                variant="outline"
                disabled={!canEdit || saving}
                onClick={() => void createCopy()}
              >
                <Copy className="mr-1.5 size-4" />
                Создать копию
              </Button>
              <Button variant="outline" onClick={downloadTemplate}>
                <Download className="mr-1.5 size-4" />
                Скачать шаблон
              </Button>
            </div>
          </section>
          {project.role === "owner" && (
            <section className="max-w-3xl rounded-xl border border-destructive/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-destructive">
                    Опасная зона
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Удаление проекта необратимо; GitHub-репозиторий останется на
                    GitHub.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-1.5 size-4" />
                  Удалить приложение
                </Button>
              </div>
            </section>
          )}
        </div>
      )}
      {tab === "access" && (
        <section className="max-w-3xl overflow-hidden rounded-xl border">
          <div className="divide-y">
            <div className="flex items-center justify-between gap-4 px-4 py-4">
              <span>
                <span className="block text-sm font-medium">
                  Участники ProjectsFlow
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Доступ к Dashboard проверяется сервером по роли проекта.
                </span>
              </span>
              <StatusPill tone="ok">Включено</StatusPill>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-4">
              <span>
                <span className="block text-sm font-medium">
                  Runtime-сессии приложения
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {dashboard.status === "active"
                    ? "App Database активна; правила CRUD применяются к каждой таблице."
                    : "Статический результат не использует runtime-базу и пользовательские сессии."}
                </span>
              </span>
              <StatusPill tone={dashboard.status === "active" ? "ok" : "muted"}>
                {dashboard.status === "active" ? "Активно" : "Не требуется"}
              </StatusPill>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-4">
              <span>
                <span className="block text-sm font-medium">
                  GitHub-доступ воркера
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Токен выдаётся через project-scoped delegation и не
                  показывается в Dashboard.
                </span>
              </span>
              <StatusPill tone={project.gitRepoUrl ? "ok" : "warn"}>
                {project.gitRepoUrl ? "Репо подключён" : "Нет репо"}
              </StatusPill>
            </div>
          </div>
        </section>
      )}
      {tab === "auth" && (
        <section className="max-w-3xl overflow-hidden rounded-xl border">
          <div className="border-b bg-muted/15 px-4 py-3">
            <p className="text-sm font-semibold">Способы входа</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Email применяется к runtime API сразу. Внешние провайдеры
              переходят в настройку и не считаются включёнными без ключей и
              callback.
            </p>
          </div>
          <div className="divide-y">
            <AuthRow
              name="Email и пароль"
              state={
                dashboardSettings.auth.emailPassword ? "enabled" : "disabled"
              }
              disabled={!canEdit || saving}
              onClick={() =>
                void updateAuth({
                  emailPassword: !dashboardSettings.auth.emailPassword,
                })
              }
            />
            <GoogleAuthProviderRow
              projectId={project.id}
              siteSlug={site?.siteSlug ?? null}
              canEdit={canEdit}
            />
            <ComingSoonAuthRow name="Microsoft" />
            <ComingSoonAuthRow name="Facebook" />
            <ComingSoonAuthRow name="Apple" />
            <ComingSoonAuthRow name="Single Sign-on (SSO)" />
          </div>
        </section>
      )}
      <DeleteProjectDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        projectId={project.id}
        projectName={project.name}
        otherMemberCount={Math.max(0, members.length - 1)}
        onDeleted={() => window.location.assign("/projects")}
      />
    </div>
  );
}

function AuthRow({
  name,
  state,
  disabled,
  onClick,
}: {
  name: string;
  state: "enabled" | "disabled" | "pending";
  disabled: boolean;
  onClick: () => void;
}): React.ReactElement {
  const active = state === "enabled";
  return (
    <div className="flex items-center gap-3 px-4 py-4">
      <span className="min-w-0 flex-1 text-sm font-medium">{name}</span>
      <StatusPill
        tone={
          state === "enabled" ? "ok" : state === "pending" ? "warn" : "muted"
        }
      >
        {state === "enabled"
          ? "Включено"
          : state === "pending"
            ? "Ожидает настройки"
            : "Выключено"}
      </StatusPill>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "h-6 w-11 rounded-full p-0.5 transition-colors disabled:opacity-50",
          active ? "bg-primary" : "bg-muted-foreground/25",
        )}
      >
        <span
          className={cn(
            "block size-5 rounded-full bg-white shadow transition-transform",
            active && "translate-x-5",
          )}
        />
      </button>
    </div>
  );
}

// Провайдеры, для которых бэкенд ещё не написан. Честно показываем «Скоро» без переключателя,
// который ничего не делает (см. срез 9 плана dashboard-parity).
function ComingSoonAuthRow({ name }: { name: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-3 px-4 py-4">
      <span className="min-w-0 flex-1 text-sm font-medium text-muted-foreground">
        {name}
      </span>
      <StatusPill tone="muted">Скоро</StatusPill>
    </div>
  );
}

// Google OAuth — реальный провайдер (срез 9). Форма настройки: client_id + client_secret
// (секрет write-only, наружу не возвращается), callback URL для регистрации в Google Cloud Console
// и переключатель включения. Без ключей вход не работает — честно, без имитации.
function GoogleAuthProviderRow({
  projectId,
  siteSlug,
  canEdit,
}: {
  projectId: string;
  siteSlug: string | null;
  canEdit: boolean;
}): React.ReactElement {
  const { projectRepository } = useContainer();
  const [status, setStatus] = useState<GoogleAuthProviderStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const callbackUrl = siteSlug
    ? `${siteResultUrl(siteSlug)}/api/auth/google/callback`
    : null;

  useEffect(() => {
    let cancelled = false;
    void projectRepository
      .getGoogleAuthProvider(projectId)
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setClientId(next.clientId);
      })
      .catch(() => {
        if (!cancelled) setStatus({ configured: false, enabled: false, clientId: "" });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, projectRepository]);

  const save = async (enabled: boolean): Promise<void> => {
    if (!clientId.trim()) {
      toast.error("Укажите Client ID");
      return;
    }
    if (!status?.configured && !clientSecret.trim()) {
      toast.error("Укажите Client Secret");
      return;
    }
    setBusy(true);
    try {
      const next = await projectRepository.saveGoogleAuthProvider(projectId, {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        enabled,
      });
      setStatus(next);
      setClientSecret("");
      toast.success(
        enabled ? "Вход через Google включён" : "Настройки Google сохранены",
      );
    } catch {
      toast.error("Не удалось сохранить настройки Google");
    } finally {
      setBusy(false);
    }
  };

  const disable = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = await projectRepository.disableGoogleAuthProvider(projectId);
      setStatus(next);
      toast.success("Вход через Google выключен");
    } catch {
      toast.error("Не удалось выключить Google");
    } finally {
      setBusy(false);
    }
  };

  const tone: "ok" | "warn" | "muted" = !status
    ? "muted"
    : status.enabled
      ? "ok"
      : status.configured
        ? "warn"
        : "muted";
  const label = !status
    ? "…"
    : status.enabled
      ? "Включено"
      : status.configured
        ? "Настроено, выключено"
        : "Выключено";

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-sm font-medium">Google</span>
        <StatusPill tone={tone}>{label}</StatusPill>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canEdit}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Свернуть" : "Настроить"}
        </Button>
      </div>
      {expanded && (
        <div className="mt-4 space-y-4 rounded-lg border bg-muted/10 p-4">
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>
              Создайте OAuth-клиент в{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
              >
                Google Cloud Console
                <ExternalLink className="size-3" />
              </a>{" "}
              (APIs &amp; Services → Credentials → OAuth client ID → Web
              application) и добавьте callback URL ниже в «Authorized redirect
              URIs».
            </p>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Authorized redirect URI</span>
            {callbackUrl ? (
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-2 py-1.5 text-xs">
                  {callbackUrl}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(callbackUrl);
                    toast.success("Callback URL скопирован");
                  }}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            ) : (
              <p className="rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground">
                Опубликуйте приложение, чтобы получить постоянный callback URL.
              </p>
            )}
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Client ID</span>
            <Input
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="xxxxxxxx.apps.googleusercontent.com"
              disabled={!canEdit || busy}
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Client Secret</span>
            <Input
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder={
                status?.configured ? "•••••••• (сохранён, оставьте пустым)" : "GOCSPX-…"
              }
              disabled={!canEdit || busy}
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!canEdit || busy}
              onClick={() => void save(true)}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {status?.enabled ? "Сохранить" : "Сохранить и включить"}
            </Button>
            {status?.enabled && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canEdit || busy}
                onClick={() => void disable()}
              >
                Выключить
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

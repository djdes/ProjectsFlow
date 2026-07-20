import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActivityItem } from "@/presentation/activity/ActivityItem";
import { useContainer } from "@/infrastructure/di/container";
import { cn } from "@/lib/utils";
import type {
  AppLogCategory,
  AppLogFeedEntry,
  AppRuntimeUser,
  AppTableSchema,
} from "@/application/project/ProjectRepository";
import type { ProjectMember } from "@/domain/project/ProjectMembership";
import type { ActivityEventItem } from "@/domain/activity/ActivityFeedItem";

// Категории единой ленты (срез 2) — по образцу Base44 «All Categories».
const CATEGORY_LABEL: Record<AppLogCategory, string> = {
  data: "Данные",
  auth: "Авторизация",
  worker: "Воркер",
  publish: "Публикация",
  runtime: "Рантайм",
};

const CATEGORY_BADGE: Record<AppLogCategory, string> = {
  data: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  auth: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  worker: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  publish: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  runtime: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
};

const OPERATION_LABEL: Record<string, string> = {
  select: "Чтение",
  insert: "Создание",
  update: "Изменение",
  delete: "Удаление",
  "dashboard.select": "Просмотр в Dashboard",
  "dashboard.insert": "Создание в Dashboard",
  "dashboard.update": "Изменение в Dashboard",
  "dashboard.delete": "Удаление в Dashboard",
  "dashboard.reveal": "Раскрытие значения",
  "dashboard.export": "Выгрузка CSV",
  "dashboard.permissions": "Изменение прав",
  "dashboard.sensitivity_changed": "Смена чувствительности",
  "dashboard.users.list": "Просмотр пользователей",
  "dashboard.user.sessions.revoke": "Завершение сессий",
  "dashboard.user.delete": "Удаление пользователя приложения",
  "worker.run.started": "Запуск воркера",
  "worker.run.finished": "Воркер завершил",
  "site.published": "Сайт опубликован",
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(date);
}

function formatCompactDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

const PAGE_SIZE = 100;

export function AppLogsPanel({
  projectId,
  members,
}: {
  projectId: string;
  // tables остаётся в контракте (передаёт DashboardSections), но единая лента фильтруется по
  // категории, а не по таблице — источники worker/publish/auth к таблицам не привязаны.
  tables: readonly AppTableSchema[];
  members: readonly ProjectMember[];
}): React.ReactElement {
  const { projectRepository } = useContainer();
  const [tab, setTab] = useState<"app" | "project">("app");
  const [entries, setEntries] = useState<readonly AppLogFeedEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [runtimeUsers, setRuntimeUsers] = useState<readonly AppRuntimeUser[]>(
    [],
  );
  const [projectEntries, setProjectEntries] = useState<
    readonly ActivityEventItem[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState<AppLogCategory | "">("");
  const [actor, setActor] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members],
  );
  const runtimeUserById = useMemo(
    () => new Map(runtimeUsers.map((user) => [user.id, user])),
    [runtimeUsers],
  );

  const load = useCallback(
    (quiet = false, cursor: string | null = null): void => {
      const append = cursor !== null;
      if (!quiet && !append) setLoading(true);
      if (append) setLoadingMore(true);
      setError(false);
      const request =
        tab === "app"
          ? Promise.all([
              projectRepository.queryAppLogs(projectId, {
                category: category || undefined,
                actor: actor || undefined,
                errorsOnly,
                limit: PAGE_SIZE,
                cursor,
              }),
              projectRepository.listAppRuntimeUsers(projectId),
            ]).then(([page, users]) => {
              setEntries((current) =>
                append ? [...current, ...page.entries] : page.entries,
              );
              setRuntimeUsers(users);
              setNextCursor(page.nextCursor);
            })
          : projectRepository
              .getProjectActivity(projectId, 150)
              .then((activity) => setProjectEntries(activity.items));
      void request
        .catch(() => setError(true))
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [actor, category, errorsOnly, projectId, projectRepository, tab],
  );

  useEffect(() => {
    load();
    // Тихий авто-refresh только первой страницы (курсор сбрасывается).
    const timer = window.setInterval(() => load(true), 15_000);
    return () => window.clearInterval(timer);
  }, [load, reload]);

  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="inline-flex rounded-lg bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={() => setTab("app")}
            className={cn(
              "h-8 rounded-md px-3 text-sm",
              tab === "app"
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground",
            )}
          >
            Приложение
          </button>
          <button
            type="button"
            onClick={() => setTab("project")}
            className={cn(
              "h-8 rounded-md px-3 text-sm",
              tab === "project"
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground",
            )}
          >
            Проект
          </button>
        </div>
        {tab === "app" && (
          <>
            <select
              aria-label="Фильтр категории"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as AppLogCategory | "")
              }
              className="h-9 min-w-36 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Все категории</option>
              {(Object.keys(CATEGORY_LABEL) as AppLogCategory[]).map((key) => (
                <option key={key} value={key}>
                  {CATEGORY_LABEL[key]}
                </option>
              ))}
            </select>
            <select
              aria-label="Фильтр пользователя"
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              className="h-9 min-w-36 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Все пользователи</option>
              {members.length > 0 && (
                <optgroup label="Команда проекта">
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.user.displayName}
                    </option>
                  ))}
                </optgroup>
              )}
              {runtimeUsers.length > 0 && (
                <optgroup label="Пользователи приложения">
                  {runtimeUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.email}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <label className="inline-flex h-9 items-center gap-2 rounded-md border px-2.5 text-sm">
              <input
                type="checkbox"
                checked={errorsOnly}
                onChange={(event) => setErrorsOnly(event.target.checked)}
              />
              Только ошибки
            </label>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-9"
          aria-label="Обновить логи"
          onClick={() => setReload((value) => value + 1)}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>

      <div className="min-h-[430px]">
        {loading ? (
          <div className="grid min-h-[430px] place-items-center text-sm text-muted-foreground">
            <span>
              <Loader2 className="mr-2 inline size-4 animate-spin" />
              Загружаем события…
            </span>
          </div>
        ) : error ? (
          <div className="grid min-h-[430px] place-items-center text-center">
            <div>
              <AlertTriangle className="mx-auto mb-2 size-5 text-destructive" />
              <p className="text-sm text-muted-foreground">
                Не удалось загрузить журнал.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setReload((value) => value + 1)}
              >
                Повторить
              </Button>
            </div>
          </div>
        ) : tab === "project" ? (
          projectEntries.length === 0 ? (
            <EmptyLogs />
          ) : (
            <ul>
              {projectEntries.map((item) => (
                <ActivityItem key={item.id} item={item} />
              ))}
            </ul>
          )
        ) : entries.length === 0 ? (
          <EmptyLogs />
        ) : (
          <div className="divide-y">
            {entries.map((entry) => {
              const member = entry.actorId
                ? memberById.get(entry.actorId)
                : null;
              const runtimeUser = entry.actorId
                ? runtimeUserById.get(entry.actorId)
                : null;
              const actorLabel =
                member?.user.displayName ??
                runtimeUser?.email ??
                (entry.actorType === "system"
                  ? "Система"
                  : entry.actorType === "runtime"
                    ? "Приложение"
                    : (entry.actorId ?? "Система"));
              const isExpanded = expanded === entry.id;
              return (
                <div
                  key={entry.id}
                  className={cn(!entry.success && "bg-destructive/5")}
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : entry.id)}
                    className="grid min-h-14 w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[22px_minmax(140px,1fr)_minmax(96px,0.5fr)_minmax(110px,0.7fr)_minmax(130px,0.8fr)_auto] sm:py-0"
                  >
                    {isExpanded ? (
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {OPERATION_LABEL[entry.operation] ?? entry.operation}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground sm:hidden">
                        {CATEGORY_LABEL[entry.category]} · {actorLabel}
                      </span>
                    </span>
                    <span className="hidden sm:block">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                          CATEGORY_BADGE[entry.category],
                        )}
                      >
                        {CATEGORY_LABEL[entry.category]}
                      </span>
                    </span>
                    <span className="hidden truncate text-muted-foreground sm:block">
                      {entry.tableName ?? "—"}
                    </span>
                    <span className="hidden truncate text-muted-foreground sm:block">
                      {actorLabel}
                    </span>
                    <time
                      dateTime={entry.createdAt}
                      className="whitespace-nowrap text-[10px] text-muted-foreground sm:text-xs"
                    >
                      <span className="sm:hidden">
                        {formatCompactDate(entry.createdAt)}
                      </span>
                      <span className="hidden sm:inline">
                        {formatDate(entry.createdAt)}
                      </span>
                    </time>
                  </button>
                  {isExpanded && (
                    <div className="grid gap-3 border-t bg-muted/15 px-3 py-3 text-xs sm:grid-cols-2 sm:px-10">
                      <div>
                        <p className="font-medium text-muted-foreground">
                          ID записи
                        </p>
                        <p className="mt-1 break-all">{entry.rowId ?? "—"}</p>
                      </div>
                      <div>
                        <p className="font-medium text-muted-foreground">
                          Источник
                        </p>
                        <p className="mt-1">{entry.actorType}</p>
                      </div>
                      <div className="sm:col-span-2">
                        <p className="font-medium text-muted-foreground">
                          Детали
                        </p>
                        <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-background p-2 font-mono text-[11px]">
                          {entry.detail
                            ? JSON.stringify(entry.detail, null, 2)
                            : "—"}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {nextCursor && (
              <div className="flex items-center justify-center border-t p-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => load(true, nextCursor)}
                >
                  {loadingMore && (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  )}
                  Показать ещё
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyLogs(): React.ReactElement {
  return (
    <div className="grid min-h-[430px] place-items-center text-center">
      <div>
        <Search className="mx-auto mb-2 size-5 text-muted-foreground" />
        <p className="text-sm font-medium">Событий пока нет</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Новые действия появятся здесь автоматически.
        </p>
      </div>
    </div>
  );
}

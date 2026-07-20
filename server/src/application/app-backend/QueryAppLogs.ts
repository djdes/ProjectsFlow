import type { AppLogCategory, AppLogEntry } from '../../domain/app-backend/AppLogEntry.js';
import { categorizeAuditOperation, sanitizeLogDetail } from '../../domain/app-backend/AppLogEntry.js';
import type { ProjectAccessDeps } from '../project/projectAccess.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { AppAdminAuditRepository } from './AppAdminAuditRepository.js';
import type { AppBackendRepository } from './AppBackendRepository.js';
import type { AppDatabaseStore, AppAuditEntry } from './AppDatabaseStore.js';
import type { LiveRepository } from '../live/LiveRepository.js';
import type { LiveSession } from '../../domain/live/LiveSession.js';

// Окно ленты: 30 дней. Слияние разнородных источников с разной пагинацией дорого — ограничиваем
// его по времени, а вглубь листаем курсором, а не offset'ом (см. риск в срезе 2 плана).
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
// Потолок выборки из ОДНОГО источника на страницу: не даём слиянию раздуться, даже если источник
// готов вернуть тысячи строк. Берём с запасом от limit, чтобы после фильтров хватило на страницу.
const MAX_SOURCE_FETCH = 500;

// Границы запроса к одному источнику: полуинтервал (sinceMs, beforeMs] по времени, newest-first,
// не более limit строк. beforeMs двигается курсором при листании вглубь.
export type AppLogSourceWindow = {
  readonly sinceMs: number;
  readonly beforeMs: number;
  readonly limit: number;
};

// Порт одного источника ленты. Источник сам знает, из какой таблицы читать и какую категорию
// проставить своим записям; QueryAppLogs только сливает, чистит detail и режет на страницы.
export interface AppLogSource {
  fetch(projectId: string, window: AppLogSourceWindow): Promise<readonly AppLogEntry[]>;
}

export type AppLogQuery = {
  readonly category?: AppLogCategory;
  readonly actorId?: string;
  readonly errorsOnly?: boolean;
  readonly limit?: number;
  // Непрозрачный курсор из предыдущей страницы (nextCursor). Пустой/невалидный → с начала ленты.
  readonly cursor?: string | null;
};

export type AppLogPage = {
  readonly entries: readonly AppLogEntry[];
  // null — источники исчерпаны в пределах окна. Иначе передать в следующий запрос.
  readonly nextCursor: string | null;
};

type Cursor = { readonly ms: number; readonly id: string };

// Курсор кодирует время+id последней отданной записи. Тай-брейк по id делает порядок
// детерминированным при совпадающих метках времени (иначе строки «прыгали» бы между страницами).
function encodeCursor(entry: AppLogEntry): string {
  const ms = Date.parse(entry.createdAt);
  return Buffer.from(`${Number.isFinite(ms) ? ms : 0}|${entry.id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const [msPart, ...idParts] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    const ms = Number(msPart);
    const id = idParts.join('|');
    if (!Number.isFinite(ms) || !id) return null;
    return { ms, id };
  } catch {
    return null;
  }
}

// Строго «старше курсора»: по времени, затем по id (тот же компаратор, что и сортировка ленты).
function isBeforeCursor(entry: AppLogEntry, cursor: Cursor): boolean {
  const ms = Date.parse(entry.createdAt);
  if (ms < cursor.ms) return true;
  if (ms > cursor.ms) return false;
  return entry.id < cursor.id;
}

function compareDesc(a: AppLogEntry, b: AppLogEntry): number {
  if (a.createdAt < b.createdAt) return 1;
  if (a.createdAt > b.createdAt) return -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

type Deps = ProjectAccessDeps & {
  readonly sources: readonly AppLogSource[];
  readonly now?: () => Date;
};

// Единая лента логов дашборда (срез 2). Сливает записи всех источников, чистит detail от секретов
// и режет на страницы курсором по времени. Требует read_project — как и остальное чтение дашборда.
export class QueryAppLogs {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, callerUserId: string, query: AppLogQuery = {}): Promise<AppLogPage> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'read_project');

    const nowMs = (this.deps.now ?? (() => new Date()))().getTime();
    const sinceMs = nowMs - WINDOW_MS;
    const cursor = decodeCursor(query.cursor);
    // Верхняя граница выборки: с курсором берём метку курсора (+1 мс, чтобы поймать записи той же
    // миллисекунды и корректно доотсечь их по id ниже), иначе — «сейчас».
    const beforeMs = cursor ? cursor.ms + 1 : nowMs;
    const limit = clampLimit(query.limit);
    const fetchLimit = Math.min(limit * 3 + 1, MAX_SOURCE_FETCH);

    const batches = await Promise.all(
      this.deps.sources.map((source) =>
        source
          .fetch(projectId, { sinceMs, beforeMs, limit: fetchLimit })
          .catch(() => [] as readonly AppLogEntry[]),
      ),
    );

    let merged: AppLogEntry[] = [];
    for (const batch of batches) {
      for (const entry of batch) {
        const ms = Date.parse(entry.createdAt);
        if (!Number.isFinite(ms) || ms < sinceMs) continue;
        if (cursor && !isBeforeCursor(entry, cursor)) continue;
        merged.push(entry);
      }
    }

    if (query.category) merged = merged.filter((e) => e.category === query.category);
    if (query.actorId) merged = merged.filter((e) => e.actorId === query.actorId);
    if (query.errorsOnly) merged = merged.filter((e) => !e.success);

    merged.sort(compareDesc);
    const page = merged.slice(0, limit).map((entry) => ({
      ...entry,
      // ЕДИНСТВЕННАЯ точка отдачи detail наружу — чистим здесь, чтобы ни один источник не мог
      // просочить секрет/промпт/путь мимо фильтра (риск безопасности среза 2).
      detail: sanitizeLogDetail(entry.detail),
    }));
    // Есть ли ещё: набрали полную страницу И в окне осталось что-то за её пределами.
    const hasMore = page.length === limit && merged.length > limit;
    const last = page[page.length - 1];
    return { entries: page, nextCursor: hasMore && last ? encodeCursor(last) : null };
  }
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

// ── Конкретные источники над уже существующими портами (без новой таблицы-агрегата) ──────────

function auditToEntry(prefix: string, row: AppAuditEntry): AppLogEntry {
  return {
    id: `${prefix}:${row.id}`,
    category: categorizeAuditOperation(row.operation),
    actorType: row.actorType,
    actorId: row.actorId ?? null,
    operation: row.operation,
    tableName: row.tableName ?? null,
    rowId: row.rowId ?? null,
    success: row.success,
    createdAt: row.createdAt,
    detail: row.detail ?? null,
  };
}

function inWindow(createdAt: string, window: AppLogSourceWindow): boolean {
  const ms = Date.parse(createdAt);
  return Number.isFinite(ms) && ms > window.sinceMs && ms <= window.beforeMs;
}

// Надёжный административный журнал (MariaDB, app_admin_audit_log): раскрытия секретов, экспорт,
// смена чувствительности, CRUD участников. Категория выводится из operation (в основном data).
export class AdminAuditLogSource implements AppLogSource {
  constructor(private readonly adminAudit: AppAdminAuditRepository) {}

  async fetch(projectId: string, window: AppLogSourceWindow): Promise<readonly AppLogEntry[]> {
    const { rows } = await this.adminAudit.list(projectId, { limit: window.limit, offset: 0 });
    return rows
      .filter((row) => inWindow(row.createdAt, window))
      .map((row) => auditToEntry('admin', row));
  }
}

// Рантайм-аудит приложения (per-project SQLite `_audit_log`): CRUD энд-юзеров, визиты страниц,
// auth-события. Категория — из operation (data / runtime / auth). Требует активной схемы бэкенда.
export class RuntimeAuditLogSource implements AppLogSource {
  constructor(
    private readonly appBackends: AppBackendRepository,
    private readonly appDb: AppDatabaseStore,
  ) {}

  async fetch(projectId: string, window: AppLogSourceWindow): Promise<readonly AppLogEntry[]> {
    const backend = await this.appBackends.getByProject(projectId);
    if (!backend || backend.status !== 'active' || !backend.schema) return [];
    this.appDb.ensureDatabase(projectId, backend.schema);
    const { rows } = this.appDb.listAudit(projectId, { limit: window.limit, offset: 0 });
    return rows
      .filter((row) => inWindow(row.createdAt, window))
      .map((row) => auditToEntry('rt', row));
  }
}

// Действия воркера: прогоны из live_sessions (данные — task_progress_events). Один прогон даёт
// событие «запущен», а завершённый — ещё и «завершён». В detail только безопасная метаинформация
// (статус, модель, стоимость, токены, HEAD'ы, число событий) — промпты/пути сюда не кладём, а
// sanitizeLogDetail в QueryAppLogs подстрахует от verbose-полей в любом случае.
export class WorkerLogSource implements AppLogSource {
  constructor(private readonly live: LiveRepository) {}

  async fetch(projectId: string, window: AppLogSourceWindow): Promise<readonly AppLogEntry[]> {
    const sessions = await this.live.listRecentProjectSessions(projectId, window.limit);
    const entries: AppLogEntry[] = [];
    for (const session of sessions) {
      const startedAt = session.startedAt.toISOString();
      if (inWindow(startedAt, window)) entries.push(sessionEntry(session, 'started', startedAt));
      if (session.endedAt) {
        const endedAt = session.endedAt.toISOString();
        if (inWindow(endedAt, window)) entries.push(sessionEntry(session, 'finished', endedAt));
      }
    }
    return entries;
  }
}

function sessionEntry(session: LiveSession, phase: 'started' | 'finished', at: string): AppLogEntry {
  const finished = phase === 'finished';
  return {
    id: `worker:${session.id}:${phase}`,
    category: 'worker',
    actorType: 'system',
    actorId: session.billedUserId,
    operation: `worker.run.${phase}`,
    tableName: null,
    rowId: session.taskId,
    // Прогон считаем неуспешным только когда он ЗАВЕРШИЛСЯ терминальным не-completed статусом.
    success: !finished || session.status === 'completed',
    createdAt: at,
    detail: {
      status: session.status,
      attempt: session.attempt,
      agent: session.agentName,
      model: session.model,
      ...(finished
        ? {
            costUsd: session.costUsd,
            tokensIn: session.tokensIn,
            tokensOut: session.tokensOut,
            eventCount: session.eventCount,
            headBefore: session.headBefore,
            headAfter: session.headAfter,
          }
        : {}),
    },
  };
}

// Публикация статики сайта. Источник читается через минимальный порт (адаптер над site_artifacts
// живёт в composition root). Одна запись «сайт опубликован» на текущий деплой.
export interface AppPublishReader {
  // Последняя публикация проекта или null, если сайт ещё не деплоился.
  getLatestPublish(projectId: string): Promise<{
    readonly deployedAt: Date;
    readonly fileCount: number;
    readonly siteSlug: string | null;
  } | null>;
}

export class PublishLogSource implements AppLogSource {
  constructor(private readonly reader: AppPublishReader) {}

  async fetch(projectId: string, window: AppLogSourceWindow): Promise<readonly AppLogEntry[]> {
    const publish = await this.reader.getLatestPublish(projectId);
    if (!publish) return [];
    const at = publish.deployedAt.toISOString();
    if (!inWindow(at, window)) return [];
    return [
      {
        id: `publish:${projectId}:${at}`,
        category: 'publish',
        actorType: 'system',
        actorId: null,
        operation: 'site.published',
        tableName: null,
        rowId: null,
        success: true,
        createdAt: at,
        detail: { fileCount: publish.fileCount, siteSlug: publish.siteSlug },
      },
    ];
  }
}

// Сборка стандартного набора источников для composition root (index.ts). publish опционален:
// без reader'а раздел publish просто не наполняется. Порядок не важен — слияние сортирует по времени.
export function createAppLogSources(deps: {
  readonly adminAudit: AppAdminAuditRepository;
  readonly appBackends: AppBackendRepository;
  readonly appDb: AppDatabaseStore;
  readonly live: LiveRepository;
  readonly publish?: AppPublishReader;
}): AppLogSource[] {
  const sources: AppLogSource[] = [
    new AdminAuditLogSource(deps.adminAudit),
    new RuntimeAuditLogSource(deps.appBackends, deps.appDb),
    new WorkerLogSource(deps.live),
  ];
  if (deps.publish) sources.push(new PublishLogSource(deps.publish));
  return sources;
}

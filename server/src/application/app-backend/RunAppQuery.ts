import type { AppBackendRepository } from './AppBackendRepository.js';
import type { AppDatabaseStore, Row } from './AppDatabaseStore.js';
import type { AppUser } from './AppAuthService.js';
import {
  appAccessForOperation,
  type AppAccess,
  type AppTable,
} from '../../domain/app-backend/AppSchema.js';
import {
  AppAccessDeniedError,
  AppBackendNotProvisionedError,
  AppSchemaInvalidError,
  AppTableNotAllowedError,
} from '../../domain/app-backend/errors.js';
import { sensitiveColumns } from '../../domain/app-backend/sensitiveFields.js';
import { assertWithinQuota } from './CheckQuota.js';

// Потолок размера батча (bulk / update-many): построчная авторизация ограничена, а условие
// update-many со счётчиком — потенциальный оракул, поэтому число затрагиваемых строк ограничено.
export const BULK_MAX = 100;

export type BulkUpdateItem = { readonly id: string; readonly values?: Row };

type Deps = {
  readonly appBackends: AppBackendRepository;
  readonly appDb: AppDatabaseStore;
};

export type RunAppQueryInput = {
  readonly projectId: string;
  readonly table: string;
  readonly op: 'select' | 'insert' | 'update' | 'delete';
  readonly filter?: Row;
  readonly sort?: { readonly column: string; readonly dir: 'asc' | 'desc' };
  readonly limit?: number;
  readonly offset?: number;
  readonly values?: Row;
  readonly id?: string;
  readonly currentUser?: AppUser | null;
};

export type RunAppQueryResult = Row[] | Row | null | { readonly deleted: number };

// Data-API пользовательского приложения: CRUD поверх таблиц ОБЪЯВЛЕННОЙ схемы, с проверкой правил
// доступа (anyone/authenticated/owner) и квоты. Системные таблицы `_*` через data-API недоступны
// (только через AppAuthService). Клиентские имена полей санитайзятся к белому списку схемы.
export class RunAppQuery {
  constructor(private readonly deps: Deps) {}

  async execute(input: RunAppQueryInput): Promise<RunAppQueryResult> {
    const backend = await this.deps.appBackends.getByProject(input.projectId);
    if (!backend || backend.status !== 'active' || !backend.schema) {
      throw new AppBackendNotProvisionedError(input.projectId);
    }
    const table = backend.schema.tables.find((t) => t.name === input.table);
    if (!table) throw new AppTableNotAllowedError(input.table);

    const user = input.currentUser ?? null;
    const fields = new Set(table.fields.map((f) => f.name));

    if (input.op === 'select') {
      const readAccess = appAccessForOperation(table.rules, 'read');
      this.requireAccess(readAccess, user);
      const where = this.sanitizeFilter(input.filter, fields);
      if (readAccess === 'owner') where.owner_id = user!.id;
      const orderBy =
        input.sort && (fields.has(input.sort.column) || input.sort.column === 'created_at')
          ? input.sort
          : undefined;
      const result = this.deps.appDb.select(input.projectId, table.name, {
        where,
        orderBy,
        limit: input.limit,
        offset: input.offset,
      });
      this.deps.appDb.recordAudit(input.projectId, {
        actorType: 'runtime',
        actorId: user?.id ?? null,
        operation: 'select',
        tableName: table.name,
        detail: { count: result.length },
      });
      return result;
    }

    // --- операции записи ---
    const writeAccess = appAccessForOperation(
      table.rules,
      input.op === 'insert' ? 'create' : input.op,
    );
    this.requireAccess(writeAccess, user);

    if (input.op === 'insert') {
      assertWithinQuota(this.deps.appDb.sizeBytes(input.projectId), backend.storageLimitBytes);
      const values = this.sanitizeValues(input.values, fields);
      if (user) values.owner_id = user.id;
      const row = this.deps.appDb.insert(input.projectId, table.name, values);
      this.deps.appDb.recordAudit(input.projectId, {
        actorType: 'runtime',
        actorId: user?.id ?? null,
        operation: 'insert',
        tableName: table.name,
        rowId: typeof row.id === 'string' ? row.id : null,
        detail: { fields: Object.keys(values) },
      });
      await this.syncUsage(input.projectId);
      return row;
    }

    if (input.op === 'update') {
      if (!input.id) throw new AppAccessDeniedError('id required');
      this.requireOwnership(input.projectId, table, input.id, user, writeAccess);
      assertWithinQuota(this.deps.appDb.sizeBytes(input.projectId), backend.storageLimitBytes);
      const values = this.sanitizeValues(input.values, fields);
      this.deps.appDb.update(input.projectId, table.name, input.id, values);
      this.deps.appDb.recordAudit(input.projectId, {
        actorType: 'runtime',
        actorId: user?.id ?? null,
        operation: 'update',
        tableName: table.name,
        rowId: input.id,
        detail: { fields: Object.keys(values) },
      });
      await this.syncUsage(input.projectId);
      return this.deps.appDb.findOne(input.projectId, table.name, { id: input.id });
    }

    // delete — квоту не проверяем (удаление освобождает место).
    if (!input.id) throw new AppAccessDeniedError('id required');
    this.requireOwnership(input.projectId, table, input.id, user, writeAccess);
    const deleted = this.deps.appDb.remove(input.projectId, table.name, input.id);
    this.deps.appDb.recordAudit(input.projectId, {
      actorType: 'runtime',
      actorId: user?.id ?? null,
      operation: 'delete',
      tableName: table.name,
      rowId: input.id,
      detail: { deleted },
    });
    await this.syncUsage(input.projectId);
    return { deleted };
  }

  // --- Bulk-операции (срез 5, паритет с Base44) ---
  //
  // Правила прав применяются к КАЖДОЙ строке батча (не к запросу), потолок батча — BULK_MAX.
  // Bulk-создание: create-доступ таблицы + owner_id проставляется построчно.
  async bulkInsert(input: {
    readonly projectId: string;
    readonly table: string;
    readonly rows: readonly Row[];
    readonly currentUser?: AppUser | null;
  }): Promise<Row[]> {
    const { backend, table, fields } = await this.resolve(input.projectId, input.table);
    const user = input.currentUser ?? null;
    this.requireAccess(appAccessForOperation(table.rules, 'create'), user);
    const rows = this.requireBatch(input.rows);
    assertWithinQuota(this.deps.appDb.sizeBytes(input.projectId), backend.storageLimitBytes);
    const inserted: Row[] = [];
    for (const raw of rows) {
      const values = this.sanitizeValues(raw, fields);
      if (user) values.owner_id = user.id;
      inserted.push(this.deps.appDb.insert(input.projectId, table.name, values));
    }
    this.deps.appDb.recordAudit(input.projectId, {
      actorType: 'runtime', actorId: user?.id ?? null, operation: 'bulk_insert',
      tableName: table.name, detail: { count: inserted.length },
    });
    await this.syncUsage(input.projectId);
    return inserted;
  }

  // Bulk-обновление по списку {id, values}: owner-правило проверяется ПОСТРОЧНО (requireOwnership),
  // чужая строка в батче отклоняет всю операцию до применения.
  async bulkUpdate(input: {
    readonly projectId: string;
    readonly table: string;
    readonly items: readonly BulkUpdateItem[];
    readonly currentUser?: AppUser | null;
  }): Promise<Row[]> {
    const { backend, table, fields } = await this.resolve(input.projectId, input.table);
    const user = input.currentUser ?? null;
    const access = appAccessForOperation(table.rules, 'update');
    this.requireAccess(access, user);
    const items = this.requireBatch(input.items);
    assertWithinQuota(this.deps.appDb.sizeBytes(input.projectId), backend.storageLimitBytes);
    const updated: Row[] = [];
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || !item.id) {
        throw new AppSchemaInvalidError('each bulk item requires a string id');
      }
      this.requireOwnership(input.projectId, table, item.id, user, access);
      const values = this.sanitizeValues(item.values, fields);
      this.deps.appDb.update(input.projectId, table.name, item.id, values);
      const row = this.deps.appDb.findOne(input.projectId, table.name, { id: item.id });
      if (row) updated.push(row);
    }
    this.deps.appDb.recordAudit(input.projectId, {
      actorType: 'runtime', actorId: user?.id ?? null, operation: 'bulk_update',
      tableName: table.name, detail: { count: updated.length },
    });
    await this.syncUsage(input.projectId);
    return updated;
  }

  // Обновление по условию. БЕЗОПАСНОСТЬ (раздел 4 плана): условие по чувствительной колонке
  // возвращает счётчик изменённых строк — это оракул. Запрещаем так же, как normalizeFilter.
  // Права применяются построчно: под owner-правилом трогаем только свои строки (не через WHERE,
  // а фильтруя кандидатов). Потолок затронутых строк — BULK_MAX.
  async updateMany(input: {
    readonly projectId: string;
    readonly table: string;
    readonly where?: Row;
    readonly values?: Row;
    readonly currentUser?: AppUser | null;
  }): Promise<{ readonly matched: number; readonly updated: number }> {
    const { backend, table, fields } = await this.resolve(input.projectId, input.table);
    const user = input.currentUser ?? null;
    const access = appAccessForOperation(table.rules, 'update');
    this.requireAccess(access, user);
    const rawWhere = input.where ?? {};
    if (!rawWhere || typeof rawWhere !== 'object' || Array.isArray(rawWhere)) {
      throw new AppSchemaInvalidError('update-many requires a condition object');
    }
    const sensitive = sensitiveColumns(table.fields);
    for (const key of Object.keys(rawWhere)) {
      if (sensitive.has(key)) {
        throw new AppSchemaInvalidError(`column ${key} is sensitive and cannot be matched by condition`);
      }
    }
    const where = this.sanitizeFilter(rawWhere, fields);
    if (Object.keys(where).length === 0) {
      throw new AppSchemaInvalidError('update-many requires a non-empty condition');
    }
    const values = this.sanitizeValues(input.values, fields);
    if (Object.keys(values).length === 0) {
      throw new AppSchemaInvalidError('update-many requires values to set');
    }
    assertWithinQuota(this.deps.appDb.sizeBytes(input.projectId), backend.storageLimitBytes);
    // Под правилом owner сужаем выборку кандидатов по владельцу ДО подсчёта, как в
    // select-ветке (:65). Иначе matched считает и чужие строки, и возвращаемое число
    // становится оракулом: перебором условий по нечувствительной колонке (plan=premium,
    // city=X) вызывающий узнаёт точное количество чужих записей, хотя менять их не может.
    if (access === 'owner') where.owner_id = user!.id;
    const candidates = this.deps.appDb.select(input.projectId, table.name, { where, limit: BULK_MAX });
    let updated = 0;
    for (const row of candidates) {
      const changes = this.deps.appDb.update(input.projectId, table.name, String(row.id), values);
      if (changes > 0) updated += 1;
    }
    this.deps.appDb.recordAudit(input.projectId, {
      actorType: 'runtime', actorId: user?.id ?? null, operation: 'update_many',
      tableName: table.name, detail: { matched: candidates.length, updated },
    });
    await this.syncUsage(input.projectId);
    return { matched: candidates.length, updated };
  }

  // Восстановление мягко удалённой строки (soft-delete из store). Требует update-доступ и построчную
  // проверку владельца; findOne видит удалённые строки, поэтому владелец проверяется до restore.
  async restore(input: {
    readonly projectId: string;
    readonly table: string;
    readonly id: string;
    readonly currentUser?: AppUser | null;
  }): Promise<Row | null> {
    const { table } = await this.resolve(input.projectId, input.table);
    const user = input.currentUser ?? null;
    const access = appAccessForOperation(table.rules, 'update');
    this.requireAccess(access, user);
    if (!input.id) throw new AppAccessDeniedError('id required');
    this.requireOwnership(input.projectId, table, input.id, user, access);
    const restored = this.deps.appDb.restore(input.projectId, table.name, input.id);
    this.deps.appDb.recordAudit(input.projectId, {
      actorType: 'runtime', actorId: user?.id ?? null, operation: 'restore',
      tableName: table.name, rowId: input.id, detail: { restored },
    });
    await this.syncUsage(input.projectId);
    return restored > 0 ? this.deps.appDb.findOne(input.projectId, table.name, { id: input.id }) : null;
  }

  private async resolve(projectId: string, tableName: string): Promise<{
    backend: NonNullable<Awaited<ReturnType<Deps['appBackends']['getByProject']>>>;
    table: AppTable;
    fields: Set<string>;
  }> {
    const backend = await this.deps.appBackends.getByProject(projectId);
    if (!backend || backend.status !== 'active' || !backend.schema) {
      throw new AppBackendNotProvisionedError(projectId);
    }
    const table = backend.schema.tables.find((t) => t.name === tableName);
    if (!table) throw new AppTableNotAllowedError(tableName);
    return { backend, table, fields: new Set(table.fields.map((f) => f.name)) };
  }

  private requireBatch<T>(items: readonly T[] | undefined): readonly T[] {
    if (!Array.isArray(items)) throw new AppSchemaInvalidError('batch must be an array');
    if (items.length === 0) throw new AppSchemaInvalidError('batch must not be empty');
    if (items.length > BULK_MAX) throw new AppSchemaInvalidError(`batch size ${items.length} exceeds ${BULK_MAX}`);
    return items;
  }

  private async syncUsage(projectId: string): Promise<void> {
    await this.deps.appBackends.setUsage(projectId, this.deps.appDb.sizeBytes(projectId));
  }

  private requireAccess(access: AppAccess, user: AppUser | null): void {
    if (access === 'anyone') return;
    if (!user) throw new AppAccessDeniedError('authentication required');
    // 'authenticated' и 'owner' оба требуют юзера; построчная проверка owner — в requireOwnership.
  }

  private requireOwnership(
    projectId: string,
    table: AppTable,
    id: string,
    user: AppUser | null,
    access: AppAccess,
  ): void {
    if (access !== 'owner') return;
    const row = this.deps.appDb.findOne(projectId, table.name, { id });
    if (!row) throw new AppAccessDeniedError('row not found');
    if (String(row.owner_id) !== user!.id) throw new AppAccessDeniedError('not the owner');
  }

  private sanitizeFilter(filter: Row | undefined, fields: Set<string>): Row {
    const out: Row = {};
    if (!filter) return out;
    for (const [k, v] of Object.entries(filter)) {
      if (fields.has(k) || k === 'id' || k === 'owner_id') out[k] = v;
    }
    return out;
  }

  private sanitizeValues(values: Row | undefined, fields: Set<string>): Row {
    // Только объявленные поля; id/owner_id/created_at — управляются рантаймом, не клиентом.
    const out: Row = {};
    if (!values) return out;
    for (const [k, v] of Object.entries(values)) {
      if (fields.has(k)) out[k] = v;
    }
    return out;
  }
}

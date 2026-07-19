import type {
  AppAuditEntry,
  AppDataFilter,
  AppDatabaseStore,
  AppFilterOperator,
  Row,
} from './AppDatabaseStore.js';
import type { AppBackendRepository } from './AppBackendRepository.js';
import type {
  AppAccess,
  AppField,
  AppSchema,
  AppTable,
} from '../../domain/app-backend/AppSchema.js';
import { appAccessForOperation } from '../../domain/app-backend/AppSchema.js';
import type { SensitiveKind } from '../../domain/app-backend/sensitiveFields.js';
import { SECRET_MASK, maskValue, sensitiveColumns } from '../../domain/app-backend/sensitiveFields.js';
import {
  AppBackendNotProvisionedError,
  AppSchemaInvalidError,
  AppTableNotAllowedError,
} from '../../domain/app-backend/errors.js';
import type { ProjectAccessDeps } from '../project/projectAccess.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import { validateAppSchema } from './validateAppSchema.js';
import { assertWithinQuota } from './CheckQuota.js';

type Deps = ProjectAccessDeps & {
  readonly appBackends: AppBackendRepository;
  readonly appDb: AppDatabaseStore;
};

const FILTER_OPERATORS: readonly AppFilterOperator[] = [
  'eq',
  'neq',
  'contains',
  'starts_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_empty',
  'is_not_empty',
];
const EMPTINESS_OPERATORS: readonly AppFilterOperator[] = ['is_empty', 'is_not_empty'];
const ACCESS: readonly AppAccess[] = ['anyone', 'authenticated', 'owner'];

export type AppBackendDashboard = {
  readonly status: 'none' | 'active';
  readonly usageBytes: number;
  readonly storageLimitBytes: number;
  readonly schema: AppSchema | null;
  readonly updatedAt: string | null;
};

export type AppRowsPage = {
  readonly rows: readonly Row[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  // Колонки, значения которых замаскированы. UI показывает их как «скрыто» и предлагает
  // точечное раскрытие через revealRowValue.
  readonly masked: Readonly<Record<string, SensitiveKind>>;
};

export type AppRowsQuery = {
  readonly filters?: readonly AppDataFilter[];
  readonly search?: string;
  readonly sort?: { readonly column: string; readonly dir: 'asc' | 'desc' };
  readonly limit?: number;
  readonly offset?: number;
};

export type AppCrudRules = {
  readonly create: AppAccess;
  readonly read: AppAccess;
  readonly update: AppAccess;
  readonly delete: AppAccess;
};
export type AppRuntimeUser = { readonly id: string; readonly email: string; readonly createdAt: string; readonly activeSessions: number };

// Административный слой Data Explorer. В отличие от публичного App Runtime он авторизует
// участника ПРОЕКТА и намеренно не применяет row-owner правила к просмотру: editor проекта
// управляет приложением целиком. Все имена по-прежнему берутся только из AppSchema.
export class ManageAppBackendData {
  constructor(private readonly deps: Deps) {}

  async getDashboard(projectId: string, callerUserId: string): Promise<AppBackendDashboard> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'read_project');
    const backend = await this.deps.appBackends.getByProject(projectId);
    if (!backend || backend.status !== 'active' || !backend.schema) {
      return {
        status: 'none',
        usageBytes: 0,
        storageLimitBytes: 0,
        schema: null,
        updatedAt: null,
      };
    }
    this.deps.appDb.ensureDatabase(projectId, backend.schema);
    return {
      status: 'active',
      usageBytes: this.deps.appDb.sizeBytes(projectId),
      storageLimitBytes: backend.storageLimitBytes,
      schema: backend.schema,
      updatedAt: backend.updatedAt.toISOString(),
    };
  }

  async listRows(
    projectId: string,
    callerUserId: string,
    tableName: string,
    query: AppRowsQuery,
  ): Promise<AppRowsPage> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'read_project');
    const { table } = await this.requireTable(projectId, tableName);
    const columns = this.columnSet(table);
    const sensitive = sensitiveColumns(table.fields);
    const filters = (query.filters ?? []).slice(0, 20).map((filter) =>
      this.normalizeFilter(table, filter));
    const limit = clamp(query.limit, 1, 100, 50);
    const offset = clamp(query.offset, 0, 1_000_000, 0);
    // Сортировка по чувствительной колонке — это компаратор скрытых значений: порядок строк
    // вместе с пагинацией позволяет двоичным поиском восстановить то, что мы маскируем.
    if (query.sort && sensitive.has(query.sort.column)) {
      throw new AppSchemaInvalidError(`column ${query.sort.column} is sensitive and cannot be sorted by`);
    }
    const sort = query.sort && columns.has(query.sort.column)
      ? { column: query.sort.column, dir: query.sort.dir === 'desc' ? 'desc' as const : 'asc' as const }
      : { column: 'created_at', dir: 'desc' as const };
    const searchValue = typeof query.search === 'string' ? query.search.slice(0, 200) : '';
    // Свободный поиск не заходит в чувствительные колонки (ни секреты, ни PII): совпадение по
    // ним работает как оракул и позволяет побайтово подобрать значение, которое мы намеренно
    // не показываем — номер карты подбирается так же, как API-ключ.
    const search = searchValue.trim()
      ? {
          columns: [...columns].filter((column) => !sensitive.has(column)),
          value: searchValue.trim(),
        }
      : undefined;
    const opts = { filters, search };
    const rows = this.deps.appDb.select(projectId, table.name, {
      ...opts,
      orderBy: sort,
      limit,
      offset,
    }).map((row) => this.maskRow(sensitive, this.fromStorageRow(table, row)));
    const total = this.deps.appDb.count(projectId, table.name, opts);
    this.deps.appDb.recordAudit(projectId, {
      actorType: 'project_member',
      actorId: callerUserId,
      operation: 'dashboard.select',
      tableName: table.name,
      detail: { count: rows.length, filtered: filters.length > 0 || Boolean(search) },
    });
    return { rows, total, limit, offset, masked: Object.fromEntries(sensitive) };
  }

  // Точечное раскрытие одного чувствительного значения. Отдельная операция, потому что
  // требует права редактирования и ВСЕГДА оставляет след в аудите — в отличие от чтения грида.
  async revealRowValue(
    projectId: string,
    callerUserId: string,
    tableName: string,
    rowId: string,
    column: string,
  ): Promise<{ readonly value: unknown }> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'update_project');
    const { table } = await this.requireTable(projectId, tableName);
    const sensitive = sensitiveColumns(table.fields);
    if (!sensitive.has(column)) throw new AppTableNotAllowedError(`column ${column}`);
    const row = this.deps.appDb.findOne(projectId, table.name, { id: rowId });
    this.deps.appDb.recordAudit(projectId, {
      actorType: 'project_member',
      actorId: callerUserId,
      operation: 'dashboard.reveal',
      tableName: table.name,
      rowId,
      detail: { column, kind: sensitive.get(column) },
    });
    if (!row) return { value: null };
    return { value: this.fromStorageRow(table, row)[column] ?? null };
  }

  async insertRow(
    projectId: string,
    callerUserId: string,
    tableName: string,
    rawValues: unknown,
  ): Promise<Row> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'update_project');
    const { backend, table } = await this.requireTable(projectId, tableName);
    assertWithinQuota(this.deps.appDb.sizeBytes(projectId), backend.storageLimitBytes);
    const values = this.normalizeValues(table, rawValues, true);
    for (const [column, kind] of sensitiveColumns(table.fields)) {
      if (kind === 'secret' && values[column] === SECRET_MASK) {
        throw new AppSchemaInvalidError(`${column} must not be the mask placeholder`);
      }
    }
    const row = this.maskRow(
      sensitiveColumns(table.fields),
      this.fromStorageRow(table, this.deps.appDb.insert(projectId, table.name, values)),
    );
    this.deps.appDb.recordAudit(projectId, {
      actorType: 'project_member',
      actorId: callerUserId,
      operation: 'dashboard.insert',
      tableName: table.name,
      rowId: typeof row.id === 'string' ? row.id : null,
      detail: { fields: Object.keys(values) },
    });
    await this.syncUsage(projectId);
    return row;
  }

  async updateRow(
    projectId: string,
    callerUserId: string,
    tableName: string,
    rowId: string,
    rawValues: unknown,
  ): Promise<Row | null> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'update_project');
    const { backend, table } = await this.requireTable(projectId, tableName);
    assertWithinQuota(this.deps.appDb.sizeBytes(projectId), backend.storageLimitBytes);
    const sensitive = sensitiveColumns(table.fields);
    const current = sensitive.size > 0
      ? this.deps.appDb.findOne(projectId, table.name, { id: rowId })
      : null;
    // Клиент видит маску вместо настоящего значения. Если он прислал её обратно нетронутой —
    // это «поле не редактировали», а не «затереть маской». Отбрасываем маски ДО нормализации
    // типов: для datetime/int/real маска не парсится и запрос падал бы 400 раньше проверки.
    const values = this.normalizeValues(
      table,
      this.dropUnchangedMasks(sensitive, current, rawValues),
      false,
    );
    this.deps.appDb.update(projectId, table.name, rowId, values);
    this.deps.appDb.recordAudit(projectId, {
      actorType: 'project_member',
      actorId: callerUserId,
      operation: 'dashboard.update',
      tableName: table.name,
      rowId,
      detail: { fields: Object.keys(values) },
    });
    await this.syncUsage(projectId);
    const row = this.deps.appDb.findOne(projectId, table.name, { id: rowId });
    return row ? this.maskRow(sensitiveColumns(table.fields), this.fromStorageRow(table, row)) : null;
  }

  async deleteRow(
    projectId: string,
    callerUserId: string,
    tableName: string,
    rowId: string,
  ): Promise<{ deleted: number }> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'update_project');
    const { table } = await this.requireTable(projectId, tableName);
    const deleted = this.deps.appDb.remove(projectId, table.name, rowId);
    this.deps.appDb.recordAudit(projectId, {
      actorType: 'project_member',
      actorId: callerUserId,
      operation: 'dashboard.delete',
      tableName: table.name,
      rowId,
      detail: { deleted },
    });
    await this.syncUsage(projectId);
    return { deleted };
  }

  async updateRules(
    projectId: string,
    callerUserId: string,
    tableName: string,
    rawRules: unknown,
  ): Promise<AppCrudRules> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'update_project');
    const { backend, table } = await this.requireTable(projectId, tableName);
    const rules = this.normalizeRules(rawRules);
    const schema = validateAppSchema({
      tables: backend.schema!.tables.map((candidate) => candidate.name === table.name
        ? {
            ...candidate,
            rules: {
              read: rules.read,
              // write остаётся compatibility-default для старых runtime-клиентов.
              write: rules.update,
              create: rules.create,
              update: rules.update,
              delete: rules.delete,
            },
          }
        : candidate),
    });
    await this.deps.appBackends.upsert({
      projectId,
      status: backend.status,
      schema,
      appKeyHash: backend.appKeyHash,
      storageLimitBytes: backend.storageLimitBytes,
    });
    this.deps.appDb.recordAudit(projectId, {
      actorType: 'project_member',
      actorId: callerUserId,
      operation: 'dashboard.permissions',
      tableName: table.name,
      detail: rules,
    });
    return rules;
  }

  async listLogs(
    projectId: string,
    callerUserId: string,
    opts: {
      readonly tableName?: string;
      readonly operation?: string;
      readonly actorId?: string;
      readonly errorsOnly?: boolean;
      readonly limit?: number;
      readonly offset?: number;
    },
  ): Promise<{ rows: AppAuditEntry[]; total: number }> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'read_project');
    const backend = await this.deps.appBackends.getByProject(projectId);
    if (!backend || backend.status !== 'active' || !backend.schema) return { rows: [], total: 0 };
    this.deps.appDb.ensureDatabase(projectId, backend.schema);
    return this.deps.appDb.listAudit(projectId, {
      tableName: cleanOptional(opts.tableName, 64),
      operation: cleanOptional(opts.operation, 80),
      actorId: cleanOptional(opts.actorId, 64),
      errorsOnly: opts.errorsOnly === true,
      limit: clamp(opts.limit, 1, 250, 100),
      offset: clamp(opts.offset, 0, 1_000_000, 0),
    });
  }

  async listRuntimeUsers(projectId: string, callerUserId: string): Promise<readonly AppRuntimeUser[]> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'read_project');
    const backend = await this.deps.appBackends.getByProject(projectId);
    if (!backend || backend.status !== 'active' || !backend.schema) return [];
    this.deps.appDb.ensureDatabase(projectId, backend.schema);
    const sessions = this.deps.appDb.select(projectId, '_sessions', { limit: 10_000 });
    const now = Date.now();
    const counts = new Map<string, number>();
    for (const session of sessions) {
      if (new Date(String(session.expires_at)).getTime() <= now) continue;
      const userId = String(session.user_id);
      counts.set(userId, (counts.get(userId) ?? 0) + 1);
    }
    // Адреса рантайм-пользователей — та же PII, что и в пользовательских таблицах: маскируем
    // так же и оставляем след в аудите, иначе это канал массовой выгрузки почт мимо схемы.
    const users = this.deps.appDb.select(projectId, '_users', { orderBy: { column: 'created_at', dir: 'desc' }, limit: 5_000 }).map((row) => ({
      id: String(row.id),
      email: String(maskValue(String(row.email), 'pii')),
      createdAt: String(row.created_at),
      activeSessions: counts.get(String(row.id)) ?? 0,
    }));
    this.deps.appDb.recordAudit(projectId, {
      actorType: 'project_member',
      actorId: callerUserId,
      operation: 'dashboard.users.list',
      tableName: '_users',
      detail: { count: users.length },
    });
    return users;
  }

  async revokeRuntimeUserSessions(projectId: string, callerUserId: string, userId: string): Promise<{ revoked: number }> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'update_project');
    const backend = await this.deps.appBackends.getByProject(projectId);
    if (!backend || backend.status !== 'active' || !backend.schema) throw new AppBackendNotProvisionedError(projectId);
    this.deps.appDb.ensureDatabase(projectId, backend.schema);
    const revoked = this.deps.appDb.removeWhere(projectId, '_sessions', { user_id: userId });
    this.deps.appDb.recordAudit(projectId, { actorType: 'project_member', actorId: callerUserId, operation: 'dashboard.user.sessions.revoke', rowId: userId, detail: { revoked } });
    return { revoked };
  }

  async deleteRuntimeUser(projectId: string, callerUserId: string, userId: string): Promise<{ deleted: number }> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'update_project');
    const backend = await this.deps.appBackends.getByProject(projectId);
    if (!backend || backend.status !== 'active' || !backend.schema) throw new AppBackendNotProvisionedError(projectId);
    this.deps.appDb.ensureDatabase(projectId, backend.schema);
    this.deps.appDb.removeWhere(projectId, '_sessions', { user_id: userId });
    const deleted = this.deps.appDb.remove(projectId, '_users', userId);
    this.deps.appDb.recordAudit(projectId, { actorType: 'project_member', actorId: callerUserId, operation: 'dashboard.user.delete', rowId: userId, detail: { deleted } });
    return { deleted };
  }

  private async requireTable(projectId: string, tableName: string): Promise<{
    backend: NonNullable<Awaited<ReturnType<AppBackendRepository['getByProject']>>>;
    table: AppTable;
  }> {
    const backend = await this.deps.appBackends.getByProject(projectId);
    if (!backend || backend.status !== 'active' || !backend.schema) {
      throw new AppBackendNotProvisionedError(projectId);
    }
    const table = backend.schema.tables.find((candidate) => candidate.name === tableName);
    if (!table) throw new AppTableNotAllowedError(tableName);
    this.deps.appDb.ensureDatabase(projectId, backend.schema);
    return { backend, table };
  }

  private columnSet(table: AppTable): Set<string> {
    return new Set(['id', 'owner_id', 'created_at', ...table.fields.map((field) => field.name)]);
  }

  private normalizeFilter(table: AppTable, raw: AppDataFilter): AppDataFilter {
    if (!raw || typeof raw !== 'object') throw new AppSchemaInvalidError('invalid filter');
    const columns = this.columnSet(table);
    if (!columns.has(raw.column)) throw new AppTableNotAllowedError(`column ${raw.column}`);
    if (!FILTER_OPERATORS.includes(raw.operator)) throw new AppSchemaInvalidError('invalid filter operator');
    // По чувствительной колонке (секрет ИЛИ PII) разрешаем только проверку на заполненность:
    // сравнение со значением превратило бы фильтр в оракул для подбора скрытого значения.
    if (
      sensitiveColumns(table.fields).has(raw.column)
      && !EMPTINESS_OPERATORS.includes(raw.operator)
    ) {
      throw new AppSchemaInvalidError(`column ${raw.column} is sensitive and cannot be matched by value`);
    }
    const field = table.fields.find((candidate) => candidate.name === raw.column);
    return {
      column: raw.column,
      operator: raw.operator,
      ...(!EMPTINESS_OPERATORS.includes(raw.operator)
        ? { value: field ? this.normalizeFieldValue(field, raw.value, false) : raw.value }
        : {}),
    };
  }

  private normalizeValues(table: AppTable, raw: unknown, inserting: boolean): Row {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new AppSchemaInvalidError('values must be an object');
    }
    const input = raw as Record<string, unknown>;
    const values: Row = {};
    for (const field of table.fields) {
      if (!(field.name in input)) {
        if (inserting && field.required) {
          throw new AppSchemaInvalidError(`${table.name}.${field.name} is required`);
        }
        continue;
      }
      values[field.name] = this.normalizeFieldValue(field, input[field.name], field.required === true);
    }
    return values;
  }

  private normalizeFieldValue(field: AppField, raw: unknown, required: boolean): unknown {
    if (raw === null || raw === undefined || raw === '') {
      if (required) throw new AppSchemaInvalidError(`${field.name} is required`);
      return null;
    }
    if (field.type === 'text') return String(raw).slice(0, 100_000);
    if (field.type === 'bool') {
      if (raw === true || raw === 1 || raw === '1' || raw === 'true') return true;
      if (raw === false || raw === 0 || raw === '0' || raw === 'false') return false;
      throw new AppSchemaInvalidError(`${field.name} must be boolean`);
    }
    if (field.type === 'int') {
      const value = Number(raw);
      if (!Number.isSafeInteger(value)) throw new AppSchemaInvalidError(`${field.name} must be integer`);
      return value;
    }
    if (field.type === 'real') {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new AppSchemaInvalidError(`${field.name} must be number`);
      return value;
    }
    const value = new Date(String(raw));
    if (Number.isNaN(value.getTime())) throw new AppSchemaInvalidError(`${field.name} must be datetime`);
    return value.toISOString();
  }

  // Работает по СЫРОМУ вводу (до нормализации типов): маска — всегда строка, и для колонки
  // нетекстового типа нормализация отвергла бы её как невалидное значение.
  private dropUnchangedMasks(
    sensitive: ReadonlyMap<string, SensitiveKind>,
    current: Row | null,
    raw: unknown,
  ): unknown {
    if (sensitive.size === 0 || !raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const result = { ...(raw as Record<string, unknown>) };
    for (const [column, kind] of sensitive) {
      if (!(column in result)) continue;
      if (kind === 'secret' && result[column] === SECRET_MASK) { delete result[column]; continue; }
      if (current && column in current && result[column] === maskValue(current[column], kind)) {
        delete result[column];
      }
    }
    return result;
  }

  private maskRow(sensitive: ReadonlyMap<string, SensitiveKind>, row: Row): Row {
    if (sensitive.size === 0) return row;
    const result: Row = { ...row };
    for (const [column, kind] of sensitive) {
      if (column in result) result[column] = maskValue(result[column], kind);
    }
    return result;
  }

  private fromStorageRow(table: AppTable, row: Row): Row {
    const result: Row = { ...row };
    for (const field of table.fields) {
      if (field.type === 'bool' && result[field.name] !== null && result[field.name] !== undefined) {
        result[field.name] = result[field.name] === true || result[field.name] === 1;
      }
    }
    return result;
  }

  private normalizeRules(raw: unknown): AppCrudRules {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new AppSchemaInvalidError('rules must be an object');
    }
    const value = raw as Record<string, unknown>;
    const get = (key: keyof AppCrudRules): AppAccess => {
      const access = value[key];
      if (typeof access !== 'string' || !ACCESS.includes(access as AppAccess)) {
        throw new AppSchemaInvalidError(`invalid rules.${key}`);
      }
      return access as AppAccess;
    };
    return { create: get('create'), read: get('read'), update: get('update'), delete: get('delete') };
  }

  private async syncUsage(projectId: string): Promise<void> {
    await this.deps.appBackends.setUsage(projectId, this.deps.appDb.sizeBytes(projectId));
  }
}

export function effectiveCrudRules(table: AppTable): AppCrudRules {
  return {
    create: appAccessForOperation(table.rules, 'create'),
    read: appAccessForOperation(table.rules, 'read'),
    update: appAccessForOperation(table.rules, 'update'),
    delete: appAccessForOperation(table.rules, 'delete'),
  };
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function cleanOptional(value: string | undefined, max: number): string | undefined {
  const cleaned = value?.trim().slice(0, max);
  return cleaned || undefined;
}

import { AppSchemaInvalidError } from '../../domain/app-backend/errors.js';
import type {
  AppAccess,
  AppField,
  AppFieldType,
  AppSchema,
  AppTable,
} from '../../domain/app-backend/AppSchema.js';

// Имя таблицы/поля: строчная буква, дальше буквы/цифры/подчёркивания. Ведущий `_` запрещён
// (под ним живут системные таблицы `_users`/`_sessions`/`_meta`).
const NAME_RE = /^[a-z][a-z0-9_]*$/;
const FIELD_TYPES: readonly AppFieldType[] = ['text', 'int', 'real', 'bool', 'datetime'];
const ACCESS: readonly AppAccess[] = ['anyone', 'authenticated', 'owner'];
// Колонки, которые App Runtime добавляет и ведёт сам — объявлять в схеме нельзя.
const RESERVED_FIELDS = new Set(['id', 'owner_id', 'created_at']);
const MAX_TABLES = 50;
const MAX_FIELDS = 100;

function fail(msg: string): never {
  throw new AppSchemaInvalidError(msg);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Валидирует и НОРМАЛИЗУЕТ объявленную схему приложения. Бросает AppSchemaInvalidError на любой
// некорректный ввод. Результат — единственный источник имён таблиц/полей для App Runtime
// (белый список; ничего из сырого клиентского ввода в SQL не попадает).
export function validateAppSchema(raw: unknown): AppSchema {
  if (!isObj(raw)) fail('schema must be an object');
  const tablesRaw = raw.tables;
  if (!Array.isArray(tablesRaw)) fail('schema.tables must be an array');
  if (tablesRaw.length > MAX_TABLES) fail(`too many tables (max ${MAX_TABLES})`);

  const tables: AppTable[] = [];
  const seenTables = new Set<string>();

  for (const t of tablesRaw) {
    if (!isObj(t)) fail('each table must be an object');
    const name = t.name;
    if (typeof name !== 'string' || !NAME_RE.test(name)) fail(`invalid table name: ${String(name)}`);
    if (seenTables.has(name)) fail(`duplicate table: ${name}`);
    seenTables.add(name);

    const fieldsRaw = t.fields;
    if (!Array.isArray(fieldsRaw)) fail(`table ${name}: fields must be an array`);
    if (fieldsRaw.length > MAX_FIELDS) fail(`table ${name}: too many fields (max ${MAX_FIELDS})`);

    const fields: AppField[] = [];
    const seenFields = new Set<string>();
    for (const f of fieldsRaw) {
      if (!isObj(f)) fail(`table ${name}: each field must be an object`);
      const fname = f.name;
      if (typeof fname !== 'string' || !NAME_RE.test(fname)) {
        fail(`table ${name}: invalid field name: ${String(fname)}`);
      }
      if (RESERVED_FIELDS.has(fname)) fail(`table ${name}: field '${fname}' is reserved (auto-managed)`);
      if (seenFields.has(fname)) fail(`table ${name}: duplicate field: ${fname}`);
      seenFields.add(fname);
      const ftype = f.type;
      if (typeof ftype !== 'string' || !FIELD_TYPES.includes(ftype as AppFieldType)) {
        fail(`table ${name}.${fname}: invalid type: ${String(ftype)}`);
      }
      fields.push({
        name: fname,
        type: ftype as AppFieldType,
        ...(f.required === true ? { required: true } : {}),
        ...(f.unique === true ? { unique: true } : {}),
      });
    }

    const rulesRaw = t.rules;
    if (!isObj(rulesRaw)) fail(`table ${name}: rules must be an object`);
    const read = rulesRaw.read;
    const write = rulesRaw.write;
    if (typeof read !== 'string' || !ACCESS.includes(read as AppAccess)) {
      fail(`table ${name}: invalid rules.read`);
    }
    if (typeof write !== 'string' || !ACCESS.includes(write as AppAccess)) {
      fail(`table ${name}: invalid rules.write`);
    }

    const operationRules: Partial<Record<'create' | 'update' | 'delete', AppAccess>> = {};
    for (const operation of ['create', 'update', 'delete'] as const) {
      const value = rulesRaw[operation];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !ACCESS.includes(value as AppAccess)) {
        fail(`table ${name}: invalid rules.${operation}`);
      }
      operationRules[operation] = value as AppAccess;
    }

    tables.push({
      name,
      fields,
      rules: { read: read as AppAccess, write: write as AppAccess, ...operationRules },
    });
  }

  return { tables };
}

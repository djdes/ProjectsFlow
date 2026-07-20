import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAppSchema } from './validateAppSchema.js';
import { AppSchemaInvalidError } from '../../domain/app-backend/errors.js';

const valid = {
  tables: [
    {
      name: 'posts',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'views', type: 'int' },
      ],
      rules: { read: 'anyone', write: 'owner' },
    },
  ],
};

test('validateAppSchema: валидная схема → нормализуется', () => {
  const s = validateAppSchema(valid);
  assert.equal(s.tables.length, 1);
  assert.equal(s.tables[0]!.name, 'posts');
  assert.equal(s.tables[0]!.fields[0]!.required, true);
  assert.equal(s.tables[0]!.fields[1]!.required, undefined);
  assert.equal(s.tables[0]!.rules.read, 'anyone');
});

test('validateAppSchema: пустой список таблиц допустим', () => {
  assert.deepEqual(validateAppSchema({ tables: [] }), { tables: [] });
});

test('validateAppSchema: не объект / нет tables → ошибка', () => {
  assert.throws(() => validateAppSchema(null), AppSchemaInvalidError);
  assert.throws(() => validateAppSchema({}), AppSchemaInvalidError);
  assert.throws(() => validateAppSchema({ tables: 'x' }), AppSchemaInvalidError);
});

test('validateAppSchema: плохое имя таблицы → ошибка', () => {
  for (const name of ['Posts', '1posts', '_users', 'po sts', 'po-sts']) {
    assert.throws(
      () =>
        validateAppSchema({ tables: [{ name, fields: [], rules: { read: 'anyone', write: 'owner' } }] }),
      AppSchemaInvalidError,
      `expected reject for name=${name}`,
    );
  }
});

test('validateAppSchema: зарезервированное имя поля → ошибка', () => {
  for (const fname of ['id', 'owner_id', 'created_at']) {
    assert.throws(
      () =>
        validateAppSchema({
          tables: [{ name: 'posts', fields: [{ name: fname, type: 'int' }], rules: { read: 'anyone', write: 'owner' } }],
        }),
      AppSchemaInvalidError,
      `expected reject for field=${fname}`,
    );
  }
});

test('validateAppSchema: неизвестный тип поля → ошибка', () => {
  assert.throws(
    () =>
      validateAppSchema({
        tables: [{ name: 'posts', fields: [{ name: 'x', type: 'json' }], rules: { read: 'anyone', write: 'owner' } }],
      }),
    AppSchemaInvalidError,
  );
});

test('validateAppSchema: дубли таблиц/полей → ошибка', () => {
  assert.throws(
    () =>
      validateAppSchema({
        tables: [
          { name: 'posts', fields: [], rules: { read: 'anyone', write: 'owner' } },
          { name: 'posts', fields: [], rules: { read: 'anyone', write: 'owner' } },
        ],
      }),
    AppSchemaInvalidError,
  );
  assert.throws(
    () =>
      validateAppSchema({
        tables: [
          {
            name: 'posts',
            fields: [
              { name: 'x', type: 'text' },
              { name: 'x', type: 'int' },
            ],
            rules: { read: 'anyone', write: 'owner' },
          },
        ],
      }),
    AppSchemaInvalidError,
  );
});

test('validateAppSchema: флаг sensitive принимается и нормализуется', () => {
  const s = validateAppSchema({
    tables: [{
      name: 'notes',
      fields: [
        { name: 'title', type: 'text' },
        { name: 'body', type: 'text', sensitive: 'secret' },
        { name: 'contact', type: 'text', sensitive: 'pii' },
      ],
      rules: { read: 'owner', write: 'owner' },
    }],
  });
  assert.equal(s.tables[0]!.fields[0]!.sensitive, undefined);
  assert.equal(s.tables[0]!.fields[1]!.sensitive, 'secret');
  assert.equal(s.tables[0]!.fields[2]!.sensitive, 'pii');
});

test('validateAppSchema: неверный флаг sensitive → ошибка', () => {
  assert.throws(
    () => validateAppSchema({
      tables: [{ name: 'notes', fields: [{ name: 'body', type: 'text', sensitive: 'private' }], rules: { read: 'owner', write: 'owner' } }],
    }),
    AppSchemaInvalidError,
  );
});

test('validateAppSchema: битые/невалидные правила доступа → ошибка', () => {
  assert.throws(
    () => validateAppSchema({ tables: [{ name: 'posts', fields: [], rules: { read: 'anyone' } }] }),
    AppSchemaInvalidError,
  );
  assert.throws(
    () =>
      validateAppSchema({ tables: [{ name: 'posts', fields: [], rules: { read: 'everyone', write: 'owner' } }] }),
    AppSchemaInvalidError,
  );
});

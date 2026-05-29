// Создаёт изолированную тестовую БД для file-sync интеграционных прогонов.
// Запуск: node --env-file=.env tools/sync-test/create-testdb.mjs
// Боевую/dev БД (projectsflow) НЕ трогает — создаёт отдельную projectsflow_synctest.
import mysql from 'mysql2/promise';

const TEST_DB = process.env.SYNC_TEST_DB || 'projectsflow_synctest';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  multipleStatements: true,
  // подключаемся БЕЗ database, чтобы иметь право CREATE DATABASE
});

try {
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  console.log(`OK: database \`${TEST_DB}\` ensured`);
  const [dbs] = await conn.query('SHOW DATABASES');
  console.log('databases:', dbs.map((r) => Object.values(r)[0]).join(', '));
} catch (e) {
  console.error('FAILED to create test DB:', e.code, e.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}

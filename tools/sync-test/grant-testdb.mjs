// Выдаёт app-пользователю права на тестовую БД (запускается под root@localhost).
import mysql from 'mysql2/promise';
const TEST_DB = process.env.SYNC_TEST_DB || 'projectsflow_synctest';
const appUser = process.env.DB_USER || 'projectsflow';
const c = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: 'root',
  password: '',
  multipleStatements: true,
});
await c.query(`CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
// грантим только существующему user@localhost (его использует app); другие host-варианты не создаём
await c.query(`GRANT ALL PRIVILEGES ON \`${TEST_DB}\`.* TO '${appUser}'@'localhost'`);
await c.query('FLUSH PRIVILEGES');
console.log(`OK: granted ALL on ${TEST_DB}.* to '${appUser}'@'localhost'`);
await c.end();

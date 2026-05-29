// Чистит sync-таблицы тестовой БД. Запуск: node --env-file=.env tools/sync-test/clean-sync.mjs
import mysql from 'mysql2/promise';
const url = process.env.DATABASE_URL
  || `mysql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 3306}/${process.env.DB_NAME}`;
const c = await mysql.createConnection(url);
for (const t of ['sync_file_entries', 'sync_change_sets', 'sync_sessions', 'sync_snapshots', 'sync_blobs', 'sync_workspaces', 'task_progress_events']) {
  await c.query('DELETE FROM ' + t);
}
await c.end();
console.log('sync tables cleaned');

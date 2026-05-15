#!/usr/bin/env node
// Прогоняет все .sql из ./db по порядку, пропуская уже применённые.
// Применённые миграции трекаются в таблице `_migrations` (создаётся автоматически).
// Запуск: npm run db:migrate
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbDir = join(__dirname, "..", "db");

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
};

const socketPath = process.env.DB_SOCKET;
const conn = await mysql.createConnection({
  ...(socketPath
    ? { socketPath }
    : {
        host: required("DB_HOST"),
        port: Number(process.env.DB_PORT ?? 3306),
      }),
  user: required("DB_USER"),
  password: required("DB_PASSWORD"),
  database: required("DB_NAME"),
  multipleStatements: true,
  charset: "utf8mb4",
});

// Tracking-table: уже применённые миграции пропускаются.
await conn.query(`
  CREATE TABLE IF NOT EXISTS _migrations (
    name VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`);

const [appliedRows] = await conn.query("SELECT name FROM _migrations");
const appliedSet = new Set(appliedRows.map((r) => r.name));

const files = (await readdir(dbDir)).filter((f) => f.endsWith(".sql")).sort();
let appliedCount = 0;
for (const file of files) {
  if (appliedSet.has(file)) {
    console.log(`→ ${file} ... skip (already applied)`);
    continue;
  }
  process.stdout.write(`→ ${file} ... `);
  const sql = await readFile(join(dbDir, file), "utf8");
  await conn.query(sql);
  await conn.query("INSERT INTO _migrations (name) VALUES (?)", [file]);
  console.log("applied");
  appliedCount += 1;
}
await conn.end();
console.log(`✓ migrations: ${appliedCount} applied, ${appliedSet.size} previously applied`);

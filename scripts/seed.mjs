#!/usr/bin/env node
// Прогоняет только сиды (db/0*_seed.sql). Можно запускать поверх существующих данных.
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

const files = (await readdir(dbDir)).filter((f) => /_seed\.sql$/.test(f)).sort();
for (const file of files) {
  process.stdout.write(`→ ${file} ... `);
  const sql = await readFile(join(dbDir, file), "utf8");
  await conn.query(sql);
  console.log("ok");
}
await conn.end();
console.log("✓ seeds applied");

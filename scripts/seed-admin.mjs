#!/usr/bin/env node
// Идемпотентный сид root/admin-пользователя. Берёт ADMIN_EMAIL / ADMIN_PASSWORD из env.
// Создаёт (или обновляет) пользователя с is_admin=1. Запуск:
//   node --env-file=.env scripts/seed-admin.mjs
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import argon2 from 'argon2';

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
};

const email = (process.env.ADMIN_EMAIL ?? 'admin@projectsflow.ru').toLowerCase();
const password = required('ADMIN_PASSWORD');
const displayName = process.env.ADMIN_DISPLAY_NAME ?? 'Администратор';

const socketPath = process.env.DB_SOCKET;
const conn = await mysql.createConnection({
  ...(socketPath
    ? { socketPath }
    : { host: required('DB_HOST'), port: Number(process.env.DB_PORT ?? 3306) }),
  user: required('DB_USER'),
  password: required('DB_PASSWORD'),
  database: required('DB_NAME'),
  charset: 'utf8mb4',
});

const passwordHash = await argon2.hash(password);

const [rows] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
if (rows.length > 0) {
  await conn.query(
    'UPDATE users SET password_hash = ?, is_admin = 1, display_name = ? WHERE email = ?',
    [passwordHash, displayName, email],
  );
  console.log(`✓ admin updated: ${email} (is_admin=1, password reset)`);
} else {
  const id = randomUUID();
  await conn.query(
    'INSERT INTO users (id, email, password_hash, display_name, is_admin) VALUES (?, ?, ?, ?, 1)',
    [id, email, passwordHash, displayName],
  );
  console.log(`✓ admin created: ${email} (id=${id})`);
}

await conn.end();

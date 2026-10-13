// Read-only with respect to application data: all test users and links are connection-local
// TEMPORARY tables. The migration is rehearsed on a uniquely named empty table, then dropped.
// Run after build: node --env-file=.env scripts/verify-telegram-pairing.mjs
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { DrizzleTelegramPairingRepository } from '../server/dist/infrastructure/repositories/DrizzleTelegramPairingRepository.js';

const connection = await mysql.createConnection({
  ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : { host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306) }),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  timezone: 'Z', multipleStatements: false,
});
const schemaTable = `telegram_pairing_check_${randomBytes(6).toString('hex')}`;
let schemaCreated = false, checks = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); checks++; };
try {
  await connection.query("SET time_zone='+00:00'");
  const migration = process.env.TELEGRAM_PAIRING_MIGRATION_SQL || await readFile(new URL('../db/163_telegram_pairing_tokens.sql', import.meta.url), 'utf8');
  await connection.query(migration.replace('CREATE TABLE telegram_pairing_tokens', `CREATE TABLE ${schemaTable}`).replace('fk_telegram_pairing_user', `fk_${schemaTable}`));
  schemaCreated = true;
  checks++;
  const [definition] = await connection.query('SHOW CREATE TABLE users');
  const shadowUsers = definition[0]['Create Table']
    .replace(/^CREATE TABLE `users`/, 'CREATE TEMPORARY TABLE `users`')
    .split('\n').filter(line => !/^\s*CONSTRAINT .* FOREIGN KEY /.test(line)).join('\n')
    .replace(/,\n\) ENGINE/, '\n) ENGINE');
  await connection.query(shadowUsers);
  await connection.query(`CREATE TEMPORARY TABLE telegram_pairing_tokens LIKE ${schemaTable}`);
  for (const id of ['pairing-a', 'pairing-b', 'pairing-c', 'pairing-d']) {
    await connection.query('INSERT INTO users (id,email,password_hash,display_name) VALUES (?,?,?,?)', [id, `${id}@example.invalid`, 'not-a-login', 'Temporary verification']);
  }
  const repo = new DrizzleTelegramPairingRepository(drizzle(connection, { mode: 'default' }));
  const now = new Date();
  const issue = (userId, tokenHash, expiresAt = new Date(now.getTime() + 600000)) => repo.issue({ userId, tokenHash, expiresAt });
  const complete = (tokenHash, telegramUserId = 9000000000001) => repo.complete({ tokenHash, telegramUserId, telegramUsername: 'temporary_check', telegramFirstName: 'Temporary', now });
  equal(await issue('pairing-a', 'a'.repeat(64)), true);
  equal(await complete('a'.repeat(64)), 'connected');
  const [linked] = await connection.query('SELECT telegram_user_id,tg_chat_id,tg_started_at FROM users WHERE id=?', ['pairing-a']);
  equal(Number(linked[0].telegram_user_id), 9000000000001);
  equal(Number(linked[0].tg_chat_id), 9000000000001);
  equal(linked[0].tg_started_at !== null, true);
  equal(await complete('a'.repeat(64)), 'expired');
  equal(await issue('pairing-a', 'z'.repeat(64)), false);
  equal(await issue('pairing-b', 'b'.repeat(64)), true);
  equal(await complete('b'.repeat(64)), 'already_linked');
  equal(await complete('b'.repeat(64), 9000000000002), 'connected');
  equal(await issue('pairing-c', 'c'.repeat(64)), true);
  equal(await issue('pairing-c', 'd'.repeat(64)), true);
  equal(await complete('c'.repeat(64), 9000000000003), 'expired');
  equal(await complete('d'.repeat(64), 9000000000003), 'connected');
  equal(await issue('pairing-d', 'e'.repeat(64), new Date(now.getTime() - 1000)), true);
  equal(await complete('e'.repeat(64), 9000000000004), 'expired');
  equal(await issue('pairing-d', 'f'.repeat(64)), true);
  await repo.revoke('pairing-d');
  equal(await complete('f'.repeat(64), 9000000000004), 'expired');
  const [unlinked] = await connection.query('SELECT telegram_user_id,tg_chat_id FROM users WHERE id=?', ['pairing-d']);
  equal(unlinked[0].telegram_user_id, null);
  equal(unlinked[0].tg_chat_id, null);
  console.log(JSON.stringify({ mariaDB_pairing_checks: checks, failed: 0, application_data_changed: false }));
} finally {
  if (schemaCreated) await connection.query(`DROP TABLE ${schemaTable}`);
  await connection.end();
}

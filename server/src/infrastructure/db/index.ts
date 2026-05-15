import mysql, { type PoolOptions } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema.js';

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
};

const connectionOptions = ((): PoolOptions => {
  const url = process.env.DATABASE_URL;
  if (url) return { uri: url };

  const socket = process.env.DB_SOCKET;
  const user = required('DB_USER');
  const password = required('DB_PASSWORD');
  const database = required('DB_NAME');

  if (socket) {
    return { socketPath: socket, user, password, database };
  }

  return {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 3306),
    user,
    password,
    database,
  };
})();

export const pool = mysql.createPool({
  ...connectionOptions,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10),
  waitForConnections: true,
  charset: 'utf8mb4_unicode_ci',
});

export const db = drizzle(pool, { schema, mode: 'default' });

export type Database = typeof db;

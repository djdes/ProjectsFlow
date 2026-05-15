import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = mysql.createPool({
  uri: databaseUrl,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10),
  waitForConnections: true,
  charset: 'utf8mb4_unicode_ci',
});

export const db = drizzle(pool, { schema, mode: 'default' });

export type Database = typeof db;

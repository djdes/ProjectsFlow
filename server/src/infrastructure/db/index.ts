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
  // Read/write all DATETIME/TIMESTAMP values as UTC. Without this mysql2 defaults
  // to timezone 'local' and parses MySQL's datetime strings (rendered in the DB's
  // session time_zone) as the Node process's local tz. In prod Node runs with TZ=UTC
  // while MySQL's SYSTEM tz is MSK, so timestamps came back +3h ahead. 'Z' makes
  // mysql2 treat every datetime string as UTC; the SET time_zone below forces MySQL
  // to render them in UTC too — so the round-trip is correct regardless of host tz.
  timezone: 'Z',
});

// Force every pooled connection onto UTC so MySQL emits/accepts datetime strings in
// UTC (pairs with timezone: 'Z' above). Runs before any user query on a fresh
// connection — mysql2 pipelines queries per connection in order.
pool.on('connection', (connection) => {
  connection.query("SET time_zone='+00:00'");
});

export const db = drizzle(pool, { schema, mode: 'default' });

export type Database = typeof db;

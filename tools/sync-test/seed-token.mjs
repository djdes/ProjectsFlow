// Сидит в ТЕСТОВУЮ БД: user + agent-token + project (owner=user, dispatcher=user) + membership.
// Печатает JSON { token, projectId, userId } в stdout (последняя строка) для E2E-прогонов.
// Токен хешируется как в проде: sha256(plaintext) hex (Sha256AgentTokenHasher). Запуск:
//   node --env-file=.env tools/sync-test/seed-token.mjs   (с $env:DB_NAME=projectsflow_synctest)
import mysql from 'mysql2/promise';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'projectsflow_synctest',
  multipleStatements: true,
});

const userId = randomUUID();
const projectId = randomUUID();
const plaintext = randomBytes(32).toString('hex');
const tokenHash = createHash('sha256').update(plaintext, 'utf8').digest('hex');
const prefix = plaintext.slice(0, 12);

await conn.query(
  'INSERT INTO users (id, email, password_hash, display_name, is_admin) VALUES (?,?,?,?,0)',
  [userId, `synctest+${userId.slice(0, 8)}@local.test`, 'x', 'SyncTest'],
);
await conn.query(
  'INSERT INTO agent_tokens (id, user_id, name, token_hash, token_prefix) VALUES (?,?,?,?,?)',
  [randomUUID(), userId, 'synctest', tokenHash, prefix],
);
await conn.query(
  'INSERT INTO projects (id, owner_id, name, status, kb_kind, finance_visibility, dispatcher_user_id, is_inbox) VALUES (?,?,?,?,?,?,?,0)',
  [projectId, userId, 'synctest-' + projectId.slice(0, 8), 'active', 'none', 'owner', userId],
);
await conn.query('INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,?)', [
  projectId,
  userId,
  'owner',
]);
await conn.end();

console.log(JSON.stringify({ token: plaintext, projectId, userId }));

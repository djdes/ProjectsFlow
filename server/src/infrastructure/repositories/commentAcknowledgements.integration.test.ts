import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import type { Database } from '../db/index.js';
import { DrizzleTaskCommentRepository } from './DrizzleTaskCommentRepository.js';
import { MysqlCommentAcknowledgementRepository } from './MysqlCommentAcknowledgementRepository.js';

// Opt-in SQL contract. All data lives in connection-local temporary tables which
// shadow the app tables; no real task, user or notification is read or changed.
test('MariaDB: acceptance resolves only its recipient/question, undo restores it, edits invalidate it', {
  skip: process.env.PF_COMMENT_ACK_DB !== '1',
}, async () => {
  const connection = await mysql.createConnection({
    ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : { host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306) }),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, timezone: 'Z',
  });
  try {
    await connection.query("SET time_zone='+00:00'");
    for (const table of ['task_comments', 'users', 'comment_notifications', 'notifications']) {
      const [schema] = await connection.query<mysql.RowDataPacket[]>(`SHOW CREATE TABLE ${table}`);
      // MariaDB temporary tables cannot carry foreign keys. Keep real column/index
      // definitions, omitting only those constraints in the connection-local copy.
      const ddl = (schema[0]!['Create Table'] as string).split('\n').filter(line => !line.includes('FOREIGN KEY')).join('\n')
        .replace(/,\n\)/, '\n)').replace(/^CREATE TABLE/, 'CREATE TEMPORARY TABLE');
      await connection.query(ddl);
    }
    const migration = await readFile(process.env.PF_COMMENT_ACK_MIGRATION ?? 'db/171_comment_acknowledgements.sql', 'utf8');
    await connection.query(migration.replace('CREATE TABLE task_comment_acknowledgements', 'CREATE TEMPORARY TABLE task_comment_acknowledgements'));
    await connection.query("INSERT INTO users (id, email, password_hash, display_name) VALUES ('reader','reader@example.test','unused','Читатель'), ('author','author@example.test','unused','Автор'), ('other','other@example.test','unused','')");
    await connection.query("INSERT INTO task_comments (id, task_id, owner_user_id, body, notify_mode) VALUES ('question','task','author','Проверь результат','selected'), ('new-question','task','author','Другой вопрос','selected')");
    await connection.query("INSERT INTO comment_notifications (id,comment_id,recipient_user_id,channel,status) VALUES ('n1','question','reader','email','sent'),('n2','question','other','email','sent'),('n3','new-question','reader','email','sent')");
    const comments = new DrizzleTaskCommentRepository(drizzle(connection) as Database);
    const repo = new MysqlCommentAcknowledgementRepository(connection as unknown as mysql.Pool);
    const outstanding = async (userId: string) => (await comments.listUnansweredAddressedTo(userId, new Date(0))).map(c => c.id).sort();
    assert.deepEqual(await outstanding('reader'), ['new-question', 'question']);
    await repo.set('question', 'reader', true);
    const first = await repo.listByComments(['question']);
    assert.equal(first[0]!.displayName, 'Читатель');
    await repo.set('question', 'reader', true);
    assert.deepEqual(await repo.listByComments(['question']), first);
    assert.deepEqual(await outstanding('reader'), ['new-question']);
    assert.deepEqual(await outstanding('other'), ['question']);
    await repo.set('question', 'other', true);
    assert.equal((await repo.listByComments(['question'])).find(a => a.userId === 'other')!.displayName, 'other@example.test');
    await repo.set('question', 'reader', false);
    assert.deepEqual(await outstanding('reader'), ['new-question', 'question']);
    assert.equal((await repo.listByComments(['question'])).length, 1);
    await repo.set('question', 'reader', true);
    // Keep the timestamp unchanged to cover two edits in the same second.
    await connection.query("UPDATE task_comments SET body='Изменённый запрос', updated_at=updated_at WHERE id='question'");
    assert.equal((await repo.listByComments(['question'])).length, 0);
    assert.deepEqual(await outstanding('reader'), ['new-question', 'question']);
    await repo.set('question', 'reader', true);
    assert.deepEqual(await outstanding('reader'), ['new-question']);
    // Ordinary replies still resolve questions independently of acceptance.
    await connection.query("INSERT INTO task_comments (id,task_id,owner_user_id,body) VALUES ('reply','task','reader','Проверил')");
    assert.deepEqual(await outstanding('reader'), []);
    await connection.query("DELETE FROM task_comments WHERE id='question'");
    assert.deepEqual(await repo.listByComments(['question']), []);
  } finally {
    await connection.end();
  }
});

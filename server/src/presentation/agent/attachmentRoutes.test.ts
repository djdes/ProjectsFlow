import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import { agentApiRouter } from './apiRoutes.js';

// Чтение вложений агентом: список метаданных + сырые байты одного файла. Это тот канал,
// которым MCP-клиент (Claude Code / Codex / Cursor) забирает приложенный к задаче файл,
// поэтому проверяем и happy-path, и то, что чужой аттач не отдаётся под видом «своего».

const PROJECT_ID = 'project-1';
const TASK_ID = 'task-1';
const BYTES = Buffer.from('hello-attachment');

function attachment(): TaskAttachment {
  return {
    id: 'att-1',
    taskId: TASK_ID,
    commentId: 'comment-9',
    filename: 'счёт «июнь».pdf',
    mimeType: 'application/pdf',
    sizeBytes: BYTES.byteLength,
    storageKey: 'att-1.bin',
    uploadedAt: new Date('2026-07-15T10:00:00Z'),
  };
}

type Deps = Parameters<typeof agentApiRouter>[0];

async function withAgentServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const item = attachment();
  const deps = {
    authenticate: {
      async execute() {
        return {
          user: { id: 'user-1' },
          token: { id: 'token-1', scopeKind: 'account' as const },
        };
      },
    },
    listTaskAttachments: {
      // executeAll, а не execute: агенту отдаём и файлы из комментариев треда.
      async executeAll(projectId: string, ownerUserId: string, taskId: string) {
        assert.equal(projectId, PROJECT_ID);
        assert.equal(ownerUserId, 'user-1');
        assert.equal(taskId, TASK_ID);
        return [item];
      },
    },
    getTaskAttachment: {
      async execute(ownerUserId: string, attachmentId: string) {
        assert.equal(ownerUserId, 'user-1');
        assert.equal(attachmentId, item.id);
        return { attachment: item, data: { data: BYTES, mimeType: item.mimeType } };
      },
    },
  } as unknown as Deps;

  const app = express();
  app.use('/api/agent', agentApiRouter(deps));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const AUTH = { Authorization: 'Bearer pfat_test' };

test('agent lists task attachments as metadata without bytes', async () => {
  await withAgentServer(async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/agent/projects/${PROJECT_ID}/tasks/${TASK_ID}/attachments`,
      { headers: AUTH },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { attachments: Record<string, unknown>[] };
    assert.deepEqual(body.attachments, [
      {
        id: 'att-1',
        commentId: 'comment-9',
        filename: 'счёт «июнь».pdf',
        mimeType: 'application/pdf',
        sizeBytes: BYTES.byteLength,
        uploadedAt: '2026-07-15T10:00:00.000Z',
      },
    ]);
  });
});

test('agent downloads one attachment as raw bytes', async () => {
  await withAgentServer(async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/agent/projects/${PROJECT_ID}/tasks/${TASK_ID}/attachments/att-1`,
      { headers: AUTH },
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    // Кириллица в имени уезжает в filename* (RFC 5987) — иначе клиент получит мусор.
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment;/);
    assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'hello-attachment');
  });
});

test('attachment that does not belong to the task is 404, not a foreign download', async () => {
  await withAgentServer(async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/agent/projects/${PROJECT_ID}/tasks/${TASK_ID}/attachments/att-from-other-task`,
      { headers: AUTH },
    );
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'attachment_not_found' });
  });
});

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import { signAttachmentUrl } from '../../application/attachments/signedAttachmentUrl.js';
import type { GetTaskAttachment } from '../../application/task/GetTaskAttachment.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import { attachmentBinaryRouter } from './attachmentBinaryRoutes.js';

const SECRET = 'attachment-test-secret';
const VIDEO = Buffer.from('0123456789');

function attachment(filename = 'demo.mp4', mimeType = 'video/mp4'): TaskAttachment {
  return {
    id: 'video-1',
    taskId: 'task-1',
    commentId: null,
    filename,
    mimeType,
    sizeBytes: VIDEO.byteLength,
    storageKey: 'video-1.bin',
    uploadedAt: new Date('2026-07-15T10:00:00Z'),
  };
}

async function withAttachmentServer(
  item: TaskAttachment,
  run: (baseUrl: string, signedPath: string) => Promise<void>,
): Promise<void> {
  const getAttachment = {
    async executeSigned() {
      return { attachment: item, data: { data: VIDEO, mimeType: item.mimeType } };
    },
    async execute() {
      throw new Error('authenticated path is not expected in this test');
    },
  } as unknown as GetTaskAttachment;
  const app = express();
  app.use('/api/attachments', attachmentBinaryRouter({ getAttachment, signingSecret: SECRET }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const signed = signAttachmentUrl(
    baseUrl,
    `/api/attachments/${item.id}`,
    SECRET,
    60,
    Date.now(),
  );
  assert.ok(signed);
  const parsed = new URL(signed);
  try {
    await run(baseUrl, `${parsed.pathname}${parsed.search}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('MP4 attachment is served inline and supports byte ranges for browser playback', async () => {
  await withAttachmentServer(attachment(), async (baseUrl, path) => {
    const full = await fetch(`${baseUrl}${path}`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.match(full.headers.get('content-disposition') ?? '', /^inline;/);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(Buffer.from(await full.arrayBuffer()).toString(), '0123456789');

    const partial = await fetch(`${baseUrl}${path}`, { headers: { Range: 'bytes=2-5' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(partial.headers.get('content-length'), '4');
    assert.equal(Buffer.from(await partial.arrayBuffer()).toString(), '2345');
  });
});

test('MP4 extension enables preview when the stored MIME type is generic', async () => {
  await withAttachmentServer(
    attachment('camera-export.MP4', 'application/octet-stream'),
    async (baseUrl, path) => {
      const response = await fetch(`${baseUrl}${path}`, { headers: { Range: 'bytes=50-' } });
      assert.equal(response.status, 416);
      assert.equal(response.headers.get('content-type'), 'video/mp4');
      assert.equal(response.headers.get('content-range'), 'bytes */10');
    },
  );
});

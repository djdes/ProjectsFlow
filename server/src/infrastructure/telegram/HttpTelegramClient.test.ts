import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { HttpTelegramClient } from './HttpTelegramClient.js';

type CapturedRequest = {
  readonly path: string;
  readonly contentType: string;
  readonly body: string;
};

async function withTelegramStub(
  respond: (path: string, requestNumber: number) => { status: number; body: unknown },
  run: (baseUrl: string, requests: CapturedRequest[]) => Promise<void>,
): Promise<void> {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const path = req.url ?? '';
    requests.push({
      path,
      contentType: String(req.headers['content-type'] ?? ''),
      body: Buffer.concat(chunks).toString('utf8'),
    });
    const response = respond(path, requests.length);
    res.statusCode = response.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`, requests);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('audio attachment is uploaded as native sendAudio with its filename', async () => {
  await withTelegramStub(
    () => ({ status: 200, body: { ok: true, result: { message_id: 42 } } }),
    async (baseUrl, requests) => {
      const client = new HttpTelegramClient('secret', baseUrl);
      const result = await client.sendAttachment({
        chatId: 7,
        data: Buffer.from('music-bytes'),
        url: 'https://fallback.test/track',
        filename: 'track.mp3',
        mimeType: 'audio/mpeg',
        caption: 'track.mp3',
      });

      assert.deepEqual(result, { kind: 'ok', messageId: 42 });
      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.path, '/botsecret/sendAudio');
      assert.match(requests[0]!.contentType, /^multipart\/form-data; boundary=/);
      assert.match(requests[0]!.body, /track\.mp3/);
      assert.match(requests[0]!.body, /music-bytes/);
    },
  );
});

test('unsupported photo codec falls back to a Telegram document', async () => {
  await withTelegramStub(
    (_path, requestNumber) =>
      requestNumber === 1
        ? { status: 400, body: { ok: false, description: 'wrong file type' } }
        : { status: 200, body: { ok: true, result: { message_id: 43 } } },
    async (baseUrl, requests) => {
      const client = new HttpTelegramClient('secret', baseUrl);
      const result = await client.sendAttachment({
        chatId: 7,
        data: Buffer.from('image-bytes'),
        filename: 'picture.webp',
        mimeType: 'image/webp',
      });

      assert.deepEqual(result, { kind: 'ok', messageId: 43 });
      assert.deepEqual(
        requests.map((request) => request.path),
        ['/botsecret/sendPhoto', '/botsecret/sendDocument'],
      );
    },
  );
});

test('rich task message references a declared photo at its paragraph position', async () => {
  await withTelegramStub(
    () => ({ status: 200, body: { ok: true, result: { message_id: 44 } } }),
    async (baseUrl, requests) => {
      const client = new HttpTelegramClient('secret', baseUrl);
      const result = await client.sendRichMessage({
        chatId: 7,
        html: '<p>Before</p><img src="tg://photo?id=task_photo_1"/><p>After</p>',
        media: [
          {
            id: 'task_photo_1',
            kind: 'photo',
            url: 'https://pf.test/api/attachments/img-1?sig=x',
          },
        ],
      });

      assert.deepEqual(result, { kind: 'ok', messageId: 44 });
      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.path, '/botsecret/sendRichMessage');
      const body = JSON.parse(requests[0]!.body);
      assert.match(body.rich_message.html, /tg:\/\/photo\?id=task_photo_1/);
      assert.deepEqual(body.rich_message.media, [
        {
          id: 'task_photo_1',
          media: {
            type: 'photo',
            media: 'https://pf.test/api/attachments/img-1?sig=x',
          },
        },
      ]);
    },
  );
});

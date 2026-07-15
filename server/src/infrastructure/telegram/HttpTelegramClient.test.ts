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

test('one task file is uploaded as a native document replying to the task card', async () => {
  await withTelegramStub(
    () => ({ status: 200, body: { ok: true, result: { message_id: 51 } } }),
    async (baseUrl, requests) => {
      const client = new HttpTelegramClient('secret', baseUrl);
      const results = await client.sendDocuments({
        chatId: 7,
        replyToMessageId: 44,
        caption: '📎 Файлы задачи',
        documents: [
          {
            data: Buffer.from('pdf-bytes'),
            filename: 'техническое-задание.pdf',
            mimeType: 'application/pdf',
          },
        ],
      });

      assert.deepEqual(results, [{ kind: 'ok', messageId: 51 }]);
      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.path, '/botsecret/sendDocument');
      assert.match(requests[0]!.contentType, /^multipart\/form-data; boundary=/);
      assert.match(requests[0]!.body, /техническое-задание\.pdf/);
      assert.match(requests[0]!.body, /pdf-bytes/);
      assert.match(requests[0]!.body, /"message_id":44/);
      assert.match(requests[0]!.body, /disable_content_type_detection/);
    },
  );
});

test('multiple task files are uploaded together as one native document album', async () => {
  await withTelegramStub(
    () => ({
      status: 200,
      body: { ok: true, result: [{ message_id: 61 }, { message_id: 62 }] },
    }),
    async (baseUrl, requests) => {
      const client = new HttpTelegramClient('secret', baseUrl);
      const results = await client.sendDocuments({
        chatId: 7,
        replyToMessageId: 44,
        caption: '📎 Файлы задачи',
        documents: [
          { data: Buffer.from('first-bytes'), filename: 'brief.pdf', mimeType: 'application/pdf' },
          { data: Buffer.from('second-bytes'), filename: 'source.zip', mimeType: 'application/zip' },
        ],
      });

      assert.deepEqual(results, [
        { kind: 'ok', messageId: 61 },
        { kind: 'ok', messageId: 62 },
      ]);
      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.path, '/botsecret/sendMediaGroup');
      assert.match(requests[0]!.contentType, /^multipart\/form-data; boundary=/);
      assert.match(requests[0]!.body, /attach:\/\/task_document_0/);
      assert.match(requests[0]!.body, /attach:\/\/task_document_1/);
      assert.match(requests[0]!.body, /brief\.pdf/);
      assert.match(requests[0]!.body, /source\.zip/);
      assert.match(requests[0]!.body, /first-bytes/);
      assert.match(requests[0]!.body, /second-bytes/);
      assert.match(requests[0]!.body, /"message_id":44/);
    },
  );
});

test('confirmed album rejection falls back to native sendDocument for every file', async () => {
  await withTelegramStub(
    (path) =>
      path.endsWith('/sendMediaGroup')
        ? {
            status: 400,
            body: {
              ok: false,
              description:
                'Bad Request: failed to send message #1 with the error message "Wrong file identifier/HTTP URL specified"',
            },
          }
        : { status: 200, body: { ok: true, result: { message_id: 70 } } },
    async (baseUrl, requests) => {
      const client = new HttpTelegramClient('secret', baseUrl);
      const results = await client.sendDocuments({
        chatId: 7,
        replyToMessageId: 44,
        caption: '📎 Файлы задачи',
        documents: [
          { data: Buffer.from('video'), filename: 'ролик.mp4', mimeType: 'video/mp4' },
          { data: Buffer.from('image'), filename: 'screen.webp', mimeType: 'image/webp' },
        ],
      });

      assert.deepEqual(results, [
        { kind: 'ok', messageId: 70 },
        { kind: 'ok', messageId: 70 },
      ]);
      assert.deepEqual(
        requests.map((request) => request.path),
        [
          '/botsecret/sendMediaGroup',
          '/botsecret/sendDocument',
          '/botsecret/sendDocument',
        ],
      );
      assert.match(requests[1]!.body, /ролик\.mp4/);
      assert.match(requests[2]!.body, /screen\.webp/);
      assert.match(requests[1]!.body, /Файлы задачи/);
      assert.doesNotMatch(requests[2]!.body, /Файлы задачи/);
      assert.match(requests[1]!.body, /"message_id":44/);
      assert.match(requests[2]!.body, /"message_id":44/);
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

test('rich task message uploads an inline screenshot with attach:// multipart media', async () => {
  await withTelegramStub(
    () => ({ status: 200, body: { ok: true, result: { message_id: 45 } } }),
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
            data: Buffer.from('png-image-bytes'),
            filename: 'скриншот.png',
            mimeType: 'image/png',
          },
        ],
      });

      assert.deepEqual(result, { kind: 'ok', messageId: 45 });
      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.path, '/botsecret/sendRichMessage');
      assert.match(requests[0]!.contentType, /^multipart\/form-data; boundary=/);
      assert.match(requests[0]!.body, /attach:\/\/rich_media_0/);
      assert.match(requests[0]!.body, /task_photo_1/);
      assert.match(requests[0]!.body, /скриншот\.png/);
      assert.match(requests[0]!.body, /png-image-bytes/);
    },
  );
});

test('one rich multipart request carries mixed task photo, video, animation and audio', async () => {
  await withTelegramStub(
    () => ({ status: 200, body: { ok: true, result: { message_id: 46 } } }),
    async (baseUrl, requests) => {
      const client = new HttpTelegramClient('secret', baseUrl);
      const media = [
        { id: 'photo_1', kind: 'photo' as const, filename: 'screen.png', mimeType: 'image/png' },
        { id: 'video_1', kind: 'video' as const, filename: 'demo.mp4', mimeType: 'video/mp4' },
        { id: 'animation_1', kind: 'animation' as const, filename: 'demo.gif', mimeType: 'image/gif' },
        { id: 'audio_1', kind: 'audio' as const, filename: 'track.mp3', mimeType: 'audio/mpeg' },
      ].map((item, index) => ({
        ...item,
        url: `https://pf.test/${item.filename}`,
        data: Buffer.from(`media-bytes-${index}`),
      }));

      const result = await client.sendRichMessage({
        chatId: 7,
        html:
          '<img src="tg://photo?id=photo_1"/>' +
          '<video src="tg://video?id=video_1"></video>' +
          '<video src="tg://video?id=animation_1"></video>' +
          '<audio src="tg://audio?id=audio_1"></audio>',
        media,
      });

      assert.deepEqual(result, { kind: 'ok', messageId: 46 });
      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.path, '/botsecret/sendRichMessage');
      for (const [index, item] of media.entries()) {
        assert.match(requests[0]!.body, new RegExp(`attach:\\/\\/rich_media_${index}`));
        assert.match(requests[0]!.body, new RegExp(`"type":"${item.kind}"`));
        assert.match(requests[0]!.body, new RegExp(item.filename.replace('.', '\\.')));
        assert.match(requests[0]!.body, new RegExp(`media-bytes-${index}`));
      }
    },
  );
});

test('ambiguous rich responses are marked delivery-unknown to prevent duplicate fallback', async () => {
  for (const response of [
    { status: 502, body: { ok: false, description: 'upstream disconnected' } },
    { status: 200, body: { unexpected: true } },
  ]) {
    await withTelegramStub(
      () => response,
      async (baseUrl) => {
        const client = new HttpTelegramClient('secret', baseUrl);
        const result = await client.sendRichMessage({ chatId: 7, html: '<p>Task</p>' });

        assert.equal(result.kind, 'error');
        assert.equal(result.kind === 'error' && result.deliveryUnknown, true);
      },
    );
  }
});

test('explicit rich 400 rejection remains safe for a single fallback message', async () => {
  await withTelegramStub(
    () => ({ status: 400, body: { ok: false, description: 'rich messages unsupported' } }),
    async (baseUrl) => {
      const client = new HttpTelegramClient('secret', baseUrl);
      const result = await client.sendRichMessage({ chatId: 7, html: '<p>Task</p>' });

      assert.deepEqual(result, {
        kind: 'error',
        description: 'rich messages unsupported',
        deliveryUnknown: false,
      });
    },
  );
});

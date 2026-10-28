import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import express from 'express';
import type { VoiceTranscriber, VoiceTranscriptionInput } from '../../application/telegram/VoiceTranscriber.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import { AgentTokenInvalidError } from '../../domain/agent/errors.js';
import { voiceTranscriptionRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

async function fixture(enabled = true) {
  const calls: VoiceTranscriptionInput[] = [];
  const transcriber: VoiceTranscriber = {
    enabled,
    async transcribe(input: VoiceTranscriptionInput): Promise<string> {
      calls.push(input);
      return `Распознано: ${input.filename} (${input.language ?? 'ru'})`;
    },
  };
  const authenticate = {
    async execute(token: string) {
      if (token === 'invalid') throw new AgentTokenInvalidError();
      return {
        user: { id: token === 'project' ? 'owner' : token },
        token: { id: 'token', scopeKind: token === 'project' ? 'project' : 'account' },
      };
    },
  } as unknown as AuthenticateAgentToken;

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, _res, next) => {
    if (req.get('X-Test-Session')) {
      req.user = { id: req.get('X-Test-Session')! } as express.Request['user'];
    }
    next();
  });
  app.use('/api/ai/stt', voiceTranscriptionRouter(transcriber, authenticate));
  app.use('/api/ai/transcribe', voiceTranscriptionRouter(transcriber, authenticate));
  app.use(errorHandler);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const url = `http://127.0.0.1:${address.port}`;
  const request = (path: string, token?: string, init: RequestInit = {}) =>
    fetch(url + path, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  return {
    calls,
    request,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test('voice transcription API requires session or account Bearer token and rejects project/invalid tokens', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/api/ai/stt')).status, 401);
    assert.equal((await f.request('/api/ai/stt', 'invalid')).status, 401);
    assert.equal((await f.request('/api/ai/stt', 'project')).status, 403);

    const statusRes = await f.request('/api/ai/stt', 'owner');
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as { ok: boolean; enabled: boolean; model: string };
    assert.equal(statusJson.ok, true);
    assert.equal(statusJson.enabled, true);
    assert.equal(statusJson.model, 'whisper-large-v3-turbo');
  } finally {
    await f.close();
  }
});

test('voice transcription API accepts multipart file upload and JSON audioBase64', async () => {
  const f = await fixture();
  try {
    const audioBytes = Buffer.from('OggS-fake-opus-voice-bytes');
    const form = new FormData();
    form.set('file', new Blob([audioBytes], { type: 'audio/ogg' }), 'voice_note.oga');
    form.set('language', 'ru');
    form.set('prompt', 'Магдэй техкарта');

    const res1 = await f.request('/api/ai/stt', 'owner', { method: 'POST', body: form });
    assert.equal(res1.status, 200);
    const body1 = (await res1.json()) as { ok: boolean; text: string; model: string; language: string };
    assert.equal(body1.ok, true);
    assert.equal(body1.text, 'Распознано: voice_note.oga (ru)');
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0]?.prompt, 'Магдэй техкарта');
    assert.deepEqual(f.calls[0]?.data, audioBytes);

    const res2 = await f.request('/api/ai/transcribe', undefined, {
      method: 'POST',
      headers: {
        'X-Test-Session': 'owner',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audioBase64: audioBytes.toString('base64'),
        filename: 'clip.mp3',
        mimeType: 'audio/mpeg',
        language: 'en',
      }),
    });
    assert.equal(res2.status, 200);
    const body2 = (await res2.json()) as { ok: boolean; text: string; language: string };
    assert.equal(body2.ok, true);
    assert.equal(body2.text, 'Распознано: clip.mp3 (en)');
    assert.equal(body2.language, 'en');
  } finally {
    await f.close();
  }
});

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import net, { createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net';
import { test } from 'node:test';
import { fetch as undiciFetch } from 'undici';
import { HttpTelegramClient } from '../telegram/HttpTelegramClient.js';
import { createProxyDispatcher } from './createProxyDispatcher.js';

type SocksConnectRecord = {
  readonly atyp: number;
  readonly targetHost: string;
  readonly targetPort: number;
  readonly username: string | null;
  readonly password: string | null;
};

function readBytes(socket: Socket, state: { buf: Buffer }, count: number): Promise<Buffer> {
  if (state.buf.length >= count) {
    const out = state.buf.subarray(0, count);
    state.buf = state.buf.subarray(count);
    return Promise.resolve(out);
  }
  return new Promise<Buffer>((resolve, reject) => {
    const onData = (chunk: Buffer): void => {
      state.buf = Buffer.concat([state.buf, chunk]);
      if (state.buf.length >= count) {
        cleanup();
        const out = state.buf.subarray(0, count);
        state.buf = state.buf.subarray(count);
        resolve(out);
      }
    };
    const onEnd = (): void => {
      cleanup();
      reject(new Error('socket closed'));
    };
    const cleanup = (): void => {
      socket.off('data', onData);
      socket.off('close', onEnd);
      socket.off('error', onEnd);
    };
    socket.on('data', onData);
    socket.on('close', onEnd);
    socket.on('error', onEnd);
  });
}

async function withSocks5Proxy(
  opts: {
    readonly auth?: { readonly username: string; readonly password: string };
    readonly forwardHostOverride?: string;
    readonly forwardPortOverride?: number;
  },
  run: (port: number, connects: SocksConnectRecord[]) => Promise<void>,
): Promise<void> {
  const connects: SocksConnectRecord[] = [];
  const sockets = new Set<Socket>();

  const server = createTcpServer((client) => {
    sockets.add(client);
    void (async () => {
      const state = { buf: Buffer.alloc(0) };
      try {
        const greetHead = await readBytes(client, state, 2);
        assert.equal(greetHead[0], 0x05);
        const methods = await readBytes(client, state, greetHead[1]!);

        let username: string | null = null;
        let password: string | null = null;
        if (opts.auth) {
          assert.ok(methods.includes(0x02), 'client must offer username/password auth');
          client.write(Buffer.from([0x05, 0x02]));
          const authVer = await readBytes(client, state, 2);
          assert.equal(authVer[0], 0x01);
          username = (await readBytes(client, state, authVer[1]!)).toString('utf8');
          const pLen = (await readBytes(client, state, 1))[0]!;
          password = (await readBytes(client, state, pLen)).toString('utf8');
          if (username !== opts.auth.username || password !== opts.auth.password) {
            client.end(Buffer.from([0x01, 0x01]));
            return;
          }
          client.write(Buffer.from([0x01, 0x00]));
        } else {
          client.write(Buffer.from([0x05, 0x00]));
        }

        const reqHead = await readBytes(client, state, 4);
        assert.equal(reqHead[0], 0x05);
        assert.equal(reqHead[1], 0x01);
        const atyp = reqHead[3]!;
        let targetHost: string;
        if (atyp === 0x01) {
          const ip = await readBytes(client, state, 4);
          targetHost = `${ip[0]}.${ip[1]}.${ip[2]}.${ip[3]}`;
        } else if (atyp === 0x03) {
          const dLen = (await readBytes(client, state, 1))[0]!;
          targetHost = (await readBytes(client, state, dLen)).toString('utf8');
        } else {
          client.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          return;
        }
        const portBuf = await readBytes(client, state, 2);
        const targetPort = portBuf.readUInt16BE(0);
        connects.push({ atyp, targetHost, targetPort, username, password });

        const upstream = net.connect({
          host: opts.forwardHostOverride ?? targetHost,
          port: opts.forwardPortOverride ?? targetPort,
        });
        sockets.add(upstream);
        await new Promise<void>((resolve, reject) => {
          upstream.once('connect', resolve);
          upstream.once('error', reject);
        });

        client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
        if (state.buf.length > 0) {
          upstream.write(state.buf);
          state.buf = Buffer.alloc(0);
        }
        client.pipe(upstream);
        upstream.pipe(client);
        client.on('error', () => upstream.destroy());
        upstream.on('error', () => client.destroy());
      } catch {
        client.destroy();
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(port, connects);
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('createProxyDispatcher returns undefined for empty input and rejects unknown schemes', () => {
  assert.equal(createProxyDispatcher(undefined), undefined);
  assert.equal(createProxyDispatcher('   '), undefined);
  assert.throws(() => createProxyDispatcher('ftp://127.0.0.1:21'), /Unsupported proxy protocol/);
});

test('HttpTelegramClient tunnels requests through an authenticated socks5:// proxy', async () => {
  let receivedHostHeader = '';
  const stub = createServer((req, res) => {
    receivedHostHeader = String(req.headers.host ?? '');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, result: { message_id: 777 } }));
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const stubPort = (stub.address() as AddressInfo).port;

  try {
    await withSocks5Proxy(
      {
        auth: { username: 'pl', password: 'secret:p@ss' },
        forwardHostOverride: '127.0.0.1',
        forwardPortOverride: stubPort,
      },
      async (proxyPort, connects) => {
        const proxyUrl = `socks5://pl:${encodeURIComponent('secret:p@ss')}@127.0.0.1:${proxyPort}`;
        const client = new HttpTelegramClient(
          'tok',
          `http://api.telegram.test:${stubPort}`,
          proxyUrl,
        );
        const result = await client.sendMessage({ chatId: 123, text: 'hello via socks5' });
        assert.deepEqual(result, { kind: 'ok', messageId: 777 });
        assert.equal(connects.length, 1);
        assert.equal(connects[0]!.atyp, 0x03);
        assert.equal(connects[0]!.targetHost, 'api.telegram.test');
        assert.equal(connects[0]!.targetPort, stubPort);
        assert.equal(connects[0]!.username, 'pl');
        assert.equal(connects[0]!.password, 'secret:p@ss');
        assert.equal(receivedHostHeader, `api.telegram.test:${stubPort}`);
      },
    );
  } finally {
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  }
});

test('socks5h:// supports connectHost override while preserving Host header', async () => {
  let receivedHostHeader = '';
  const stub = createServer((req, res) => {
    receivedHostHeader = String(req.headers.host ?? '');
    res.end('ok');
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const stubPort = (stub.address() as AddressInfo).port;

  try {
    await withSocks5Proxy(
      { forwardHostOverride: '127.0.0.1', forwardPortOverride: stubPort },
      async (proxyPort, connects) => {
        const dispatcher = createProxyDispatcher(`socks5h://127.0.0.1:${proxyPort}`, {
          connectHost: '149.154.167.220',
        });
        try {
          const res = await undiciFetch(`http://api.telegram.org:${stubPort}/ping`, {
            dispatcher,
          });
          assert.equal(await res.text(), 'ok');
          assert.equal(connects.length, 1);
          assert.equal(connects[0]!.atyp, 0x01);
          assert.equal(connects[0]!.targetHost, '149.154.167.220');
          assert.equal(receivedHostHeader, `api.telegram.org:${stubPort}`);
        } finally {
          await dispatcher?.close();
        }
      },
    );
  } finally {
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  }
});

test('socks5:// surfaces authentication failure cleanly', async () => {
  await withSocks5Proxy(
    { auth: { username: 'pl', password: 'right' } },
    async (proxyPort) => {
      const dispatcher = createProxyDispatcher(`socks5://pl:wrong@127.0.0.1:${proxyPort}`);
      try {
        await assert.rejects(
          undiciFetch('http://example.com/', { dispatcher }),
          (err: Error & { cause?: Error }) =>
            /SOCKS5 authentication failed/.test(err.cause?.message ?? err.message),
        );
      } finally {
        await dispatcher?.close();
      }
    },
  );
});

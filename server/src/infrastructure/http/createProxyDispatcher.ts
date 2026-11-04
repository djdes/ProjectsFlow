import net, { type Socket } from 'node:net';
import {
  Agent,
  buildConnector,
  Pool,
  ProxyAgent,
  type Dispatcher,
} from 'undici';

export type ProxyDispatcherOptions = {
  // Override the tunnel destination host while preserving the original Host header and TLS SNI
  // (e.g. TELEGRAM_PROXY_CONNECT_HOST when a proxy blocks *.telegram.org by domain name).
  readonly connectHost?: string;
  readonly connectTimeoutMs?: number;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const SOCKS_PROTOCOLS = new Set(['socks5:', 'socks5h:', 'socks:']);
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

function stripIpv6Brackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function pinnedHttpProxyAgent(proxyUrl: string, connectHost: string): ProxyAgent {
  return new ProxyAgent({
    uri: proxyUrl,
    factory: (origin, opts) => {
      const options = opts as Pool.Options;
      const tunnel = options.connect;
      if (typeof tunnel !== 'function') return new Pool(origin, options);
      const connect: buildConnector.connector = (target, callback) =>
        tunnel(
          {
            ...target,
            servername: target.servername || target.hostname,
            hostname: connectHost,
            host: target.port ? `${connectHost}:${target.port}` : connectHost,
          },
          callback,
        );
      return new Pool(origin, { ...options, connect });
    },
  });
}

function parseIpv6Bytes(ip: string): Buffer {
  // Expand :: shorthand into 8 16-bit groups (supports embedded IPv4 tail like ::ffff:127.0.0.1).
  let normalized = ip;
  const v4Match = normalized.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const octets = v4Match[2]!.split('.').map(Number);
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16);
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16);
    normalized = `${v4Match[1]}${hi}:${lo}`;
  }
  const halves = normalized.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  const groups = [...left, ...Array<string>(Math.max(0, missing)).fill('0'), ...right];
  const buf = Buffer.alloc(16);
  for (let i = 0; i < 8; i += 1) {
    buf.writeUInt16BE(parseInt(groups[i] || '0', 16), i * 2);
  }
  return buf;
}

function encodeSocks5TargetAddress(host: string): Buffer {
  const clean = stripIpv6Brackets(host);
  const ipVersion = net.isIP(clean);
  if (ipVersion === 4) {
    const octets = clean.split('.').map(Number);
    return Buffer.from([0x01, octets[0]!, octets[1]!, octets[2]!, octets[3]!]);
  }
  if (ipVersion === 6) {
    return Buffer.concat([Buffer.from([0x04]), parseIpv6Bytes(clean)]);
  }
  const domain = Buffer.from(clean, 'utf8');
  if (domain.length === 0 || domain.length > 255) {
    throw new Error(`Invalid SOCKS5 target hostname length: ${domain.length}`);
  }
  return Buffer.concat([Buffer.from([0x03, domain.length]), domain]);
}

class SocketByteReader {
  private buffer: Buffer = Buffer.alloc(0);
  private pending: {
    readonly count: number;
    readonly resolve: (chunk: Buffer) => void;
    readonly reject: (err: Error) => void;
  } | null = null;
  private endedError: Error | null = null;

  private readonly onData = (chunk: Buffer): void => {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    this.flush();
  };

  private readonly onError = (err: Error): void => {
    this.fail(err);
  };

  private readonly onClose = (): void => {
    this.fail(new Error('SOCKS5 proxy closed connection during handshake'));
  };

  constructor(private readonly socket: Socket) {
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  readExact(count: number): Promise<Buffer> {
    if (this.buffer.length >= count) {
      const out = this.buffer.subarray(0, count);
      this.buffer = this.buffer.subarray(count);
      return Promise.resolve(out);
    }
    if (this.endedError) {
      return Promise.reject(this.endedError);
    }
    return new Promise<Buffer>((resolve, reject) => {
      this.pending = { count, resolve, reject };
    });
  }

  detach(): void {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
    if (this.buffer.length > 0) {
      this.socket.unshift(this.buffer);
      this.buffer = Buffer.alloc(0);
    }
  }

  private flush(): void {
    if (!this.pending || this.buffer.length < this.pending.count) return;
    const { count, resolve } = this.pending;
    this.pending = null;
    const out = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    resolve(out);
  }

  private fail(err: Error): void {
    if (!this.endedError) this.endedError = err;
    if (!this.pending) return;
    const { reject } = this.pending;
    this.pending = null;
    reject(err);
  }
}

function writeBuffer(socket: Socket, data: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.write(data, (err) => (err ? reject(err) : resolve()));
  });
}

async function openSocks5Tunnel(
  proxyUrl: URL,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
): Promise<Socket> {
  const proxyHost = stripIpv6Brackets(proxyUrl.hostname);
  const proxyPort = proxyUrl.port ? Number(proxyUrl.port) : 1080;
  const hasAuth = proxyUrl.username.length > 0 || proxyUrl.password.length > 0;
  const username = decodeURIComponent(proxyUrl.username);
  const password = decodeURIComponent(proxyUrl.password);

  const socket = net.connect({ host: proxyHost, port: proxyPort });
  socket.setNoDelay(true);

  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`SOCKS5 connect timeout (${proxyHost}:${proxyPort})`);
      socket.destroy(err);
      reject(err);
    }, timeoutMs);
  });

  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const onConnect = (): void => {
          socket.off('error', onErr);
          resolve();
        };
        const onErr = (err: Error): void => {
          socket.off('connect', onConnect);
          reject(err);
        };
        socket.once('connect', onConnect);
        socket.once('error', onErr);
      }),
      timeoutPromise,
    ]);

    const reader = new SocketByteReader(socket);
    try {
      const greeting = hasAuth
        ? Buffer.from([0x05, 0x02, 0x00, 0x02])
        : Buffer.from([0x05, 0x01, 0x00]);
      await Promise.race([writeBuffer(socket, greeting), timeoutPromise]);

      const methodReply = await Promise.race([reader.readExact(2), timeoutPromise]);
      if (methodReply[0] !== 0x05) {
        throw new Error(`Invalid SOCKS5 version from proxy: ${methodReply[0]}`);
      }
      const method = methodReply[1]!;
      if (method === 0x02) {
        if (!hasAuth) {
          throw new Error('SOCKS5 proxy requires authentication');
        }
        const uBuf = Buffer.from(username, 'utf8');
        const pBuf = Buffer.from(password, 'utf8');
        if (uBuf.length > 255 || pBuf.length > 255) {
          throw new Error('SOCKS5 credentials exceed 255 bytes');
        }
        const authReq = Buffer.concat([
          Buffer.from([0x01, uBuf.length]),
          uBuf,
          Buffer.from([pBuf.length]),
          pBuf,
        ]);
        await Promise.race([writeBuffer(socket, authReq), timeoutPromise]);
        const authReply = await Promise.race([reader.readExact(2), timeoutPromise]);
        if (authReply[1] !== 0x00) {
          throw new Error(`SOCKS5 authentication failed (status=${authReply[1]})`);
        }
      } else if (method !== 0x00) {
        throw new Error(`SOCKS5 proxy rejected auth methods (method=0x${method.toString(16)})`);
      }

      const addrPart = encodeSocks5TargetAddress(targetHost);
      const portPart = Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]);
      const connectReq = Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), addrPart, portPart]);
      await Promise.race([writeBuffer(socket, connectReq), timeoutPromise]);

      const head = await Promise.race([reader.readExact(4), timeoutPromise]);
      if (head[0] !== 0x05) {
        throw new Error(`Invalid SOCKS5 reply version: ${head[0]}`);
      }
      if (head[1] !== 0x00) {
        throw new Error(`SOCKS5 CONNECT rejected (rep=0x${head[1]!.toString(16)})`);
      }
      const atyp = head[3]!;
      if (atyp === 0x01) {
        await Promise.race([reader.readExact(4 + 2), timeoutPromise]);
      } else if (atyp === 0x04) {
        await Promise.race([reader.readExact(16 + 2), timeoutPromise]);
      } else if (atyp === 0x03) {
        const lenBuf = await Promise.race([reader.readExact(1), timeoutPromise]);
        await Promise.race([reader.readExact(lenBuf[0]! + 2), timeoutPromise]);
      } else {
        throw new Error(`Unsupported SOCKS5 bind ATYP: ${atyp}`);
      }

      reader.detach();
      return socket;
    } catch (err) {
      reader.detach();
      throw err;
    }
  } catch (err) {
    if (!socket.destroyed) socket.destroy();
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createSocks5Agent(proxyUrl: URL, options: ProxyDispatcherOptions): Agent {
  const timeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const connectHost = options.connectHost?.trim() || undefined;
  const tlsUpgrade = buildConnector({ allowH2: false, timeout: timeoutMs });

  const connect: buildConnector.connector = (target, callback) => {
    const originalHost = stripIpv6Brackets(target.hostname);
    const tunnelHost = connectHost ?? originalHost;
    const tunnelPort = target.port
      ? Number(target.port)
      : target.protocol === 'https:'
        ? 443
        : 80;

    openSocks5Tunnel(proxyUrl, tunnelHost, tunnelPort, timeoutMs).then(
      (socket) => {
        socket.setKeepAlive(true, 60_000);
        if (target.protocol !== 'https:') {
          callback(null, socket);
          return;
        }
        const servername =
          target.servername || (net.isIP(originalHost) === 0 ? originalHost : undefined);
        tlsUpgrade(
          {
            ...target,
            ...(servername ? { servername } : {}),
            httpSocket: socket,
          },
          callback,
        );
      },
      (err: unknown) => {
        callback(err instanceof Error ? err : new Error(String(err)), null);
      },
    );
  };

  return new Agent({ connect });
}

export function createProxyDispatcher(
  proxyUrl?: string | null,
  options: ProxyDispatcherOptions = {},
): Dispatcher | undefined {
  const raw = proxyUrl?.trim();
  if (!raw) return undefined;

  const parsed = new URL(raw);
  const protocol = parsed.protocol.toLowerCase();
  const connectHost = options.connectHost?.trim() || undefined;

  if (SOCKS_PROTOCOLS.has(protocol)) {
    return createSocks5Agent(parsed, options);
  }
  if (HTTP_PROTOCOLS.has(protocol)) {
    return connectHost ? pinnedHttpProxyAgent(raw, connectHost) : new ProxyAgent(raw);
  }
  throw new Error(
    `Unsupported proxy protocol "${parsed.protocol}" (expected http://, https://, socks5://, or socks5h://)`,
  );
}

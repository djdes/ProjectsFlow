// Device-flow setup для @projectsflow/mcp-server. Запускается как
// `npx @projectsflow/mcp-server setup` или `PROJECTSFLOW_API_URL=... npx ...`.
//
// Flow:
//   1) POST /agent/device/authorize → {deviceCode, userCode, verificationUriComplete}
//   2) Печатаем юзеру код + URL.
//   3) Поллим POST /agent/device/token с deviceCode'ом, пока не получим accessToken.
//   4) Сохраняем {apiUrl, token} в ~/.config/projectsflow/agent.json.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

type AuthorizeResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

type TokenResponse = {
  accessToken: string;
  tokenName: string;
};

type ErrorBody = {
  error?: string;
  message?: string;
};

const DEFAULT_API_URL = 'https://projectsflow.ru/api';
const CONFIG_DIR = join(homedir(), '.config', 'projectsflow');
const CONFIG_PATH = join(CONFIG_DIR, 'agent.json');

function envApiUrl(): string {
  return (process.env['PROJECTSFLOW_API_URL'] ?? DEFAULT_API_URL).replace(/\/+$/, '');
}

function log(line: string): void {
  // setup пишет в stdout (это НЕ MCP-режим, stdout свободен).
  process.stdout.write(`${line}\n`);
}

async function authorize(apiUrl: string): Promise<AuthorizeResponse> {
  const res = await fetch(`${apiUrl}/agent/device/authorize`, { method: 'POST' });
  if (!res.ok) {
    const body = (await safeJson(res)) as ErrorBody | null;
    throw new Error(`authorize failed: ${res.status} ${body?.message ?? body?.error ?? res.statusText}`);
  }
  return (await res.json()) as AuthorizeResponse;
}

async function pollOnce(apiUrl: string, deviceCode: string): Promise<TokenResponse | 'pending'> {
  const res = await fetch(`${apiUrl}/agent/device/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceCode }),
  });
  // 202 — authorization_pending, продолжаем поллить.
  if (res.status === 202) return 'pending';
  if (!res.ok) {
    const body = (await safeJson(res)) as ErrorBody | null;
    throw new Error(`token poll failed: ${res.status} ${body?.message ?? body?.error ?? res.statusText}`);
  }
  return (await res.json()) as TokenResponse;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function saveConfig(apiUrl: string, token: string): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }
  // Если файл уже существует — backup, чтоб не потерять старый токен случайно.
  if (existsSync(CONFIG_PATH)) {
    try {
      const old = await readFile(CONFIG_PATH, 'utf8');
      await writeFile(`${CONFIG_PATH}.bak`, old);
    } catch {
      // best-effort, не блокируем основной flow
    }
  }
  const data = { apiUrl, token };
  await writeFile(CONFIG_PATH, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Открыть URL в дефолтном браузере без зависимостей. Best-effort: если не получилось —
// юзер просто откроет URL руками (мы его уже распечатали).
async function openBrowser(url: string): Promise<void> {
  try {
    const { spawn } = await import('node:child_process');
    const cmd =
      platform() === 'win32' ? 'cmd' : platform() === 'darwin' ? 'open' : 'xdg-open';
    const args = platform() === 'win32' ? ['/c', 'start', '""', url] : [url];
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // ignore
  }
}

export async function runSetup(): Promise<void> {
  const apiUrl = envApiUrl();
  log('');
  log('  ProjectsFlow MCP setup');
  log('  ─────────────────────────────────────────────────');
  log(`  API: ${apiUrl}`);
  log('');

  log('  Запрашиваю код подключения…');
  const auth = await authorize(apiUrl);

  log('');
  log(`  Код:          ${auth.userCode}`);
  log(`  Открой URL:   ${auth.verificationUriComplete}`);
  log('');
  log('  Открываю в браузере…');
  log('  (если не открылось — скопируй URL руками)');
  log('');
  await openBrowser(auth.verificationUriComplete);

  const deadline = Date.now() + auth.expiresIn * 1000;
  let interval = auth.interval * 1000;

  while (Date.now() < deadline) {
    await delay(interval);
    try {
      const result = await pollOnce(apiUrl, auth.deviceCode);
      if (result === 'pending') continue;

      // Успех — есть accessToken.
      await saveConfig(apiUrl, result.accessToken);
      log('');
      log(`  ✓ Подключено как «${result.tokenName}»`);
      log(`    Конфиг сохранён: ${CONFIG_PATH}`);
      log('');
      log('  Дальше:');
      log('    1) Зарегистрируй MCP в Claude Code:');
      log('       claude mcp add --scope user projectsflow -- npx -y @projectsflow/mcp-server@latest');
      log('    2) Перезапусти Claude Code — увидишь pf_* tool\'ы в списке MCP.');
      log('');
      return;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('expired_token') || msg.includes('410')) {
        log('');
        log('  ✗ Срок действия кода истёк. Запусти setup ещё раз.');
        process.exit(1);
      }
      if (msg.includes('access_denied') || msg.includes('403')) {
        log('');
        log('  ✗ Подключение отклонено.');
        process.exit(1);
      }
      // Иначе — пишем но продолжаем поллить (transient errors).
      process.stderr.write(`  warn: ${msg}\n`);
      // Бэкофф при ошибках — двойной интервал, чтобы не задрочить сервер.
      interval = Math.min(interval * 2, 30_000);
    }
  }

  log('');
  log('  ✗ Время ожидания истекло. Запусти setup ещё раз.');
  process.exit(1);
}

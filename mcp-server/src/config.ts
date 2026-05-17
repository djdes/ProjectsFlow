import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Конфиг MCP-сервера: где API и какой токен. Источники по приоритету:
// 1. Env: PROJECTSFLOW_API_URL, PROJECTSFLOW_AGENT_TOKEN
// 2. Файл: ~/.config/projectsflow/agent.json или PROJECTSFLOW_CONFIG=<path>
//
// Конфиг ищем только при старте — для long-running stdio-сессий перезапуск нужен
// чтоб подхватить новые значения.

export type AgentConfig = {
  readonly apiUrl: string;
  readonly token: string;
};

const DEFAULT_CONFIG_PATH = join(homedir(), '.config', 'projectsflow', 'agent.json');

export function loadConfig(): AgentConfig {
  // 1) ENV
  const envUrl = process.env['PROJECTSFLOW_API_URL'];
  const envToken = process.env['PROJECTSFLOW_AGENT_TOKEN'];
  if (envUrl && envToken) {
    return { apiUrl: stripTrailing(envUrl), token: envToken };
  }

  // 2) File
  const configPath = process.env['PROJECTSFLOW_CONFIG'] ?? DEFAULT_CONFIG_PATH;
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Invalid JSON in ${configPath}: ${(e as Error).message}`);
    }
    if (!isAgentConfigShape(parsed)) {
      throw new Error(`${configPath} must contain {apiUrl: string, token: string}`);
    }
    return { apiUrl: stripTrailing(parsed.apiUrl), token: parsed.token };
  }

  throw new Error(
    `ProjectsFlow MCP: config not found.\n` +
      `Either set PROJECTSFLOW_API_URL + PROJECTSFLOW_AGENT_TOKEN env vars,\n` +
      `or create ${configPath} with {"apiUrl":"https://projectsflow.ru/api","token":"pfat_..."}`,
  );
}

function stripTrailing(s: string): string {
  return s.replace(/\/+$/, '');
}

function isAgentConfigShape(v: unknown): v is { apiUrl: string; token: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { apiUrl?: unknown }).apiUrl === 'string' &&
    typeof (v as { token?: unknown }).token === 'string'
  );
}

#!/usr/bin/env node
// ============================================================
// ProjectsFlow MCP Server
//
// Подключается к Claude Code через stdio. Экспонирует 3 tool'а:
//   - pf_list_projects        — список проектов юзера
//   - pf_list_credentials     — список credential-файлов в проекте
//   - pf_get_credential       — полный credential с резолвленными секретами
//
// Установка в Claude Code:
//   claude mcp add projectsflow npx -- -y @projectsflow/mcp-server
//
// Конфиг (token + apiUrl) берётся из:
//   ~/.config/projectsflow/agent.json  ИЛИ
//   env: PROJECTSFLOW_API_URL + PROJECTSFLOW_AGENT_TOKEN
// ============================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { ApiClient, ApiError } from './api.js';

const TOOLS = [
  {
    name: 'pf_list_projects',
    description:
      'List ProjectsFlow projects accessible to the current user. ' +
      'Returns id, name, status, hasKb (whether the project has a Knowledge Base repo connected), ' +
      'and gitRepoUrl. Use this to find the project id needed for other tools.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'pf_list_credentials',
    description:
      "List credential files in a project's KB repo. Returns slug+title+kind for each — " +
      'use slug with pf_get_credential to retrieve plaintext values.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_get_credential',
    description:
      'Fetch a credential with all secret fields resolved to PLAINTEXT. ' +
      'Returns title, kind, and a fields object {field_name: value}. ' +
      "vault-references in the credential's frontmatter are automatically resolved.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        slug: {
          type: 'string',
          description:
            "Credential slug (filename without .md), e.g. 'ssh-prod'. Get from pf_list_credentials.",
        },
      },
      required: ['projectId', 'slug'],
      additionalProperties: false,
    },
  },
];

// Input schemas для validation (zod вместо ручного парсинга).
const ListCredentialsInput = z.object({ projectId: z.string().min(1) });
const GetCredentialInput = z.object({
  projectId: z.string().min(1),
  slug: z.string().min(1),
});

async function main(): Promise<void> {
  const config = loadConfig();
  const api = new ApiClient(config);

  const server = new Server(
    { name: 'projectsflow', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    try {
      switch (name) {
        case 'pf_list_projects': {
          const projects = await api.listProjects();
          return jsonResult(projects);
        }
        case 'pf_list_credentials': {
          const input = ListCredentialsInput.parse(req.params.arguments ?? {});
          const creds = await api.listCredentials(input.projectId);
          return jsonResult(creds);
        }
        case 'pf_get_credential': {
          const input = GetCredentialInput.parse(req.params.arguments ?? {});
          const cred = await api.getCredential(input.projectId, input.slug);
          return jsonResult(cred);
        }
        default:
          return errorResult(`Unknown tool: ${name}`);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        return errorResult(
          `ProjectsFlow API ${e.status}: ${JSON.stringify(e.detail) || e.message}`,
        );
      }
      if (e instanceof z.ZodError) {
        return errorResult(`Invalid arguments: ${JSON.stringify(e.issues)}`);
      }
      return errorResult(`Error: ${(e as Error).message}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Сервер живёт пока жив stdio-канал от Claude Code. process.stdin закроется → сервер выйдет.
}

function jsonResult(data: unknown): {
  content: { type: 'text'; text: string }[];
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

main().catch((err) => {
  // Ошибка на старте (config not found, etc.) — пишем в stderr и валим процесс с кодом 1.
  // stdout не трогаем — он зарезервирован под MCP-протокол.
  process.stderr.write(`projectsflow-mcp: fatal: ${(err as Error).message}\n`);
  process.exit(1);
});

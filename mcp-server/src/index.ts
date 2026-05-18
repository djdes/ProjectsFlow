#!/usr/bin/env node
// ============================================================
// ProjectsFlow MCP Server
//
// Подключается к Claude Code через stdio. Экспонирует tool'ы для работы с
// проектами, credential-vault и kanban-задачами:
//
//   - pf_list_projects         — список проектов юзера
//   - pf_list_credentials      — список credential-файлов в проекте
//   - pf_get_credential        — полный credential с резолвленными секретами
//   - pf_list_tasks            — список kanban-задач в проекте
//   - pf_move_task             — перенести задачу на другой статус
//   - pf_link_commit_to_task   — привязать коммит к задаче
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

const TASK_STATUS_VALUES = ['todo', 'in_progress', 'done'] as const;

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
  {
    name: 'pf_list_tasks',
    description:
      "List kanban tasks in a project. Returns id, title, description, status " +
      "('todo' | 'in_progress' | 'done'), position, and commitCount. Use this BEFORE making " +
      'a commit: read open tasks (todo + in_progress), match against your staged diff and ' +
      'planned commit message, ask the user to confirm if you found a candidate, then ' +
      'call pf_link_commit_to_task and (optionally) pf_move_task after `git push`.',
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
    name: 'pf_move_task',
    description:
      'Move a task to a different status column. The task lands at the BOTTOM of the target ' +
      'column — the user can manually reorder in the UI later if needed. ' +
      'Use this to mark a task done after the commit is pushed, or to pull a task into in_progress ' +
      'when you start working on it. NOTE: pf_link_commit_to_task already auto-transitions ' +
      'todo→in_progress on the first linked commit, so you usually only need pf_move_task ' +
      'explicitly when moving to done (or back to todo for a revert).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        taskId: { type: 'string', description: 'Task id (from pf_list_tasks)' },
        targetStatus: {
          type: 'string',
          enum: TASK_STATUS_VALUES,
          description: "Target column: 'todo', 'in_progress', or 'done'",
        },
      },
      required: ['projectId', 'taskId', 'targetStatus'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_link_commit_to_task',
    description:
      'Link a git commit (by SHA) to a kanban task. The commit SHA must be reachable on ' +
      "the project's GitHub repo — call this AFTER `git push`, not before. The server pulls " +
      'commit metadata (message, author, date, html_url) from GitHub and stores a snapshot. ' +
      'On the first linked commit, the task auto-transitions from "todo" to "in_progress".',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        taskId: { type: 'string', description: 'Task id (from pf_list_tasks)' },
        sha: {
          type: 'string',
          description:
            'Commit SHA (7-40 hex chars). Full SHA preferred; short SHAs work but GitHub resolves them server-side.',
        },
      },
      required: ['projectId', 'taskId', 'sha'],
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
const ListTasksInput = z.object({ projectId: z.string().min(1) });
const MoveTaskInput = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  targetStatus: z.enum(TASK_STATUS_VALUES),
});
const LinkCommitInput = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  sha: z.string().trim().regex(/^[0-9a-f]{7,40}$/i, 'Invalid commit SHA'),
});

async function main(): Promise<void> {
  const config = loadConfig();
  const api = new ApiClient(config);

  const server = new Server(
    { name: 'projectsflow', version: '0.2.0' },
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
        case 'pf_list_tasks': {
          const input = ListTasksInput.parse(req.params.arguments ?? {});
          const tasks = await api.listTasks(input.projectId);
          return jsonResult(tasks);
        }
        case 'pf_move_task': {
          const input = MoveTaskInput.parse(req.params.arguments ?? {});
          const task = await api.moveTask(input.projectId, input.taskId, input.targetStatus);
          return jsonResult(task);
        }
        case 'pf_link_commit_to_task': {
          const input = LinkCommitInput.parse(req.params.arguments ?? {});
          const commit = await api.linkCommitToTask(input.projectId, input.taskId, input.sha);
          return jsonResult(commit);
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

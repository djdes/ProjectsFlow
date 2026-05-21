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

const TASK_STATUS_VALUES = ['backlog', 'todo', 'in_progress', 'done'] as const;

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
    name: 'pf_get_task',
    description:
      'Fetch a single task with ALL its attachments inlined AND the full thread of comments. ' +
      'Returns the task metadata + comments as text, then each attachment as a separate ' +
      'content block: images (image/*) as inline `image` blocks (viewable directly), other ' +
      'files as embedded `resource` blocks. Comments are ordered oldest-first (like a chat). ' +
      "Use this whenever you're about to work on a task — even if attachmentCount is 0, " +
      'the comments thread often carries clarifications, prior agent attempts, or user ' +
      'follow-ups that change the scope.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        taskId: { type: 'string', description: 'Task id (from pf_list_tasks)' },
      },
      required: ['projectId', 'taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_create_task_comment',
    description:
      'Post a comment to a kanban task. Use this to leave progress updates as you work: ' +
      '"starting", "found blocker X", "approach: Y", "PR opened — N". The comment author ' +
      "will be the user that issued the agent token. Mentions via `@displayName` are parsed " +
      'server-side and trigger notifications. Markdown is allowed in the body. Recommended ' +
      'cadence: one comment when picking up a task, one per significant decision/blocker, ' +
      'one at completion. Avoid noisy "still working" pings — those add no signal.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        taskId: { type: 'string', description: 'Task id (from pf_list_tasks)' },
        body: {
          type: 'string',
          description: 'Comment body (markdown). 1-10000 chars after trim.',
        },
      },
      required: ['projectId', 'taskId', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_list_tasks',
    description:
      "List kanban tasks in a project. Returns id, title, description, status " +
      "('backlog' | 'todo' | 'in_progress' | 'done'), position, and commitCount. 'backlog' " +
      'is the unnamed left-most column for raw triage items — users manually promote them ' +
      'to TODO. Use this BEFORE making a commit: read open tasks (todo + in_progress), match ' +
      'against your staged diff and planned commit message, ask the user to confirm if you ' +
      'found a candidate, then call pf_link_commit_to_task and (optionally) pf_move_task after `git push`.',
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
          description: "Target column: 'backlog', 'todo', 'in_progress', or 'done'",
        },
      },
      required: ['projectId', 'taskId', 'targetStatus'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_create_credential',
    description:
      "Create a new credential in the project's KB-repo with structured fields. Each field " +
      'has an explicit `isSecret` flag — secret fields land in the vault (encrypted secrets ' +
      'table) and are referenced from the markdown frontmatter as `vault://`, public fields ' +
      "live in the frontmatter directly. Use this when the user asks to save a token, " +
      'password, API key, SSH credentials, or any other sensitive value into the project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        title: {
          type: 'string',
          description: 'Human-readable title shown in the UI list (e.g. "npm publish token")',
        },
        kind: {
          type: 'string',
          description:
            "Optional credential kind/category for the UI badge: 'npm-token', 'ssh', " +
            "'github-pat', 'database', etc. Lowercase, kebab-case preferred.",
        },
        slug: {
          type: 'string',
          description:
            'Optional filename slug (without .md). Defaults to slugify(title). ' +
            "Example: 'npm-publish' → credentials/npm-publish.md",
        },
        fields: {
          type: 'array',
          description: 'Credential fields. Mark secrets explicitly with isSecret=true.',
          items: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: "Field name (lowercase, snake_case), e.g. 'token', 'scope'",
              },
              value: { type: 'string', description: 'Field value (plaintext)' },
              isSecret: {
                type: 'boolean',
                description: 'true → store in vault and reference via `vault://`',
              },
            },
            required: ['key', 'value', 'isSecret'],
            additionalProperties: false,
          },
          minItems: 1,
        },
      },
      required: ['projectId', 'title', 'fields'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_create_task',
    description:
      'Create a new kanban task in the project. By default the task lands at the bottom of ' +
      "the TODO column. Use this when the user asks to add a task / TODO / ticket to a project.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        description: {
          type: 'string',
          description: 'Task description (markdown). Required, 1-5000 chars.',
        },
        status: {
          type: 'string',
          enum: TASK_STATUS_VALUES,
          description: "Initial column. Default: 'todo'.",
        },
      },
      required: ['projectId', 'description'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_write_kb_document',
    description:
      "Create or update a Markdown document in the project's KB-repo. Path must end with " +
      "`.md` (e.g. 'notes/architecture.md'). For new files pass sha=null; for updates pass " +
      "the current sha returned by an earlier read (optimistic lock — server rejects with 409 " +
      "if the file was modified meanwhile). Use this for general KB writes; for credentials " +
      'specifically use pf_create_credential — it handles the vault/secret separation.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        path: {
          type: 'string',
          description: "Repo-relative path, must end with .md. Example: 'notes/setup.md'",
        },
        frontmatter: {
          type: 'object',
          description: 'YAML frontmatter as a JSON object',
          additionalProperties: true,
        },
        body: { type: 'string', description: 'Markdown body (after frontmatter)' },
        sha: {
          type: ['string', 'null'],
          description: 'Current sha for updates, null for new files',
        },
      },
      required: ['projectId', 'path', 'frontmatter', 'body', 'sha'],
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
  {
    name: 'pf_list_pending_agent_jobs',
    description:
      'List queued agent-jobs across ALL projects the current user is a member of, oldest first. ' +
      'Each item includes project name, git repo URL, task description, and createdAt. Use this ' +
      'at the start of every /check-agent-queue tick: if the array is empty, exit immediately ' +
      "with a short message (don't burn message budget on empty ticks). If non-empty, pick the " +
      'FIRST item and proceed to pf_claim_agent_job.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Max jobs to return (default 10, max 50)',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pf_claim_agent_job',
    description:
      'Atomically claim a queued agent-job - moves status from queued to running. Returns the ' +
      "updated job. If another /loop session already claimed it (status not queued), returns 409 " +
      '"agent_job_already_claimed" - skip the job and try the next one (or exit if list ' +
      'returned only one). Always call this immediately after pf_list_pending_agent_jobs picks ' +
      'a candidate, before doing any work.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Agent job id (from pf_list_pending_agent_jobs)' },
      },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_complete_agent_job',
    description:
      'Finalize an agent-job. Call this ONCE at the end of work - either after successful PR ' +
      "creation (ok=true, prUrl=<url>, branchName=<branch>), or after failure (ok=false, " +
      'error=<short reason>). Sets status to succeeded or failed, fills finished_at. If the ' +
      'job was cancelled by the user during your work, this call returns 409 ' +
      '"agent_job_not_in_running_state" - handle by cleaning up the local branch/worktree and ' +
      'NOT pushing the PR.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Agent job id' },
        ok: { type: 'boolean', description: 'true on success, false on failure' },
        prUrl: { type: ['string', 'null'], description: 'PR URL if PR was created' },
        error: { type: ['string', 'null'], description: 'Short failure reason' },
        branchName: { type: ['string', 'null'], description: 'Branch name that agent worked on' },
      },
      required: ['jobId', 'ok'],
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
const GetTaskInput = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
});
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
const CreateCredentialInput = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  kind: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  fields: z
    .array(
      z.object({
        key: z.string().min(1),
        value: z.string(),
        isSecret: z.boolean(),
      }),
    )
    .min(1),
});
const CreateTaskInputZ = z.object({
  projectId: z.string().min(1),
  description: z.string().min(1),
  status: z.enum(TASK_STATUS_VALUES).optional(),
});
const WriteKbDocInputZ = z.object({
  projectId: z.string().min(1),
  path: z.string().regex(/^[a-z0-9_./-]+\.md$/i, 'Path must end with .md'),
  frontmatter: z.record(z.unknown()),
  body: z.string(),
  sha: z.string().nullable(),
});
const CreateTaskCommentInputZ = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  body: z.string().trim().min(1).max(10_000),
});

const ListPendingAgentJobsInput = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});

const ClaimAgentJobInput = z.object({
  jobId: z.string().min(1),
});

const CompleteAgentJobInputZ = z.object({
  jobId: z.string().min(1),
  ok: z.boolean(),
  prUrl: z.string().url().nullable().optional(),
  error: z.string().max(4000).nullable().optional(),
  branchName: z.string().max(200).nullable().optional(),
});

async function main(): Promise<void> {
  const config = loadConfig();
  const api = new ApiClient(config);

  const server = new Server(
    { name: 'projectsflow', version: '0.7.0' },
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
        case 'pf_get_task': {
          const input = GetTaskInput.parse(req.params.arguments ?? {});
          const { task, attachments, comments } = await api.getTask(
            input.projectId,
            input.taskId,
          );
          // Текстовый блок — task + attachment metadata + comments thread (без base64-дублей).
          const meta = {
            task,
            attachments: attachments.map((a) => ({
              id: a.id,
              filename: a.filename,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              uploadedAt: a.uploadedAt,
            })),
            comments,
          };
          const content: ToolContent[] = [
            { type: 'text', text: JSON.stringify(meta, null, 2) },
          ];
          // Бинари — image/* как `image`-блок (LLM видит картинку), остальное как
          // `resource` с blob (Claude Code умеет читать embedded resources).
          for (const a of attachments) {
            if (a.mimeType.startsWith('image/')) {
              content.push({ type: 'image', data: a.dataBase64, mimeType: a.mimeType });
            } else {
              content.push({
                type: 'resource',
                resource: {
                  uri: `projectsflow://attachment/${a.id}`,
                  mimeType: a.mimeType,
                  blob: a.dataBase64,
                },
              });
            }
          }
          return { content };
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
        case 'pf_create_credential': {
          const input = CreateCredentialInput.parse(req.params.arguments ?? {});
          const credential = await api.createCredential(input.projectId, {
            title: input.title,
            kind: input.kind ?? null,
            slug: input.slug ?? null,
            fields: input.fields,
          });
          return jsonResult(credential);
        }
        case 'pf_create_task': {
          const input = CreateTaskInputZ.parse(req.params.arguments ?? {});
          const task = await api.createTask(input.projectId, {
            description: input.description,
            status: input.status,
          });
          return jsonResult(task);
        }
        case 'pf_create_task_comment': {
          const input = CreateTaskCommentInputZ.parse(req.params.arguments ?? {});
          const comment = await api.createTaskComment(
            input.projectId,
            input.taskId,
            input.body,
          );
          return jsonResult(comment);
        }
        case 'pf_write_kb_document': {
          const input = WriteKbDocInputZ.parse(req.params.arguments ?? {});
          const result = await api.writeKbDocument(input.projectId, {
            path: input.path,
            frontmatter: input.frontmatter,
            body: input.body,
            sha: input.sha,
          });
          return jsonResult(result);
        }
        case 'pf_list_pending_agent_jobs': {
          const input = ListPendingAgentJobsInput.parse(req.params.arguments ?? {});
          const jobs = await api.listPendingAgentJobs(input.limit ?? 10);
          return jsonResult(jobs);
        }
        case 'pf_claim_agent_job': {
          const input = ClaimAgentJobInput.parse(req.params.arguments ?? {});
          const job = await api.claimAgentJob(input.jobId);
          return jsonResult(job);
        }
        case 'pf_complete_agent_job': {
          const input = CompleteAgentJobInputZ.parse(req.params.arguments ?? {});
          await api.completeAgentJob(input.jobId, {
            ok: input.ok,
            prUrl: input.prUrl ?? null,
            error: input.error ?? null,
            branchName: input.branchName ?? null,
          });
          return jsonResult({ ok: true });
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

// MCP content-block union — text/image/resource. SDK типизирует это структурно
// (CallToolResult принимает массив с этими shapes), но нам удобнее иметь явный alias.
type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | {
      type: 'resource';
      resource: { uri: string; mimeType: string; blob: string };
    };

function jsonResult(data: unknown): { content: ToolContent[] } {
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

// Subcommand-роутинг. По умолчанию (без argv) — MCP-сервер на stdio. С аргументом
// `setup` — интерактивный device-flow и запись agent.json. Это позволяет одному
// `bin`'у обслуживать оба сценария без отдельных npm-пакетов.
const subcommand = process.argv[2];

if (subcommand === 'setup') {
  // Динамический импорт — чтобы при обычном MCP-старте setup.js не загружался.
  import('./setup.js')
    .then(({ runSetup }) => runSetup())
    .catch((err: Error) => {
      process.stderr.write(`projectsflow-mcp setup: ${err.message}\n`);
      process.exit(1);
    });
} else if (subcommand && subcommand !== '--') {
  process.stderr.write(
    `Unknown subcommand: ${subcommand}\n` +
      `Usage:\n` +
      `  projectsflow-mcp           — start MCP stdio server (used by Claude Code)\n` +
      `  projectsflow-mcp setup     — interactive device-flow setup, writes agent.json\n`,
  );
  process.exit(2);
} else {
  main().catch((err) => {
    // Ошибка на старте (config not found, etc.) — пишем в stderr и валим процесс с кодом 1.
    // stdout не трогаем — он зарезервирован под MCP-протокол.
    const msg = (err as Error).message;
    process.stderr.write(`projectsflow-mcp: fatal: ${msg}\n`);
    if (msg.toLowerCase().includes('config not found')) {
      process.stderr.write(
        `\n` +
          `Looks like you haven't run setup yet. Try:\n` +
          `  npx -y @projectsflow/mcp-server@latest setup\n` +
          `\n` +
          `Or set PROJECTSFLOW_API_URL and PROJECTSFLOW_AGENT_TOKEN env vars in your\n` +
          `Claude Code MCP config:\n` +
          `  claude mcp add --scope user projectsflow \\\n` +
          `    -e PROJECTSFLOW_API_URL=https://projectsflow.ru/api \\\n` +
          `    -e PROJECTSFLOW_AGENT_TOKEN=pfat_... \\\n` +
          `    -- npx -y @projectsflow/mcp-server@latest\n`,
      );
    }
    process.exit(1);
  });
}

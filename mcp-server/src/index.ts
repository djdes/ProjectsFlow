#!/usr/bin/env node
// ============================================================
// ProjectsFlow MCP Server
//
// Подключается к Claude Code через stdio. Экспонирует tool'ы для работы с
// проектами, credential-vault и kanban-задачами:
//
//   - pf_list_projects         — список проектов юзера
//   - pf_get_project           — метаданные одного проекта
//   - pf_list_user_repos       — GitHub-репозитории юзера (для подбора перед созданием)
//   - pf_create_project        — создать проект (+ опционально завести/привязать git-репо)
//   - pf_update_project        — переименовать проект / привязать git-репо
//   - pf_list_members          — состав команды проекта
//   - pf_list_credentials      — список credential-файлов в проекте
//   - pf_get_credential        — полный credential с резолвленными секретами
//   - pf_create_credential     — создать credential (секреты в vault)
//   - pf_create_local_kb       — локальная KB без git
//   - pf_list_kb_documents     — все KB-доки проекта
//   - pf_read_kb_document      — прочитать KB-док целиком
//   - pf_write_kb_document     — создать/обновить KB-док
//   - pf_delete_kb_document    — удалить KB-док (необратимо)
//   - pf_list_tasks            — список kanban-задач в проекте
//   - pf_get_task              — задача с вложениями и тредом комментариев
//   - pf_create_task           — создать задачу
//   - pf_update_task           — изменить описание задачи
//   - pf_delete_task           — удалить задачу (необратимо)
//   - pf_move_task             — перенести задачу на другой статус
//   - pf_search_tasks          — глобальный поиск по задачам
//   - pf_create_task_comment   — комментарий к задаче
//   - pf_link_commit_to_task   — привязать коммит к задаче
//   - pf_list_commits          — коммиты задачи
//   - pf_sync_commits          — авто-привязка коммитов по [short-id]
//   - pf_get_finance           — P&L-сводка проекта
//   - pf_add_expense           — добавить расход
//   - pf_add_income            — добавить доход
//   - pf_check_repo_usage      — приватная проверка занятости репо
//   - pf_request_repo_access   — запрос общего доступа к репо
//   - pf_get_my_account        — профиль юзера + github (метаданные, без токена) + agent-токены
//   - pf_delete_project        — безвозвратное удаление проекта (owner-only)
//   - pf_list_my_dispatched_projects — проекты, где этот юзер — Ralph-диспетчер
//   - pf_set_project_dispatcher      — назначить/снять диспетчера (owner-only)
//   - pf_get_project_git_token       — делегированный GitHub-токен owner'а для git-операций
//   - pf_live_start_session          — открыть LIVE-сессию стрима действий воркера по задаче
//   - pf_live_append_events          — дослать батч событий (<=64) в LIVE-сессию
//   - pf_live_finish_session         — финализировать LIVE-сессию (статус + стоимость + диффы)
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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.js';
import { ApiClient, ApiError } from './api.js';

// Версия сервера читается из package.json в рантайме (а не хардкодом / import) —
// rootDir=./src запрещает `import pkg from '../package.json'` (TS6059). Резолвим
// относительно скомпилированного dist/index.js: ../package.json.
function readPkgVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// 'awaiting_clarification' — задача на паузе до действия человека (Ralph F11 Q&A).
// 'manual' — колонка для задач, которые делает человек руками; вне pipeline'а агента.
// Порядок повторяет домен сервера.
const TASK_STATUS_VALUES = [
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'done',
  'manual',
] as const;

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
    name: 'pf_list_user_repos',
    description:
      "List the authenticated user's GitHub repositories (most recently pushed first). " +
      'Returns fullName, htmlUrl, description, private, pushedAt. Use this BEFORE ' +
      'pf_create_project to look for an existing repo whose name resembles the new project — ' +
      'so you can offer to connect it instead of creating a duplicate. Requires the user to ' +
      'have connected GitHub on the site (otherwise 409 github_not_connected).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'pf_create_project',
    description:
      'Create a new ProjectsFlow project for the current user. IMPORTANT — decide the git ' +
      'option WITH THE USER before calling: (1) call pf_list_user_repos and look for a repo ' +
      'whose name resembles `name`; (2) ask the user whether to CONNECT an existing repo ' +
      '(suggest the closest match), CREATE a new repo under their GitHub account, or use ' +
      "NEITHER. Put the decision in `git` (omit = none). For git.mode='create' with a " +
      'non-latin project name, also pass a latin `repoName` (GitHub repo names must be ASCII). ' +
      'New repos default to private. Returns the created project.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name (shown in UI; may be Cyrillic)' },
        git: {
          type: 'object',
          description: 'Git option chosen by the user. Omit for no repo.',
          properties: {
            mode: { type: 'string', enum: ['none', 'connect', 'create'] },
            gitRepoUrl: {
              type: 'string',
              description: "mode='connect': full https URL of the existing repo",
            },
            repoName: {
              type: 'string',
              description: "mode='create': repo name (ASCII); defaults to a slug of the project name",
            },
            description: { type: 'string', description: "mode='create': repo description" },
            private: { type: 'boolean', description: "mode='create': private repo (default true)" },
          },
          required: ['mode'],
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_update_project',
    description:
      'Update a project: rename it and/or attach a git repository. Pass at least one of ' +
      'name / gitRepoUrl. Requires editor+ role on the project. Returns the updated project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        name: { type: 'string', description: 'New project name' },
        gitRepoUrl: {
          type: ['string', 'null'],
          description: 'GitHub repo URL to attach (null to detach)',
        },
      },
      required: ['projectId'],
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
      '"starting", "found blocker X", "approach: Y", "PR opened — N". Comments are stored ' +
      'with actor_kind=\'agent\' (server auto-sets) so the UI shows a Claude-styled "✻ Диспетчер" ' +
      'header instead of the token owner\'s name. Mentions via `@displayName` are parsed ' +
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
        agentName: {
          type: 'string',
          enum: ['ralph-dispatcher', 'ralph-worker', 'ralph-grillme', 'ralph-verify'],
          description:
            'Identifier of the agent process creating this comment. Drives the UI title: ' +
            'ralph-dispatcher → "Диспетчер · Claude Code/Opus" (default), ' +
            'ralph-worker → "Воркер · Claude Opus 4.7", ' +
            'ralph-grillme → "Grillme-агент · Claude Opus 4.7", ' +
            'ralph-verify → "Верификатор · Claude Sonnet 4.6". ' +
            'Omit if you are not sure — server defaults to ralph-dispatcher.',
        },
      },
      required: ['projectId', 'taskId', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_list_task_comments',
    description:
      "Read the comment thread of a task (ASC by createdAt). Returns id, body (raw markdown — " +
      "HTML comments like `<!-- ralph-* -->` are preserved), ownerUserId, ownerDisplayName, " +
      'createdAt, updatedAt. Use this when you need conversation history — e.g. to check whether a ' +
      'question you would ask has already been answered (look for `<!-- ralph-answer ... -->` markers), ' +
      'or to read prior decisions before continuing work. Filter narrowly with `has_marker` when ' +
      'scanning many comments for a specific kind. Note: pf_get_task already returns full thread for ' +
      'one task — use pf_list_task_comments when you specifically need filters or to poll for updates.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        taskId: { type: 'string', description: 'Task id (from pf_list_tasks)' },
        since: {
          type: 'string',
          description:
            'ISO 8601 datetime. Returns only comments with createdAt >= since. Useful for polling.',
        },
        limit: {
          type: 'number',
          description: 'Max comments to return. 1..500, default 200.',
        },
        has_marker: {
          type: 'string',
          enum: ['ralph-question', 'ralph-answer', 'ralph-grillme-summary'],
          description:
            'Server-side body filter — only comments containing `<!-- {marker}` substring. ' +
            'Narrows huge threads to relevant Q&A markers.',
        },
      },
      required: ['projectId', 'taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_list_tasks',
    description:
      "List kanban tasks in a project. Returns id, title, description, status " +
      "('backlog' | 'todo' | 'in_progress' | 'awaiting_clarification' | 'done' | 'manual'), " +
      'position, commitCount, and commentCount ' +
      '(>0 means the task already has a discussion thread — read it via pf_get_task). \'backlog\' ' +
      'is the unnamed left-most column for raw triage items — users manually promote them ' +
      "to TODO. 'manual' is a parking column for tasks the user does by hand — no auto-transitions, " +
      "agent never picks them up. Use this BEFORE making a commit: read open tasks (todo + in_progress), " +
      'match against your staged diff and planned commit message, ask the user to confirm if you ' +
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
      "explicitly when moving to done (or back to todo for a revert). 'awaiting_clarification' " +
      'parks an in-progress task waiting on a human (answer to ralph-question, post-retry triage, ' +
      'reformulation) — server auto-returns it to in_progress when a comment with ' +
      '`<!-- ralph-answer ` or `<!-- ralph-grillme-summary ` marker arrives. ' +
      "'manual' is a parking column for tasks the user does by hand — no auto-transitions trigger " +
      'on this status.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        taskId: { type: 'string', description: 'Task id (from pf_list_tasks)' },
        targetStatus: {
          type: 'string',
          enum: TASK_STATUS_VALUES,
          description:
            "Target column: 'backlog', 'todo', 'in_progress', 'awaiting_clarification', 'done', or 'manual'",
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
      "the TODO column. Use this when the user asks to add a task / TODO / ticket to a project. " +
      'Optionally specify ralphMode to control how the Ralph dispatcher should treat this task ' +
      "(default 'normal').",
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
        ralphMode: {
          type: 'string',
          enum: ['normal', 'silent', 'grillme'],
          description:
            "How Ralph should handle this task: 'normal' (default — worker may ask " +
            "ralph-question on critical ambiguity), 'silent' (worker never asks; on " +
            "ambiguity → blocked immediately; grillme skipped), 'grillme' (force pre-worker " +
            'grillme interview up to 10 questions, then worker as normal).',
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
      'On the first linked commit, the task auto-transitions from "todo" to "in_progress". ' +
      'v0.16+: works for admin-dispatchers without their own GitHub — server falls back to ' +
      "delegated owner/member token (same order as pf_get_project_git_token). Owner sees " +
      'usage in audit-log with context=link_commit.',
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
    name: 'pf_check_repo_usage',
    description:
      'PRIVATE check whether a git repository is already connected to a project. Returns ' +
      "ownership ('none' = nobody uses it; 'self' = you already have it; 'other' = it belongs " +
      'to a DIFFERENT user) and, only when other, an opaque requestTarget token. This NEVER ' +
      "reveals the other project's name, id, owner or count — privacy by design. Call this " +
      'before creating a project that connects an existing repo: if ownership=other, offer the ' +
      'user to request shared access via pf_request_repo_access.',
    inputSchema: {
      type: 'object',
      properties: {
        gitRepoUrl: { type: 'string', description: 'Git repo URL (https or git@…); normalized server-side' },
      },
      required: ['gitRepoUrl'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_request_repo_access',
    description:
      'Request shared access to a repository that belongs to another user (pass the requestTarget ' +
      'from pf_check_repo_usage). Notifies the project owner(s); the API does NOT grant access — ' +
      'the owner approves on the site. Idempotent (repeating does not spam). Returns status ' +
      "('pending' | 'already_requested' | 'approved' | 'denied') and a requestId.",
    inputSchema: {
      type: 'object',
      properties: {
        gitRepoUrl: { type: 'string', description: 'Same git repo URL passed to pf_check_repo_usage' },
        requestTarget: { type: 'string', description: 'Opaque token from pf_check_repo_usage (ownership=other)' },
        message: { type: 'string', description: 'Optional note to the owner' },
      },
      required: ['gitRepoUrl', 'requestTarget'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_create_local_kb',
    description:
      'Create a LOCAL knowledge base for a project (stored in ProjectsFlow, no git repo needed). ' +
      'Use right after pf_create_project when the user has no GitHub KB but wants to save ' +
      'credentials/notes immediately. After this, pf_create_credential / pf_list_credentials / ' +
      'pf_get_credential work for the project. Optional — skip if the project already has a KB.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects / pf_create_project)' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_declare_app_schema',
    description:
      "Declare (or re-declare) the app BACKEND for a project: enables login/users + a database " +
      "with tables and access rules, so the generated site can be a real app (auth, per-user " +
      "data), not just static pages. Backend = one SQLite file per project on our server (100 MB " +
      "quota). Call this from the dispatcher when the generated app needs persistence. The site " +
      "frontend then talks to `<slug>.projectsflow.ru/api/*` via the @projectsflow/app-client SDK. " +
      "Returns an appKey ONCE (store it in the project KB — the server keeps only a hash). " +
      "Idempotent: re-calling updates the schema and rotates the key. Field types: text/int/real/" +
      "bool/datetime. Table/field names must match ^[a-z][a-z0-9_]*$; names starting with `_` are " +
      "reserved. Access rules read/write: 'anyone' | 'authenticated' | 'owner' (owner = only the " +
      "row's creator). id/owner_id/created_at columns are added automatically — do not declare them.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        schema: {
          type: 'object',
          description:
            "App schema: { tables: [{ name, fields: [{ name, type, required?, unique? }], " +
            "rules: { read, write } }] }",
          properties: {
            tables: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Table name, ^[a-z][a-z0-9_]*$' },
                  fields: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        type: { type: 'string', enum: ['text', 'int', 'real', 'bool', 'datetime'] },
                        required: { type: 'boolean' },
                        unique: { type: 'boolean' },
                      },
                      required: ['name', 'type'],
                      additionalProperties: false,
                    },
                  },
                  rules: {
                    type: 'object',
                    properties: {
                      read: { type: 'string', enum: ['anyone', 'authenticated', 'owner'] },
                      write: { type: 'string', enum: ['anyone', 'authenticated', 'owner'] },
                    },
                    required: ['read', 'write'],
                    additionalProperties: false,
                  },
                },
                required: ['name', 'fields', 'rules'],
                additionalProperties: false,
              },
            },
          },
          required: ['tables'],
          additionalProperties: false,
        },
      },
      required: ['projectId', 'schema'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_list_pending_ai_prompt_jobs',
    description:
      'List queued AI-prompt-improvement jobs where current user is the dispatcher, oldest first. ' +
      'These are short-lived requests from the ProjectsFlow web UI: user clicked the "AI" button ' +
      'next to a task-description field, and the site wants the dispatcher to rewrite the text in ' +
      'plain Russian + elaborate on details. Each item has projectId (or null for Inbox tasks), ' +
      'projectName and createdAt. Call this in /loop or directly from the dispatcher (e.g. ' +
      'dispatch.ps1 in repo PFLoopDispatch) — AI requests are time-sensitive (user is waiting ' +
      'up to 25s on a long-poll). If empty, no work to do.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max jobs to return (default 10, max 50)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pf_claim_ai_prompt_job',
    description:
      'Atomically claim a queued AI-prompt-improvement job. Returns the full job: id, projectId, ' +
      'inputText (the original user text, 1..5000 chars), kbContext (pre-fetched KB bundle, may ' +
      'be null — server already collected it, you do NOT need to fetch KB yourself). On 409 ' +
      '"ai_prompt_job_already_claimed" another session won — skip and try the next one. After ' +
      'claim you have ~5 minutes before server-side cleanup cancels stuck jobs — process and ' +
      'complete promptly. Call Claude with system prompt "Ты помощник по постановке задач..." ' +
      '(see docs/superpowers/specs/2026-05-28-ai-prompt-improvement-design.md §8.3) and the ' +
      'inputText + kbContext as the user message.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'AI-prompt-job id (from pf_list_pending_ai_prompt_jobs)' },
      },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_complete_ai_prompt_job',
    description:
      'Finalize an AI-prompt-improvement job. ok=true requires improvedText (the rewritten task ' +
      'description for "improve" mode, or a JSON result string for "compose" mode; ≤600000 chars). ' +
      'ok=false requires error (short reason, ≤500 chars, e.g. ' +
      '"claude_api_overloaded" or "rate_limited"). Server then unblocks the frontend long-poll ' +
      'and returns the result to the user. Idempotency: do NOT retry on 409 ' +
      '"ai_prompt_job_not_in_running_state" — the job has been cancelled by server cleanup or ' +
      'user, just drop it.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'AI-prompt-job id' },
        ok: { type: 'boolean', description: 'true if Claude produced a valid rewrite' },
        improvedText: {
          type: ['string', 'null'],
          description: 'Rewritten task description / compose JSON result (≤600000 chars). Required when ok=true.',
        },
        error: {
          type: ['string', 'null'],
          description: 'Short error reason (≤500 chars). Required when ok=false.',
        },
      },
      required: ['jobId', 'ok'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_list_pending_monitoring_analysis_jobs',
    description:
      'List queued monitoring AI-analysis jobs where current user is the dispatcher, oldest first. ' +
      'A project member clicked "Разобрать через AI" on a server snapshot/logs/alert and the site ' +
      'wants the dispatcher to diagnose it. Each item has projectId/projectName, serverId/serverName, ' +
      'analysisType (snapshot|logs|alert|digest) and createdAt. Time-sensitive: the user long-polls ' +
      'up to 25s. If empty, no work to do.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max jobs to return (default 10, max 50)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pf_claim_monitoring_analysis_job',
    description:
      'Atomically claim a queued monitoring AI-analysis job. Returns the full job including `context` ' +
      '— a pre-assembled markdown bundle (server config, latest snapshot metrics, active alerts, ' +
      'recent trend, and log tails for logs/alert types). Analyze THAT context directly; you do NOT ' +
      'need to fetch snapshots/logs yourself. analysisType tells you the focus: snapshot=general ' +
      'health diagnosis, logs=parse log tails for errors, alert=explain why the alert fired. On 409 ' +
      'another session won — skip. You have ~5 min before cleanup cancels stuck jobs. Write a concise ' +
      'Russian markdown report: what is healthy, what is suspicious, likely root cause, 2-3 concrete actions.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job id (from pf_list_pending_monitoring_analysis_jobs)' },
      },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_complete_monitoring_analysis_job',
    description:
      'Finalize a monitoring AI-analysis job. ok=true requires resultMarkdown (the diagnosis report, ' +
      'Russian markdown, ≤300000 chars). ok=false requires error (short reason ≤500 chars). Optionally ' +
      'report costUsd/tokensIn/tokensOut so the UI can show the analysis cost. Server then unblocks the ' +
      'web long-poll. Do NOT retry on 409 (job cancelled by cleanup/user) — drop it.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job id' },
        ok: { type: 'boolean', description: 'true if Claude produced a valid analysis' },
        resultMarkdown: {
          type: ['string', 'null'],
          description: 'Diagnosis report in Russian markdown (≤300000 chars). Required when ok=true.',
        },
        error: { type: ['string', 'null'], description: 'Short error reason (≤500 chars). Required when ok=false.' },
        costUsd: { type: ['number', 'null'], description: 'Optional run cost in USD.' },
        tokensIn: { type: ['integer', 'null'], description: 'Optional input tokens.' },
        tokensOut: { type: ['integer', 'null'], description: 'Optional output tokens.' },
      },
      required: ['jobId', 'ok'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_list_pending_commit_sync_jobs',
    description:
      'List queued daily commit-sync jobs where current user is the dispatcher, oldest first. ' +
      'The site scheduled a daily run that matches recent git commits to the project\'s open tasks ' +
      '(todo/in_progress) BY MEANING. Each item has projectId/projectName and createdAt. If empty, ' +
      'no work to do.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max jobs to return (default 10, max 50)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pf_claim_commit_sync_job',
    description:
      'Atomically claim a queued commit-sync job. Returns the full job including `context` — a ' +
      'pre-assembled markdown bundle: the project\'s open tasks (todo/in_progress) and recent commits ' +
      'with sha, message, committedAt and ageHours. Read THAT context directly; you do NOT fetch ' +
      'tasks/commits yourself. Your job: decide which commits SEMANTICALLY reference which task (the ' +
      'commit message/content closes or advances the task — this is NOT id-matching, reason about ' +
      'meaning). Return only matches as {taskId, commitSha, reason}. Do NOT decide in_progress vs done ' +
      '— the SERVER applies the age threshold. On 409 another session won — skip. ~5 min before cleanup.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job id (from pf_list_pending_commit_sync_jobs)' },
      },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_complete_commit_sync_job',
    description:
      'Finalize a commit-sync job. ok=true requires matches (array of {taskId, commitSha, reason?}); ' +
      'pass an EMPTY array if no commit semantically matches any task. The server applies the age ' +
      'threshold deterministically (commit younger than threshold → task to in_progress; older → done). ' +
      'ok=false requires error (≤500 chars). Optionally report costUsd/tokensIn/tokensOut.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job id' },
        ok: { type: 'boolean', description: 'true if matching ran successfully (matches may be empty)' },
        matches: {
          type: ['array', 'null'],
          description: 'Matches [{taskId, commitSha, reason?}]. Required (may be empty) when ok=true.',
          items: {
            type: 'object',
            properties: {
              taskId: { type: 'string' },
              commitSha: { type: 'string' },
              reason: { type: ['string', 'null'] },
            },
            required: ['taskId', 'commitSha'],
          },
        },
        error: { type: ['string', 'null'], description: 'Short error reason (≤500 chars). Required when ok=false.' },
        costUsd: { type: ['number', 'null'], description: 'Optional run cost in USD.' },
        tokensIn: { type: ['integer', 'null'], description: 'Optional input tokens.' },
        tokensOut: { type: ['integer', 'null'], description: 'Optional output tokens.' },
      },
      required: ['jobId', 'ok'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_get_project',
    description:
      'Fetch metadata for a single project: id, name, status, hasKb, gitRepoUrl. Returns ' +
      '404 if the current user is not a member. Use when you have a project id and need its ' +
      'current details (e.g. to check whether a git repo or KB is attached).',
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
    name: 'pf_list_members',
    description:
      "List a project's team members. Returns userId, displayName, email, role " +
      "('owner' | 'editor' | 'viewer'), isAdmin and joinedAt for each. Use to see who is on " +
      'the project — e.g. before @mentioning someone in a task comment.',
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
    name: 'pf_search_tasks',
    description:
      'Full-text search across kanban tasks. Scope: tasks in projects the current user is a ' +
      'member of (admins search all projects). Returns taskId, projectId, projectName, status ' +
      'and an excerpt. Query must be at least 2 chars. Use to find a task across projects ' +
      'when you do not know which project it lives in.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (min 2 chars)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_list_kb_documents',
    description:
      "List ALL Markdown documents in a project's Knowledge Base (not just credentials). " +
      'Returns path, title, kind, frontmatter and sha for each. Use to discover what is in ' +
      'the KB before reading a specific doc with pf_read_kb_document.',
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
    name: 'pf_read_kb_document',
    description:
      'Read a single KB document in full: path, frontmatter, body (markdown), and sha. ' +
      'Use the sha with pf_write_kb_document to update the doc safely (optimistic lock). ' +
      'For credentials prefer pf_get_credential (it resolves vault secrets).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        path: { type: 'string', description: "Repo-relative path ending in .md, e.g. 'notes/setup.md'" },
      },
      required: ['projectId', 'path'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_delete_kb_document',
    description:
      'Delete a KB document by path. IRREVERSIBLE — the file is removed from the KB. ' +
      'Requires editor+ role. Use only when the user explicitly asks to delete a KB note/doc.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        path: { type: 'string', description: "Repo-relative path ending in .md to delete" },
      },
      required: ['projectId', 'path'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_update_task',
    description:
      "Update a task's description (markdown), Ralph mode, priority and/or deadline. Requires " +
      'editor+ role. Returns the updated task. Pass at least one of `description`, `ralphMode`, ' +
      '`priority` or `deadline`. Use for triage: set priority/deadline on raw backlog cards.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        taskId: { type: 'string', description: 'Task id (from pf_list_tasks)' },
        description: {
          type: 'string',
          description: 'New task description (markdown), 1-10000 chars. Omit to leave unchanged.',
        },
        ralphMode: {
          type: 'string',
          enum: ['normal', 'silent', 'grillme'],
          description:
            "New Ralph mode for this task. 'normal' | 'silent' | 'grillme' " +
            '(see pf_create_task for semantics). Omit to leave unchanged.',
        },
        priority: {
          type: ['integer', 'null'],
          description: 'Priority 1..4 (1=urgent, 4=low). null clears it. Omit to leave unchanged.',
        },
        deadline: {
          type: ['string', 'null'],
          description: "Deadline 'YYYY-MM-DD'. null clears it. Omit to leave unchanged.",
        },
      },
      required: ['projectId', 'taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_delete_task',
    description:
      'Delete a kanban task. IRREVERSIBLE — the task and its comments are removed. Requires ' +
      'editor+ role. Use only when the user explicitly asks to delete a task.',
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
    name: 'pf_list_commits',
    description:
      'List git commits linked to a task. Returns sha, message, authorName, htmlUrl, ' +
      'committedAt and linkedAt for each. Use to see what work has already been attributed ' +
      'to a task.',
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
    name: 'pf_sync_commits',
    description:
      "Scan the project's recent GitHub commits and auto-link them to tasks by the [short-id] " +
      'marker in each commit message (the 8-char task id prefix). Auto-transitions todo→in_progress ' +
      'on first link. Returns counts: linkedCount, autoTransitionedCount, scannedCount. Requires ' +
      'a connected git repo and GitHub. Use to backfill commit links after pushing several commits.',
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
    name: 'pf_get_finance',
    description:
      'Get a project P&L summary: labor cost, other expenses, income, total expense, profit ' +
      'and margin. Amounts are returned in BOTH rubles (*Rubles, for readability) and kopecks ' +
      '(*Kopecks, exact). Includes line items (labor assignments, expenses, incomes). Visible to ' +
      "the owner always; to other members only if finance visibility is set to 'members' " +
      '(otherwise the API returns 403).',
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
    name: 'pf_add_expense',
    description:
      'Add an expense to a project (owner only). amountRubles is in RUBLES (e.g. 1500.50). ' +
      "category is a short tag like 'ads', 'infra', 'tools', 'other'. incurredOn is an optional " +
      'YYYY-MM-DD date (defaults to today). Returns the created expense.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        amountRubles: { type: 'number', description: 'Amount in rubles (non-negative)' },
        category: { type: 'string', description: "Expense category, e.g. 'ads', 'infra', 'tools', 'other'" },
        description: { type: 'string', description: 'Optional free-text note' },
        incurredOn: { type: 'string', description: 'Optional date YYYY-MM-DD (default today)' },
      },
      required: ['projectId', 'amountRubles', 'category'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_add_income',
    description:
      'Add an income entry to a project (owner only). amountRubles is in RUBLES. source is an ' +
      'optional label (e.g. client name). receivedOn is an optional YYYY-MM-DD date (defaults ' +
      'to today). Returns the created income.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        amountRubles: { type: 'number', description: 'Amount in rubles (non-negative)' },
        source: { type: 'string', description: 'Optional income source label' },
        receivedOn: { type: 'string', description: 'Optional date YYYY-MM-DD (default today)' },
      },
      required: ['projectId', 'amountRubles'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_list_my_dispatched_projects',
    description:
      "Return the list of projects where the CURRENT user is assigned as the Ralph dispatcher " +
      '(i.e. the autonomous task executor). This is the MAIN tool a Ralph /loop polls every ' +
      'tick to figure out where work exists. Each project entry includes openTaskCount ' +
      '(todo + in_progress) and pendingAiPromptJobCount, so the loop can skip empty projects ' +
      "without further round-trips. No args — scope is the user behind the Bearer token. " +
      'Use together with pf_list_tasks to pick the next item.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'pf_get_automation_config',
    description:
      'Return the project automation config for the dispatcher: whether automation is enabled, ' +
      'a computed `shouldRun` flag (server already accounts for the count/time limit), the ' +
      'pause range (pauseMinSeconds..pauseMaxSeconds) to wait between tasks, the ralphMode to ' +
      'create tasks with (usually "silent"), and `nextCriterion` — the criterion to generate ' +
      'the next task from, with its editable systemPrompt and userHint. Call this when a ' +
      'dispatched project has 0 open tasks and automationEnabled=true (from ' +
      'pf_list_my_dispatched_projects). If shouldRun=true and nextCriterion is set: run Claude ' +
      'with nextCriterion.systemPrompt (+ userHint) to produce ONE task description, create the ' +
      'task (status=todo, ralphMode from config), then call pf_record_automation_task. The ' +
      'response also carries per-project publish/deploy settings the worker must honor on every ' +
      'run: gitAuthorMode/gitAuthorName/gitAuthorEmail (commit identity — name/email already ' +
      "resolved; 'bot' means use the fixed agent identity), ignoreClaudeMd (skip the project's " +
      'CLAUDE.md commit ritual / Co-Authored-By when true), ultracodeReviewEnabled (run a ' +
      'blocking compatibility review before push), and deployMethod/deployCommand (github_auto = ' +
      'do nothing — push triggers GitHub auto-deploy, ssh_manual = run deployCommand after each ' +
      "successful push, none = no deploy, auto = deploy by following the project's CLAUDE.md deploy " +
      'instructions yourself, no command given). ' +
      "Only the project's assigned dispatcher may call this (403 otherwise).",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_my_dispatched_projects)' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_record_automation_task',
    description:
      'Tell the server that an automation task was just created. The server increments the ' +
      'task counter, starts the run clock on the first task (the time limit counts from here), ' +
      'advances the round-robin criterion pointer, and closes the run (runStatus="completed") ' +
      'once the count/time limit is reached. Returns the fresh config view (same shape as ' +
      'pf_get_automation_config) so you can read the updated shouldRun and nextCriterion. Call ' +
      'this exactly once per automation task you create, right after creating it. Only the ' +
      "project's assigned dispatcher may call this.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id' },
        taskId: { type: 'string', description: 'Id of the task you just created' },
      },
      required: ['projectId', 'taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_get_project_git_token',
    description:
      'Return a GitHub access token DELEGATED to the current dispatcher by a project member. ' +
      'v0.15+: per-member opt-in — every project member can independently enable their own ' +
      'delegation. Server returns the token of the FIRST eligible grantor in deterministic ' +
      'order: project owner first, then other members sorted by displayName ASC. The caller ' +
      '(current dispatcher) is excluded from candidates — you never receive your own token ' +
      'via this endpoint. Response includes `source: "owner_delegation" | "member_delegation"` ' +
      'and `grantedByDisplayName` for diagnostics. Use ONLY for git operations on this project ' +
      'repository (clone/fetch/push/PR). Token belongs to the grantor — do not persist, do not ' +
      'log, do not use outside the immediate git command. Errors: 403 not_dispatcher (you are ' +
      'not the dispatcher); 403 delegation_disabled (nobody enabled their delegation); 403 ' +
      'no_eligible_grantor (candidates exist but none has GitHub connected — response includes ' +
      '`candidatesChecked` for diagnostics). Recommended URL form for git push: ' +
      'https://x-access-token:<token>@github.com/owner/repo.git (token expires when grantor ' +
      'revokes delegation or rotates OAuth).',
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
    name: 'pf_set_project_dispatcher',
    description:
      'Assign or clear the Ralph dispatcher of a project (OWNER-only). userId = a project ' +
      "member's user id who has at least one active agent-token. Pass userId=null to clear " +
      "the dispatcher (project goes back to manual mode). Server validates: target must be a " +
      'member AND have ≥1 active token (otherwise 400 dispatcher_not_member / dispatcher_no_active_tokens). ' +
      'Use sparingly — the typical assignment flow is via the website UI.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        userId: {
          type: ['string', 'null'],
          description: 'Target user id, or null to clear the dispatcher',
        },
      },
      required: ['projectId', 'userId'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_delete_project',
    description:
      'Permanently delete a project (OWNER-only). IRREVERSIBLE. Cascades deletion of: ' +
      'tasks + their comments/commits/attachment-rows, local KB documents, project secrets ' +
      'in vault, finance records (expenses/incomes/employee-assignments), invites and ' +
      'join-requests, and team memberships. The connected GitHub repository and GitHub-KB ' +
      'repo are NOT deleted — manage those on GitHub. Inbox-project cannot be deleted (409). ' +
      'Other team members will be notified by email (best-effort). Use only when the user ' +
      "EXPLICITLY asks to delete the project — never as part of cleanup or 'tidying up'.",
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
    name: 'pf_get_my_account',
    description:
      "Return the authenticated user's full account data: profile (id, email, displayName, " +
      'avatarUrl, isAdmin, createdAt), GitHub connection metadata (login, scopes, connectedAt; ' +
      'the OAuth access_token is NOT returned here — use pf_get_project_git_token for a ' +
      'per-project, audited git token), and the list of agent-tokens (id, name, prefix, ' +
      'createdAt, lastUsedAt, isCurrent flag for the token that made THIS call). ' +
      'Account PASSWORD is NOT returned: it is stored as a bcrypt hash and is physically ' +
      'irreversible — the response carries `passwordHashed: true` as explicit explanation. ' +
      "Agent-token PLAINTEXT values are NOT returned either: only a bcrypt hash is stored " +
      '(the plaintext is shown once at creation time on the site) — each token entry carries ' +
      '`plaintextAvailable: false`. No projectId needed — scope is the user behind the Bearer.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'pf_list_monitored_servers',
    description:
      'List the REMOTE servers that the monitoring collector should poll over SSH. Returns ' +
      'connection metadata only (host, sshPort, sshUser, sshCredentialRef — an OPAQUE local ' +
      'reference, NOT a secret; resolve the actual key on YOUR machine), plus pm2 process-name ' +
      'filter, nginx log paths, deployPath and collectIntervalSeconds. Non-admin sees only ' +
      "servers of projects they OWN (monitoring is owner-only); admin sees all. 'local' servers " +
      'are EXCLUDED — the PF backend collects those directly. Used by the Ralph-style monitoring ' +
      'collector loop (see monitor-collect.ps1). Optionally filter by projectId.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Optional project id to filter by' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pf_record_server_snapshot',
    description:
      'Push a collected metrics snapshot for a REMOTE server into ProjectsFlow. Gated by ' +
      'manage_monitoring (owner). The server is resolved by (projectId, serverName) and ' +
      'auto-created on first push (zero-config). Send reachable=false with no metrics when the ' +
      'host is unreachable (this fires a down alert). `collectedAt` must be an ISO-8601 string, ' +
      'strictly later than the last snapshot (non-monotonic / future timestamps are rejected). ' +
      'Strip secrets from log tails before pushing — the server also redacts, but redact locally ' +
      'too. metrics = { pm2: [...], system: {...} }; logs = { pm2Out, pm2Err, nginxAccess, ' +
      'nginxError } each { available, lines?, bytes? }. Returns { ok, snapshotId, serverId }.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_monitored_servers)' },
        serverName: { type: 'string', description: 'Server name (matches project_servers.name)' },
        collectedAt: { type: 'string', description: 'ISO-8601 timestamp of collection' },
        reachable: { type: 'boolean', description: 'Was the host reachable?' },
        metrics: { type: ['object', 'null'], description: '{ pm2: [...], system: {...} }' },
        logs: { type: ['object', 'null'], description: 'Redacted, truncated log tails' },
        dbHealth: { type: ['object', 'null'], description: 'Optional DB health' },
        errors: { type: 'array', items: { type: 'string' }, description: 'Collection errors' },
      },
      required: ['projectId', 'serverName', 'collectedAt', 'reachable'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_live_start_session',
    description:
      'Open a LIVE streaming session for a task — the Cursor-style action feed shown on the ' +
      'task card while an agent works. Returns { sessionId, baseSeq }: use baseSeq as the first ' +
      'event seq, then increment for every subsequent event. agentName is a short label ' +
      '(e.g. "claude-agent"). attempt is the 1-based retry counter. headBefore is the git HEAD ' +
      'SHA before work starts (used to compute the final diff). Primary path is the dispatcher ' +
      'REST; this tool is for non-PowerShell agents.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        taskId: { type: 'string', description: 'Task id (from pf_list_tasks)' },
        agentName: { type: 'string', description: 'Short agent label, e.g. "claude-agent"' },
        attempt: { type: 'integer', description: '1-based retry counter (default 1)' },
        model: { type: ['string', 'null'], description: 'Model id, e.g. "claude-opus-4-7"' },
        headBefore: {
          type: ['string', 'null'],
          description: 'git HEAD SHA before work starts (40 hex) — used for the final diff',
        },
      },
      required: ['projectId', 'taskId', 'agentName'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_live_append_events',
    description:
      'Append a batch of events (<=64) to an open LIVE session. Each event has a strictly ' +
      'increasing seq (start from baseSeq returned by pf_live_start_session), a kind, and ' +
      'optional text/payload. kind is one of: assistant_text (text), tool_use (payload ' +
      '{name,brief}), file_edit (payload {path,edits:[{old,new}]}), file_write (payload ' +
      '{path,content}), bash (payload {command}), tool_error (text), diff_summary, file_diff, ' +
      'session_finished. Duplicate seqs are idempotent server-side. Returns { appended }. ' +
      'Primary path is the dispatcher REST; this tool is for non-PowerShell agents.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        taskId: { type: 'string', description: 'Task id (from pf_list_tasks)' },
        sessionId: { type: 'string', description: 'Session id from pf_live_start_session' },
        events: {
          type: 'array',
          description: 'Batch of events, at most 64.',
          maxItems: 64,
          items: {
            type: 'object',
            properties: {
              seq: { type: 'integer', description: 'Strictly increasing event sequence number' },
              kind: {
                type: 'string',
                description:
                  'Event kind: assistant_text | tool_use | file_edit | file_write | bash | ' +
                  'tool_error | diff_summary | file_diff | session_finished',
              },
              text: { type: ['string', 'null'], description: 'Text payload (assistant_text, tool_error)' },
              payload: { description: 'Structured payload (JSON) for tool/file/diff events' },
            },
            required: ['seq', 'kind'],
            additionalProperties: false,
          },
        },
      },
      required: ['projectId', 'taskId', 'sessionId', 'events'],
      additionalProperties: false,
    },
  },
  {
    name: 'pf_live_finish_session',
    description:
      'Finalize a LIVE session: set its terminal status and attach optional cost/token totals ' +
      'and per-file git diffs. status is one of completed | failed | timeout | canceled. ' +
      'headAfter is the git HEAD SHA after work finished. fileDiffs is the full per-file diff ' +
      "(change is added | modified | deleted | renamed) — large diffs should set truncated=true " +
      'and binaries isBinary=true. Returns { ok }. Primary path is the dispatcher REST; this ' +
      'tool is for non-PowerShell agents.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        taskId: { type: 'string', description: 'Task id (from pf_list_tasks)' },
        sessionId: { type: 'string', description: 'Session id from pf_live_start_session' },
        status: {
          type: 'string',
          enum: ['completed', 'failed', 'timeout', 'canceled'],
          description: 'Terminal session status',
        },
        headAfter: { type: ['string', 'null'], description: 'git HEAD SHA after work finished (40 hex)' },
        costUsd: { type: ['number', 'null'], description: 'API-equivalent cost in USD' },
        tokensIn: { type: ['integer', 'null'], description: 'Total input tokens' },
        tokensOut: { type: ['integer', 'null'], description: 'Total output tokens' },
        fileDiffs: {
          type: 'array',
          description: 'Per-file git diffs computed at finish.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Repo-relative file path' },
              change: {
                type: 'string',
                enum: ['added', 'modified', 'deleted', 'renamed'],
                description: 'Kind of change',
              },
              additions: { type: 'integer', description: 'Added line count' },
              deletions: { type: 'integer', description: 'Deleted line count' },
              unifiedDiff: { type: ['string', 'null'], description: 'Unified diff text (may be capped)' },
              isBinary: { type: 'boolean', description: 'true for binary files (diff omitted)' },
              truncated: { type: 'boolean', description: 'true if unifiedDiff was capped' },
            },
            required: ['path', 'change', 'additions', 'deletions'],
            additionalProperties: false,
          },
        },
      },
      required: ['projectId', 'taskId', 'sessionId', 'status'],
      additionalProperties: false,
    },
  },
];

// Input schemas для validation (zod вместо ручного парсинга).
const CreateProjectInputZ = z.object({
  name: z.string().trim().min(1).max(200),
  git: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('none') }),
      z.object({ mode: z.literal('connect'), gitRepoUrl: z.string().url() }),
      z.object({
        mode: z.literal('create'),
        repoName: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(350).optional(),
        private: z.boolean().optional(),
      }),
    ])
    .optional(),
});
const UpdateProjectInputZ = z
  .object({
    projectId: z.string().min(1),
    name: z.string().trim().min(1).max(200).optional(),
    gitRepoUrl: z.string().url().nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.gitRepoUrl !== undefined, {
    message: 'нужно хотя бы одно поле (name или gitRepoUrl)',
  });
const ListMonitoredServersInput = z.object({ projectId: z.string().min(1).optional() });
const RecordServerSnapshotInput = z.object({
  projectId: z.string().min(1),
  serverName: z.string().min(1).max(120),
  collectedAt: z.string().min(1),
  reachable: z.boolean(),
  metrics: z.unknown().optional(),
  logs: z.unknown().optional(),
  dbHealth: z.unknown().optional(),
  errors: z.array(z.string()).optional(),
});
// --- LIVE-стрим действий воркера (Cursor-style лента) ---
const LIVE_EVENT_KINDS = [
  'assistant_text',
  'tool_use',
  'file_edit',
  'file_write',
  'bash',
  'tool_error',
  'diff_summary',
  'file_diff',
  'session_finished',
] as const;
const LIVE_SESSION_STATUS = ['completed', 'failed', 'timeout', 'canceled'] as const;
const LIVE_FILE_CHANGE = ['added', 'modified', 'deleted', 'renamed'] as const;

const LiveStartSessionInputZ = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  agentName: z.string().trim().min(1).max(64),
  attempt: z.number().int().min(1).optional(),
  model: z.string().max(64).nullable().optional(),
  headBefore: z.string().max(40).nullable().optional(),
});
const LiveAppendEventsInputZ = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  events: z
    .array(
      z.object({
        seq: z.number().int().nonnegative(),
        kind: z.enum(LIVE_EVENT_KINDS),
        text: z.string().nullable().optional(),
        payload: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(64),
});
const LiveFinishSessionInputZ = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.enum(LIVE_SESSION_STATUS),
  headAfter: z.string().max(40).nullable().optional(),
  costUsd: z.number().nullable().optional(),
  tokensIn: z.number().int().nullable().optional(),
  tokensOut: z.number().int().nullable().optional(),
  fileDiffs: z
    .array(
      z.object({
        path: z.string().min(1),
        change: z.enum(LIVE_FILE_CHANGE),
        additions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
        unifiedDiff: z.string().nullable().optional(),
        isBinary: z.boolean().optional(),
        truncated: z.boolean().optional(),
      }),
    )
    .optional(),
});

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
  ralphMode: z.enum(['normal', 'silent', 'grillme']).optional(),
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
  // Какой именно agent-процесс пишет коммент. Бэк дефолтит 'ralph-dispatcher'.
  // Открытое enum через z.string() (не z.enum) — forward-compat для новых имён без релиза.
  agentName: z
    .enum(['ralph-dispatcher', 'ralph-worker', 'ralph-grillme', 'ralph-verify'])
    .optional(),
});

const ListTaskCommentsInputZ = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  since: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  has_marker: z
    .enum(['ralph-question', 'ralph-answer', 'ralph-grillme-summary'])
    .optional(),
});

const CheckRepoUsageInput = z.object({
  gitRepoUrl: z.string().min(1),
});
const RequestRepoAccessInput = z.object({
  gitRepoUrl: z.string().min(1),
  requestTarget: z.string().min(1),
  message: z.string().max(2000).optional(),
});
const CreateLocalKbInput = z.object({
  projectId: z.string().min(1),
});

// Схема бэкенда приложения. Валидация здесь мягкая (форма) — строгую проверку (regex имён,
// зарезервированные `_*`, лимиты) делает сервер (validateAppSchema), возвращая 400 при нарушении.
const AppFieldZ = z.object({
  name: z.string().min(1),
  type: z.enum(['text', 'int', 'real', 'bool', 'datetime']),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
});
const AppTableZ = z.object({
  name: z.string().min(1),
  fields: z.array(AppFieldZ).min(1),
  rules: z.object({
    read: z.enum(['anyone', 'authenticated', 'owner']),
    write: z.enum(['anyone', 'authenticated', 'owner']),
  }),
});
const DeclareAppSchemaInput = z.object({
  projectId: z.string().min(1),
  schema: z.object({ tables: z.array(AppTableZ).min(1) }),
});

const ListPendingAiPromptJobsInput = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});

const ClaimAiPromptJobInput = z.object({
  jobId: z.string().min(1),
});

const CompleteAiPromptJobInput = z.object({
  jobId: z.string().min(1),
  ok: z.boolean(),
  // 600000: compose-результат — большая JSON-строка (2 варианта + сегменты).
  improvedText: z.string().max(600000).nullable().optional(),
  error: z.string().max(500).nullable().optional(),
});

const ListPendingMonitoringAnalysisJobsInput = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});

const ClaimMonitoringAnalysisJobInput = z.object({
  jobId: z.string().min(1),
});

const CompleteMonitoringAnalysisJobInput = z.object({
  jobId: z.string().min(1),
  ok: z.boolean(),
  resultMarkdown: z.string().max(300000).nullable().optional(),
  error: z.string().max(500).nullable().optional(),
  costUsd: z.number().nullable().optional(),
  tokensIn: z.number().int().nullable().optional(),
  tokensOut: z.number().int().nullable().optional(),
});

const ListPendingCommitSyncJobsInput = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});

const ClaimCommitSyncJobInput = z.object({
  jobId: z.string().min(1),
});

const CompleteCommitSyncJobInput = z.object({
  jobId: z.string().min(1),
  ok: z.boolean(),
  matches: z
    .array(
      z.object({
        taskId: z.string().min(1),
        commitSha: z.string().min(1),
        reason: z.string().max(2000).nullable().optional(),
      }),
    )
    .max(500)
    .nullable()
    .optional(),
  error: z.string().max(500).nullable().optional(),
  costUsd: z.number().nullable().optional(),
  tokensIn: z.number().int().nullable().optional(),
  tokensOut: z.number().int().nullable().optional(),
});

const GetProjectInput = z.object({ projectId: z.string().min(1) });
const ListMembersInput = z.object({ projectId: z.string().min(1) });
const SearchTasksInput = z.object({ query: z.string().trim().min(2).max(200) });
const ListKbDocumentsInput = z.object({ projectId: z.string().min(1) });
const KbPathRegex = /^[a-z0-9_./-]+\.md$/i;
const ReadKbDocumentInput = z.object({
  projectId: z.string().min(1),
  path: z.string().regex(KbPathRegex, 'Path must end with .md'),
});
const DeleteKbDocumentInput = z.object({
  projectId: z.string().min(1),
  path: z.string().regex(KbPathRegex, 'Path must end with .md'),
});
const UpdateTaskInputZ = z
  .object({
    projectId: z.string().min(1),
    taskId: z.string().min(1),
    description: z.string().trim().min(1).max(10_000).optional(),
    ralphMode: z.enum(['normal', 'silent', 'grillme']).optional(),
    priority: z.number().int().min(1).max(4).nullable().optional(),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'deadline must be YYYY-MM-DD')
      .nullable()
      .optional(),
  })
  .refine(
    (o) =>
      o.description !== undefined ||
      o.ralphMode !== undefined ||
      o.priority !== undefined ||
      o.deadline !== undefined,
    { message: 'Pass at least one of `description`, `ralphMode`, `priority` or `deadline`.' },
  );
const DeleteTaskInputZ = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
});
const ListCommitsInput = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
});
const SyncCommitsInput = z.object({ projectId: z.string().min(1) });
const IsoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
const GetFinanceInput = z.object({ projectId: z.string().min(1) });
const GetAutomationConfigInput = z.object({ projectId: z.string().min(1) });
const RecordAutomationTaskInput = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
});
const AddExpenseInputZ = z.object({
  projectId: z.string().min(1),
  amountRubles: z.number().nonnegative(),
  category: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  incurredOn: z.string().regex(IsoDateRegex, 'Date must be YYYY-MM-DD').optional(),
});
const AddIncomeInputZ = z.object({
  projectId: z.string().min(1),
  amountRubles: z.number().nonnegative(),
  source: z.string().max(200).optional(),
  receivedOn: z.string().regex(IsoDateRegex, 'Date must be YYYY-MM-DD').optional(),
});

async function main(): Promise<void> {
  const config = loadConfig();
  const api = new ApiClient(config);

  const server = new Server(
    { name: 'projectsflow', version: readPkgVersion() },
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
        case 'pf_list_user_repos': {
          const repos = await api.listUserRepos();
          return jsonResult(repos);
        }
        case 'pf_create_project': {
          const input = CreateProjectInputZ.parse(req.params.arguments ?? {});
          const project = await api.createProject({ name: input.name, git: input.git });
          return jsonResult(project);
        }
        case 'pf_update_project': {
          const input = UpdateProjectInputZ.parse(req.params.arguments ?? {});
          const project = await api.updateProject(input.projectId, {
            name: input.name,
            gitRepoUrl: input.gitRepoUrl,
          });
          return jsonResult(project);
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
          // ВАЖНО: cap'аем размер inline-бинарей — большие файлы могут заглушить stdio-канал
          // MCP и memory-spike процесс (base64 раздувает в ~1.33×, плюс concat).
          const MAX_INLINE_BYTES = 2 * 1024 * 1024; // 2 MB raw
          for (const a of attachments) {
            if (a.sizeBytes > MAX_INLINE_BYTES) {
              content.push({
                type: 'text',
                text: `[attachment ${a.filename} (${a.mimeType}, ${Math.round(a.sizeBytes / 1024)} KB) — слишком большой для inline, открой в UI: projectsflow://attachment/${a.id}]`,
              });
              continue;
            }
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
            ralphMode: input.ralphMode,
          });
          return jsonResult(task);
        }
        case 'pf_create_task_comment': {
          const input = CreateTaskCommentInputZ.parse(req.params.arguments ?? {});
          const comment = await api.createTaskComment(
            input.projectId,
            input.taskId,
            input.body,
            input.agentName,
          );
          return jsonResult(comment);
        }
        case 'pf_list_task_comments': {
          const input = ListTaskCommentsInputZ.parse(req.params.arguments ?? {});
          const comments = await api.listTaskComments(input.projectId, input.taskId, {
            since: input.since,
            limit: input.limit,
            has_marker: input.has_marker,
          });
          return jsonResult({ comments });
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
        case 'pf_check_repo_usage': {
          const input = CheckRepoUsageInput.parse(req.params.arguments ?? {});
          const result = await api.checkRepoUsage(input.gitRepoUrl);
          return jsonResult(result);
        }
        case 'pf_request_repo_access': {
          const input = RequestRepoAccessInput.parse(req.params.arguments ?? {});
          const result = await api.requestRepoAccess({
            gitRepoUrl: input.gitRepoUrl,
            requestTarget: input.requestTarget,
            message: input.message,
          });
          return jsonResult(result);
        }
        case 'pf_create_local_kb': {
          const input = CreateLocalKbInput.parse(req.params.arguments ?? {});
          await api.createLocalKb(input.projectId);
          return jsonResult({ ok: true });
        }
        case 'pf_declare_app_schema': {
          const input = DeclareAppSchemaInput.parse(req.params.arguments ?? {});
          const result = await api.declareAppSchema(input.projectId, input.schema);
          return jsonResult(result);
        }
        case 'pf_list_pending_ai_prompt_jobs': {
          const input = ListPendingAiPromptJobsInput.parse(req.params.arguments ?? {});
          const jobs = await api.listPendingAiPromptJobs(input.limit ?? 10);
          return jsonResult(jobs);
        }
        case 'pf_claim_ai_prompt_job': {
          const input = ClaimAiPromptJobInput.parse(req.params.arguments ?? {});
          const job = await api.claimAiPromptJob(input.jobId);
          return jsonResult(job);
        }
        case 'pf_complete_ai_prompt_job': {
          const input = CompleteAiPromptJobInput.parse(req.params.arguments ?? {});
          await api.completeAiPromptJob(input.jobId, {
            ok: input.ok,
            improvedText: input.improvedText ?? null,
            error: input.error ?? null,
          });
          return jsonResult({ ok: true });
        }
        case 'pf_list_pending_monitoring_analysis_jobs': {
          const input = ListPendingMonitoringAnalysisJobsInput.parse(req.params.arguments ?? {});
          const jobs = await api.listPendingMonitoringAnalysisJobs(input.limit ?? 10);
          return jsonResult(jobs);
        }
        case 'pf_claim_monitoring_analysis_job': {
          const input = ClaimMonitoringAnalysisJobInput.parse(req.params.arguments ?? {});
          const job = await api.claimMonitoringAnalysisJob(input.jobId);
          return jsonResult(job);
        }
        case 'pf_complete_monitoring_analysis_job': {
          const input = CompleteMonitoringAnalysisJobInput.parse(req.params.arguments ?? {});
          await api.completeMonitoringAnalysisJob(input.jobId, {
            ok: input.ok,
            resultMarkdown: input.resultMarkdown ?? null,
            error: input.error ?? null,
            costUsd: input.costUsd ?? null,
            tokensIn: input.tokensIn ?? null,
            tokensOut: input.tokensOut ?? null,
          });
          return jsonResult({ ok: true });
        }
        case 'pf_list_pending_commit_sync_jobs': {
          const input = ListPendingCommitSyncJobsInput.parse(req.params.arguments ?? {});
          const jobs = await api.listPendingCommitSyncJobs(input.limit ?? 10);
          return jsonResult(jobs);
        }
        case 'pf_claim_commit_sync_job': {
          const input = ClaimCommitSyncJobInput.parse(req.params.arguments ?? {});
          const job = await api.claimCommitSyncJob(input.jobId);
          return jsonResult(job);
        }
        case 'pf_complete_commit_sync_job': {
          const input = CompleteCommitSyncJobInput.parse(req.params.arguments ?? {});
          await api.completeCommitSyncJob(input.jobId, {
            ok: input.ok,
            matches: input.matches
              ? input.matches.map((m) => ({
                  taskId: m.taskId,
                  commitSha: m.commitSha,
                  reason: m.reason ?? null,
                }))
              : null,
            error: input.error ?? null,
            costUsd: input.costUsd ?? null,
            tokensIn: input.tokensIn ?? null,
            tokensOut: input.tokensOut ?? null,
          });
          return jsonResult({ ok: true });
        }
        case 'pf_get_project': {
          const input = GetProjectInput.parse(req.params.arguments ?? {});
          const project = await api.getProject(input.projectId);
          return jsonResult(project);
        }
        case 'pf_list_members': {
          const input = ListMembersInput.parse(req.params.arguments ?? {});
          const members = await api.listMembers(input.projectId);
          return jsonResult(members);
        }
        case 'pf_search_tasks': {
          const input = SearchTasksInput.parse(req.params.arguments ?? {});
          const results = await api.searchTasks(input.query);
          return jsonResult(results);
        }
        case 'pf_list_kb_documents': {
          const input = ListKbDocumentsInput.parse(req.params.arguments ?? {});
          const documents = await api.listKbDocuments(input.projectId);
          return jsonResult(documents);
        }
        case 'pf_read_kb_document': {
          const input = ReadKbDocumentInput.parse(req.params.arguments ?? {});
          const document = await api.readKbDocument(input.projectId, input.path);
          return jsonResult(document);
        }
        case 'pf_delete_kb_document': {
          const input = DeleteKbDocumentInput.parse(req.params.arguments ?? {});
          await api.deleteKbDocument(input.projectId, input.path);
          return jsonResult({ ok: true });
        }
        case 'pf_update_task': {
          const input = UpdateTaskInputZ.parse(req.params.arguments ?? {});
          const task = await api.updateTask(input.projectId, input.taskId, {
            description: input.description,
            ralphMode: input.ralphMode,
            priority: input.priority,
            deadline: input.deadline,
          });
          return jsonResult(task);
        }
        case 'pf_delete_task': {
          const input = DeleteTaskInputZ.parse(req.params.arguments ?? {});
          await api.deleteTask(input.projectId, input.taskId);
          return jsonResult({ ok: true });
        }
        case 'pf_list_commits': {
          const input = ListCommitsInput.parse(req.params.arguments ?? {});
          const commits = await api.listCommits(input.projectId, input.taskId);
          return jsonResult(commits);
        }
        case 'pf_sync_commits': {
          const input = SyncCommitsInput.parse(req.params.arguments ?? {});
          const result = await api.syncCommits(input.projectId);
          return jsonResult(result);
        }
        case 'pf_get_finance': {
          const input = GetFinanceInput.parse(req.params.arguments ?? {});
          const finance = await api.getFinance(input.projectId);
          return jsonResult(finance);
        }
        case 'pf_add_expense': {
          const input = AddExpenseInputZ.parse(req.params.arguments ?? {});
          const expense = await api.addExpense(input.projectId, {
            amountRubles: input.amountRubles,
            category: input.category,
            description: input.description,
            incurredOn: input.incurredOn,
          });
          return jsonResult(expense);
        }
        case 'pf_add_income': {
          const input = AddIncomeInputZ.parse(req.params.arguments ?? {});
          const income = await api.addIncome(input.projectId, {
            amountRubles: input.amountRubles,
            source: input.source,
            receivedOn: input.receivedOn,
          });
          return jsonResult(income);
        }
        case 'pf_get_my_account': {
          const account = await api.getMyAccount();
          return jsonResult(account);
        }
        case 'pf_delete_project': {
          const input = z
            .object({ projectId: z.string().min(1) })
            .parse(req.params.arguments ?? {});
          await api.deleteProject(input.projectId);
          return jsonResult({ ok: true, deletedProjectId: input.projectId });
        }
        case 'pf_list_my_dispatched_projects': {
          const projects = await api.listMyDispatchedProjects();
          return jsonResult(projects);
        }
        case 'pf_get_automation_config': {
          const input = GetAutomationConfigInput.parse(req.params.arguments ?? {});
          const config = await api.getAutomationConfig(input.projectId);
          return jsonResult(config);
        }
        case 'pf_record_automation_task': {
          const input = RecordAutomationTaskInput.parse(req.params.arguments ?? {});
          const config = await api.recordAutomationTask(input.projectId, input.taskId);
          return jsonResult(config);
        }
        case 'pf_set_project_dispatcher': {
          const input = z
            .object({
              projectId: z.string().min(1),
              userId: z.string().min(1).nullable(),
            })
            .parse(req.params.arguments ?? {});
          const project = await api.setProjectDispatcher(input.projectId, input.userId);
          return jsonResult(project);
        }
        case 'pf_get_project_git_token': {
          const input = z
            .object({ projectId: z.string().min(1) })
            .parse(req.params.arguments ?? {});
          const token = await api.getProjectGitToken(input.projectId);
          return jsonResult(token);
        }
        case 'pf_list_monitored_servers': {
          const input = ListMonitoredServersInput.parse(req.params.arguments ?? {});
          const servers = await api.listMonitoredServers(input.projectId);
          return jsonResult(servers);
        }
        case 'pf_record_server_snapshot': {
          const input = RecordServerSnapshotInput.parse(req.params.arguments ?? {});
          const result = await api.recordServerSnapshot(input.projectId, {
            serverName: input.serverName,
            collectedAt: input.collectedAt,
            reachable: input.reachable,
            metrics: input.metrics,
            logs: input.logs,
            dbHealth: input.dbHealth,
            errors: input.errors,
          });
          return jsonResult(result);
        }
        case 'pf_live_start_session': {
          const input = LiveStartSessionInputZ.parse(req.params.arguments ?? {});
          const result = await api.liveStartSession(input.projectId, input.taskId, {
            agentName: input.agentName,
            attempt: input.attempt,
            model: input.model,
            headBefore: input.headBefore,
          });
          return jsonResult(result);
        }
        case 'pf_live_append_events': {
          const input = LiveAppendEventsInputZ.parse(req.params.arguments ?? {});
          const result = await api.liveAppendEvents(
            input.projectId,
            input.taskId,
            input.sessionId,
            input.events,
          );
          return jsonResult(result);
        }
        case 'pf_live_finish_session': {
          const input = LiveFinishSessionInputZ.parse(req.params.arguments ?? {});
          const result = await api.liveFinishSession(
            input.projectId,
            input.taskId,
            input.sessionId,
            {
              status: input.status,
              headAfter: input.headAfter,
              costUsd: input.costUsd,
              tokensIn: input.tokensIn,
              tokensOut: input.tokensOut,
              fileDiffs: input.fileDiffs,
            },
          );
          return jsonResult(result);
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

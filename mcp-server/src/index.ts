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
//   - pf_get_my_account        — профиль юзера + github (OAuth-токен) + agent-токены
//   - pf_delete_project        — безвозвратное удаление проекта (owner-only)
//   - pf_list_my_dispatched_projects — проекты, где этот юзер — Ralph-диспетчер
//   - pf_set_project_dispatcher      — назначить/снять диспетчера (owner-only)
//   - pf_get_project_git_token       — делегированный GitHub-токен owner'а для git-операций
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
      "('backlog' | 'todo' | 'in_progress' | 'done'), position, commitCount, and commentCount " +
      '(>0 means the task already has a discussion thread — read it via pf_get_task). \'backlog\' ' +
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
      'NOT pushing the PR. Do NOT retry pf_complete_agent_job after a 409: the server has ' +
      'already finalized the job.',
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
      "Update a task's description (markdown). Requires editor+ role. Returns the updated task. " +
      'Use to edit task text — e.g. to expand a terse TODO into a full spec, or fix a typo.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        taskId: { type: 'string', description: 'Task id (from pf_list_tasks)' },
        description: { type: 'string', description: 'New task description (markdown), 1-10000 chars' },
      },
      required: ['projectId', 'taskId', 'description'],
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
      '(todo + in_progress) and queuedAgentJobCount, so the loop can skip empty projects ' +
      "without further round-trips. No args — scope is the user behind the Bearer token. " +
      'Use together with pf_list_tasks / pf_list_pending_agent_jobs to pick the next item.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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
      'avatarUrl, isAdmin, createdAt), GitHub connection (login, scopes, plaintext OAuth ' +
      'access_token if connected — symmetrical to pf_get_credential returning plaintext ' +
      "secrets of the user's own data), and the list of agent-tokens (id, name, prefix, " +
      'createdAt, lastUsedAt, isCurrent flag for the token that made THIS call). ' +
      'Account PASSWORD is NOT returned: it is stored as a bcrypt hash and is physically ' +
      'irreversible — the response carries `passwordHashed: true` as explicit explanation. ' +
      "Agent-token PLAINTEXT values are NOT returned either: only a bcrypt hash is stored " +
      '(the plaintext is shown once at creation time on the site) — each token entry carries ' +
      '`plaintextAvailable: false`. No projectId needed — scope is the user behind the Bearer.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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

const ListPendingAgentJobsInput = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});

const ClaimAgentJobInput = z.object({
  jobId: z.string().min(1),
});

const CompleteAgentJobInput = z.object({
  jobId: z.string().min(1),
  ok: z.boolean(),
  prUrl: z.string().url().nullable().optional(),
  error: z.string().max(4000).nullable().optional(),
  branchName: z.string().max(200).nullable().optional(),
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
const UpdateTaskInputZ = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  description: z.string().trim().min(1).max(10_000),
});
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
    { name: 'projectsflow', version: '0.16.0' },
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
          const input = CompleteAgentJobInput.parse(req.params.arguments ?? {});
          await api.completeAgentJob(input.jobId, {
            ok: input.ok,
            prUrl: input.prUrl ?? null,
            error: input.error ?? null,
            branchName: input.branchName ?? null,
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
          const task = await api.updateTask(input.projectId, input.taskId, input.description);
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

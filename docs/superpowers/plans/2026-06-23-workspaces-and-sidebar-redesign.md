# Workspaces + Sidebar/Profile Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fully-isolated workspaces (пространства) as a top-level container above projects, with a Notion-style sidebar header that switches/creates/manages workspaces, and relocate theme/animation/monitoring from the bottom profile block into the profile page.

**Architecture:** Clean Architecture mirrored on server and client. New `workspaces` + `workspace_members` tables; `projects.workspace_id` + `users.current_workspace_id`. Active workspace is server-truth; `GET /api/projects` is scoped to it. UI: the sidebar header becomes a Radix dropdown trigger (workspace switcher + account items), a create-workspace Dialog, and a workspace-settings page.

**Tech Stack:** Node 22, Express 4, Drizzle (mysql2), TypeScript ESM, Vite + React 19, Tailwind, shadcn/ui, react-router-dom v7. Tests: `node:test` + `node:assert/strict`. No TanStack Query (manual provider cache).

**Spec:** `docs/superpowers/specs/2026-06-23-workspaces-and-sidebar-redesign-design.md`

## Global Constraints

- **IDs:** `CHAR(36)` UUID v4, app-generated via `idGenerator()` (`server/src/infrastructure/id/idGenerator.ts` → `crypto.randomUUID()`). Client mock uses `crypto.randomUUID()`.
- **Migrations:** append-only, MariaDB-compatible, idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`). Pure SQL only (runner has no JS step). Never edit shipped `db/0*.sql`.
- **Layers (client):** `presentation` imports only from `domain`, `application`, `lib/`, `components/ui/` — never from `infrastructure/*`. The only bridge is `useContainer()` in `infrastructure/di/container.tsx`.
- **Both adapters required (client):** every port gets an `HttpXRepository` AND a `MockXRepository`.
- **User strings in Russian; code/comments/identifiers in English.**
- **Server tests:** `node:test`, in-memory fakes, `assert/strict`. Run: `npm --prefix server test` (verify exact script in `server/package.json`).
- **Client checks:** `npm run typecheck` and `npm run lint` from repo root must pass.
- **Server route response shape:** `res.json({ workspace: dto })` / `{ workspaces: [...] }`; DTOs serialize `Date` → ISO string; errors delegated via `next(e)` to the central error mapper.
- **Auth:** `req.user!.id` (set by `sessionFromCookie`); routers `router.use(requireAuth)`.
- **Animations:** gate every motion on `useMotion()` + `prefers-reduced-motion`.

---

## PHASE 1 — Database

### Task 1: Migration `db/073_workspaces.sql`

**Files:**
- Create: `db/073_workspaces.sql`

**Interfaces:**
- Produces: tables `workspaces(id, name, icon, owner_user_id, created_at)`,
  `workspace_members(workspace_id, user_id, role, created_at)`; columns
  `projects.workspace_id` (NOT NULL after backfill), `users.current_workspace_id`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 073: Пространства (workspaces) — верхнеуровневый изолированный контейнер над проектами.
-- Каждый проект принадлежит ровно одному пространству; у пространства свои участники.
-- См. docs/superpowers/specs/2026-06-23-workspaces-and-sidebar-redesign-design.md.

CREATE TABLE IF NOT EXISTS workspaces (
  id            CHAR(36)     NOT NULL,
  name          VARCHAR(120) NOT NULL,
  icon          VARCHAR(16)      NULL,
  owner_user_id CHAR(36)     NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_workspaces_owner (owner_user_id),
  CONSTRAINT fk_workspaces_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id CHAR(36) NOT NULL,
  user_id      CHAR(36) NOT NULL,
  role         ENUM('owner','member') NOT NULL DEFAULT 'member',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  KEY idx_wm_user (user_id),
  CONSTRAINT fk_wm_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_wm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id CHAR(36) NULL AFTER id;
ALTER TABLE users    ADD COLUMN IF NOT EXISTS current_workspace_id CHAR(36) NULL;

-- Backfill: одно личное пространство на юзера, коррелируется по owner_user_id.
INSERT INTO workspaces (id, name, owner_user_id)
SELECT UUID(), 'Личное', id FROM users;

INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT id, owner_user_id, 'owner' FROM workspaces;

UPDATE projects p
JOIN workspaces w ON w.owner_user_id = p.owner_id
SET p.workspace_id = w.id;

INSERT IGNORE INTO workspace_members (workspace_id, user_id, role)
SELECT p.workspace_id, pm.user_id, 'member'
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE pm.user_id <> p.owner_id;

UPDATE users u
JOIN workspaces w ON w.owner_user_id = u.id
SET u.current_workspace_id = w.id;

-- После backfill: жёсткие констрейнты.
ALTER TABLE projects MODIFY COLUMN workspace_id CHAR(36) NOT NULL;
ALTER TABLE projects ADD CONSTRAINT fk_projects_workspace
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE users ADD CONSTRAINT fk_users_current_workspace
  FOREIGN KEY (current_workspace_id) REFERENCES workspaces(id);
```

- [ ] **Step 2: Apply against a dev DB and verify**

Run: `npm run db:migrate`
Expected: `→ 073_workspaces.sql ... applied`. Then sanity-check:
`SELECT COUNT(*) FROM workspaces;` equals user count; every `projects.workspace_id` non-null;
every `users.current_workspace_id` non-null.

> If no dev DB is reachable, verify syntax by reading the file against `db/002`/`db/010`
> style and proceed — the server typecheck (Task 2) is the next gate.

- [ ] **Step 3: Commit**

```bash
git add db/073_workspaces.sql
git commit -m "feat(db): workspaces + workspace_members tables, project/user scoping columns + backfill"
```

### Task 2: Drizzle schema for workspaces

**Files:**
- Modify: `server/src/infrastructure/db/schema.ts` (add tables; add columns to `projects`/`users`)

**Interfaces:**
- Produces: `workspaces`, `workspaceMembers` table objects; `WorkspaceRow`, `WorkspaceMemberRow`,
  `NewWorkspaceRow`, `NewWorkspaceMemberRow` types; `projects.workspaceId`, `users.currentWorkspaceId` columns.

- [ ] **Step 1: Add the tables and columns**

Locate the helper defs (`id`, `fkUserId`, `createdAtCol`) and the `projects`/`users` tables.
Add columns and new tables (mirror existing `mysqlEnum`/`char`/`varchar` usage):

```typescript
// in users table object: add
currentWorkspaceId: char('current_workspace_id', { length: 36 }),

// in projects table object: add
workspaceId: char('workspace_id', { length: 36 }).notNull(),

// new tables (near projects/projectMembers)
export const workspaces = mysqlTable(
  'workspaces',
  {
    id: id(),
    name: varchar('name', { length: 120 }).notNull(),
    icon: varchar('icon', { length: 16 }),
    ownerUserId: char('owner_user_id', { length: 36 }).notNull(),
    createdAt: createdAtCol(),
  },
  (t) => [index('idx_workspaces_owner').on(t.ownerUserId)],
);

export const workspaceMembers = mysqlTable(
  'workspace_members',
  {
    workspaceId: char('workspace_id', { length: 36 }).notNull(),
    userId: char('user_id', { length: 36 }).notNull(),
    role: mysqlEnum('role', ['owner', 'member']).notNull().default('member'),
    createdAt: createdAtCol(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('idx_wm_user').on(t.userId),
  ],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type NewWorkspaceRow = typeof workspaces.$inferInsert;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMemberRow = typeof workspaceMembers.$inferInsert;
```

> Verify `primaryKey` is imported from `drizzle-orm/mysql-core` (check how `projectMembers`
> declares its composite PK and copy that exact mechanism — it may use `primaryKey({...})`).

- [ ] **Step 2: Typecheck server**

Run: `npm --prefix server run build` (or the server typecheck script — confirm in `server/package.json`)
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/infrastructure/db/schema.ts
git commit -m "feat(server): drizzle schema for workspaces + workspace_members + scoping columns"
```

---

## PHASE 2 — Server domain

### Task 3: Workspace domain types + errors

**Files:**
- Create: `server/src/domain/workspace/Workspace.ts`
- Create: `server/src/domain/workspace/WorkspaceMember.ts`
- Create: `server/src/domain/workspace/errors.ts`

**Interfaces:**
- Produces:
  - `type Workspace = { readonly id, name, icon: string|null, ownerUserId, createdAt: Date }`
  - `type WorkspaceRole = 'owner' | 'member'`
  - `type WorkspaceMember = { readonly workspaceId, userId, role: WorkspaceRole, displayName?, email?, avatarUrl?: string|null }`
  - Errors: `WorkspaceNotFoundError`, `NotWorkspaceMemberError`, `NotWorkspaceOwnerError`,
    `LastOwnerError`, `WorkspaceNotEmptyError`, `CannotDeleteLastWorkspaceError`,
    `WorkspaceNameEmptyError`, `UserNotFoundByEmailError`, `NotProjectOwnerError`.

- [ ] **Step 1: Write the types**

```typescript
// Workspace.ts
export type Workspace = {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly ownerUserId: string;
  readonly createdAt: Date;
};

// WorkspaceMember.ts
export type WorkspaceRole = 'owner' | 'member';
export type WorkspaceMember = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceRole;
  // enriched for member-list responses
  readonly displayName?: string;
  readonly email?: string;
  readonly avatarUrl?: string | null;
};
```

- [ ] **Step 2: Write the errors** (mirror `domain/project/errors.ts` class style with `this.name`)

```typescript
export class WorkspaceNotFoundError extends Error {
  constructor() { super('Workspace not found'); this.name = 'WorkspaceNotFoundError'; }
}
export class NotWorkspaceMemberError extends Error {
  constructor() { super('Not a workspace member'); this.name = 'NotWorkspaceMemberError'; }
}
export class NotWorkspaceOwnerError extends Error {
  constructor() { super('Workspace owner role required'); this.name = 'NotWorkspaceOwnerError'; }
}
export class LastOwnerError extends Error {
  constructor() { super('Cannot remove or demote the last owner'); this.name = 'LastOwnerError'; }
}
export class WorkspaceNotEmptyError extends Error {
  constructor() { super('Workspace still has projects'); this.name = 'WorkspaceNotEmptyError'; }
}
export class CannotDeleteLastWorkspaceError extends Error {
  constructor() { super('Cannot delete your only workspace'); this.name = 'CannotDeleteLastWorkspaceError'; }
}
export class WorkspaceNameEmptyError extends Error {
  constructor() { super('Workspace name cannot be empty'); this.name = 'WorkspaceNameEmptyError'; }
}
export class UserNotFoundByEmailError extends Error {
  constructor(public readonly email: string) { super(`No user with email ${email}`); this.name = 'UserNotFoundByEmailError'; }
}
export class NotProjectOwnerError extends Error {
  constructor() { super('Only the project owner can move it'); this.name = 'NotProjectOwnerError'; }
}
```

- [ ] **Step 3: Register error→HTTP mappings**

Find the central error mapper (search `InsufficientProjectRoleError` in `server/src/presentation`).
Add mappings: `WorkspaceNotFoundError`/`NotWorkspaceMemberError` → 404; `NotWorkspaceOwnerError`/`NotProjectOwnerError` → 403;
`LastOwnerError`/`WorkspaceNotEmptyError`/`CannotDeleteLastWorkspaceError`/`WorkspaceNameEmptyError` → 409 with a Russian `message`;
`UserNotFoundByEmailError` → 404 with message. Match the existing mapping mechanism exactly.

- [ ] **Step 4: Commit**

```bash
git add server/src/domain/workspace server/src/presentation
git commit -m "feat(server): workspace domain types + errors + http error mappings"
```

---

## PHASE 3 — Server application (port + service)

### Task 4: WorkspaceRepository port

**Files:**
- Create: `server/src/application/workspace/WorkspaceRepository.ts`

**Interfaces:**
- Produces the port below (consumed by Task 5 service and Task 6 Drizzle repo):

```typescript
import type { Workspace } from '../../domain/workspace/Workspace.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';

export type CreateWorkspaceInput = { readonly id: string; readonly name: string; readonly icon: string | null; readonly ownerUserId: string; };
export type UpdateWorkspaceInput = { readonly name?: string; readonly icon?: string | null; };

export interface WorkspaceRepository {
  /** Workspaces where the user is a member, with their role + project count. */
  listForUser(userId: string): Promise<Array<Workspace & { role: WorkspaceRole; projectCount: number }>>;
  getById(id: string): Promise<Workspace | null>;
  createWithOwnerMembership(input: CreateWorkspaceInput): Promise<Workspace>;
  update(id: string, patch: UpdateWorkspaceInput): Promise<Workspace | null>;
  delete(id: string): Promise<void>;
  countForUser(userId: string): Promise<number>;
  projectCount(workspaceId: string): Promise<number>;

  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  countOwners(workspaceId: string): Promise<number>;
  addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
  setMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
  removeMember(workspaceId: string, userId: string): Promise<void>;

  setCurrentWorkspace(userId: string, workspaceId: string): Promise<void>;
  getCurrentWorkspaceId(userId: string): Promise<string | null>;
  /** Any other workspace this user belongs to, excluding `excludeId`. For auto-switch. */
  findAnotherForUser(userId: string, excludeId: string): Promise<string | null>;
}
```

- [ ] **Step 1: Write the file above. Step 2: Commit.**

```bash
git add server/src/application/workspace/WorkspaceRepository.ts
git commit -m "feat(server): WorkspaceRepository port"
```

### Task 5: WorkspaceService + access guard (TDD)

**Files:**
- Create: `server/src/application/workspace/workspaceAccess.ts` (guards `requireWorkspaceMember`, `requireWorkspaceOwner`)
- Create: `server/src/application/workspace/WorkspaceService.ts`
- Create: `server/src/application/workspace/WorkspaceService.test.ts`

**Interfaces:**
- Consumes: `WorkspaceRepository` (Task 4), `ProjectRepository`/`ProjectMemberRepository`
  (for project move + count), a `users` lookup port for email→user (find existing
  `UserRepository.findByEmail` — search server/src/application/**), `idGen: () => string`.
- Produces `WorkspaceService` with methods:
  - `listForUser(userId)`
  - `create(userId, { name, icon })` → creates, sets current, returns workspace
  - `rename(workspaceId, userId, { name?, icon? })` (owner only)
  - `switchCurrent(userId, workspaceId)` (member only)
  - `addMember(workspaceId, userId, email, role)` (owner only; email→user; `UserNotFoundByEmailError`)
  - `changeMemberRole(workspaceId, actorId, targetUserId, role)` (owner only; `LastOwnerError` guard)
  - `removeMember(workspaceId, actorId, targetUserId)` (owner only; `LastOwnerError` guard; if removed user's current = this ws, auto-switch them)
  - `moveProject(workspaceId, userId, projectId, targetWorkspaceId)` (project owner + member of both; auto-add project members to target)
  - `deleteWorkspace(workspaceId, userId)` (owner; `WorkspaceNotEmptyError` if projectCount>0; `CannotDeleteLastWorkspaceError` if countForUser<=1; auto-switch if was current)

- [ ] **Step 1: Write failing tests** (in-memory fakes, `node:test`):

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceService } from './WorkspaceService.js';
import { LastOwnerError, WorkspaceNotEmptyError, CannotDeleteLastWorkspaceError, NotWorkspaceOwnerError } from '../../domain/workspace/errors.js';

function makeService(seed) { /* build in-memory fake repos implementing the ports; return { service, fakes } */ }

test('create: creates workspace, adds creator as owner, sets it current', async () => {
  const { service, fakes } = makeService({ users: ['u1'] });
  const ws = await service.create('u1', { name: 'Team', icon: null });
  assert.equal(ws.name, 'Team');
  assert.equal(await fakes.repo.getCurrentWorkspaceId('u1'), ws.id);
  assert.equal((await fakes.repo.getMembership(ws.id, 'u1'))?.role, 'owner');
});

test('rename: non-owner rejected', async () => {
  const { service } = makeService({ /* ws owned by u1, u2 member */ });
  await assert.rejects(() => service.rename('ws1', 'u2', { name: 'x' }), NotWorkspaceOwnerError);
});

test('removeMember: cannot remove the last owner', async () => {
  const { service } = makeService({ /* ws1 single owner u1 */ });
  await assert.rejects(() => service.removeMember('ws1', 'u1', 'u1'), LastOwnerError);
});

test('changeMemberRole: demoting last owner rejected', async () => {
  const { service } = makeService({ /* ws1 single owner u1 */ });
  await assert.rejects(() => service.changeMemberRole('ws1', 'u1', 'u1', 'member'), LastOwnerError);
});

test('delete: workspace with projects rejected', async () => {
  const { service } = makeService({ /* ws1 owner u1 has 1 project, u1 has 2 workspaces */ });
  await assert.rejects(() => service.deleteWorkspace('ws1', 'u1'), WorkspaceNotEmptyError);
});

test('delete: last workspace rejected', async () => {
  const { service } = makeService({ /* ws1 owner u1, 0 projects, only workspace */ });
  await assert.rejects(() => service.deleteWorkspace('ws1', 'u1'), CannotDeleteLastWorkspaceError);
});

test('moveProject: auto-adds project members to target workspace', async () => {
  const { service, fakes } = makeService({ /* projА in ws1(owner u1, members u1,u2), target ws2 */ });
  await service.moveProject('ws1', 'u1', 'projA', 'ws2');
  assert.ok(await fakes.repo.getMembership('ws2', 'u2')); // u2 added to ws2
});
```

- [ ] **Step 2: Run tests, verify they FAIL**

Run: `npm --prefix server test`
Expected: failures (`WorkspaceService` not implemented).

- [ ] **Step 3: Implement `workspaceAccess.ts` + `WorkspaceService.ts`**

Guards (mirror `projectAccess.ts`):
```typescript
export async function requireWorkspaceMember(repo, workspaceId, userId) {
  const m = await repo.getMembership(workspaceId, userId);
  if (!m) throw new WorkspaceNotFoundError(); // don't leak existence
  return m;
}
export async function requireWorkspaceOwner(repo, workspaceId, userId) {
  const m = await requireWorkspaceMember(repo, workspaceId, userId);
  if (m.role !== 'owner') throw new NotWorkspaceOwnerError();
  return m;
}
```
Service: constructor DI `{ repo, projects, projectMembers, users, idGen }`. Implement each
method enforcing the guards + domain rules from the tests. `create` trims name (`WorkspaceNameEmptyError`).
`moveProject`: load project, require `project.ownerId === userId` else `NotProjectOwnerError`;
require actor is member of both workspaces; set `project.workspaceId = target`; for each
`projectMembers` row, `repo.addMember(target, memberUserId, 'member')` (idempotent).

- [ ] **Step 4: Run tests, verify PASS**

Run: `npm --prefix server test`
Expected: all workspace tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/application/workspace
git commit -m "feat(server): WorkspaceService + access guards with rule tests"
```

---

## PHASE 4 — Server infrastructure

### Task 6: DrizzleWorkspaceRepository

**Files:**
- Create: `server/src/infrastructure/repositories/DrizzleWorkspaceRepository.ts`

**Interfaces:**
- Consumes: `Database`, schema `workspaces`/`workspaceMembers`/`projects`/`users` (Task 2),
  port (Task 4). Produces `class DrizzleWorkspaceRepository implements WorkspaceRepository`.

- [ ] **Step 1: Implement** (mirror `DrizzleProjectRepository`: `toWorkspace` mapper,
  transactions for `createWithOwnerMembership`, `count(*)` via drizzle `count()`).

Key methods:
- `listForUser`: join `workspaceMembers` (user) → `workspaces`, left-join project counts
  (`SELECT workspace_id, COUNT(*) FROM projects GROUP BY workspace_id`), map role+projectCount.
- `createWithOwnerMembership`: TX insert workspace + insert owner membership.
- `addMember`: `insert ... ` with `onDuplicateKeyUpdate`/`INSERT IGNORE` semantics (use the
  duplicate-key swallow pattern or drizzle `.onDuplicateKeyUpdate({ set: { role: ... } })` —
  but for idempotent add, ignore duplicates; for `setMemberRole` use `update`).
- `setCurrentWorkspace`: `update(users).set({ currentWorkspaceId }).where(eq(users.id, userId))`.
- `getCurrentWorkspaceId`: select `users.currentWorkspaceId`.
- `findAnotherForUser`: first `workspaceMembers` row for user where `workspaceId <> excludeId`.
- `projectCount`/`countForUser`/`countOwners`: drizzle aggregate counts.
- `delete`: `delete(workspaces).where(eq(id))` (members cascade via FK).

- [ ] **Step 2: Typecheck server build.** Run: `npm --prefix server run build` → no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/infrastructure/repositories/DrizzleWorkspaceRepository.ts
git commit -m "feat(server): DrizzleWorkspaceRepository"
```

---

## PHASE 5 — Server presentation + wiring + scoping

### Task 7: Workspace routes

**Files:**
- Create: `server/src/presentation/workspaces/schemas.ts` (zod)
- Create: `server/src/presentation/workspaces/routes.ts`

**Interfaces:**
- Consumes: `WorkspaceService`. Produces `workspacesRouter(deps): Router` mounted at `/api/workspaces`.
- DTO: `toDto(ws, role?, projectCount?)` → `{ id, name, icon, ownerUserId, role?, projectCount?, createdAt: ISO }`.

- [ ] **Step 1: zod schemas**

```typescript
import { z } from 'zod';
export const createWorkspaceSchema = z.object({ name: z.string().min(1), icon: z.string().max(16).nullable().optional() });
export const updateWorkspaceSchema = z.object({ name: z.string().min(1).optional(), icon: z.string().max(16).nullable().optional() });
export const setCurrentSchema = z.object({ workspaceId: z.string() });
export const addMemberSchema = z.object({ email: z.string().email(), role: z.enum(['owner','member']).optional() });
export const changeRoleSchema = z.object({ role: z.enum(['owner','member']) });
export const moveProjectSchema = z.object({ targetWorkspaceId: z.string() });
```

- [ ] **Step 2: Router** (mirror `projects/routes.ts`; `router.use(requireAuth)`; `next(e)` on error):
  - `GET /` → `listForUser(req.user.id)` → `{ workspaces: [...] }`
  - `POST /` → `create` → 201 `{ workspace }`
  - `PATCH /:id` → `rename`
  - `PUT /current` → `switchCurrent` → 204
  - `GET /:id/members` → `{ members: [...] }`
  - `POST /:id/members` → `addMember` → 201
  - `PATCH /:id/members/:userId` → `changeMemberRole`
  - `DELETE /:id/members/:userId` → `removeMember` → 204
  - `GET /:id/projects` → list projects in workspace (member-gated)
  - `POST /:id/projects/:projectId/move` → `moveProject` → 204
  - `DELETE /:id` → `deleteWorkspace` → 204

- [ ] **Step 3: Commit**

```bash
git add server/src/presentation/workspaces
git commit -m "feat(server): /api/workspaces routes + schemas"
```

### Task 8: Wire workspace service + mount router + scope projects by active workspace

**Files:**
- Modify: `server/src/index.ts` (instantiate repo + service)
- Modify: `server/src/presentation/http.ts` (mount router)
- Modify: server project listing use-case/repo to scope by active workspace
  (find `ListProjects` + `DrizzleProjectMemberRepository.listForUser` — the query behind `GET /api/projects`)
- Modify: server project create to set `workspaceId = current` (find `CreateProject` + repo insert)

**Interfaces:**
- Consumes: `DrizzleWorkspaceRepository`, `WorkspaceService`.

- [ ] **Step 1: Instantiate + mount**

```typescript
// index.ts
const workspaceRepo = new DrizzleWorkspaceRepository(db);
const workspaceService = new WorkspaceService({ repo: workspaceRepo, projects: projectRepo, projectMembers: projectMemberRepo, users: userRepo, idGen: idGenerator });
// add to deps passed to http.ts: workspaces: { service: workspaceService, repo: workspaceRepo }
```
```typescript
// http.ts
app.use('/api/workspaces', workspacesRouter({ service: deps.workspaces.service }));
```

- [ ] **Step 2: Scope project list by active workspace**

In the project-listing query (the one serving `GET /api/projects`), add a filter
`projects.workspace_id = (SELECT current_workspace_id FROM users WHERE id = :userId)`
(or resolve current first via `workspaceRepo.getCurrentWorkspaceId(userId)` and pass it down).
Keep the existing membership join. Add a unit/integration check that a user does not see a
project whose `workspace_id` differs from their current workspace.

- [ ] **Step 3: Project create sets workspace_id**

`CreateProject` resolves `workspaceId = await workspaceRepo.getCurrentWorkspaceId(ownerId)`
and passes it to `repo.createWithOwnerMembership({ ..., workspaceId })`. Update
`CreateProjectInput` + the Drizzle insert to include `workspaceId`. (Add `workspaceId` to
the project insert values.)

- [ ] **Step 4: Deep-link auto-switch**

In `GetProject` (or the `GET /api/projects/:id` handler), after access check, if
`project.workspaceId !== currentWorkspaceId` and the user is a member of `project.workspaceId`,
call `workspaceRepo.setCurrentWorkspace(userId, project.workspaceId)` before returning.

- [ ] **Step 5: Typecheck + run server tests**

Run: `npm --prefix server run build && npm --prefix server test`
Expected: builds, tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src
git commit -m "feat(server): wire workspaces, scope project list/create by active workspace, deep-link auto-switch"
```

---

## PHASE 6 — Client data layer

### Task 9: Client domain + application

**Files:**
- Create: `client/src/domain/workspace/Workspace.ts`
- Create: `client/src/application/workspace/WorkspaceRepository.ts` (port)
- Create: `client/src/application/workspace/` use-cases:
  `ListWorkspaces.ts`, `CreateWorkspace.ts`, `RenameWorkspace.ts`, `SwitchWorkspace.ts`,
  `ListWorkspaceMembers.ts`, `AddWorkspaceMember.ts`, `ChangeMemberRole.ts`,
  `RemoveWorkspaceMember.ts`, `MoveProject.ts`, `DeleteWorkspace.ts`

**Interfaces:**
- Produces:
```typescript
// domain
export type WorkspaceRole = 'owner' | 'member';
export type Workspace = { readonly id: string; readonly name: string; readonly icon: string | null; readonly ownerUserId: string; readonly role: WorkspaceRole; readonly projectCount: number; readonly createdAt: Date; };
export type WorkspaceMember = { readonly userId: string; readonly displayName: string; readonly email: string; readonly avatarUrl: string | null; readonly role: WorkspaceRole; };
// port
export interface WorkspaceRepository {
  list(): Promise<Workspace[]>;
  create(input: { name: string; icon: string | null }): Promise<Workspace>;
  rename(id: string, patch: { name?: string; icon?: string | null }): Promise<Workspace>;
  switchCurrent(id: string): Promise<void>;
  listMembers(id: string): Promise<WorkspaceMember[]>;
  addMember(id: string, email: string, role: WorkspaceRole): Promise<WorkspaceMember>;
  changeMemberRole(id: string, userId: string, role: WorkspaceRole): Promise<void>;
  removeMember(id: string, userId: string): Promise<void>;
  moveProject(workspaceId: string, projectId: string, targetWorkspaceId: string): Promise<void>;
  remove(id: string): Promise<void>;
}
```
- Use-cases: thin wrappers (mirror `application/project/*`). `CreateWorkspace.execute(rawName, icon)`
  trims name, throws `WorkspaceNameEmptyError` (add to `client/src/domain/workspace/errors.ts`).

- [ ] **Step 1: Write domain + errors + port + use-cases. Step 2: typecheck. Step 3: commit.**

```bash
git add client/src/domain/workspace client/src/application/workspace
git commit -m "feat(client): workspace domain + application (port + use-cases)"
```

### Task 10: Client infrastructure (http + mock) + DI

**Files:**
- Create: `client/src/infrastructure/http/HttpWorkspaceRepository.ts`
- Create: `client/src/infrastructure/mock/MockWorkspaceRepository.ts` (+ seed entries)
- Modify: `client/src/infrastructure/di/container.tsx`

**Interfaces:**
- Consumes: port (Task 9), `httpClient`. Produces container entries `listWorkspaces`,
  `createWorkspace`, `renameWorkspace`, `switchWorkspace`, `listWorkspaceMembers`,
  `addWorkspaceMember`, `changeMemberRole`, `removeWorkspaceMember`, `moveProject`,
  `deleteWorkspace`, `workspaceRepository`.

- [ ] **Step 1: HttpWorkspaceRepository** (DTO `fromDto` parses `createdAt`; routes under `/workspaces`;
  map 409/404 `HttpError` → domain errors where relevant). Endpoints per Task 7.

- [ ] **Step 2: MockWorkspaceRepository** (in-memory array seeded with 2 demo workspaces, one
  `role:'owner'` current; `crypto.randomUUID()`; `delay()` like `MockProjectRepository`).

- [ ] **Step 3: Register in container** (instantiate `new HttpWorkspaceRepository()`, wire use-cases,
  add to `Container` type + `buildContainer()` return — exactly like project entries).

- [ ] **Step 4: typecheck + lint.** Run: `npm run typecheck && npm run lint` → pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/infrastructure
git commit -m "feat(client): Http + Mock WorkspaceRepository, DI wiring"
```

### Task 11: Workspaces provider + hooks

**Files:**
- Create: `client/src/presentation/hooks/WorkspacesProvider.tsx` (cache + invalidation, mirror `ProjectsProvider`)
- Create: `client/src/presentation/hooks/useWorkspaces.ts`, `useCurrentWorkspace.ts`,
  `useSwitchWorkspace.ts`, `useCreateWorkspace.ts`, `useWorkspaceMembers.ts`
- Modify: app provider tree (wrap with `WorkspacesProvider` above `ProjectsProvider` — find where `ProjectsProvider` is mounted)

**Interfaces:**
- Produces:
  - `useWorkspaces()` → `{ data: Workspace[] | null, loading, error }`
  - `useCurrentWorkspace()` → `{ workspace: Workspace | null, loading }` (the one with `role` whose
    id matches server-current; since the list reflects membership and the server tracks current,
    expose current via a `currentId` the provider tracks — see below)
  - `useSwitchWorkspace()` → `{ switchTo: (id) => Promise<void>, switching }`
  - `useCreateWorkspace()` → `{ submit: (name, icon) => Promise<Workspace>, saving, error }`
  - `useWorkspaceMembers(id)` → `{ members, loading, refresh, ... }`

- [ ] **Step 1: Provider** holds `data: Workspace[]` and `currentId: string | null`.
  - On load: `list()` → set data. Determine `currentId`: server returns the list; add a
    `currentWorkspaceId` to the `GET /api/projects` bootstrap OR expose it via `GET /workspaces`
    response (include a `current: boolean` flag per workspace, set server-side from
    `users.current_workspace_id`). **Decision:** server marks each workspace DTO with `isCurrent`.
    Update Task 7 `toDto` + Task 9 domain `Workspace` to include `isCurrent: boolean`.
  - `switchTo(id)`: call `switchWorkspace.execute(id)`, set `currentId=id` optimistically,
    then **invalidate projects**: dispatch the existing `PROJECT_CHANGED_EVENT`
    (`window.dispatchEvent(new Event(PROJECT_CHANGED_EVENT))`) so `ProjectsProvider` refetches,
    and navigate to `/`.
  - `applyAppend(ws)` for create; `applyReplace` for rename; `applyRemove` for delete.

- [ ] **Step 2: Hooks** consume the provider (mirror `useProjects`/`useCreateProject`).

- [ ] **Step 3: Update domain `Workspace` + DTO with `isCurrent`** (and server `toDto`).
  Re-run server build + client typecheck.

- [ ] **Step 4: typecheck + lint. Step 5: commit.**

```bash
git add client/src server/src
git commit -m "feat(client): WorkspacesProvider + hooks, isCurrent flag, switch invalidates projects"
```

---

## PHASE 7 — UI

### Task 12: Sidebar header → workspace switcher trigger + popup

**Files:**
- Create: `client/src/presentation/layout/WorkspaceSwitcher.tsx` (replaces the role of `SidebarUserMenu`)
- Modify: `client/src/presentation/layout/Sidebar.tsx` (header + collapsed rail + remove bottom block)
- Modify: `client/src/presentation/layout/projectIcons.tsx` if a workspace-icon helper is needed (reuse `avatarColor`/`getInitials`)

**Interfaces:**
- Consumes: `useWorkspaces`, `useCurrentWorkspace`, `useSwitchWorkspace`, `useCurrentUser`, `useAuth`.
- Produces `<WorkspaceSwitcher compact? />` rendering the trigger (icon + name + hover chevron)
  and the dropdown (account email+copy, `Настройки`→`/profile`, `Выйти`, workspace list with
  `✓` on current + gear→`/workspaces/:id/settings`, `+ Новое пространство`→opens create dialog).

- [ ] **Step 1: Build `WorkspaceSwitcher`** using Radix `DropdownMenu` (mirror current `SidebarUserMenu`
  structure for the account rows; reuse `Avatar`/`AvatarFallback` + `avatarColor`/`getInitials`
  for the workspace square). Trigger: workspace icon + name; on hover show `ChevronsUpDown` (lucide)
  via a group-hover opacity transition. Workspace rows: clicking a non-current one calls
  `switchTo(id)` then closes; gear icon (stopPropagation) navigates to settings.

- [ ] **Step 2: Replace usages in `Sidebar.tsx`**
  - Full mode header: replace the `Link to="/"` PF-logo+title with `<WorkspaceSwitcher />`
    (keep search/bell/collapse to its right). Remove the bottom `<div className="space-y-1 border-t pt-2">`
    block's `SidebarUserMenu`; keep the admin `NavLink` (move it just above, or keep a slim
    bordered footer containing only admin for admins).
  - Collapsed rail: replace the top PF `Link` with `<WorkspaceSwitcher compact />`; remove the
    bottom `<SidebarUserMenu compact />`.

- [ ] **Step 3: Delete `SidebarUserMenu.tsx`** (no longer referenced) — confirm no other imports
  (`grep SidebarUserMenu`).

- [ ] **Step 4: typecheck + lint + run app**

Run: `npm run typecheck && npm run lint`. Then `npm run dev:client` and verify the header shows
the workspace name, the popup opens, switching changes the project list.

- [ ] **Step 5: Commit**

```bash
git add client/src/presentation/layout
git commit -m "feat(client): workspace switcher header + popup, remove bottom profile block"
```

### Task 13: Create-workspace dialog

**Files:**
- Create: `client/src/presentation/components/forms/NewWorkspaceDialog.tsx`
- Modify: `WorkspaceSwitcher.tsx` (open dialog from `+ Новое пространство`)

**Interfaces:**
- Consumes: `useCreateWorkspace`, `useSwitchWorkspace` (switch is implicit server-side on create),
  optional emoji picker (reuse the project icon picker — find it via `grep` for the emoji input in `NewProjectDialog`/project settings).
- Produces controlled `<NewWorkspaceDialog open onOpenChange />`.

- [ ] **Step 1: Build dialog** (mirror `NewProjectDialog`): name `Input` (required, maxLength 120),
  optional emoji-icon control, `Создать`/`Отмена`, close-on-success. On submit:
  `await submit(name, icon)` → server creates + sets current + returns `isCurrent:true`;
  provider `applyAppend` + set `currentId`; close dialog; dispatch project-invalidation + navigate `/`.

- [ ] **Step 2: typecheck + lint + manual test** (create → popup shows new ws with ✓, lands in empty workspace).

- [ ] **Step 3: Commit**

```bash
git add client/src/presentation/components/forms/NewWorkspaceDialog.tsx client/src/presentation/layout/WorkspaceSwitcher.tsx
git commit -m "feat(client): create-workspace dialog with auto-switch"
```

### Task 14: Profile page — monitoring card + rename to «Настройки»

**Files:**
- Modify: `client/src/presentation/pages/ProfilePage.tsx` (add monitoring entry card; the
  `PreferencesCard` theme+animation already lives here — leave it)
- Modify: any nav label/`<title>`/breadcrumb saying «Профиль» for this page → «Настройки»
  (the popup item is already «Настройки» from Task 12)

**Interfaces:**
- Produces a `MonitoringCard` linking to `/monitoring`.

- [ ] **Step 1: Add a card** to `ProfilePage` (after `PreferencesCard` or near top):
```tsx
<Card>
  <CardHeader>
    <CardTitle>Мониторинг</CardTitle>
    <CardDescription>Состояние серверов и здоровье инфраструктуры.</CardDescription>
  </CardHeader>
  <CardContent>
    <Button asChild variant="outline"><Link to="/monitoring"><Activity className="size-4" />Открыть мониторинг</Link></Button>
  </CardContent>
</Card>
```
- [ ] **Step 2: Rename page heading** `«Профиль»` → `«Настройки»` (keep route `/profile`).
- [ ] **Step 3: typecheck + lint. Step 4: commit.**

```bash
git add client/src/presentation/pages/ProfilePage.tsx
git commit -m "feat(client): move monitoring entry into settings page, rename Профиль→Настройки"
```

### Task 15: Workspace settings page (rename, members, projects move, delete)

**Files:**
- Create: `client/src/presentation/pages/WorkspaceSettingsPage.tsx`
- Modify: `client/src/presentation/app/routes.tsx` (add `workspaces/:workspaceId/settings`)

**Interfaces:**
- Consumes: `useWorkspaces`, `useWorkspaceMembers`, `useRenameWorkspace`, `useDeleteWorkspace`,
  `useMoveProject` (add these thin mutation hooks alongside Task 11 ones if not present),
  `useProjects` (for the workspace's project list).

- [ ] **Step 1: Page sections** (shadcn `Card`s):
  - **Название**: name input + emoji + save (rename).
  - **Участники**: list (avatar, name, email, role select), add-by-email form, remove button.
    Disable demote/remove of last owner (UI guard + server enforces). Show server error toasts.
  - **Проекты**: list of workspace projects, each with a «Перенести» control (select target
    workspace from `useWorkspaces`) calling `moveProject`.
  - **Опасная зона**: delete workspace button (confirm dialog); disabled with hint if it has
    projects or is the only workspace; on success switch handled server-side + navigate `/`.
- [ ] **Step 2: Route**: add `{ path: 'workspaces/:workspaceId/settings', element: <WorkspaceSettingsPage /> }`
  under the `AppShell` children.
- [ ] **Step 3: typecheck + lint + manual test** each action.
- [ ] **Step 4: Commit**

```bash
git add client/src/presentation
git commit -m "feat(client): workspace settings page — rename, members, move projects, delete"
```

### Task 16: Animations polish

**Files:**
- Modify: `WorkspaceSwitcher.tsx`, `NewWorkspaceDialog.tsx`, and the active `✓` rendering.
- Reference: `client/src/styles/globals.css` (existing keyframes), `useMotion`.

**Interfaces:** none new.

- [ ] **Step 1:** Confirm the shadcn `DropdownMenuContent`/`DialogContent` already animate via
  Radix `data-state` Tailwind classes (`data-[state=open]:animate-in` etc.). If the project's
  variants lack them, add fade+zoom+slide classes consistent with other menus.
- [ ] **Step 2:** Active-workspace `✓`: wrap in a span that plays a spring-pop
  (`motion-safe:animate-...`) when it becomes current; gate on `useMotion`.
- [ ] **Step 3:** Header hover hint: `ChevronsUpDown` `opacity-0 group-hover:opacity-100
  transition-opacity` + tiny translate.
- [ ] **Step 4:** Workspace-name crossfade on switch (key the name span by `currentId` so React
  remounts with an `animate-in fade-in` when motion enabled).
- [ ] **Step 5:** Verify with animations toggled OFF (no motion) and reduced-motion.
- [ ] **Step 6: Commit**

```bash
git add client/src
git commit -m "feat(client): workspace switcher + dialog animations (motion-gated)"
```

---

## PHASE 8 — Verification

### Task 17: Full verification sweep

- [ ] **Step 1:** `npm --prefix server run build && npm --prefix server test` → green.
- [ ] **Step 2:** `npm run typecheck && npm run lint` → green.
- [ ] **Step 3:** Manual E2E in `npm run dev`:
  - Switch workspaces → project list changes; current marked `✓`.
  - Create workspace → empty, auto-switched, appears with `✓`.
  - Create same-named project in two workspaces → independent task lists.
  - Add member by email; demote/remove guarded for last owner.
  - Move a project to another workspace → disappears from source list, appears in target.
  - Delete empty workspace ok; delete with projects / last workspace blocked with Russian message.
  - Deep-link to a project in another workspace → auto-switches.
  - Theme/animation/monitoring reachable only from settings page; bottom sidebar block gone.
  - Mobile (≤375px) + collapsed rail: switcher trigger works; safe-area intact.
- [ ] **Step 4:** Commit any fixes; the feature branch is ready for review/merge.

---

## Self-Review notes (coverage)

- Spec §3 (DB) → Tasks 1–2. §4 (active ws + isolation + deep-link) → Task 8. §5 (server) →
  Tasks 3–8. §6 (client) → Tasks 9–11. §7 (edge-cases) → Task 5 tests + Task 15 UI guards.
  §8 (UI) → Tasks 12–15. §8.5 (profile) → Task 14. §8.6 (remove bottom block) → Task 12.
  §9 (animations) → Task 16. §10 (tests) → Tasks 5, 8, 17.
- Open implementation decision locked in Task 11: server marks each workspace DTO `isCurrent`
  (source of truth `users.current_workspace_id`); the client provider tracks `currentId` from it.

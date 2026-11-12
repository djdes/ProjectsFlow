# Один проект в нескольких пространствах — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** проект подключается к нескольким пространствам; задача помнит пространство создания;
видимость задач — правила пространств и персональные правила людей; проверка на сервере.

**Architecture:** таблицы db/182 + `tasks.origin_workspace_id`; чистая доменная функция
видимости (`domain/project/ProjectSharing.ts`); загрузка правил и членств — в инфраструктуре
(`DrizzleProjectSharingRepository`), применение — через `ProjectMemberRepository`
(`filterVisibleTasks`), который уже есть у всех task-use-case'ов: доступ к проекту через
основное ∪ подключённые пространства, фильтр задач — по правилам. Проекты без подключённых
пространств идут быстрым путём (поведение прежнее).

**Tech Stack:** Node 22, Express 4, drizzle-orm (MariaDB), node:test + tsx; React 19 + shadcn.

**Spec:** `docs/superpowers/specs/2026-11-12-shared-projects-across-workspaces-design.md`

## Global Constraints

- Миграция `db/182_shared_projects.sql`, append-only, без FK на `tasks` (без перестройки таблицы).
- Происхождение `NULL` = основное пространство; происхождение, не подключённое к проекту, — тоже основное.
- Видят всегда: автор и ответственный задачи; автор проекта; owner/lead основного пространства.
- Правило человека заменяет правила пространств; `mine` — только где он автор/ответственный.
- Пользовательские строки — по-русски; CSS — логические утилиты, движение под `motion-safe:`.

## Review Focus

- Прямая ссылка на скрытую задачу (`GET /tasks/:id`, комментарии, вложения) — 404, не 403.
- Проект без подключённых пространств: ни одного лишнего отличия в доступе и списках.
- Отключение пространства: участники только этого пространства теряют проект; задачи остаются.
- Участник обоих пространств: в каждом пространстве видит своё правило, по прямой ссылке — объединение.
- Уведомление гостю (не участнику основного) видно в его пространстве.

---

### Task 1: Схема и происхождение задачи
- Create `db/182_shared_projects.sql`: `project_workspace_access(project_id, workspace_id, task_scope ENUM('all','own','selected') DEFAULT 'own', visible_from JSON, created_by_user_id, created_at, PK(project_id, workspace_id), KEY(workspace_id), FK project/workspace CASCADE)`; `project_member_task_visibility(project_id, user_id, task_scope ENUM('all','mine','selected'), visible_from JSON, updated_by_user_id, updated_at, PK(project_id,user_id), FK CASCADE)`; `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS origin_workspace_id CHAR(36) NULL`, индекс `(project_id, origin_workspace_id)`.
- Modify `schema.ts`, `Task` (`originWorkspaceId?: string | null`), `toTask`, `TaskRepository.create` input.

### Task 2: Домен видимости (TDD)
- Create `server/src/domain/project/ProjectSharing.ts`: `WorkspaceTaskScope`, `MemberTaskScope`, `ProjectSharing`, `taskOrigin()`, `canSeeTask(sharing, viewer, task)` где `viewer = { userId, viewerWorkspaceId: string | null, memberWorkspaceIds, isAdmin }`.
- Tests: все комбинации правил; автор/ответственный; admin; устаревшее происхождение; объединение без контекста.

### Task 3: Репозиторий общих проектов
- Create `application/project/ProjectSharingRepository.ts` (порт) + `DrizzleProjectSharingRepository`: `loadMany(projectIds)` (только общие), `memberships(userId, workspaceIds)`, `getConfig(projectId)`, `saveConfig(projectId, actor, config)`, `workspaceIdsOf(projectId)`, `projectInWorkspaceSql` helper.

### Task 4: Доступ к проекту через подключённые пространства
- `DrizzleProjectMemberRepository`: `findForProject` (лучшая роль среди основного и подключённых, исключения — по пространству), `listByProject` (объединение участников), `listProjectsWhere` (проекты основного ИЛИ подключённые к W; роль/исключения в W), `isProjectHidden`, `filterVisibleTasks(userId, tasks)` (контекст пространства — из запроса), `filterTaskAudience(task, userIds)`; `ProjectWithRole.sharedWorkspaces`.

### Task 5: Применение видимости
- `ListTasks`, `taskAuthorization` (read/modify/delete/canManage → 404), `SearchTasks` (пост-фильтр), очереди «Входящих» (`listAssignedToInWorkspace`, `listByStatusInWorkspace` — с подключёнными проектами + фильтр), аудитория уведомлений/realtime по задаче, `DrizzleNotificationRepository.create` (пространство гостя), SSE-фильтр (`workspaceIdsOf`), сводки пространства.

### Task 6: Происхождение и приёмка
- `CreateTask`: `originWorkspaceId` = пространство запроса, если подключено; иначе единственное пространство проекта, где автор участник; иначе NULL. `MoveTaskToProject` сбрасывает в NULL.
- `TaskApprovalService.resolveTargetStatus/canApprove(project, actor, …, originWorkspaceId?)` — политика пространства происхождения; 5 вызовов передают происхождение.

### Task 7: Управление доступом
- `ManageProjectSharing.get/save` (автор проекта или owner/lead основного; добавить можно только пространство, где актор owner/lead; командные пространства), роуты `GET/PUT /api/projects/:id/workspace-access`; отключение пространства обнуляет происхождение его задач.

### Task 8: Клиент
- Тип/порт/HTTP; `ProjectWorkspaceAccessDialog` (пространства с правилами + люди); пункт «Доступ пространств…» в меню проекта (сайдбар и страница проекта); значок «общий» в сайдбаре; бейдж пространства на карточке задачи из другого пространства.

### Task 9: Проверка и выкладка
- typecheck, lint, test:server, build:client, smoke; ревью; PR → CI → merge → деплой.

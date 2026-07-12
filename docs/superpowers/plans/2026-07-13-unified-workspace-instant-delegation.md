# Единое пространство, мгновенное делегирование и Telegram-меню «по ответственным» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: используй superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans для исполнения задача-за-задачей. Шаги помечены чекбоксами (`- [ ]`).

**Goal:** Перевести доступ к проектам с per-project приглашений на единое пространство (workspace_members — единственный источник доступа), сделать делегирование мгновенным (сразу accepted, без принятия/отказа) и добавить Telegram-меню задач по ответственным со сроками и кнопками Завершить/Комментировать/Открыть.

**Architecture:** Вариант A из спеки — интерфейс `ProjectMemberRepository` не меняется, его Drizzle-реализация читает членство через `projects.workspace_id → workspace_members`; `requireProjectAccess` и ~30 use-case'ов остаются как есть. Делегирование создаётся сразу `accepted`; `AcceptTaskDelegation`/`DeclineTaskDelegation`/`InviteAndDelegateTask` и весь `pending_invite`-флоу удаляются. Telegram-бот получает новый экран «по ответственным» поверх существующей навигации.

**Tech Stack:** server — Express 4 + mysql2/Drizzle, ESM (импорты с .js), тесты node:test (`node --import tsx --test`); client — Vite + React 19 + TS + Tailwind (тестов нет, проверка через typecheck/lint/build); БД — MariaDB 10.11, миграции append-only в `db/`.

**Спека:** [docs/superpowers/specs/2026-07-13-unified-workspace-and-instant-delegation-design.md](../specs/2026-07-13-unified-workspace-and-instant-delegation-design.md)

## Global Constraints

- **Кириллица** во всех user-facing строках; технические комментарии/код/типы — на английском.
- **Миграции append-only**, MariaDB-совместимый синтаксис (без `INSERT ... AS new ...`); НЕ запускать локально (локальная БД сломана на 054) — синтаксис применяется `scripts/migrate.mjs` на проде при автодеплое. Последняя существующая миграция — `db/109`; новые — 110, 111, 112.
- **Тесты — только node:test** (`node --import tsx --test src/path/file.test.ts`), НЕ vitest/jest/pytest.
- **Коммиты — явные пути** (`git add <путь>`), никогда `git add -A`/`-u`/`.` (в worktree может быть параллельная работа). Сообщения на русском в стиле репо (`feat(workspace): …`, `fix(tasks): …`).
- **Clean Architecture:** presentation НЕ импортирует infrastructure напрямую (client — через DI-контейнер). Слои domain→application→infrastructure→presentation, однонаправленно.
- **Изоляция worktree:** работать в отдельном worktree, remote — `github`.

---

## ⚠️ ERRATA — обязательные правки верификаторов (применить ПЕРЕД исполнением)

Три верификатора (согласованность типов, покрытие спеки, заглушки) прошли по собранному плану. Ниже — их находки: **11 блокеров + 11 minor**. Дубли между проверками схлопнуты. Исполнитель КАЖДОЙ задачи обязан свериться с этим списком по номеру своей задачи ДО написания кода — правки здесь имеют приоритет над текстом задачи ниже.

### 1. [BLOCKER] Task 21 (E-client, HttpInviteRepository/PreviewDto) vs Task 6 Step 5 (B-server, invites/routes.ts GET-превью)

**Проблема:** Контракт превью инвайта разъехался. Сервер (Task 6) отдаёт { preview: { kind, targetName, projectName: targetName /*алиас*/, role, inviterDisplayName, inviteEmail, expiresAt } } и НИКОГДА не шлёт workspaceName. Клиент (Task 21) объявляет PreviewDto = { workspaceName?, projectName?, ... } и вычисляет kind через `preview.workspaceName != null` → всегда false: любой workspace-инвайт отрендерится как «Приглашение в проект», строка «Доступ ко всем проектам пространства» никогда не покажется. Блок Consumes в task-21.md описывает несуществующий серверный shape (противоречит Produces секции B: `InvitePreview = { kind: 'workspace'|'project'; targetName; ... }` из списка интерфейсов).

**Правка:** В Task 21 Step 2 привести HttpInviteRepository к фактическому серверному контракту:
```ts
type PreviewDto = {
  kind?: 'workspace' | 'project';
  targetName?: string;
  // Легаси-алиас (= targetName) — на случай отставшего сервера.
  projectName?: string | null;
  role: InviteRole;
  inviterDisplayName: string | null;
  inviteEmail: string | null;
  expiresAt: string;
};
// в getPreview:
return {
  kind: preview.kind ?? 'project',
  targetName: preview.targetName ?? preview.projectName ?? '',
  role: preview.role,
  inviterDisplayName: preview.inviterDisplayName,
  inviteEmail: preview.inviteEmail,
  expiresAt: new Date(preview.expiresAt),
};
```
И поправить блок Consumes в task-21.md: `GET /api/invites/:token → { preview: { kind, targetName, projectName(=targetName, легаси-алиас), role, inviterDisplayName, inviteEmail, expiresAt } }`.

### 2. [BLOCKER] Task 14 Step 6 (C-server-delegation) vs Task 5 Step 6 (B-server-workspace) — server/src/domain/notifications/Notification.ts

**Проблема:** WorkspaceInvitePayload добавляется ДВАЖДЫ в один и тот же файл: Task 5 (секция B) вставляет тип + `| WorkspaceInvitePayload` в union после ProjectInvitePayload, и Task 14 (секция C) даёт идентичную инструкцию (тот же тип, то же место, тот же union-member). При исполнении по порядку (B → C) Task 14 создаст дубликат объявления типа и дубликат члена union → tsc падает с Duplicate identifier 'WorkspaceInvitePayload'. Оба interface-списка ([B] и [C]) заявляют этот payload как свой Produces — владение не разграничено.

**Правка:** Убрать добавление payload из Task 14: в Files оставить «Modify: Notification.ts (только комментарий TaskDelegationPayload)»; Step 6 переписать: «1) Убедиться, что WorkspaceInvitePayload и `| WorkspaceInvitePayload` в union уже добавлены Task 5 (rg -n "WorkspaceInvitePayload" server/src/domain/notifications/Notification.ts → 2+ совпадения); если секция B ещё не в main — добавить по тексту Task 5 Step 6 и зафиксировать. 2) Заменить комментарий над TaskDelegationPayload (как в текущем Step 6.2)». В interface-списке C пометить WorkspaceInvitePayload как Consumes (из B), не Produces.

### 3. [BLOCKER] Task 19 Step 3 (E-client, WorkspaceInviteDto в HttpWorkspaceRepository) vs Task 7 Step 2.4 (B-server, inviteToDto в workspaces/routes.ts)

**Проблема:** Shape DTO инвайта не совпадает. Сервер (Task 7 inviteToDto) отдаёт только { id, role, email, expiresAt, createdAt, token?, url? }. Клиент (Task 19) объявляет WorkspaceInviteDto с ОБЯЗАТЕЛЬНЫМИ workspaceId, acceptedAt, acceptedByUserId, createdByUserId и спредит их в домен WorkspaceInvite — в рантайме эти required-поля будут undefined (invite.workspaceId === undefined и т.д.). UI сейчас их не читает, поэтому не падает, но доменный тип врёт, и любой будущий потребитель (например, сверка invite.workspaceId в InvitesCard) молча сломается. Interface-список [E] тоже заявляет полный WorkspaceInvite (id, workspaceId, ..., createdByUserId).

**Правка:** Выровнять сервер под заявленный контракт — в Task 7 Step 2.4 расширить WorkspaceInviteDto и inviteToDto:
```ts
type WorkspaceInviteDto = {
  id: string;
  workspaceId: string;
  role: 'editor' | 'viewer';
  email: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  createdByUserId: string;
  createdAt: string;
  token?: string;
  url?: string;
};
function inviteToDto(i: WorkspaceInvite, opts?: ...): WorkspaceInviteDto {
  const dto: WorkspaceInviteDto = {
    id: i.id,
    workspaceId: i.workspaceId,
    role: i.role,
    email: i.email,
    expiresAt: i.expiresAt.toISOString(),
    acceptedAt: i.acceptedAt ? i.acceptedAt.toISOString() : null,
    acceptedByUserId: i.acceptedByUserId,
    createdByUserId: i.createdByUserId,
    createdAt: i.createdAt.toISOString(),
  };
  ...
}
```
И синхронно поправить Produces в task-07.md: `GET ... → { invites: Array<{id, workspaceId, role, email, expiresAt, acceptedAt, acceptedByUserId, createdByUserId, createdAt}> }` (без token).

### 4. [BLOCKER] Task 9 Steps 1–3 (B-server-workspace) vs Task 1 Steps 3, 6, 8 (A) — server/src/application/workspace/WorkspaceService.ts и WorkspaceService.test.ts

**Проблема:** Task 9 написан от СТАРОГО состояния файла и дублирует/противоречит правкам Task 1. Конкретно: (а) Task 9 Step 3.4 велит удалить хвост moveProject, цитируя `addMember(targetWorkspaceId, m.userId, 'member')` — но Task 1 Step 6.3 уже поменял литерал на `'editor'`, exact-match правка не применится; (б) Task 9 Step 3.2 (дефолт addMember 'member'→'editor') и Step 3.3 (guard `role !== 'owner'`) уже выполнены Task 1 Step 6.1/6.2; (в) Task 9 Step 1.3 (замены 'member'→'editor' в тестах, строки 169/187/196/205) уже выполнены Task 1 Step 8; (г) Task 9 Step 1.5 добавляет тест 'changeMemberRole: понижение последнего owner до viewer тоже отклоняется' — дубль теста из Task 1 Step 3 ('demoting the last owner to viewer rejected'), останутся два одинаковых теста; (д) ожидания Task 9 Step 2 («default-роль — 'member'», guard падает) неверны после Task 1 — «падающие» тесты частично зелёные сразу.

**Правка:** Переписать Task 9 с учётом того, что Task 1 уже в main: Step 1 — оставить только пункты 1–2 (убрать members из Seed.projects, удалить projectMembersPort из фейков/конструктора) и пункт 4 (новый moveProject-тест); удалить пункты 3 и 5 (уже сделаны/дублируют Task 1). Step 2 — ожидание: только конструктор требует projectMembers и moveProject-тест падает. Step 3 — оставить пункты 1 (снос ProjectMembersPort + поля Deps) и 4, где в удаляемой цитате `'member'` заменить на `'editor'`:
```ts
    const members = await this.deps.projectMembers.listByProject(projectId);
    for (const m of members) {
      await this.deps.repo.addMember(targetWorkspaceId, m.userId, 'editor');
    }
```
Пункты 2–3 Step 3 удалить (выполнены Task 1). Из Produces Task 9 убрать «changeMemberRole защищает последнего owner…» и «addMember дефолт editor» — это Produces Task 1.

### 5. [BLOCKER] Секция C (Task 12) ↔ Task 25 Step 7 — server/src/domain/task/TaskDelegation.ts:34 (ACTIVE_DELEGATION_STATUSES) и server/src/infrastructure/repositories/DrizzleTaskDelegationRepository.ts:20 (ACTIVE_STATUSES)

**Проблема:** Спека §4 требует, чтобы pending/pending_invite перестали быть активными статусами, а Task 25 Step 7 явно ОЖИДАЕТ «оба массива не содержат 'pending_invite'» — но ни одна задача плана (11, 12, 15) эти константы не меняет. Сейчас оба массива = ['pending','accepted','pending_invite'] (проверено в коде, ACTIVE_STATUSES используется в 5 запросах Drizzle-репозитория). Финальная верификация гарантированно уйдёт в fix-процедуру Step 8 вместо запланированной правки.

**Правка:** В Task 12 добавить шаг (рядом со Step 8 «удалить порт listPendingForDelegate»): в server/src/domain/task/TaskDelegation.ts заменить массив на:
```ts
// Активная делегация — только accepted: делегирование мгновенное (спека §4),
// legacy pending/pending_invite добиты миграцией 112.
export const ACTIVE_DELEGATION_STATUSES: readonly TaskDelegationStatus[] = ['accepted'];
```
и в DrizzleTaskDelegationRepository.ts:20:
```ts
const ACTIVE_STATUSES: readonly TaskDelegationStatus[] = ['accepted'];
```
Прогнать npm test (фикстуры buildTaskDigest.test.ts создают делегации напрямую, мимо репозитория — не сломаются).

### 6. [BLOCKER] Task 15 Step 3.8 (notifyDelegate) и Step 3.10 (notifySegmentDelegate) — server/src/application/telegram/composer/TelegramComposerService.ts

**Проблема:** Спека §4: «в TG к карточке цепляются "✅ Завершить / 💬 Комментировать / Открыть"», и Task 26 Step 7.5 проверяет ровно этот набор кнопок. Но новая клавиатура в Task 15 — только `taskActionKeyboard(taskId)` = nd:/nc: (Завершить/Комментировать), url-кнопки «Открыть» НЕТ (в старом коде её тоже не было — там были только da:/dd:). Ручная TG-проверка юзера в Task 26 упадёт по чек-листу.

**Правка:** В Task 15 Step 3.8 (notifyDelegate) заменить `replyMarkup: taskActionKeyboard(taskId),` на клавиатуру с url-кнопкой deep-link (тот же паттерн, что в Task 16 buildAssigneeTaskCards):
```ts
replyMarkup: {
  inline_keyboard: [
    ...taskActionKeyboard(taskId).inline_keyboard,
    [{ text: 'Открыть в ProjectsFlow', url: `${this.deps.appUrl.replace(/\/$/, '')}/projects/${projectId}?task=${taskId}` }],
  ],
},
```
(projectId — параметр notifyDelegate, уже есть). Аналогично в Step 3.10 для notifySegmentDelegate. В тестах Step 1.3/1.5 добавить assert `h.delegateMessages[0]!.buttons.includes('Открыть в ProjectsFlow')`.

### 7. [BLOCKER] Task 21 Step 2 (client/src/infrastructure/http/HttpInviteRepository.ts, PreviewDto) ↔ Task 6 Step 5 (server/src/presentation/invites/routes.ts)

**Проблема:** Контракт GET /api/invites/:token в двух задачах несовместим: сервер (Task 6) отдаёт `{ kind, targetName, projectName: targetName /*алиас*/, role, ... }` и НИКОГДА не отдаёт `workspaceName`; клиент (Task 21) читает `workspaceName?/projectName?` и определяет kind через `preview.workspaceName != null` → workspace-инвайты ВСЕГДА отрендерятся как «Приглашение в проект» (kind='project'). tsc/lint это не поймают — обнаружится только на проде.

**Правка:** В Task 21 Step 2 привести PreviewDto к фактическому серверному контракту Task 6:
```ts
type PreviewDto = {
  kind: 'workspace' | 'project';
  targetName: string;
  role: InviteRole;
  inviterDisplayName: string | null;
  inviteEmail: string | null;
  expiresAt: string;
};
```
и в getPreview маппить напрямую:
```ts
return {
  kind: preview.kind,
  targetName: preview.targetName,
  role: preview.role,
  inviterDisplayName: preview.inviterDisplayName,
  inviteEmail: preview.inviteEmail,
  expiresAt: new Date(preview.expiresAt),
};
```
Также обновить блок Consumes задачи 21 (описание превью) под kind/targetName.

### 8. [BLOCKER] Task 21 (E-client), Step 2 — HttpInviteRepository.getPreview + Interfaces-блок задачи

**Проблема:** Контракт превью инвайта расходится с сервером. Сервер после Task 6 Step 5 отдаёт { preview: { kind, targetName, projectName: targetName (легаси-алиас), role, ... } } и НИКОГДА не отдаёт workspaceName. Клиентский код Task 21 детектит тип токена через `preview.workspaceName != null` — это всегда false, все workspace-инвайты на /invite/:token отрендерятся как kind='project' («Приглашение в проект», без пояснения про доступ ко всем проектам пространства). Interfaces-блок Task 21 описывает несуществующий серверный контракт ({ workspaceName?, projectName? }).

**Правка:** В HttpInviteRepository читать поля, которые сервер реально отдаёт:
```ts
type PreviewDto = {
  kind?: 'workspace' | 'project';
  targetName?: string;
  projectName?: string | null;
  role: InviteRole;
  inviterDisplayName: string | null;
  inviteEmail: string | null;
  expiresAt: string;
};

async getPreview(token: string): Promise<InvitePreview> {
  const { preview } = await httpClient.get<{ preview: PreviewDto }>(`/invites/${token}`);
  return {
    kind: preview.kind ?? 'project',
    targetName: preview.targetName ?? preview.projectName ?? '',
    role: preview.role,
    inviterDisplayName: preview.inviterDisplayName,
    inviteEmail: preview.inviteEmail,
    expiresAt: new Date(preview.expiresAt),
  };
}
```
И поправить Interfaces-блок Task 21: `GET /api/invites/:token → { preview: { kind: 'workspace'|'project', targetName, projectName (алиас targetName), role, inviterDisplayName, inviteEmail, expiresAt } }`.

### 9. [BLOCKER] Task 26 (Секция F), Step 4 — prod-verify.mjs, блок 6 «Делегирование A→B»

**Проблема:** Id делегации извлекается из несуществующих полей. `POST /api/projects/:pid/tasks/:tid/delegate` возвращает { task: { ..., delegation } } (server/src/presentation/tasks/routes.ts:509 — `res.json({ task: toDto({ ...task, delegation }) })`), а элементы GET /delegations/assigned-to-me после Task 12 имеют форму { task, projectId, projectName, isInbox, canModify } — delegation лежит ВНУТРИ task (toDto маппит её, tasks/routes.ts:159–172). Выражение `d1?.delegation?.id ?? d1?.id ?? item1?.delegation?.id` даст undefined → чек «получен id делегации» упадёт, проверки accept/decline 404 пройдут случайно (URL с 'undefined' тоже 404), а Step 8 `POST /api/delegations/undefined/relinquish` вместо 204 получит 404 — прогон провалится на живом проде. Проверка `item1?.delegation ? status==='accepted' : true` проходит вакуумно и ничего не проверяет.

**Правка:** В prod-verify.mjs заменить:
```js
const delId = d1?.task?.delegation?.id ?? item1?.task?.delegation?.id;
check(Boolean(delId), 'получен id делегации');
check(item1?.task?.delegation?.status === 'accepted', 'status=accepted у делегации');
```
(вместо `d1?.delegation?.id ?? d1?.id ?? item1?.delegation?.id` и вакуумной проверки item1?.delegation).

### 10. [BLOCKER] Task 9 (B-server) Step 1 п.3 и Step 3 пп.2–4 vs Task 1 Steps 3, 6, 8

**Проблема:** Task 9 дублирует правки, уже выполненные Task 1, и цитирует для точечных Edit-замен строки, которых после Task 1 больше нет: (а) Step 1 п.3 — замены `'member'`→`'editor'` в WorkspaceService.test.ts (строки 169/187/196/205) уже сделаны Task 1 Step 8; (б) Step 3 п.2 (default addMember `'editor'`) и п.3 (guard `role !== 'owner'`) уже сделаны Task 1 Step 6; (в) Step 3 п.4 велит удалить хвост moveProject, цитируя его с литералом `'member'`, но Task 1 Step 6.3 уже заменил его на `'editor'` — exact-match правка не найдёт old_string; (г) новый тест Task 9 «changeMemberRole: понижение последнего owner до viewer тоже отклоняется» дублирует по смыслу тест Task 1 Step 3 «demoting the last owner to viewer rejected» — в файле окажутся два одинаковых теста.

**Правка:** В Task 9: удалить Step 1 п.3 и Step 3 пп.2–3 (пометить «уже сделано Task 1»); в Step 3 п.4 цитировать удаляемый хвост с `'editor'`:
```ts
    // Все участники проекта должны стать участниками целевого пространства (идемпотентно).
    const members = await this.deps.projectMembers.listByProject(projectId);
    for (const m of members) {
      await this.deps.repo.addMember(targetWorkspaceId, m.userId, 'editor');
    }
```
и убрать из Step 1 п.5 дублирующий тест про viewer (оставить только тест Task 1 Step 3); тест «addMember: роль по умолчанию — editor» оставить.

### 11. [BLOCKER] Task 25 (Секция F) Step 7 vs Task 12/13/23 — свипы pending_invite / ACTIVE_* / revertToUserId

**Проблема:** Ожидания финального grep-свипа противоречат тому, что реально производят задачи плана: (а) `ACTIVE_DELEGATION_STATUSES` (server/src/domain/task/TaskDelegation.ts:34–38) и `ACTIVE_STATUSES` (server/src/infrastructure/repositories/DrizzleTaskDelegationRepository.ts:20) сейчас содержат 'pending_invite', и НИ ОДНА задача (11/12/13/15) их не правит — Task 25 ждёт «не содержат» и заставит чинить ad-hoc на финальной верификации; (б) переписанный в Task 13 RelinquishTaskDelegation сохраняет `existing.status !== 'pending_invite'` в guard — Task 25 посчитает это дефектом; (в) исключения свипа `pending_invite` не включают client/src/domain/task/TaskDelegation.ts (union сознательно НЕ сужается по Task 23 Step 4 и разрешён в Task 24) и новый server/src/application/task/ListTasksAssignedToMe.test.ts (Task 12 Step 1 использует `status: 'pending_invite'` в тесте); (г) свип `revertToUserId` разрешает только schema/domain/Drizzle-repo, но поле останется в server/src/application/task/TaskDelegationRepository.ts:17 (CreateDelegationInput) и в тест-фейках (DelegateExistingTask.test.ts:55, buildTaskDigest.test.ts:141,216 + новые тесты Task 11/13 с `revertToUserId: null`).

**Правка:** Два согласованных изменения: 1) В Task 12 Step 8 добавить пункт: «в server/src/domain/task/TaskDelegation.ts из ACTIVE_DELEGATION_STATUSES и в DrizzleTaskDelegationRepository.ts из ACTIVE_STATUSES убрать 'pending_invite' (оставить ['pending','accepted'] — легаси-pending добьёт миграция 112)»; в Task 13 guard заменить на `if (existing.status !== 'pending' && existing.status !== 'accepted') { throw new DelegationWrongStateError(existing.status, 'pending|accepted'); }`. 2) В Task 25 Step 7 расширить списки исключений: для `pending_invite` — плюс client/src/domain/task/TaskDelegation.ts (union) и server/src/application/task/ListTasksAssignedToMe.test.ts (тест легаси-строки); для `revertToUserId` — плюс server/src/application/task/TaskDelegationRepository.ts (поле CreateDelegationInput) и любые `*.test.ts` (фейки TaskDelegation).

### 12. [MINOR] Task 5 Step 1–2 (B) vs Task 2 Steps 3–4 (A) — server/src/domain/workspace/WorkspaceInvite.ts и schema.ts

**Проблема:** Task 5 в Files заявляет «Create: server/src/domain/workspace/WorkspaceInvite.ts» и Step 1 безусловно создаёт файл, который уже создан Task 2 (контент отличается только комментариями). Для schema.ts guard «если уже добавлена Секцией A — пропустить» есть, для доменного файла — нет. Вдобавок schema-сниппет Task 5 отличается от Task 2: `role: mysqlEnum('role', ['editor','viewer']).notNull()` БЕЗ `.default('editor')`, тогда как Task 2 и миграция 111 задают DEFAULT 'editor' — при исполнении по сниппету Task 5 Drizzle-схема разойдётся с БД.

**Правка:** В Task 5 Step 1 добавить: «Файл server/src/domain/workspace/WorkspaceInvite.ts уже создан Task 2 (секция A) — сверить содержимое и пропустить создание; создавать только если секция A не выкачена». В Step 2 сниппет привести к Task 2: `role: mysqlEnum('role', ['editor', 'viewer']).notNull().default('editor'),`. В Files пометить оба как «Create (skip if exists — Task 2)».

### 13. [MINOR] Task 25 Step 5 (F-verify) vs Task 3 (A) — имя миграции 112

**Проблема:** Task 25 Step 5 приводит пример имени `112_backfill_workspace_members_and_delegations.sql`, а секция A создаёт файл `112_unified_membership_backfill.sql` (так же он назван в interface-списке A). Пример в верификационном чек-листе противоречит фактическому имени и может заставить исполнителя посчитать миграцию «не той» или переименовать её.

**Правка:** В Task 25 Step 5 заменить пример на фактические имена секции A: «Ожидание: ровно три файла — `110_workspace_member_roles.sql`, `111_workspace_invites.sql`, `112_unified_membership_backfill.sql`». То же имя использовать в Task 26 Step 3 (ожидание списка `_migrations`).

### 14. [MINOR] Task 21 Consumes (E-client, task-21.md) vs Task 7 Step 3 (B-server, POST /api/invites/:token/accept)

**Проблема:** Task 21 Consumes утверждает: «legacy project-токен: оба (workspaceId и projectId)». Сервер (Task 7) для легаси-токена возвращает ТОЛЬКО `{ projectId }` (AcceptProjectInvite отдаёт { projectId }, workspaceId в ответ не попадает). Клиентский код это переживает (`res.workspaceId ?? null`), но описание контракта в задаче неверно и провоцирует написать код/тест, ожидающий workspaceId у легаси-ветки.

**Правка:** В task-21.md Consumes заменить строку на: «POST /api/invites/:token/accept → 200: ws-инвайт → { workspaceId }; legacy project-токен → { projectId } (workspaceId в ответе отсутствует, клиент маппит в null)».

### 15. [MINOR] Task 12 Step 8.2 — server/src/application/task/TaskDelegationRepository.ts:17 (CreateDelegationInput.revertToUserId) + Task 11 Step 16 (insert в DrizzleTaskDelegationRepository.create)

**Проблема:** Спека §4 удаляет «revert_to_user_id-логику», Task 25 Step 7 ожидает revertToUserId только в schema.ts, domain-типе и toDomain-маппинге. Но поле `readonly revertToUserId?: string | null;` в CreateDelegationInput ни одна задача не удаляет (единственный писатель — InviteAndDelegateTask — удаляется в Task 12), а Task 11 Step 16 сознательно ОСТАВЛЯЕТ `revertToUserId: input.revertToUserId ?? null` в insert. Grep-свип Task 25 найдёт порт-файл как «дефект» и уйдёт в импровизированный Step 8.

**Правка:** В Task 12 Step 8.2 добавить пункт: удалить поле `revertToUserId` (с комментарием) из `CreateDelegationInput` в server/src/application/task/TaskDelegationRepository.ts. И в DrizzleTaskDelegationRepository.create заменить строку insert на `revertToUserId: null,` (или убрать колонку из values). Тогда ожидание Task 25 Step 7 выполняется по построению.

### 16. [MINOR] Task 22 (или Task 24 Step 2) — client/src/domain/chat/ChatRoom.ts:13

**Проблема:** Клиентский тип `ChatRoom.role: 'owner' | 'member'` — зеркало серверного ChatRoomSummary.role, который Task 1 меняет на WorkspaceRole ('owner'|'editor'|'viewer'). Ни одна клиентская задача этот файл не трогает; tsc не поймает (самостоятельный литеральный union, сервер начнёт присылать 'editor'/'viewer' в поле типа 'member'). Runtime-логика не ломается (WorkspaceChatPanel проверяет только === 'owner'), но тип станет враньём.

**Правка:** В Task 22 Step 1 добавить вторую правку: в client/src/domain/chat/ChatRoom.ts строка 13:
```ts
  readonly role: 'owner' | 'editor' | 'viewer';
```
(и файл в git add коммита Task 22).

### 17. [MINOR] Task 25 (секция F) — отсутствует шаг ультракод-ревью из спеки §8

**Проблема:** Спека §8 явно требует: «серверные интеграционные точки — ультракод-ревью (многоагентная проверка всех затронутых мест: чат, уведомления, „делегировано", TG, дайджесты, EOD, пикеры, меншены) перед коммитом». В Task 25 есть только тесты/typecheck/lint/grep-свипы — ревью-шага нет ни в одной задаче. Особенно важно для дайджестов/EOD/пикеров/меншенов, у которых по плану НЕТ собственных задач (спека полагается, что переписанный репозиторий Task 4 их «бесплатно» обслуживает — это как раз то, что должно проверить ревью).

**Правка:** В Task 25 добавить Step 7.5 (перед коммитом фиксов): запустить skill `code-review` на уровне high/ultra по диффу ветки с фокус-списком: server/src/application/{chat,digest,eod,notifications}, DispatchChatMentionNotifications, buildTaskDigest/SendDailyDigest (members.length>1 и получатели теперь ws-участники), ListTasksDelegatedToOthers, listSharedUsers-потребители (пикеры/меншены). Найденные дефекты чинить по процедуре Step 8.

### 18. [MINOR] Task 26 Step 7, пункт 5 (ручная TG-проверка делегирования)

**Проблема:** Чек-лист обещает: «делегировать задачу привязанному юзеру → TG-уведомление приходит». Проверено по коду: TG-карточка «вам поручена задача» отправляется ТОЛЬКО из TelegramComposerService (kind 'task_delegation' в sendNotification); web-путь (DelegateExistingTask.notifyDelegated) шлёт только in-app + email, TG-моста нет, и план его не добавляет. Если юзер делегирует из веб-интерфейса — TG-сообщение не придёт, и пункт будет ошибочно засчитан как прод-дефект.

**Правка:** В Task 26 Step 7.5 уточнить сценарий: «делегировать через TG-композер: в личке бота отправить `+Проект текст @имя_привязанного` → делегату приходит карточка без Принять/Отказать, с ✅ Завершить / 💬 Комментировать / Открыть». Если владелец хочет TG-канал и для веб-делегирований — это отдельное решение (добавить tgSend-порт в DelegateExistingTask/ReassignTaskDelegation), зафиксировать как follow-up, не как критерий этой верификации.

### 19. [MINOR] Task 23 (E-client) — все ссылки на строки AssignedToMeBlock.tsx

**Проблема:** Номера строк систематически устарели на +40…+60: `resolve` на 300 (план: 259–282), `inviteFlow` на 483 (441–444), `confirmInvite` на 540 (496–513), `pendingCount` на 644–647 (603–606), JSX InviteToDelegateDialog на ~905–909 (855–860), компонент InviteToDelegateDialog на 1266 (1208), PendingCard на 1769 (1712), деструктуризация useProjectsContext на 216 (174–177), resolvingIds на 231 (188). Сами символы существуют и уникальны — задача исполнима, но исполнитель, режущий по номерам строк, порежет не то.

**Правка:** Добавить в шапку Task 23 part 2 примечание: «Номера строк ориентировочные — файл уехал; якориться ТОЛЬКО по именам символов (isAwaitingResponse, resolve, resolvingIds, inviteFlow, confirmInvite, pendingCount/pendingWord, InviteToDelegateDialog, PendingCard) через Grep, не по номерам строк».

### 20. [MINOR] Task 5 (B-server) Step 1–2 vs Task 2 Steps 3–4 — дублирование WorkspaceInvite.ts и workspaceInvites в schema.ts

**Проблема:** Task 2 уже создаёт server/src/domain/workspace/WorkspaceInvite.ts и добавляет таблицу workspaceInvites в schema.ts (с `.default('editor')`). Task 5 Step 2 предусматривает пропуск для schema.ts («если уже добавлена — сверить и пропустить»), но Step 1 велит «Создать WorkspaceInvite.ts» безусловно (Write упадёт или перезапишет файл с другими комментариями), а fallback-вариант схемы в Task 5 отличается: `role: mysqlEnum(...).notNull()` без `.default('editor')` — расхождение с миграцией db/111 (DEFAULT 'editor').

**Правка:** В Task 5 Step 1 добавить оговорку: «Файл уже создан Task 2 (Секция A) — сверить содержимое и пропустить создание; тип и поля идентичны». В fallback-блоке Step 2 заменить строку role на `role: mysqlEnum('role', ['editor', 'viewer']).notNull().default('editor'),` — синхронно с миграцией 111 и версией Task 2.

### 21. [MINOR] Task 10 (B-server) Step 6 — команда коммита

**Проблема:** `git add -u server/src` стейджит ВСЕ изменённые/удалённые tracked-файлы под server/src, а не только удаления из Steps 2–3 — при незакоммиченных хвостах от параллельной работы в том же worktree в коммит попадёт лишнее (правило репо: только явные пути; git add -A/-u по каталогу — тот же класс риска).

**Правка:** Заменить на явные пути (удаления после git rm уже в индексе):
```
git add server/src/index.ts  # только если Step 1 находил и чинил хвосты
git commit -m "chore(workspace): удалены легаси use-cases project-инвайтов и их email-шаблон — приглашения только в пространство, старые токены работают через dual-резолв"
```
Если Step 1 ничего не находил — коммитить только застейдженные git rm-удаления, без git add вовсе.

### 22. [MINOR] Task 22 (E-client) Step 4 п.2 — рендер InvitesCard в WorkspaceSettingsPage

**Проблема:** План вставляет `{isOwner && <InvitesCard .../>}` после MembersCard (строка 86), но соседние карточки управления командой гейтятся как `isOwner && !isDefault` (строка 88 фактического файла): для дефолт-хаба (kind='default', members auto-managed) появится карточка инвайтов, хотя ручное управление командой там скрыто — несогласованность UI (возможно намеренная в единой модели, но план это не проговаривает).

**Правка:** Либо явно зафиксировать намерение в плане («инвайты доступны и для default-хаба — это личное пространство, приглашение в него легально»), либо согласовать с соседним гейтом: `{isOwner && !isDefault && <InvitesCard workspaceId={workspace.id} />}`.

---

## Секция A — БД, схема, доменные типы (Task 1–3)

## Секция A: Миграции БД + Drizzle schema + доменные типы (Task 1 — Task 3)

### Task 1: Роли пространства owner/editor/viewer (миграция 110 + schema + домен + ripple)

**Files:**
- Create: `db/110_workspace_member_roles.sql`
- Modify: `server/src/infrastructure/db/schema.ts` (строка 351)
- Modify: `server/src/domain/workspace/WorkspaceMember.ts` (строка 1)
- Modify: `server/src/application/workspace/WorkspaceService.ts` (строки 118, 138–139, 182–185)
- Modify: `server/src/presentation/workspaces/schemas.ts` (строки 19, 23)
- Modify: `server/src/presentation/workspaces/routes.ts` (строки 5, 22, 49, 144)
- Modify: `server/src/application/workspace/HubMembershipSync.ts` (строки 21–25, 43)
- Modify: `server/src/application/chat/ChatRepository.ts` (строки 4, 14)
- Modify: `server/src/application/chat/ChatService.ts` (строки 2, 66)
- Test: `server/src/application/workspace/WorkspaceService.test.ts` (новый тест + строки 169, 187, 196, 205, 207)
- Test: `server/src/application/chat/ChatService.test.ts` (все `role: 'member'`)

**Interfaces:**
- Consumes: — (первая задача плана).
- Produces: `WorkspaceRole = 'owner' | 'editor' | 'viewer'` (server/src/domain/workspace/WorkspaceMember.ts); Drizzle-колонка `workspaceMembers.role: mysqlEnum('role', ['owner','editor','viewer']).notNull().default('editor')`; миграция `db/110_workspace_member_roles.sql`.

- [ ] **Step 1: Создать миграцию db/110_workspace_member_roles.sql.** Полное содержимое файла:
  ```sql
  -- 110: роли участников пространства: ENUM('owner','member') → ENUM('owner','editor','viewer').
  -- Существующие member → editor. Через промежуточный расширенный ENUM — MariaDB не умеет
  -- переименовать значение ENUM за один шаг без потери данных (сужение при живых 'member'
  -- в strict mode упало бы). Идемпотентно при повторном прогоне после частичного сбоя.
  -- См. docs/superpowers/specs/2026-07-13-unified-workspace-and-instant-delegation-design.md §3.1.

  ALTER TABLE workspace_members
    MODIFY COLUMN role ENUM('owner','member','editor','viewer') NOT NULL DEFAULT 'member';

  UPDATE workspace_members SET role = 'editor' WHERE role = 'member';

  ALTER TABLE workspace_members
    MODIFY COLUMN role ENUM('owner','editor','viewer') NOT NULL DEFAULT 'editor';
  ```
- [ ] **Step 2: Перечитать SQL на MariaDB-совместимость.** Чек-лист (локально миграции НЕ запускать — локальная БД сломана на 054, синтаксис проверит `scripts/migrate.mjs` на проде при деплое): (a) нет `INSERT ... AS new` (MariaDB не понимает); (b) UPDATE стоит СТРОГО между двумя ALTER — сужение ENUM при существующих `'member'`-строках упало бы в strict mode; (c) `MODIFY COLUMN` повторяет `NOT NULL` и `DEFAULT` (MariaDB перезаписывает определение колонки целиком); (d) точка с запятой после каждого стейтмента (файл multi-statement, как db/073).
- [ ] **Step 3: Написать падающий тест на новый guard понижения owner.** В `server/src/application/workspace/WorkspaceService.test.ts` после существующего теста `'changeMemberRole: demoting the last owner rejected'` (строка 188) добавить:
  ```ts
  test('changeMemberRole: demoting the last owner to viewer rejected', async () => {
    const { service } = makeFakes({
      workspaces: [{ id: 'w1', ownerUserId: 'u1' }],
      members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    });
    await assert.rejects(() => service.changeMemberRole('w1', 'u1', 'u1', 'viewer'), LastOwnerError);
  });
  ```
  (`LastOwnerError` уже импортирован в файле; tsx не типчекает, поэтому литерал `'viewer'` до смены типа выполнится.)
- [ ] **Step 4: Прогнать тест — убедиться, что падает.** Из каталога `c:\www\ProjectsFlow\server` выполнить:
  ```
  node --import tsx --test src/application/workspace/WorkspaceService.test.ts
  ```
  Ожидание: новый тест FAIL с `AssertionError ... Missing expected rejection (LastOwnerError)` — текущий guard в `changeMemberRole` проверяет `role === 'member'`, для `'viewer'` он не срабатывает и понижение проходит молча. Остальные тесты файла — PASS.
- [ ] **Step 5: Расширить доменный тип и Drizzle-схему.** В `server/src/domain/workspace/WorkspaceMember.ts` строка 1:
  ```ts
  export type WorkspaceRole = 'owner' | 'editor' | 'viewer';
  ```
  (было `'owner' | 'member'`). В `server/src/infrastructure/db/schema.ts` строка 351 внутри `workspaceMembers`:
  ```ts
      role: mysqlEnum('role', ['owner', 'editor', 'viewer']).notNull().default('editor'),
  ```
  (было `['owner', 'member']` / `.default('member')`).
- [ ] **Step 6: Минимальная реализация в WorkspaceService.** В `server/src/application/workspace/WorkspaceService.ts` три правки:
  1. Строка 118, дефолт роли в `addMember`:
  ```ts
      role: WorkspaceRole = 'editor',
  ```
  2. Строки 138–139, guard в `changeMemberRole` (комментарий + условие):
  ```ts
      // Понижение owner'а до editor/viewer: нельзя оставить пространство без владельца.
      if (target.role === 'owner' && role !== 'owner') {
  ```
  3. Строка 185 в `moveProject` (цикл копирования участников удалит другая задача плана — здесь только чиним литерал):
  ```ts
        await this.deps.repo.addMember(targetWorkspaceId, m.userId, 'editor');
  ```
- [ ] **Step 7: Прогнать тест — новый guard зелёный.** Из `c:\www\ProjectsFlow\server`:
  ```
  node --import tsx --test src/application/workspace/WorkspaceService.test.ts
  ```
  Ожидание: тест `'changeMemberRole: demoting the last owner to viewer rejected'` — PASS. Тесты со старым литералом `'member'` теперь падают (runtime-поведение `addMember` изменилось только в дефолте — но литералы чинятся в Step 8).
- [ ] **Step 8: Обновить литералы `'member'` в двух тест-файлах.** В `server/src/application/workspace/WorkspaceService.test.ts` пять правок:
  - строка 169: `{ workspaceId: 'w1', userId: 'u2', role: 'member' }` → `{ workspaceId: 'w1', userId: 'u2', role: 'editor' }`
  - строка 187: `service.changeMemberRole('w1', 'u1', 'u1', 'member')` → `service.changeMemberRole('w1', 'u1', 'u1', 'editor')`
  - строка 196: `service.addMember('w1', 'u1', 'nobody@x', 'member')` → `service.addMember('w1', 'u1', 'nobody@x', 'editor')`
  - строка 205: `service.addMember('w1', 'u1', 'u2@x', 'member')` → `service.addMember('w1', 'u1', 'u2@x', 'editor')`
  - строка 207: `assert.equal((await repo.getMembership('w1', 'u2'))?.role, 'member');` → `assert.equal((await repo.getMembership('w1', 'u2'))?.role, 'editor');`

  В `server/src/application/chat/ChatService.test.ts` заменить ВСЕ вхождения `role: 'member'` → `role: 'editor'` (11 мест: строки 150, 159, 164, 170, 181, 193, 207, 218, 227, 243, 275; других `'member'` в файле нет — сиды типизированы через `WorkspaceRole`, без правки не скомпилируются).
- [ ] **Step 9: Обновить остальные compile-зависимые места (zod-схемы, DTO, HubMembershipSync, чат).**
  1. `server/src/presentation/workspaces/schemas.ts` строки 19 и 23:
  ```ts
    role: z.enum(['owner', 'editor', 'viewer']).optional(),
  ```
  ```ts
    role: z.enum(['owner', 'editor', 'viewer']),
  ```
  2. `server/src/presentation/workspaces/routes.ts` — строка 5, импорт:
  ```ts
  import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
  ```
  строка 22 (тип `WorkspaceDto`): `role?: 'owner' | 'member';` → `role?: WorkspaceRole;`
  строка 49 (возврат `memberToDto`): `role: 'owner' | 'member';` → `role: WorkspaceRole;`
  строка 144: `body.role ?? 'member'` → `body.role ?? 'editor'`
  3. `server/src/application/workspace/HubMembershipSync.ts` — добавить в начало файла (после блока комментария, перед `type ProjectsPort`):
  ```ts
  import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
  ```
  строка 23: `addMember(workspaceId: string, userId: string, role: 'owner' | 'member'): Promise<void>;` → `addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;`
  строка 43: `await this.deps.workspaces.addMember(hubId, userId, 'member'); // идемпотентно` → `await this.deps.workspaces.addMember(hubId, userId, 'editor'); // идемпотентно`
  (сам `HubMembershipSync` удаляется другой задачей плана — здесь только сохраняем компиляцию).
  4. `server/src/application/chat/ChatRepository.ts` — строка 4, после импорта `WorkspaceKind` добавить:
  ```ts
  import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
  ```
  строка 14 (в `ChatRoomRow`): `readonly role: 'owner' | 'member';` → `readonly role: WorkspaceRole;`
  5. `server/src/application/chat/ChatService.ts` — строка 2, импорт:
  ```ts
  import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
  ```
  строка 66 (в `ChatRoomSummary`): `readonly role: 'owner' | 'member';` → `readonly role: WorkspaceRole;`
- [ ] **Step 10: Полная проверка — тесты обоих затронутых модулей + tsc.** Из `c:\www\ProjectsFlow\server`:
  ```
  node --import tsx --test src/application/workspace/WorkspaceService.test.ts src/application/chat/ChatService.test.ts
  ```
  Ожидание: все PASS. Затем из корня `c:\www\ProjectsFlow`:
  ```
  npm run build -w @projectsflow/server
  ```
  Ожидание: tsc без ошибок (это и есть серверный typecheck; `npm run typecheck` из корня гоняет только клиент — клиентский `WorkspaceRole` правит клиентская секция плана).
- [ ] **Step 11: Commit.**
  ```
  git add db/110_workspace_member_roles.sql server/src/infrastructure/db/schema.ts server/src/domain/workspace/WorkspaceMember.ts server/src/application/workspace/WorkspaceService.ts server/src/application/workspace/WorkspaceService.test.ts server/src/presentation/workspaces/schemas.ts server/src/presentation/workspaces/routes.ts server/src/application/workspace/HubMembershipSync.ts server/src/application/chat/ChatRepository.ts server/src/application/chat/ChatService.ts server/src/application/chat/ChatService.test.ts && git commit -m "feat(workspace): роли пространства owner/editor/viewer — миграция 110, WorkspaceRole, member→editor по всем слоям"
  ```

---

### Task 2: Таблица workspace_invites (миграция 111 + schema + домен)

**Files:**
- Create: `db/111_workspace_invites.sql`
- Create: `server/src/domain/workspace/WorkspaceInvite.ts`
- Modify: `server/src/infrastructure/db/schema.ts` (после строки 361 — `export type NewWorkspaceMemberRow ...`)

**Interfaces:**
- Consumes: — (независима от Task 1; трогает тот же schema.ts — выполнять после Task 1, чтобы не конфликтовать по файлу).
- Produces: Drizzle-таблица `workspaceInvites` + типы `WorkspaceInviteRow`/`NewWorkspaceInviteRow` (server/src/infrastructure/db/schema.ts); доменные типы `WorkspaceInviteRole = 'editor' | 'viewer'` и `WorkspaceInvite` (server/src/domain/workspace/WorkspaceInvite.ts); миграция `db/111_workspace_invites.sql`. Их потребляют use-cases приглашений (`CreateWorkspaceInvite`/`AcceptWorkspaceInvite`/`GetInviteByToken` и Drizzle-репозиторий) из серверной секции плана.

- [ ] **Step 1: Создать миграцию db/111_workspace_invites.sql.** Зеркало `db/011_project_invites.sql` + FK CASCADE на workspaces. Полное содержимое файла:
  ```sql
  -- 111: invite-ссылки в ПРОСТРАНСТВА (замена per-project приглашений). Один токен =
  -- одноразовый, TTL 7 дней (см. CreateWorkspaceInvite use-case). Зеркало project_invites
  -- (db/011); project_invites замораживается — новые не создаются, старые токены
  -- продолжают работать (accept зачисляет в пространство проекта, код-адаптация).
  -- email — информационное «для кого предназначался», mismatch НЕ блокирует accept.
  -- См. docs/superpowers/specs/2026-07-13-unified-workspace-and-instant-delegation-design.md §3.1.

  CREATE TABLE IF NOT EXISTS workspace_invites (
    id                   CHAR(36)     NOT NULL,
    workspace_id         CHAR(36)     NOT NULL,
    role                 ENUM('editor','viewer') NOT NULL DEFAULT 'editor',
    -- 32-byte hex (как project_invites.token). UNIQUE — security-критично.
    token                CHAR(64)     NOT NULL,
    email                VARCHAR(255) NULL,
    expires_at           TIMESTAMP    NOT NULL,
    accepted_at          TIMESTAMP    NULL,
    accepted_by_user_id  CHAR(36)     NULL,
    created_by_user_id   CHAR(36)     NOT NULL,
    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ws_invites_token (token),
    KEY idx_ws_invites_workspace (workspace_id),
    KEY idx_ws_invites_expires (expires_at),
    CONSTRAINT fk_ws_invites_workspace FOREIGN KEY (workspace_id)
      REFERENCES workspaces(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  ```
- [ ] **Step 2: Перечитать SQL на MariaDB-совместимость.** Чек-лист (локально НЕ запускать — локальная БД сломана на 054, прогонит `scripts/migrate.mjs` на проде): (a) `CREATE TABLE IF NOT EXISTS` — идемпотентно при повторном прогоне; (b) кодировка/ENGINE как у остальных таблиц (`utf8mb4_unicode_ci`, InnoDB); (c) FK только на `workspace_id` (accepted_by/created_by БЕЗ FK — зеркало project_invites, где их тоже нет); (d) нет `INSERT ... AS new`.
- [ ] **Step 3: Добавить таблицу в Drizzle-схему.** В `server/src/infrastructure/db/schema.ts` сразу после блока (строки ~360–361):
  ```ts
  export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
  export type NewWorkspaceMemberRow = typeof workspaceMembers.$inferInsert;
  ```
  вставить:
  ```ts

  // Invite-ссылки в пространство (db/111) — замена per-project приглашений. Токен одноразовый,
  // TTL 7 дней; email — информационное поле, mismatch не блокирует accept.
  export const workspaceInvites = mysqlTable(
    'workspace_invites',
    {
      id: id(),
      workspaceId: char('workspace_id', { length: 36 }).notNull(),
      role: mysqlEnum('role', ['editor', 'viewer']).notNull().default('editor'),
      token: char('token', { length: 64 }).notNull(),
      email: varchar('email', { length: 255 }),
      expiresAt: timestamp('expires_at').notNull(),
      acceptedAt: timestamp('accepted_at'),
      acceptedByUserId: char('accepted_by_user_id', { length: 36 }),
      createdByUserId: char('created_by_user_id', { length: 36 }).notNull(),
      createdAt: createdAtCol(),
    },
    (t) => [
      uniqueIndex('uq_ws_invites_token').on(t.token),
      index('idx_ws_invites_workspace').on(t.workspaceId),
      index('idx_ws_invites_expires').on(t.expiresAt),
    ],
  );

  export type WorkspaceInviteRow = typeof workspaceInvites.$inferSelect;
  export type NewWorkspaceInviteRow = typeof workspaceInvites.$inferInsert;
  ```
  (все хелперы — `id()`, `createdAtCol()`, `mysqlEnum`, `char`, `varchar`, `timestamp`, `uniqueIndex`, `index` — уже импортированы в schema.ts, ими пользуется `projectInvites`.)
- [ ] **Step 4: Создать доменный тип.** Новый файл `server/src/domain/workspace/WorkspaceInvite.ts` (зеркало `server/src/domain/project/ProjectInvite.ts`):
  ```ts
  // Роли, которые можно выдавать через workspace-invite. Owner НЕ через invite —
  // владение пространством передаётся отдельно (управление командой пространства).
  export type WorkspaceInviteRole = 'editor' | 'viewer';

  export type WorkspaceInvite = {
    readonly id: string;
    readonly workspaceId: string;
    readonly role: WorkspaceInviteRole;
    // 32-byte hex (64 char'а). Наружу отдаётся только в момент создания и владельцу.
    readonly token: string;
    readonly email: string | null;
    readonly expiresAt: Date;
    readonly acceptedAt: Date | null;
    readonly acceptedByUserId: string | null;
    readonly createdByUserId: string;
    readonly createdAt: Date;
  };
  ```
- [ ] **Step 5: Серверный typecheck.** Из корня `c:\www\ProjectsFlow`:
  ```
  npm run build -w @projectsflow/server
  ```
  Ожидание: tsc без ошибок (новые декларации ни на что не влияют).
- [ ] **Step 6: Commit.**
  ```
  git add db/111_workspace_invites.sql server/src/infrastructure/db/schema.ts server/src/domain/workspace/WorkspaceInvite.ts && git commit -m "feat(workspace): таблица workspace_invites — миграция 111, Drizzle-схема, домен WorkspaceInvite"
  ```

---

### Task 3: Бэкфилл единого членства + делегации pending→accepted (миграция 112)

**Files:**
- Create: `db/112_unified_membership_backfill.sql`

**Interfaces:**
- Consumes: миграцию `db/110_workspace_member_roles.sql` из Task 1 (значения `'editor'`/`'viewer'` в ENUM `workspace_members.role` обязаны существовать до INSERT'ов ниже — порядок гарантирован нумерацией 110 < 112).
- Produces: миграция `db/112_unified_membership_backfill.sql` (данные; на неё опираются переписанный `DrizzleProjectMemberRepository` и удаление accept/decline-флоу из других секций плана).

- [ ] **Step 1: Создать миграцию db/112_unified_membership_backfill.sql.** Полное содержимое файла:
  ```sql
  -- 112: бэкфилл единого членства + мгновенное делегирование.
  -- 1) Участники не-inbox проектов становятся участниками ПРОСТРАНСТВ этих проектов —
  --    workspace_members отныне единственный источник доступа (спека §3.1/§3.2).
  --    INSERT IGNORE: существующие членства (включая owner'ов пространств) НЕ трогаются
  --    и НЕ понижаются; повторный прогон после частичного сбоя безопасен.
  -- 2) Все ждущие делегации (pending / pending_invite) становятся принятыми — accept/decline
  --    флоу выпилен (спека §4). ENUM статусов НЕ сужаем: старые значения остаются историей.
  -- См. docs/superpowers/specs/2026-07-13-unified-workspace-and-instant-delegation-design.md §7.

  -- Владельцы пространств: гарантируем owner-членство до основного бэкфилла
  -- (идемпотентно, паттерн db/073/db/079) — «последний owner» не может быть понижен,
  -- т.к. INSERT IGNORE не перезаписывает существующую строку.
  INSERT IGNORE INTO workspace_members (workspace_id, user_id, role)
  SELECT w.id, w.owner_user_id, 'owner'
    FROM workspaces w;

  -- Участник любого не-inbox проекта P → участник пространства P. Роль — высшая из его
  -- проектных ролей в проектах этого пространства: owner/editor проекта → editor
  -- пространства (owner проекта, не являющийся owner_user_id пространства, получает
  -- editor — спека §7.3), только viewer'ские роли → viewer.
  -- pm.role IN ('owner','editor') — булево 1/0, MAX по группе = «есть хоть одна ≥ editor».
  INSERT IGNORE INTO workspace_members (workspace_id, user_id, role)
  SELECT p.workspace_id,
         pm.user_id,
         CASE WHEN MAX(pm.role IN ('owner','editor')) = 1 THEN 'editor' ELSE 'viewer' END
    FROM project_members pm
    JOIN projects p ON p.id = pm.project_id
   WHERE p.is_inbox = 0
   GROUP BY p.workspace_id, pm.user_id;

  -- Делегирование без принятия: всё «ждущее ответа» считается принятым.
  -- responded_at присваивается ДО status (SET исполняется слева направо) и только там,
  -- где его ещё не было.
  UPDATE task_delegations
     SET responded_at = COALESCE(responded_at, NOW()),
         status = 'accepted'
   WHERE status IN ('pending','pending_invite');
  ```
- [ ] **Step 2: Перечитать SQL на MariaDB-совместимость.** Чек-лист (локально НЕ запускать — локальная БД сломана на 054; синтаксис прогонит `scripts/migrate.mjs` на проде при деплое): (a) нет `INSERT ... AS new` — только `INSERT IGNORE ... SELECT`; (b) `MAX(<булево выражение>)` по группе — валидный MariaDB-паттерн (булево = 1/0); (c) сравнение ENUM `pm.role IN ('owner','editor')` идёт по строковым значениям — корректно для `project_members.role ENUM('owner','editor','viewer')`; (d) `GROUP BY p.workspace_id, pm.user_id` покрывает все не-агрегатные колонки SELECT (ONLY_FULL_GROUP_BY-safe); (e) обе INSERT-цели удовлетворяют FK `workspace_members` (`p.workspace_id` NOT NULL FK на workspaces; `pm.user_id` FK на users); (f) UPDATE идемпотентен — повторный прогон найдёт 0 строк `pending/pending_invite`; (g) порядок стейтментов: owner'ы → бэкфилл участников → делегации.
- [ ] **Step 3: Проверить, что нумерация не уехала.** Выполнить из корня `c:\www\ProjectsFlow`:
  ```
  Get-ChildItem db\1*.sql | Sort-Object Name | Select-Object -Last 5
  ```
  Ожидание: последние файлы — `109_task_properties.sql`, `110_workspace_member_roles.sql` (Task 1), `111_workspace_invites.sql` (Task 2), `112_unified_membership_backfill.sql` (этот файл). Если параллельно в main въехала чужая миграция с этими номерами — переименовать свои файлы на следующие свободные номера (append-only, коллизии номеров недопустимы).
- [ ] **Step 4: Commit.**
  ```
  git add db/112_unified_membership_backfill.sql && git commit -m "feat(workspace): бэкфилл членства пространств из project_members + делегации pending→accepted — миграция 112"
  ```

---

## Секции B–E — сервер, делегирование, Telegram, клиент (Task 4–24)

### Task 4: DrizzleProjectMemberRepository — членство «насквозь» через workspace_members

**Files:**
- Create: `server/src/infrastructure/repositories/workspaceMembershipView.ts`
- Test (create): `server/src/infrastructure/repositories/workspaceMembershipView.test.ts`
- Modify: `server/src/infrastructure/repositories/DrizzleProjectMemberRepository.ts` (полная перезапись, сейчас 315 строк)

**Interfaces:**
- Consumes (из Секции A, задачи миграций/схемы — должны быть уже в main):
  - `server/src/infrastructure/db/schema.ts`: `workspaceMembers.role: mysqlEnum('role', ['owner','editor','viewer'])` (расширенный ENUM, миграция db/110);
  - `server/src/domain/workspace/WorkspaceMember.ts`: `export type WorkspaceRole = 'owner' | 'editor' | 'viewer'`;
  - существующие таблицы `projects` (`workspaceId`, `ownerId`, `isInbox`, `createdAt`), `projectMembers`, `users`, `workspaceMembers` из `schema.ts`.
- Produces:
  - `workspaceMembershipView.ts`: `ProjectAccessRow`, `WorkspaceMemberAccessRow`, `deriveMembership(project, userId, wsMember): ProjectMembership | null`, `deriveProjectMembers(project, wsMembers): ProjectMembership[]`, `deriveOwnersCount(project, wsOwnerCount): number`;
  - переписанный `DrizzleProjectMemberRepository` — интерфейс `ProjectMemberRepository` НЕ меняется (спека §3.2), меняется только источник данных.

Контекст: `project_members` больше НЕ источник доступа — только ленивое хранилище per-member настроек (`notification_prefs`, `sort_order`, `is_favorite`, `favorite_sort_order`). Доступ = `projects.workspace_id → workspace_members`, роль маппится 1:1. Инвариант: для `is_inbox=true` «участник» ровно один — владелец проекта (`projects.owner_id`), роль `owner`, независимо от состава пространства.

- [ ] **Step 1: падающий тест на чистые функции membership-вью.** Создать файл `server/src/infrastructure/repositories/workspaceMembershipView.test.ts` целиком:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveMembership,
  deriveProjectMembers,
  deriveOwnersCount,
  type ProjectAccessRow,
  type WorkspaceMemberAccessRow,
} from './workspaceMembershipView.js';

const PROJECT_CREATED = new Date('2026-01-01T00:00:00Z');
const WM_CREATED = new Date('2026-02-02T00:00:00Z');

function proj(over: Partial<ProjectAccessRow> = {}): ProjectAccessRow {
  return {
    id: 'p1',
    workspaceId: 'w1',
    ownerId: 'u-owner',
    isInbox: false,
    createdAt: PROJECT_CREATED,
    ...over,
  };
}

function wm(userId: string, role: WorkspaceMemberAccessRow['role']): WorkspaceMemberAccessRow {
  return { userId, role, createdAt: WM_CREATED };
}

test('deriveMembership: ws-роль маппится 1:1 в роль проекта', () => {
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    const m = deriveMembership(proj(), 'u2', wm('u2', role));
    assert.deepEqual(m, { projectId: 'p1', userId: 'u2', role, joinedAt: WM_CREATED });
  }
});

test('deriveMembership: не участник пространства → null', () => {
  assert.equal(deriveMembership(proj(), 'u2', null), null);
});

test('deriveMembership: inbox — владелец всегда owner, даже без ws-строки', () => {
  const m = deriveMembership(proj({ isInbox: true }), 'u-owner', null);
  assert.deepEqual(m, {
    projectId: 'p1',
    userId: 'u-owner',
    role: 'owner',
    joinedAt: PROJECT_CREATED,
  });
});

test('deriveMembership: inbox — участник пространства НЕ владелец → null (приватность Входящих)', () => {
  assert.equal(deriveMembership(proj({ isInbox: true }), 'u2', wm('u2', 'owner')), null);
});

test('deriveProjectMembers: обычный проект — все участники пространства с их ролями', () => {
  const list = deriveProjectMembers(proj(), [wm('u-owner', 'owner'), wm('u2', 'editor'), wm('u3', 'viewer')]);
  assert.deepEqual(
    list.map((m) => [m.userId, m.role]),
    [['u-owner', 'owner'], ['u2', 'editor'], ['u3', 'viewer']],
  );
});

test('deriveProjectMembers: inbox — ровно один участник (владелец), остальные отброшены', () => {
  const list = deriveProjectMembers(proj({ isInbox: true }), [wm('u-owner', 'editor'), wm('u2', 'owner')]);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], {
    projectId: 'p1',
    userId: 'u-owner',
    role: 'owner',
    joinedAt: WM_CREATED, // joinedAt владельца берётся из его ws-строки, если есть
  });
});

test('deriveProjectMembers: inbox без ws-строки владельца — joinedAt = createdAt проекта', () => {
  const list = deriveProjectMembers(proj({ isInbox: true }), []);
  assert.deepEqual(list, [
    { projectId: 'p1', userId: 'u-owner', role: 'owner', joinedAt: PROJECT_CREATED },
  ]);
});

test('deriveOwnersCount: inbox всегда 1, иначе — счётчик ws-owner-ов', () => {
  assert.equal(deriveOwnersCount({ isInbox: true }, 5), 1);
  assert.equal(deriveOwnersCount({ isInbox: false }, 2), 2);
  assert.equal(deriveOwnersCount({ isInbox: false }, 0), 0);
});
```

- [ ] **Step 2: убедиться, что тест падает.** Из `c:/www/ProjectsFlow/server` выполнить:
  `node --import tsx --test src/infrastructure/repositories/workspaceMembershipView.test.ts`
  Ожидаемо: ошибка `Cannot find module ... workspaceMembershipView.js` (модуля ещё нет).

- [ ] **Step 3: реализация чистого модуля.** Создать `server/src/infrastructure/repositories/workspaceMembershipView.ts` целиком:

```ts
// Чистая логика «членство проекта через пространство» (спека unified-workspace §3.2).
// Вынесена из DrizzleProjectMemberRepository, чтобы инвариант приватности Входящих
// был покрыт unit-тестами без реальной БД.
import type { ProjectMembership, ProjectRole } from '../../domain/project/ProjectMembership.js';

// Минимальный срез строки projects, нужный для резолва доступа.
export type ProjectAccessRow = {
  readonly id: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly isInbox: boolean;
  readonly createdAt: Date;
};

// Строка workspace_members. Роль маппится в роль проекта 1:1 (owner→owner и т.д.).
export type WorkspaceMemberAccessRow = {
  readonly userId: string;
  readonly role: ProjectRole;
  readonly createdAt: Date;
};

/**
 * Членство юзера в проекте, дериватив от членства в пространстве.
 * Инвариант приватности Входящих: is_inbox → доступ есть ТОЛЬКО у владельца
 * (projects.owner_id), роль всегда 'owner'. Делегаты видят отдельные inbox-задачи
 * через taskAuthorization, но НЕ через членство в проекте.
 */
export function deriveMembership(
  project: ProjectAccessRow,
  userId: string,
  wsMember: WorkspaceMemberAccessRow | null,
): ProjectMembership | null {
  if (project.isInbox) {
    if (project.ownerId !== userId) return null;
    return { projectId: project.id, userId, role: 'owner', joinedAt: project.createdAt };
  }
  if (!wsMember) return null;
  return {
    projectId: project.id,
    userId,
    role: wsMember.role,
    joinedAt: wsMember.createdAt,
  };
}

/** Список участников проекта: для inbox — только владелец; иначе все участники пространства. */
export function deriveProjectMembers(
  project: ProjectAccessRow,
  wsMembers: readonly WorkspaceMemberAccessRow[],
): ProjectMembership[] {
  if (project.isInbox) {
    const owner = wsMembers.find((m) => m.userId === project.ownerId);
    return [
      {
        projectId: project.id,
        userId: project.ownerId,
        role: 'owner',
        joinedAt: owner?.createdAt ?? project.createdAt,
      },
    ];
  }
  return wsMembers.map((m) => ({
    projectId: project.id,
    userId: m.userId,
    role: m.role,
    joinedAt: m.createdAt,
  }));
}

/** Owners проекта: inbox — всегда ровно 1 (владелец); иначе owners пространства. */
export function deriveOwnersCount(
  project: Pick<ProjectAccessRow, 'isInbox'>,
  wsOwnerCount: number,
): number {
  return project.isInbox ? 1 : wsOwnerCount;
}
```

- [ ] **Step 4: прогнать тест — PASS.** Из `c:/www/ProjectsFlow/server`:
  `node --import tsx --test src/infrastructure/repositories/workspaceMembershipView.test.ts`
  Все 8 тестов зелёные.

- [ ] **Step 5: commit.**
  `git add server/src/infrastructure/repositories/workspaceMembershipView.ts server/src/infrastructure/repositories/workspaceMembershipView.test.ts && git commit -m "feat(workspace): чистые функции membership-вью — доступ к проекту через пространство, инвариант приватности inbox"`

Продолжение (перезапись самого репозитория) — в `task-04-part2.md`.

### Task 4 (part 2): перезапись DrizzleProjectMemberRepository

Продолжение task-04.md. Шаги 1–5 (чистый модуль + тесты) уже сделаны.

- [ ] **Step 6: полная перезапись `server/src/infrastructure/repositories/DrizzleProjectMemberRepository.ts`.** Заменить ВСЁ содержимое файла на:

```ts
import { aliasedTable, and, asc, eq, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projectMembers,
  projects,
  users,
  workspaceMembers,
  type ProjectRow,
  type UserRow,
} from '../db/schema.js';
import type {
  ProjectMembership,
  ProjectRole,
} from '../../domain/project/ProjectMembership.js';
import type { Project, ProjectStatus } from '../../domain/project/Project.js';
import type { User } from '../../domain/user/User.js';
import type { NotificationPrefs } from '../../domain/notifications/NotificationPrefs.js';
import type {
  AddMemberInput,
  ProjectMemberRepository,
  ProjectMemberWithUser,
  ProjectWithRole,
  SharedUser,
} from '../../application/project/ProjectMemberRepository.js';
import { parseJsonCol } from './jsonCol.js';
import {
  deriveMembership,
  deriveOwnersCount,
  type ProjectAccessRow,
} from './workspaceMembershipView.js';

// Единое пространство (спека unified-workspace §3.2): доступ к проекту читается
// «насквозь» через projects.workspace_id → workspace_members (роль 1:1).
// project_members больше НЕ источник доступа — только ленивое хранилище
// per-member настроек (notification_prefs, sort_order, is_favorite,
// favorite_sort_order); строки создаются upsert-ом при первой записи настроек.
// Инвариант: is_inbox=true → единственный «участник» — владелец (role 'owner').

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? null,
    isAdmin: row.isAdmin,
    createdAt: row.createdAt,
  };
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    icon: row.icon ?? null,
    status: row.status as ProjectStatus,
    gitRepoUrl: row.gitRepoUrl ?? null,
    kbRepoFullName: row.kbRepoFullName ?? null,
    isInbox: row.isInbox,
    kbKind: row.kbKind,
    financeVisibility: row.financeVisibility,
    dispatcherUserId: row.dispatcherUserId ?? null,
    multiTaskWorker: row.multiTaskWorker,
    description: row.description ?? null,
    coverUrl: row.coverUrl ?? null,
    coverPosition: row.coverPosition,
    publicSlug: row.publicSlug ?? null,
    isPublic: row.isPublic,
    publicIndexing: row.publicIndexing,
    appRepoFullName: row.appRepoFullName ?? null,
    siteSlug: row.siteSlug ?? null,
    createdAt: row.createdAt,
  };
}

export class DrizzleProjectMemberRepository implements ProjectMemberRepository {
  constructor(private readonly db: Database) {}

  // Срез projects для резолва доступа (workspace_id/owner_id/is_inbox).
  private async getProjectAccessRow(projectId: string): Promise<ProjectAccessRow | null> {
    const rows = await this.db
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        ownerId: projects.ownerId,
        isInbox: projects.isInbox,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findForProject(projectId: string, userId: string): Promise<ProjectMembership | null> {
    const rows = await this.db
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        ownerId: projects.ownerId,
        isInbox: projects.isInbox,
        createdAt: projects.createdAt,
        wmRole: workspaceMembers.role,
        wmCreatedAt: workspaceMembers.createdAt,
      })
      .from(projects)
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, projects.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .where(eq(projects.id, projectId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    const wsMember =
      r.wmRole !== null && r.wmCreatedAt !== null
        ? { userId, role: r.wmRole as ProjectRole, createdAt: r.wmCreatedAt }
        : null;
    return deriveMembership(
      { id: r.id, workspaceId: r.workspaceId, ownerId: r.ownerId, isInbox: r.isInbox, createdAt: r.createdAt },
      userId,
      wsMember,
    );
  }

  async listByProject(projectId: string): Promise<ProjectMemberWithUser[]> {
    const project = await this.getProjectAccessRow(projectId);
    if (!project) return [];

    if (project.isInbox) {
      // Инвариант приватности: у Входящих единственный участник — владелец.
      const rows = await this.db
        .select({ user: users, prefs: projectMembers.notificationPrefs })
        .from(users)
        .leftJoin(
          projectMembers,
          and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, users.id)),
        )
        .where(eq(users.id, project.ownerId))
        .limit(1);
      const r = rows[0];
      if (!r) return [];
      return [
        {
          projectId,
          userId: project.ownerId,
          role: 'owner',
          joinedAt: project.createdAt,
          user: toUser(r.user),
          notificationPrefs: parseJsonCol<NotificationPrefs | null>(r.prefs, null),
        },
      ];
    }

    // Участники пространства проекта + их per-project prefs (ленивые строки — left join).
    const rows = await this.db
      .select({
        member: workspaceMembers,
        user: users,
        prefs: projectMembers.notificationPrefs,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .leftJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, workspaceMembers.userId),
        ),
      )
      .where(eq(workspaceMembers.workspaceId, project.workspaceId))
      .orderBy(asc(workspaceMembers.createdAt));
    return rows.map((r) => ({
      projectId,
      userId: r.member.userId,
      role: r.member.role as ProjectRole,
      joinedAt: r.member.createdAt,
      user: toUser(r.user),
      notificationPrefs: parseJsonCol<NotificationPrefs | null>(r.prefs, null),
    }));
  }

  async listProjectsForUser(userId: string): Promise<ProjectWithRole[]> {
    return this.listProjectsWhere(userId, undefined);
  }

  async listProjectsForUserInWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<ProjectWithRole[]> {
    return this.listProjectsWhere(userId, workspaceId);
  }

  // Проекты всех пространств, где юзер участник, + его собственные Входящие.
  // Чужие inbox отфильтровываются WHERE-условием (NOT is_inbox OR owner_id = me).
  // Per-member настройки — left join к ленивым строкам project_members.
  private async listProjectsWhere(
    userId: string,
    workspaceId: string | undefined,
  ): Promise<ProjectWithRole[]> {
    const inboxPrivacy = or(eq(projects.isInbox, false), eq(projects.ownerId, userId));
    const rows = await this.db
      .select({
        project: projects,
        wsRole: workspaceMembers.role,
        memberCount: sql<number>`(SELECT COUNT(*) FROM workspace_members wm2 WHERE wm2.workspace_id = ${projects.workspaceId})`,
        taskCount: sql<number>`(SELECT COUNT(*) FROM tasks t WHERE t.project_id = ${projects.id})`,
        isFavorite: projectMembers.isFavorite,
        favoriteSortOrder: projectMembers.favoriteSortOrder,
      })
      .from(projects)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, projects.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .leftJoin(
        projectMembers,
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
      )
      .where(
        workspaceId === undefined
          ? inboxPrivacy
          : and(inboxPrivacy, eq(projects.workspaceId, workspaceId)),
      )
      .orderBy(sql`COALESCE(${projectMembers.sortOrder}, 0)`, asc(projects.createdAt));
    return rows.map((r) => ({
      ...toProject(r.project),
      role: r.project.isInbox ? ('owner' as const) : (r.wsRole as ProjectRole),
      memberCount: r.project.isInbox ? 1 : Number(r.memberCount),
      taskCount: Number(r.taskCount),
      isFavorite: r.isFavorite ?? false,
      favoriteSortOrder: Number(r.favoriteSortOrder ?? 0),
    }));
  }

  async countOwners(projectId: string): Promise<number> {
    const project = await this.getProjectAccessRow(projectId);
    if (!project) return 0;
    if (project.isInbox) return deriveOwnersCount(project, 0);
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, project.workspaceId),
          eq(workspaceMembers.role, 'owner'),
        ),
      );
    return deriveOwnersCount(project, Number(rows[0]?.count ?? 0));
  }

  async isMemberOfAnyProjectOwnedBy(userId: string, ownerUserId: string): Promise<boolean> {
    // «Общий проект» = юзер состоит в пространстве, где есть не-inbox проект ownerUserId.
    const rows = await this.db
      .select({ one: sql<number>`1` })
      .from(workspaceMembers)
      .innerJoin(projects, eq(projects.workspaceId, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(projects.ownerId, ownerUserId),
          eq(projects.isInbox, false),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  // Легаси-запись в project_members: строка теперь лишь носитель per-member настроек,
  // доступ она НЕ даёт. Возвращаем синтетическое членство (findForProject мог бы вернуть
  // null, если юзер не в пространстве, — а add зовут и для «настроечных» строк).
  async add(input: AddMemberInput): Promise<ProjectMembership> {
    await this.db
      .insert(projectMembers)
      .values({ projectId: input.projectId, userId: input.userId, role: input.role })
      .onDuplicateKeyUpdate({ set: { role: input.role } });
    return {
      projectId: input.projectId,
      userId: input.userId,
      role: input.role,
      joinedAt: new Date(),
    };
  }

  async remove(projectId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async updateRole(
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<ProjectMembership | null> {
    // Роль в project_members — легаси; фактический доступ определяет пространство.
    await this.db
      .update(projectMembers)
      .set({ role })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    return this.findForProject(projectId, userId);
  }

  async getNotificationPrefs(
    projectId: string,
    userId: string,
  ): Promise<NotificationPrefs | null> {
    const rows = await this.db
      .select({ prefs: projectMembers.notificationPrefs })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    return parseJsonCol<NotificationPrefs | null>(rows[0]?.prefs, null);
  }

  // Ленивое создание строки настроек: у ws-участника может ещё не быть строки
  // в project_members — upsert. role в такой строке — placeholder, доступ не даёт.
  async setNotificationPrefs(
    projectId: string,
    userId: string,
    prefs: NotificationPrefs,
  ): Promise<void> {
    await this.db
      .insert(projectMembers)
      .values({ projectId, userId, role: 'editor', notificationPrefs: prefs })
      .onDuplicateKeyUpdate({ set: { notificationPrefs: prefs } });
  }

  async listSharedUsers(userId: string): Promise<SharedUser[]> {
    // Пул «знакомых» = участники общих ПРОСТРАНСТВ (спека §3.2). Self-join
    // workspace_members: wm1 — членства caller-а, wm2 — остальные участники тех же пространств.
    const wm1 = aliasedTable(workspaceMembers, 'wm1');
    const wm2 = aliasedTable(workspaceMembers, 'wm2');
    const rows = await this.db
      .selectDistinct({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(wm1)
      .innerJoin(wm2, eq(wm2.workspaceId, wm1.workspaceId))
      .innerJoin(users, eq(users.id, wm2.userId))
      .where(and(eq(wm1.userId, userId), ne(wm2.userId, userId)))
      .orderBy(asc(users.displayName));
    return rows;
  }

  async reorderForUser(userId: string, orderedIds: readonly string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    // Скоупим по реально доступным проектам (мусорный id от клиента не должен
    // создать строку с несуществующим project_id — FK упадёт).
    const accessible = new Set((await this.listProjectsForUser(userId)).map((p) => p.id));
    const ids = orderedIds.filter((id) => accessible.has(id));
    if (ids.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i += 1) {
        await tx
          .insert(projectMembers)
          .values({ projectId: ids[i]!, userId, role: 'editor', sortOrder: i })
          .onDuplicateKeyUpdate({ set: { sortOrder: i } });
      }
    });
  }

  async setFavorite(projectId: string, userId: string, favorite: boolean): Promise<void> {
    if (!favorite) {
      // Нет строки — и так не favorite: обычного UPDATE достаточно.
      await this.db
        .update(projectMembers)
        .set({ isFavorite: false })
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
      return;
    }
    // favorite=true: ленивый upsert строки + favorite_sort_order = MAX+1 одной транзакцией.
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ max: sql<number | null>`MAX(${projectMembers.favoriteSortOrder})` })
        .from(projectMembers)
        .where(
          and(eq(projectMembers.userId, userId), eq(projectMembers.isFavorite, true)),
        );
      const nextOrder = Number(rows[0]?.max ?? -1) + 1;
      await tx
        .insert(projectMembers)
        .values({
          projectId,
          userId,
          role: 'editor',
          isFavorite: true,
          favoriteSortOrder: nextOrder,
        })
        .onDuplicateKeyUpdate({ set: { isFavorite: true, favoriteSortOrder: nextOrder } });
    });
  }

  async reorderFavoritesForUser(userId: string, orderedIds: readonly string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    const accessible = new Set((await this.listProjectsForUser(userId)).map((p) => p.id));
    const ids = orderedIds.filter((id) => accessible.has(id));
    if (ids.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i += 1) {
        await tx
          .insert(projectMembers)
          .values({
            projectId: ids[i]!,
            userId,
            role: 'editor',
            isFavorite: true,
            favoriteSortOrder: i,
          })
          .onDuplicateKeyUpdate({ set: { favoriteSortOrder: i } });
      }
    });
  }
}
```

- [ ] **Step 7: компиляция сервера + прогон затронутых тестов.** Из `c:/www/ProjectsFlow/server`:
  1. `npx tsc -p tsconfig.json --noEmit` — 0 ошибок в изменённых файлах (если падают НЕ связанные с этой задачей файлы на роли `'member'` — это зона задач Секции A/Task 9, зафиксировать и не чинить здесь).
  2. `node --import tsx --test src/infrastructure/repositories/workspaceMembershipView.test.ts` — PASS.
  3. `npm test` (полный набор) — существующие тесты application-слоя не трогают Drizzle-класс (у них ручные фейки портов), регрессий быть не должно.

- [ ] **Step 8: commit.**
  `git add server/src/infrastructure/repositories/DrizzleProjectMemberRepository.ts && git commit -m "feat(workspace): DrizzleProjectMemberRepository читает членство через workspace_members — project_members остаётся только носителем per-member настроек (ленивые upsert-строки)"`

### Task 5: workspace-инвайты — домен, порт, Drizzle-репозиторий, email, use-cases

**Files:**
- Create: `server/src/domain/workspace/WorkspaceInvite.ts`
- Modify: `server/src/domain/workspace/errors.ts` (добавить 3 ошибки в конец файла)
- Modify: `server/src/infrastructure/db/schema.ts` (таблица `workspaceInvites`, если ещё не добавлена Секцией A)
- Create: `server/src/application/workspace/WorkspaceInviteRepository.ts`
- Create: `server/src/infrastructure/repositories/DrizzleWorkspaceInviteRepository.ts`
- Create: `server/src/application/notifications/emails/workspaceInviteEmail.ts`
- Modify: `server/src/domain/notifications/Notification.ts` (payload `workspace_invite`)
- Create: `server/src/application/workspace/CreateWorkspaceInvite.ts`, `AcceptWorkspaceInvite.ts`, `ListWorkspaceInvites.ts`, `DeleteWorkspaceInvite.ts`
- Test (create): `server/src/application/workspace/WorkspaceInvites.test.ts`
- Modify: `server/src/presentation/middleware/errorHandler.ts`

**Interfaces:**
- Consumes:
  - Секция A: миграция `db/111` `CREATE TABLE workspace_invites` (зеркало `project_invites`); `WorkspaceRole = 'owner'|'editor'|'viewer'`.
  - Существующие: `requireWorkspaceMember(repo, workspaceId, userId): Promise<WorkspaceMember>` из `application/workspace/workspaceAccess.ts`; `EmailMessage`/`EmailSender` из `application/notifications/EmailSender.ts`; паттерн `renderInviteEmail` из `emails/inviteEmail.ts`.
- Produces:
  - `WorkspaceInviteRole = 'editor' | 'viewer'`; тип `WorkspaceInvite`;
  - ошибки `WorkspaceInviteNotFoundError | WorkspaceInviteExpiredError | WorkspaceInviteAlreadyUsedError`;
  - `interface WorkspaceInviteRepository { create; getById; findByToken; listPendingByWorkspace(workspaceId, now); markAccepted; delete }`;
  - `class DrizzleWorkspaceInviteRepository implements WorkspaceInviteRepository` (constructor(db));
  - `renderWorkspaceInviteEmail(input: { to; workspaceName; actorDisplayName; role; acceptUrl }): EmailMessage`;
  - `WorkspaceInvitePayload` (`type: 'workspace_invite'`) в union `NotificationPayload`;
  - use-cases: `CreateWorkspaceInvite.execute({workspaceId, actorUserId, role, email}) → {invite}`; `AcceptWorkspaceInvite.execute(token, userId) → {workspaceId}`; `ListWorkspaceInvites.execute(workspaceId, actorUserId) → WorkspaceInvite[]`; `DeleteWorkspaceInvite.execute(workspaceId, actorUserId, inviteId) → void`.

- [ ] **Step 1: домен.** Создать `server/src/domain/workspace/WorkspaceInvite.ts`:

```ts
// Роли, выдаваемые через invite в пространство. Owner — только через смену роли
// владельцем (workspaces routes), не через токен.
export type WorkspaceInviteRole = 'editor' | 'viewer';

export type WorkspaceInvite = {
  readonly id: string;
  readonly workspaceId: string;
  readonly role: WorkspaceInviteRole;
  // 32-byte hex (64 символа), как у project_invites.
  readonly token: string;
  // Информационный email «для кого» — mismatch при accept разрешён (как у project-инвайтов).
  readonly email: string | null;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly acceptedByUserId: string | null;
  readonly createdByUserId: string;
  readonly createdAt: Date;
};
```

В конец `server/src/domain/workspace/errors.ts` добавить:

```ts
export class WorkspaceInviteNotFoundError extends Error {
  constructor() {
    super('Workspace invite not found');
    this.name = 'WorkspaceInviteNotFoundError';
  }
}

export class WorkspaceInviteExpiredError extends Error {
  constructor() {
    super('Workspace invite expired');
    this.name = 'WorkspaceInviteExpiredError';
  }
}

export class WorkspaceInviteAlreadyUsedError extends Error {
  constructor() {
    super('Workspace invite already used');
    this.name = 'WorkspaceInviteAlreadyUsedError';
  }
}
```

- [ ] **Step 2: schema.ts.** Открыть `server/src/infrastructure/db/schema.ts`, найти `export const projectInvites`. Если таблицы `workspaceInvites` в файле ещё НЕТ (Секция A могла добавить — тогда только сверить имена индексов с миграцией db/111 и пропустить шаг), добавить сразу после блока `projectInvites`:

```ts
// Приглашения в пространство (спека unified-workspace §3.1) — зеркало project_invites.
export const workspaceInvites = mysqlTable('workspace_invites', {
  id: id(),
  workspaceId: char('workspace_id', { length: 36 }).notNull(),
  role: mysqlEnum('role', ['editor', 'viewer']).notNull(),
  token: char('token', { length: 64 }).notNull(),
  email: varchar('email', { length: 255 }),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  acceptedByUserId: char('accepted_by_user_id', { length: 36 }),
  createdByUserId: char('created_by_user_id', { length: 36 }).notNull(),
  createdAt: createdAtCol(),
}, (t) => [
  uniqueIndex('uq_ws_invites_token').on(t.token),
  index('idx_ws_invites_workspace').on(t.workspaceId),
  index('idx_ws_invites_expires').on(t.expiresAt),
]);
export type WorkspaceInviteRow = typeof workspaceInvites.$inferSelect;
export type NewWorkspaceInviteRow = typeof workspaceInvites.$inferInsert;
```

- [ ] **Step 3: порт.** Создать `server/src/application/workspace/WorkspaceInviteRepository.ts`:

```ts
import type {
  WorkspaceInvite,
  WorkspaceInviteRole,
} from '../../domain/workspace/WorkspaceInvite.js';

export type CreateWorkspaceInviteInput = {
  readonly id: string;
  readonly workspaceId: string;
  readonly role: WorkspaceInviteRole;
  readonly token: string;
  readonly email: string | null;
  readonly expiresAt: Date;
  readonly createdByUserId: string;
};

export type AcceptWorkspaceInviteInput = {
  readonly inviteId: string;
  readonly acceptedAt: Date;
  readonly acceptedByUserId: string;
};

export interface WorkspaceInviteRepository {
  create(input: CreateWorkspaceInviteInput): Promise<WorkspaceInvite>;
  getById(inviteId: string): Promise<WorkspaceInvite | null>;
  // Look-up из accept-flow (/invite/:token).
  findByToken(token: string): Promise<WorkspaceInvite | null>;
  // Pending-инвайты пространства (acceptedAt IS NULL, expiresAt > now) — для UI «Команда».
  listPendingByWorkspace(workspaceId: string, now: Date): Promise<WorkspaceInvite[]>;
  markAccepted(input: AcceptWorkspaceInviteInput): Promise<WorkspaceInvite | null>;
  delete(inviteId: string): Promise<boolean>;
}
```

- [ ] **Step 4: Drizzle-репозиторий.** Создать `server/src/infrastructure/repositories/DrizzleWorkspaceInviteRepository.ts` (прямая адаптация `DrizzleProjectInviteRepository.ts`):

```ts
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { workspaceInvites, type WorkspaceInviteRow } from '../db/schema.js';
import type {
  WorkspaceInvite,
  WorkspaceInviteRole,
} from '../../domain/workspace/WorkspaceInvite.js';
import type {
  AcceptWorkspaceInviteInput,
  CreateWorkspaceInviteInput,
  WorkspaceInviteRepository,
} from '../../application/workspace/WorkspaceInviteRepository.js';

function toInvite(row: WorkspaceInviteRow): WorkspaceInvite {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    role: row.role as WorkspaceInviteRole,
    token: row.token,
    email: row.email ?? null,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt ?? null,
    acceptedByUserId: row.acceptedByUserId ?? null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

export class DrizzleWorkspaceInviteRepository implements WorkspaceInviteRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateWorkspaceInviteInput): Promise<WorkspaceInvite> {
    await this.db.insert(workspaceInvites).values({
      id: input.id,
      workspaceId: input.workspaceId,
      role: input.role,
      token: input.token,
      email: input.email,
      expiresAt: input.expiresAt,
      createdByUserId: input.createdByUserId,
    });
    const fresh = await this.getById(input.id);
    if (!fresh) throw new Error('Failed to read back workspace invite after insert');
    return fresh;
  }

  async getById(inviteId: string): Promise<WorkspaceInvite | null> {
    const rows = await this.db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.id, inviteId))
      .limit(1);
    return rows[0] ? toInvite(rows[0]) : null;
  }

  async findByToken(token: string): Promise<WorkspaceInvite | null> {
    const rows = await this.db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.token, token))
      .limit(1);
    return rows[0] ? toInvite(rows[0]) : null;
  }

  async listPendingByWorkspace(workspaceId: string, now: Date): Promise<WorkspaceInvite[]> {
    const rows = await this.db
      .select()
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          isNull(workspaceInvites.acceptedAt),
          gt(workspaceInvites.expiresAt, now),
        ),
      )
      .orderBy(asc(workspaceInvites.createdAt));
    return rows.map(toInvite);
  }

  async markAccepted(input: AcceptWorkspaceInviteInput): Promise<WorkspaceInvite | null> {
    await this.db
      .update(workspaceInvites)
      .set({ acceptedAt: input.acceptedAt, acceptedByUserId: input.acceptedByUserId })
      .where(eq(workspaceInvites.id, input.inviteId));
    return this.getById(input.inviteId);
  }

  async delete(inviteId: string): Promise<boolean> {
    const result = await this.db
      .delete(workspaceInvites)
      .where(eq(workspaceInvites.id, inviteId));
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }
}
```

- [ ] **Step 5: email-шаблон.** Создать `server/src/application/notifications/emails/workspaceInviteEmail.ts` — адаптация `inviteEmail.ts` («проект» → «пространство», accept-URL тот же `/invite/:token`):

```ts
import type { EmailMessage } from '../EmailSender.js';

const roleLabel: Record<'editor' | 'viewer', string> = {
  editor: 'редактор',
  viewer: 'наблюдатель',
};

export type WorkspaceInviteEmailInput = {
  readonly to: string;
  readonly workspaceName: string;
  readonly actorDisplayName: string;
  readonly role: 'editor' | 'viewer';
  // `${appUrl}/invite/${token}` — тот же маршрут, что у project-инвайтов (dual-token).
  readonly acceptUrl: string;
};

// HTML-письмо с CTA «Принять приглашение». Inline-CSS — почтовые клиенты
// игнорируют <style>. Чистая функция без I/O — потому в application.
export function renderWorkspaceInviteEmail(input: WorkspaceInviteEmailInput): EmailMessage {
  const subject = `Вас пригласили в пространство «${input.workspaceName}» в ProjectsFlow`;

  const text = [
    `${input.actorDisplayName} приглашает вас в пространство «${input.workspaceName}» как ${roleLabel[input.role]}.`,
    'Вы получите доступ ко всем проектам пространства, включая будущие.',
    '',
    `Принять приглашение: ${input.acceptUrl}`,
    '',
    'Если вы не ожидали это письмо — просто проигнорируйте его.',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="ru">
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="padding:28px 32px 8px;">
          <div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:#2563eb;">PROJECTSFLOW</div>
        </td></tr>
        <tr><td style="padding:8px 32px 0;">
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f172a;">Приглашение в пространство</h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#334155;">
            <strong style="color:#0f172a;">${input.actorDisplayName}</strong> приглашает вас присоединиться к пространству
            <strong style="color:#0f172a;">«${input.workspaceName}»</strong> как <strong>${roleLabel[input.role]}</strong>.
          </p>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#64748b;">
            Вы получите доступ ко всем проектам пространства, включая будущие.
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <a href="${input.acceptUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 28px;border-radius:8px;">
            Принять приглашение
          </a>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
            Кнопка не работает? Откройте ссылку вручную:<br/>
            <a href="${input.acceptUrl}" style="color:#2563eb;word-break:break-all;">${input.acceptUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Если вы не ожидали это письмо — просто проигнорируйте его.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { to: input.to, subject, html, text };
}
```

- [ ] **Step 6: payload уведомления.** В `server/src/domain/notifications/Notification.ts` после блока `ProjectInvitePayload` (строки 31–40) добавить:

```ts
// Приглашение в пространство (спека unified-workspace §6). Создаётся при invite на email
// зарегистрированного юзера — уведомление с кнопкой «Принять» (token → /invite/:token).
export type WorkspaceInvitePayload = {
  readonly type: 'workspace_invite';
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly role: 'editor' | 'viewer';
  readonly inviteId: string;
  readonly token: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};
```

и включить `| WorkspaceInvitePayload` в union `NotificationPayload` (после `| ProjectInvitePayload`).

- [ ] **Step 7: компиляция + commit фундамента.** Из `c:/www/ProjectsFlow/server`: `npx tsc -p tsconfig.json --noEmit` (новые файлы без ошибок). Затем:
  `git add server/src/domain/workspace/WorkspaceInvite.ts server/src/domain/workspace/errors.ts server/src/infrastructure/db/schema.ts server/src/application/workspace/WorkspaceInviteRepository.ts server/src/infrastructure/repositories/DrizzleWorkspaceInviteRepository.ts server/src/application/notifications/emails/workspaceInviteEmail.ts server/src/domain/notifications/Notification.ts && git commit -m "feat(workspace): фундамент workspace-инвайтов — домен, порт, Drizzle-репозиторий, email-шаблон, payload workspace_invite"`

Продолжение (use-cases + TDD-тесты + errorHandler) — в `task-05-part2.md`.

### Task 5 (part 2): use-cases workspace-инвайтов + тесты + errorHandler

Продолжение task-05.md (шаги 1–7 сделаны: домен, порт, Drizzle-репо, email, payload).

- [ ] **Step 8: падающий тест use-cases.** Создать `server/src/application/workspace/WorkspaceInvites.test.ts` целиком:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateWorkspaceInvite } from './CreateWorkspaceInvite.js';
import { AcceptWorkspaceInvite } from './AcceptWorkspaceInvite.js';
import { ListWorkspaceInvites } from './ListWorkspaceInvites.js';
import { DeleteWorkspaceInvite } from './DeleteWorkspaceInvite.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import {
  NotWorkspaceOwnerError,
  WorkspaceNotFoundError,
  WorkspaceInviteNotFoundError,
  WorkspaceInviteExpiredError,
  WorkspaceInviteAlreadyUsedError,
} from '../../domain/workspace/errors.js';

const NOW = new Date('2026-07-13T12:00:00Z');
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Seed = {
  members?: Array<{ workspaceId: string; userId: string; role: WorkspaceRole }>;
  users?: Array<{ id: string; email: string; displayName: string }>;
  invites?: WorkspaceInvite[];
};

function makeFakes(seed: Seed = {}) {
  const members = (seed.members ?? []).map((m) => ({ ...m }));
  const users = seed.users ?? [];
  const invites = new Map<string, WorkspaceInvite>();
  for (const i of seed.invites ?? []) invites.set(i.id, i);
  const sentEmails: Array<{ to: string; subject: string }> = [];
  const notifications: Array<{ userId: string; payload: { type: string } }> = [];

  let seq = 0;
  const idGen = (): string => `id-${++seq}`;

  const invitesRepo: WorkspaceInviteRepository = {
    async create(input) {
      const invite: WorkspaceInvite = {
        ...input,
        acceptedAt: null,
        acceptedByUserId: null,
        createdAt: NOW,
      };
      invites.set(invite.id, invite);
      return invite;
    },
    async getById(id) {
      return invites.get(id) ?? null;
    },
    async findByToken(token) {
      for (const i of invites.values()) if (i.token === token) return i;
      return null;
    },
    async listPendingByWorkspace(workspaceId, now) {
      return [...invites.values()].filter(
        (i) => i.workspaceId === workspaceId && i.acceptedAt === null && i.expiresAt > now,
      );
    },
    async markAccepted({ inviteId, acceptedAt, acceptedByUserId }) {
      const i = invites.get(inviteId);
      if (!i) return null;
      const next = { ...i, acceptedAt, acceptedByUserId };
      invites.set(inviteId, next);
      return next;
    },
    async delete(id) {
      return invites.delete(id);
    },
  };

  const workspaces = {
    async getMembership(workspaceId: string, userId: string) {
      const m = members.find((x) => x.workspaceId === workspaceId && x.userId === userId);
      return m ? { workspaceId, userId, role: m.role } : null;
    },
    async addMember(workspaceId: string, userId: string, role: WorkspaceRole) {
      if (!members.find((x) => x.workspaceId === workspaceId && x.userId === userId)) {
        members.push({ workspaceId, userId, role });
      }
    },
    async getById(id: string) {
      return { id, name: 'Команда' };
    },
  };
  const usersPort = {
    async getById(id: string) {
      const u = users.find((x) => x.id === id);
      return u ? { displayName: u.displayName } : null;
    },
    async getByEmail(email: string) {
      const u = users.find((x) => x.email === email);
      return u ? { id: u.id } : null;
    },
  };
  const emailPort = {
    async send(msg: { to: string; subject: string }) {
      sentEmails.push({ to: msg.to, subject: msg.subject });
    },
  };
  const notificationsPort = {
    async create(input: { id: string; userId: string; payload: { type: string } }) {
      notifications.push({ userId: input.userId, payload: input.payload });
      return input;
    },
  };

  const create = new CreateWorkspaceInvite({
    workspaces,
    invites: invitesRepo,
    users: usersPort,
    notifications: notificationsPort,
    email: emailPort,
    idGen,
    randomToken: () => 'a'.repeat(64),
    now: () => NOW,
    ttlMs: TTL_MS,
    appUrl: 'https://projectsflow.ru',
  });
  const accept = new AcceptWorkspaceInvite({
    invites: invitesRepo,
    workspaces,
    now: () => NOW,
  });
  const list = new ListWorkspaceInvites({
    workspaces,
    invites: invitesRepo,
    now: () => NOW,
  });
  const del = new DeleteWorkspaceInvite({ workspaces, invites: invitesRepo });

  return { create, accept, list, del, invitesRepo, workspaces, members, sentEmails, notifications };
}

function pendingInvite(over: Partial<WorkspaceInvite> = {}): WorkspaceInvite {
  return {
    id: 'inv-1',
    workspaceId: 'w1',
    role: 'editor',
    token: 't'.repeat(64),
    email: null,
    expiresAt: new Date(NOW.getTime() + TTL_MS),
    acceptedAt: null,
    acceptedByUserId: null,
    createdByUserId: 'u1',
    createdAt: NOW,
    ...over,
  };
}

test('create: owner создаёт invite с TTL 7 дней и токеном', async () => {
  const { create } = makeFakes({ members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }] });
  const { invite } = await create.execute({ workspaceId: 'w1', actorUserId: 'u1', role: 'editor', email: null });
  assert.equal(invite.workspaceId, 'w1');
  assert.equal(invite.token.length, 64);
  assert.equal(invite.expiresAt.getTime(), NOW.getTime() + TTL_MS);
});

test('create: viewer не может приглашать', async () => {
  const { create } = makeFakes({ members: [{ workspaceId: 'w1', userId: 'u3', role: 'viewer' }] });
  await assert.rejects(
    () => create.execute({ workspaceId: 'w1', actorUserId: 'u3', role: 'editor', email: null }),
    NotWorkspaceOwnerError,
  );
});

test('create: не участник — 404-ошибка (не палим пространство)', async () => {
  const { create } = makeFakes({});
  await assert.rejects(
    () => create.execute({ workspaceId: 'w1', actorUserId: 'intruder', role: 'editor', email: null }),
    WorkspaceNotFoundError,
  );
});

test('create с email: шлёт письмо + in-app workspace_invite зарегистрированному', async () => {
  const { create, sentEmails, notifications } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    users: [
      { id: 'u1', email: 'u1@x', displayName: 'Ярослав' },
      { id: 'u2', email: 'u2@x', displayName: 'Гость' },
    ],
  });
  await create.execute({ workspaceId: 'w1', actorUserId: 'u1', role: 'viewer', email: 'u2@x' });
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0]?.to, 'u2@x');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.userId, 'u2');
  assert.equal(notifications[0]?.payload.type, 'workspace_invite');
});

test('accept: зачисляет в пространство с ролью инвайта и потребляет токен', async () => {
  const { accept, workspaces, invitesRepo } = makeFakes({ invites: [pendingInvite()] });
  const res = await accept.execute('t'.repeat(64), 'u2');
  assert.equal(res.workspaceId, 'w1');
  assert.equal((await workspaces.getMembership('w1', 'u2'))?.role, 'editor');
  assert.ok((await invitesRepo.getById('inv-1'))?.acceptedAt);
});

test('accept: уже участник — роль не меняется, токен потребляется', async () => {
  const { accept, workspaces, invitesRepo } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u2', role: 'owner' }],
    invites: [pendingInvite({ role: 'viewer' })],
  });
  await accept.execute('t'.repeat(64), 'u2');
  assert.equal((await workspaces.getMembership('w1', 'u2'))?.role, 'owner');
  assert.ok((await invitesRepo.getById('inv-1'))?.acceptedAt);
});

test('accept: неизвестный токен → WorkspaceInviteNotFoundError', async () => {
  const { accept } = makeFakes({});
  await assert.rejects(() => accept.execute('nope', 'u2'), WorkspaceInviteNotFoundError);
});

test('accept: просроченный → WorkspaceInviteExpiredError', async () => {
  const { accept } = makeFakes({
    invites: [pendingInvite({ expiresAt: new Date(NOW.getTime() - 1000) })],
  });
  await assert.rejects(() => accept.execute('t'.repeat(64), 'u2'), WorkspaceInviteExpiredError);
});

test('accept: использованный → WorkspaceInviteAlreadyUsedError', async () => {
  const { accept } = makeFakes({
    invites: [pendingInvite({ acceptedAt: NOW, acceptedByUserId: 'u9' })],
  });
  await assert.rejects(() => accept.execute('t'.repeat(64), 'u2'), WorkspaceInviteAlreadyUsedError);
});

test('list: owner видит только pending', async () => {
  const { list } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    invites: [
      pendingInvite(),
      pendingInvite({ id: 'inv-2', token: 'u'.repeat(64), acceptedAt: NOW }),
      pendingInvite({ id: 'inv-3', token: 'v'.repeat(64), expiresAt: new Date(NOW.getTime() - 1) }),
    ],
  });
  const items = await list.execute('w1', 'u1');
  assert.deepEqual(items.map((i) => i.id), ['inv-1']);
});

test('list: viewer не видит инвайты', async () => {
  const { list } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u3', role: 'viewer' }],
    invites: [pendingInvite()],
  });
  await assert.rejects(() => list.execute('w1', 'u3'), NotWorkspaceOwnerError);
});

test('delete: owner отзывает invite; чужой inviteId → not found', async () => {
  const { del, invitesRepo } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    invites: [pendingInvite(), pendingInvite({ id: 'inv-other', workspaceId: 'w2', token: 'z'.repeat(64) })],
  });
  await del.execute('w1', 'u1', 'inv-1');
  assert.equal(await invitesRepo.getById('inv-1'), null);
  await assert.rejects(() => del.execute('w1', 'u1', 'inv-other'), WorkspaceInviteNotFoundError);
});
```

- [ ] **Step 9: убедиться, что тест падает.** Из `c:/www/ProjectsFlow/server`:
  `node --import tsx --test src/application/workspace/WorkspaceInvites.test.ts`
  Ожидаемо: `Cannot find module ... CreateWorkspaceInvite.js`.

- [ ] **Step 10: реализация CreateWorkspaceInvite.** Создать `server/src/application/workspace/CreateWorkspaceInvite.ts`:

```ts
import type {
  WorkspaceInvite,
  WorkspaceInviteRole,
} from '../../domain/workspace/WorkspaceInvite.js';
import {
  NotWorkspaceOwnerError,
  WorkspaceNotFoundError,
} from '../../domain/workspace/errors.js';
import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import type { NotificationPayload } from '../../domain/notifications/Notification.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import { renderWorkspaceInviteEmail } from '../notifications/emails/workspaceInviteEmail.js';
import { requireWorkspaceMember } from './workspaceAccess.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';

// Узкие структурные порты — реальные репозитории (DrizzleWorkspaceRepository,
// DrizzleUserRepository, NotificationRepository) им соответствуют.
type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  getById(id: string): Promise<{ id: string; name: string } | null>;
};
type UsersPort = {
  getById(id: string): Promise<{ displayName: string } | null>;
  getByEmail(email: string): Promise<{ id: string } | null>;
};
type NotificationsPort = {
  create(input: { id: string; userId: string; payload: NotificationPayload }): Promise<unknown>;
};

type Deps = {
  readonly workspaces: WorkspacesPort;
  readonly invites: WorkspaceInviteRepository;
  readonly users: UsersPort;
  readonly notifications: NotificationsPort;
  readonly email: EmailSender;
  readonly idGen: () => string;
  readonly randomToken: () => string;
  readonly now: () => Date;
  readonly ttlMs: number;
  readonly appUrl: string;
};

export type CreateWorkspaceInviteCommand = {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly role: WorkspaceInviteRole;
  // Информационный email — mismatch при accept разрешён (как у project-инвайтов).
  readonly email: string | null;
};

export class CreateWorkspaceInvite {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateWorkspaceInviteCommand): Promise<{ invite: WorkspaceInvite }> {
    // Приглашать могут owner и editor (зеркало project-права 'invite_member'); viewer — нет.
    const m = await requireWorkspaceMember(
      this.deps.workspaces,
      input.workspaceId,
      input.actorUserId,
    );
    if (m.role === 'viewer') throw new NotWorkspaceOwnerError();
    const ws = await this.deps.workspaces.getById(input.workspaceId);
    if (!ws) throw new WorkspaceNotFoundError();

    const expiresAt = new Date(this.deps.now().getTime() + this.deps.ttlMs);
    const invite = await this.deps.invites.create({
      id: this.deps.idGen(),
      workspaceId: input.workspaceId,
      role: input.role,
      token: this.deps.randomToken(),
      email: input.email,
      expiresAt,
      createdByUserId: input.actorUserId,
    });

    // Доставка — best-effort: создатель в любом случае получает token в ответе.
    if (input.email) {
      await this.notifyInvitee(input, ws.name, invite).catch((err: unknown) => {
        console.error('[ws-invite] delivery failed:', err);
      });
    }
    return { invite };
  }

  private async notifyInvitee(
    input: CreateWorkspaceInviteCommand,
    workspaceName: string,
    invite: WorkspaceInvite,
  ): Promise<void> {
    const email = input.email;
    if (!email) return;
    const actor = await this.deps.users.getById(input.actorUserId);
    const actorDisplayName = actor?.displayName ?? 'Кто-то';
    const acceptUrl = `${this.deps.appUrl.replace(/\/$/, '')}/invite/${invite.token}`;

    await this.deps.email.send(
      renderWorkspaceInviteEmail({
        to: email,
        workspaceName,
        actorDisplayName,
        role: invite.role,
        acceptUrl,
      }),
    );

    // In-app — только если у email уже есть аккаунт (отрисуется через SSE).
    const invitee = await this.deps.users.getByEmail(email);
    if (invitee) {
      await this.deps.notifications.create({
        id: this.deps.idGen(),
        userId: invitee.id,
        payload: {
          type: 'workspace_invite',
          workspaceId: invite.workspaceId,
          workspaceName,
          role: invite.role,
          inviteId: invite.id,
          token: invite.token,
          actorUserId: input.actorUserId,
          actorDisplayName,
        },
      });
    }
  }
}
```

- [ ] **Step 11: реализация Accept/List/Delete.** Создать `server/src/application/workspace/AcceptWorkspaceInvite.ts`:

```ts
import {
  WorkspaceInviteAlreadyUsedError,
  WorkspaceInviteExpiredError,
  WorkspaceInviteNotFoundError,
} from '../../domain/workspace/errors.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';

type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
};

type Deps = {
  readonly invites: WorkspaceInviteRepository;
  readonly workspaces: WorkspacesPort;
  readonly now: () => Date;
};

export class AcceptWorkspaceInvite {
  constructor(private readonly deps: Deps) {}

  async execute(token: string, userId: string): Promise<{ workspaceId: string }> {
    const invite = await this.deps.invites.findByToken(token);
    if (!invite) throw new WorkspaceInviteNotFoundError();
    if (invite.acceptedAt !== null) throw new WorkspaceInviteAlreadyUsedError();
    const now = this.deps.now();
    if (invite.expiresAt.getTime() < now.getTime()) throw new WorkspaceInviteExpiredError();

    // Уже участник — не апгрейдим/даунгрейдим роль, просто потребляем токен.
    const existing = await this.deps.workspaces.getMembership(invite.workspaceId, userId);
    if (!existing) {
      await this.deps.workspaces.addMember(invite.workspaceId, userId, invite.role);
    }

    await this.deps.invites.markAccepted({
      inviteId: invite.id,
      acceptedAt: now,
      acceptedByUserId: userId,
    });
    return { workspaceId: invite.workspaceId };
  }
}
```

Создать `server/src/application/workspace/ListWorkspaceInvites.ts`:

```ts
import { NotWorkspaceOwnerError } from '../../domain/workspace/errors.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import { requireWorkspaceMember } from './workspaceAccess.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';

type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
};

type Deps = {
  readonly workspaces: WorkspacesPort;
  readonly invites: WorkspaceInviteRepository;
  readonly now: () => Date;
};

export class ListWorkspaceInvites {
  constructor(private readonly deps: Deps) {}

  // Pending-инвайты видят owner и editor (те, кто может приглашать).
  async execute(workspaceId: string, actorUserId: string): Promise<WorkspaceInvite[]> {
    const m = await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    if (m.role === 'viewer') throw new NotWorkspaceOwnerError();
    return this.deps.invites.listPendingByWorkspace(workspaceId, this.deps.now());
  }
}
```

Создать `server/src/application/workspace/DeleteWorkspaceInvite.ts`:

```ts
import {
  NotWorkspaceOwnerError,
  WorkspaceInviteNotFoundError,
} from '../../domain/workspace/errors.js';
import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import { requireWorkspaceMember } from './workspaceAccess.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';

type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
};

type Deps = {
  readonly workspaces: WorkspacesPort;
  readonly invites: WorkspaceInviteRepository;
};

export class DeleteWorkspaceInvite {
  constructor(private readonly deps: Deps) {}

  // Idempotent cleanup: использованный invite тоже можно удалить.
  async execute(workspaceId: string, actorUserId: string, inviteId: string): Promise<void> {
    const m = await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    if (m.role === 'viewer') throw new NotWorkspaceOwnerError();

    const invite = await this.deps.invites.getById(inviteId);
    if (!invite || invite.workspaceId !== workspaceId) throw new WorkspaceInviteNotFoundError();

    await this.deps.invites.delete(inviteId);
  }
}
```

- [ ] **Step 12: прогнать тесты — PASS.** Из `c:/www/ProjectsFlow/server`:
  `node --import tsx --test src/application/workspace/WorkspaceInvites.test.ts` — все 12 тестов зелёные.

- [ ] **Step 13: errorHandler.** В `server/src/presentation/middleware/errorHandler.ts`:
  1. К существующему импорту из `../../domain/workspace/errors.js` (там уже импортируются `WorkspaceNotFoundError`, `NotWorkspaceOwnerError`, `LastOwnerError` и др., строки ~117–120) добавить `WorkspaceInviteNotFoundError, WorkspaceInviteExpiredError, WorkspaceInviteAlreadyUsedError`.
  2. В блок «--- Пространства (workspaces) ---» (после ветки `LastOwnerError`, ~строка 704) добавить — коды ответов совпадают с project-инвайтами, клиент обрабатывает одинаково:

```ts
  if (err instanceof WorkspaceInviteNotFoundError) {
    res.status(404).json({ error: 'invite_not_found', message: 'Приглашение не найдено' });
    return;
  }
  if (err instanceof WorkspaceInviteExpiredError) {
    res.status(410).json({ error: 'invite_expired', message: 'Срок действия приглашения истёк' });
    return;
  }
  if (err instanceof WorkspaceInviteAlreadyUsedError) {
    res.status(410).json({ error: 'invite_used', message: 'Это приглашение уже использовано' });
    return;
  }
```

- [ ] **Step 14: компиляция + commit.** Из `c:/www/ProjectsFlow/server`: `npx tsc -p tsconfig.json --noEmit`, затем `npm test` (весь набор). Commit:
  `git add server/src/application/workspace/CreateWorkspaceInvite.ts server/src/application/workspace/AcceptWorkspaceInvite.ts server/src/application/workspace/ListWorkspaceInvites.ts server/src/application/workspace/DeleteWorkspaceInvite.ts server/src/application/workspace/WorkspaceInvites.test.ts server/src/presentation/middleware/errorHandler.ts && git commit -m "feat(workspace): use-cases приглашений в пространство — create/accept/list/delete, TTL 7 дней, best-effort email и in-app workspace_invite"`

### Task 6: dual-token GetInviteByToken + legacy accept зачисляет в пространство

**Files:**
- Modify: `server/src/application/project/GetInviteByToken.ts` (полная перезапись, сейчас 53 строки)
- Test (create): `server/src/application/project/GetInviteByToken.test.ts`
- Modify: `server/src/application/project/AcceptProjectInvite.ts` (полная перезапись, сейчас 80 строк)
- Test (create): `server/src/application/project/AcceptProjectInvite.test.ts`
- Modify: `server/src/presentation/invites/routes.ts` (GET-превью: kind/targetName)
- Modify: `server/src/index.ts` (инстанс `workspaceInviteRepo`; wiring блока `invites:` ~строки 1602–1617)

**Interfaces:**
- Consumes (Task 5): `WorkspaceInviteRepository` (`findByToken`), `DrizzleWorkspaceInviteRepository`, тип `WorkspaceInvite`, ошибки `WorkspaceInviteAlreadyUsedError/WorkspaceInviteExpiredError` из `domain/workspace/errors.js`. Существующие: `ProjectInviteRepository.findByToken/markAccepted`, `projectRepo.getWorkspaceId(projectId): Promise<string|null>`, `workspaceRepo.getMembership/addMember`, `ActivityRecorder.record`.
- Produces:
  - `InvitePreview = { kind: 'workspace' | 'project'; targetName: string; role: 'editor'|'viewer'; inviterDisplayName: string|null; inviteEmail: string|null; expiresAt: Date }` (поле `projectName` из старого превью ЗАМЕНЕНО на `kind`+`targetName`; HTTP-ответ дополнительно дублирует `projectName = targetName` для совместимости — клиентская секция обновит `InvitePage`);
  - `AcceptProjectInvite.execute(token, userId): Promise<{ projectId: string }>` — сигнатура прежняя, но зачисление идёт в `workspace_members` пространства проекта.

- [ ] **Step 1: падающий тест GetInviteByToken.** Создать `server/src/application/project/GetInviteByToken.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetInviteByToken } from './GetInviteByToken.js';
import type { ProjectInvite } from '../../domain/project/ProjectInvite.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import { ProjectInviteNotFoundError } from '../../domain/project/errors.js';
import { WorkspaceInviteExpiredError } from '../../domain/workspace/errors.js';

const NOW = new Date('2026-07-13T12:00:00Z');
const FUTURE = new Date('2026-07-20T12:00:00Z');

const WS_TOKEN = 'w'.repeat(64);
const PJ_TOKEN = 'p'.repeat(64);

function wsInvite(over: Partial<WorkspaceInvite> = {}): WorkspaceInvite {
  return {
    id: 'wi-1', workspaceId: 'ws-1', role: 'editor', token: WS_TOKEN, email: 'x@y',
    expiresAt: FUTURE, acceptedAt: null, acceptedByUserId: null,
    createdByUserId: 'u1', createdAt: NOW,
    ...over,
  };
}

function pjInvite(over: Partial<ProjectInvite> = {}): ProjectInvite {
  return {
    id: 'pi-1', projectId: 'p-1', role: 'viewer', token: PJ_TOKEN, email: null,
    expiresAt: FUTURE, acceptedAt: null, acceptedByUserId: null,
    createdByUserId: 'u1', createdAt: NOW,
    ...over,
  };
}

function makeUseCase(seed: { ws?: WorkspaceInvite[]; pj?: ProjectInvite[] }) {
  return new GetInviteByToken({
    workspaceInvites: {
      async findByToken(token) {
        return (seed.ws ?? []).find((i) => i.token === token) ?? null;
      },
    },
    invites: {
      async findByToken(token) {
        return (seed.pj ?? []).find((i) => i.token === token) ?? null;
      },
    },
    projects: {
      async getById(id) {
        return id === 'p-1' ? { name: 'Сайт клиента' } : null;
      },
    },
    workspaces: {
      async getById(id) {
        return id === 'ws-1' ? { name: 'Команда X' } : null;
      },
    },
    users: {
      async getById() {
        return { displayName: 'Ярослав' };
      },
    },
    now: () => NOW,
  });
}

test('workspace-токен резолвится первым: kind=workspace, имя пространства', async () => {
  const uc = makeUseCase({ ws: [wsInvite()] });
  const preview = await uc.execute(WS_TOKEN);
  assert.equal(preview.kind, 'workspace');
  assert.equal(preview.targetName, 'Команда X');
  assert.equal(preview.role, 'editor');
  assert.equal(preview.inviterDisplayName, 'Ярослав');
});

test('легаси project-токен: kind=project, имя проекта', async () => {
  const uc = makeUseCase({ pj: [pjInvite()] });
  const preview = await uc.execute(PJ_TOKEN);
  assert.equal(preview.kind, 'project');
  assert.equal(preview.targetName, 'Сайт клиента');
  assert.equal(preview.role, 'viewer');
});

test('неизвестный токен → ProjectInviteNotFoundError (единый 404 invite_not_found)', async () => {
  const uc = makeUseCase({});
  await assert.rejects(() => uc.execute('nope'), ProjectInviteNotFoundError);
});

test('просроченный workspace-токен → WorkspaceInviteExpiredError', async () => {
  const uc = makeUseCase({
    ws: [wsInvite({ expiresAt: new Date(NOW.getTime() - 1000) })],
  });
  await assert.rejects(() => uc.execute(WS_TOKEN), WorkspaceInviteExpiredError);
});
```

- [ ] **Step 2: убедиться, что падает.** Из `c:/www/ProjectsFlow/server`:
  `node --import tsx --test src/application/project/GetInviteByToken.test.ts`
  Ожидаемо: TS/型-ошибки конструктора (нет deps `workspaceInvites`/`workspaces`) и/или падения assert-ов — старый код не знает kind/targetName.

- [ ] **Step 3: перезапись GetInviteByToken.** Заменить всё содержимое `server/src/application/project/GetInviteByToken.ts` на:

```ts
import {
  ProjectInviteAlreadyUsedError,
  ProjectInviteExpiredError,
  ProjectInviteNotFoundError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import {
  WorkspaceInviteAlreadyUsedError,
  WorkspaceInviteExpiredError,
  WorkspaceNotFoundError,
} from '../../domain/workspace/errors.js';
import type { ProjectInvite } from '../../domain/project/ProjectInvite.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';

// Узкие структурные порты — реальные репозитории им соответствуют, тесты фейкают только их.
type ProjectInvitesPort = {
  findByToken(token: string): Promise<ProjectInvite | null>;
};
type WorkspaceInvitesPort = {
  findByToken(token: string): Promise<WorkspaceInvite | null>;
};
type ProjectsPort = { getById(id: string): Promise<{ name: string } | null> };
type WorkspacesPort = { getById(id: string): Promise<{ name: string } | null> };
type UsersPort = { getById(id: string): Promise<{ displayName: string } | null> };

type Deps = {
  readonly invites: ProjectInvitesPort;
  readonly workspaceInvites: WorkspaceInvitesPort;
  readonly projects: ProjectsPort;
  readonly workspaces: WorkspacesPort;
  readonly users: UsersPort;
  readonly now: () => Date;
};

// Preview для anon-страницы /invite/:token. Токены двух поколений (спека §3.2):
// сначала workspace_invites, затем легаси project_invites. ID цели не отдаём —
// у анона нет повода знать его до accept'а (защита от перебора).
export type InvitePreview = {
  readonly kind: 'workspace' | 'project';
  readonly targetName: string;
  readonly role: 'editor' | 'viewer';
  readonly inviterDisplayName: string | null;
  readonly inviteEmail: string | null;
  readonly expiresAt: Date;
};

export class GetInviteByToken {
  constructor(private readonly deps: Deps) {}

  async execute(token: string): Promise<InvitePreview> {
    const wsInvite = await this.deps.workspaceInvites.findByToken(token);
    if (wsInvite) {
      if (wsInvite.acceptedAt !== null) throw new WorkspaceInviteAlreadyUsedError();
      if (wsInvite.expiresAt.getTime() < this.deps.now().getTime()) {
        throw new WorkspaceInviteExpiredError();
      }
      const ws = await this.deps.workspaces.getById(wsInvite.workspaceId);
      if (!ws) throw new WorkspaceNotFoundError();
      const inviter = await this.deps.users.getById(wsInvite.createdByUserId);
      return {
        kind: 'workspace',
        targetName: ws.name,
        role: wsInvite.role,
        inviterDisplayName: inviter?.displayName ?? null,
        inviteEmail: wsInvite.email,
        expiresAt: wsInvite.expiresAt,
      };
    }

    // Легаси project_invites (заморожены, но непринятые токены продолжают работать).
    const invite = await this.deps.invites.findByToken(token);
    if (!invite) throw new ProjectInviteNotFoundError();
    if (invite.acceptedAt !== null) throw new ProjectInviteAlreadyUsedError();
    if (invite.expiresAt.getTime() < this.deps.now().getTime()) {
      throw new ProjectInviteExpiredError();
    }
    const project = await this.deps.projects.getById(invite.projectId);
    if (!project) throw new ProjectNotFoundError();
    const inviter = await this.deps.users.getById(invite.createdByUserId);
    return {
      kind: 'project',
      targetName: project.name,
      role: invite.role,
      inviterDisplayName: inviter?.displayName ?? null,
      inviteEmail: invite.email,
      expiresAt: invite.expiresAt,
    };
  }
}
```

- [ ] **Step 4: прогнать — PASS.** `node --import tsx --test src/application/project/GetInviteByToken.test.ts` — 4 теста зелёные.

- [ ] **Step 5: обновить GET /api/invites/:token под новое превью.** В `server/src/presentation/invites/routes.ts` заменить тело `res.json({...})` GET-обработчика (строки 24–32) на:

```ts
      res.json({
        preview: {
          kind: preview.kind,
          targetName: preview.targetName,
          // Легаси-алиас для клиента до правки InvitePage (клиентская секция).
          projectName: preview.targetName,
          role: preview.role,
          inviterDisplayName: preview.inviterDisplayName,
          inviteEmail: preview.inviteEmail,
          expiresAt: preview.expiresAt.toISOString(),
        },
      });
```

- [ ] **Step 6: commit.**
  `git add server/src/application/project/GetInviteByToken.ts server/src/application/project/GetInviteByToken.test.ts server/src/presentation/invites/routes.ts && git commit -m "feat(workspace): dual-резолв токена приглашения — сначала workspace_invites, потом легаси project_invites"`

  Примечание: `server/src/index.ts` пока передаёт в `GetInviteByToken` старый набор deps — компиляция index.ts починится в Step 10 (part 2) этой же задачи; коммит выше не включает index.ts, поэтому если хочется зелёный tsc на каждом коммите — можно выполнить Step 10 (wiring) до этого коммита и включить index.ts в него.

Продолжение (AcceptProjectInvite + wiring) — в `task-06-part2.md`.

### Task 6 (part 2): AcceptProjectInvite → вступление в пространство + wiring index.ts

Продолжение task-06.md (шаги 1–6 сделаны).

- [ ] **Step 7: падающий тест AcceptProjectInvite.** Создать `server/src/application/project/AcceptProjectInvite.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AcceptProjectInvite } from './AcceptProjectInvite.js';
import type { ProjectInvite } from '../../domain/project/ProjectInvite.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import {
  ProjectInviteExpiredError,
  ProjectInviteNotFoundError,
} from '../../domain/project/errors.js';

const NOW = new Date('2026-07-13T12:00:00Z');
const FUTURE = new Date('2026-07-20T12:00:00Z');
const TOKEN = 'p'.repeat(64);

function invite(over: Partial<ProjectInvite> = {}): ProjectInvite {
  return {
    id: 'pi-1', projectId: 'p-1', role: 'editor', token: TOKEN, email: null,
    expiresAt: FUTURE, acceptedAt: null, acceptedByUserId: null,
    createdByUserId: 'u1', createdAt: NOW,
    ...over,
  };
}

function makeFakes(seed: {
  invites?: ProjectInvite[];
  members?: Array<{ workspaceId: string; userId: string; role: WorkspaceRole }>;
}) {
  const invites = new Map<string, ProjectInvite>((seed.invites ?? []).map((i) => [i.id, i]));
  const members = (seed.members ?? []).map((m) => ({ ...m }));

  const uc = new AcceptProjectInvite({
    invites: {
      async findByToken(token) {
        for (const i of invites.values()) if (i.token === token) return i;
        return null;
      },
      async markAccepted({ inviteId, acceptedAt, acceptedByUserId }) {
        const i = invites.get(inviteId);
        if (!i) return null;
        const next = { ...i, acceptedAt, acceptedByUserId };
        invites.set(inviteId, next);
        return next;
      },
    },
    projects: {
      async getWorkspaceId(projectId) {
        return projectId === 'p-1' ? 'ws-1' : null;
      },
    },
    workspaces: {
      async getMembership(workspaceId, userId) {
        const m = members.find((x) => x.workspaceId === workspaceId && x.userId === userId);
        return m ? { workspaceId, userId, role: m.role } : null;
      },
      async addMember(workspaceId, userId, role) {
        members.push({ workspaceId, userId, role });
      },
    },
    now: () => NOW,
  });
  return { uc, invites, members };
}

test('accept легаси-токена: зачисляет в ПРОСТРАНСТВО проекта с ролью инвайта', async () => {
  const { uc, invites, members } = makeFakes({ invites: [invite()] });
  const res = await uc.execute(TOKEN, 'u2');
  assert.equal(res.projectId, 'p-1');
  assert.deepEqual(members, [{ workspaceId: 'ws-1', userId: 'u2', role: 'editor' }]);
  assert.ok(invites.get('pi-1')?.acceptedAt);
});

test('accept: уже участник пространства — роль не трогаем, токен потребляем', async () => {
  const { uc, invites, members } = makeFakes({
    invites: [invite({ role: 'viewer' })],
    members: [{ workspaceId: 'ws-1', userId: 'u2', role: 'owner' }],
  });
  await uc.execute(TOKEN, 'u2');
  assert.equal(members.length, 1);
  assert.equal(members[0]?.role, 'owner');
  assert.ok(invites.get('pi-1')?.acceptedAt);
});

test('accept: неизвестный токен → ProjectInviteNotFoundError', async () => {
  const { uc } = makeFakes({});
  await assert.rejects(() => uc.execute('nope', 'u2'), ProjectInviteNotFoundError);
});

test('accept: просроченный → ProjectInviteExpiredError, участник не добавлен', async () => {
  const { uc, members } = makeFakes({
    invites: [invite({ expiresAt: new Date(NOW.getTime() - 1000) })],
  });
  await assert.rejects(() => uc.execute(TOKEN, 'u2'), ProjectInviteExpiredError);
  assert.equal(members.length, 0);
});
```

- [ ] **Step 8: убедиться, что падает.** `node --import tsx --test src/application/project/AcceptProjectInvite.test.ts` (из `c:/www/ProjectsFlow/server`) — конструктор не принимает `projects`/`workspaces`.

- [ ] **Step 9: перезапись AcceptProjectInvite.** Заменить всё содержимое `server/src/application/project/AcceptProjectInvite.ts` на:

```ts
import {
  ProjectInviteAlreadyUsedError,
  ProjectInviteExpiredError,
  ProjectInviteNotFoundError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import type { ProjectInvite } from '../../domain/project/ProjectInvite.js';
import type {
  WorkspaceMember,
  WorkspaceRole,
} from '../../domain/workspace/WorkspaceMember.js';
import type { AcceptProjectInviteInput } from './ProjectInviteRepository.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';

// Узкие структурные порты (реальные projectRepo/workspaceRepo им соответствуют).
type InvitesPort = {
  findByToken(token: string): Promise<ProjectInvite | null>;
  markAccepted(input: AcceptProjectInviteInput): Promise<ProjectInvite | null>;
};
type ProjectsPort = {
  getWorkspaceId(projectId: string): Promise<string | null>;
};
type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
};

type Deps = {
  readonly invites: InvitesPort;
  readonly projects: ProjectsPort;
  readonly workspaces: WorkspacesPort;
  readonly now: () => Date;
  // Лента действий (best-effort). Опционально.
  readonly activityRecorder?: ActivityRecorder;
};

export type AcceptInviteResult = {
  readonly projectId: string;
};

// Легаси-токены project_invites заморожены (новые не создаются), но непринятые
// продолжают работать: accept зачисляет юзера в ПРОСТРАНСТВО проекта (спека §3.1) —
// он получает доступ ко всем проектам пространства, как и по workspace-инвайту.
export class AcceptProjectInvite {
  constructor(private readonly deps: Deps) {}

  async execute(token: string, userId: string): Promise<AcceptInviteResult> {
    const invite = await this.deps.invites.findByToken(token);
    if (!invite) throw new ProjectInviteNotFoundError();
    if (invite.acceptedAt !== null) throw new ProjectInviteAlreadyUsedError();
    const now = this.deps.now();
    if (invite.expiresAt.getTime() < now.getTime()) throw new ProjectInviteExpiredError();

    const workspaceId = await this.deps.projects.getWorkspaceId(invite.projectId);
    if (!workspaceId) throw new ProjectNotFoundError();

    // Уже участник пространства — роль не апгрейдим/даунгрейдим, просто потребляем токен.
    const existing = await this.deps.workspaces.getMembership(workspaceId, userId);
    if (!existing) {
      await this.deps.workspaces.addMember(workspaceId, userId, invite.role);
      // Лента действий проекта (best-effort): участник присоединился по инвайту.
      void this.deps.activityRecorder?.record({
        projectId: invite.projectId,
        actorUserId: userId,
        kind: 'member_added',
        payload: { targetUserId: userId, role: invite.role },
      });
    }

    await this.deps.invites.markAccepted({
      inviteId: invite.id,
      acceptedAt: now,
      acceptedByUserId: userId,
    });

    return { projectId: invite.projectId };
  }
}
```

- [ ] **Step 10: прогнать — PASS.** `node --import tsx --test src/application/project/AcceptProjectInvite.test.ts` — 4 теста зелёные.

- [ ] **Step 11: wiring index.ts.** В `server/src/index.ts`:
  1. К импортам инфраструктуры добавить (рядом с `DrizzleProjectInviteRepository`):
     `import { DrizzleWorkspaceInviteRepository } from './infrastructure/repositories/DrizzleWorkspaceInviteRepository.js';`
  2. Рядом с инстансом `projectInviteRepo` (найти `new DrizzleProjectInviteRepository(db)`) добавить:
     `const workspaceInviteRepo = new DrizzleWorkspaceInviteRepository(db);`
  3. Заменить блок `invites:` в createApp (~строки 1602–1617) на:

```ts
  invites: {
    getByToken: new GetInviteByToken({
      invites: projectInviteRepo,
      workspaceInvites: workspaceInviteRepo,
      projects: projectRepo,
      workspaces: workspaceRepo,
      users: userRepo,
      now,
    }),
    accept: new AcceptProjectInvite({
      invites: projectInviteRepo,
      projects: projectRepo,
      workspaces: workspaceRepo,
      now,
      activityRecorder,
    }),
  },
```

  (Ключи `members`, `users`, `hubSync` из старого accept-wiring удаляются — новый Deps их не принимает.)

- [ ] **Step 12: компиляция + полный прогон + commit.** Из `c:/www/ProjectsFlow/server`: `npx tsc -p tsconfig.json --noEmit`, затем `npm test`. Commit:
  `git add server/src/application/project/AcceptProjectInvite.ts server/src/application/project/AcceptProjectInvite.test.ts server/src/index.ts && git commit -m "feat(workspace): accept легаси project-инвайта зачисляет в пространство проекта (без hubSync и project_members)"`

### Task 7: presentation — invite-маршруты пространства, dual-token accept, снос project-invite-маршрутов

**Files:**
- Modify: `server/src/presentation/workspaces/schemas.ts` (29 строк — role-enum'ы, схема invite)
- Modify: `server/src/presentation/workspaces/routes.ts` (deps, memberToDto, +3 invite-маршрута)
- Modify: `server/src/presentation/invites/routes.ts` (POST accept — dual-token)
- Modify: `server/src/presentation/projects/routes.ts` (удалить invite-маршруты, строки ~1241–1287, + inviteToDto/типы/deps)
- Modify: `server/src/presentation/projects/schemas.ts` (удалить `createInviteSchema` ~строка 215 и `CreateInviteBody` ~строка 254)
- Modify: `server/src/presentation/http.ts` (AppDeps + mounts)
- Modify: `server/src/index.ts` (wiring: workspaces.invites, invites.acceptWorkspace; убрать project-invite use-cases из `projects:`)

**Interfaces:**
- Consumes (Task 5/6): `CreateWorkspaceInvite` (`execute({workspaceId, actorUserId, role, email}) → {invite: WorkspaceInvite}`), `ListWorkspaceInvites` (`execute(workspaceId, actorUserId) → WorkspaceInvite[]`), `DeleteWorkspaceInvite` (`execute(workspaceId, actorUserId, inviteId) → void`), `AcceptWorkspaceInvite` (`execute(token, userId) → {workspaceId}`), `WorkspaceInviteNotFoundError`, `GetInviteByToken`/`AcceptProjectInvite` (Task 6), инстансы `workspaceInviteRepo`, `workspaceRepo`, `appBaseUrl`, `randomBytes` в index.ts. Секция A: `WorkspaceRole = 'owner'|'editor'|'viewer'`.
- Produces (REST-контракт для клиентской секции):
  - `GET /api/workspaces/:id/invites → { invites: Array<{id, role, email, expiresAt, createdAt}> }` (без token);
  - `POST /api/workspaces/:id/invites {role: 'editor'|'viewer', email?} → 201 { invite: {..., token, url} }` (`url = ${appUrl}/invite/${token}`);
  - `DELETE /api/workspaces/:id/invites/:inviteId → 204`;
  - `POST /api/invites/:token/accept → { workspaceId }` (workspace-токен) ИЛИ `{ projectId }` (легаси);
  - `PATCH /api/workspaces/:id/members/:userId {role: 'owner'|'editor'|'viewer'}` (защита последнего owner — уже в `WorkspaceService.changeMemberRole`);
  - удалены `GET/POST /api/projects/:id/invites`, `DELETE /api/projects/:id/invites/:inviteId`.

- [ ] **Step 1: schemas пространств.** В `server/src/presentation/workspaces/schemas.ts` заменить `addMemberSchema` и `changeRoleSchema` и добавить схему инвайта (в конец файла):

```ts
export const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'editor', 'viewer']).optional(),
});

export const changeRoleSchema = z.object({
  role: z.enum(['owner', 'editor', 'viewer']),
});

export const createWorkspaceInviteSchema = z.object({
  role: z.enum(['editor', 'viewer']),
  // Информационный email «для кого» — опционален; пустая строка → null в route.
  email: z.string().trim().email().nullable().optional(),
});
```

- [ ] **Step 2: workspaces/routes.ts — deps, DTO, invite-маршруты.** В `server/src/presentation/workspaces/routes.ts`:

1. Импорты — добавить:

```ts
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import type { CreateWorkspaceInvite } from '../../application/workspace/CreateWorkspaceInvite.js';
import type { ListWorkspaceInvites } from '../../application/workspace/ListWorkspaceInvites.js';
import type { DeleteWorkspaceInvite } from '../../application/workspace/DeleteWorkspaceInvite.js';
```

и `createWorkspaceInviteSchema` в импорт из `./schemas.js`.

2. В `WorkspaceDto` поле `role?: 'owner' | 'member'` → `role?: WorkspaceRole`. В `memberToDto` тип возврата `role: 'owner' | 'member'` → `role: WorkspaceRole`.

3. Расширить Deps:

```ts
type Deps = {
  readonly service: WorkspaceService;
  readonly invites: {
    readonly create: CreateWorkspaceInvite;
    readonly list: ListWorkspaceInvites;
    readonly delete: DeleteWorkspaceInvite;
  };
  readonly appUrl: string;
};
```

4. После `memberToDto` добавить DTO инвайта:

```ts
type WorkspaceInviteDto = {
  id: string;
  role: 'editor' | 'viewer';
  email: string | null;
  expiresAt: string;
  createdAt: string;
  // token/url отдаются ТОЛЬКО в ответе на создание — одноразовый секрет.
  token?: string;
  url?: string;
};

function inviteToDto(
  i: WorkspaceInvite,
  opts?: { includeToken?: boolean; appUrl?: string },
): WorkspaceInviteDto {
  const dto: WorkspaceInviteDto = {
    id: i.id,
    role: i.role,
    email: i.email,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  };
  if (opts?.includeToken) {
    dto.token = i.token;
    if (opts.appUrl) dto.url = `${opts.appUrl.replace(/\/$/, '')}/invite/${i.token}`;
  }
  return dto;
}
```

5. Перед `return router;` добавить маршруты:

```ts
  // GET /api/workspaces/:id/invites — pending-инвайты (owner/editor). Token не отдаём.
  router.get('/:id/invites', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await deps.invites.list.execute(req.params.id as string, req.user!.id);
      res.json({ invites: list.map((i) => inviteToDto(i)) });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/workspaces/:id/invites — создать invite; token+url только в этом ответе.
  router.post('/:id/invites', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createWorkspaceInviteSchema.parse(req.body);
      const { invite } = await deps.invites.create.execute({
        workspaceId: req.params.id as string,
        actorUserId: req.user!.id,
        role: body.role,
        email: body.email ?? null,
      });
      res.status(201).json({
        invite: inviteToDto(invite, { includeToken: true, appUrl: deps.appUrl }),
      });
    } catch (e) {
      next(e);
    }
  });

  // DELETE /api/workspaces/:id/invites/:inviteId — отозвать invite.
  router.delete(
    '/:id/invites/:inviteId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await deps.invites.delete.execute(
          req.params.id as string,
          req.user!.id,
          req.params['inviteId'] as string,
        );
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );
```

(Смена роли/удаление участника с защитой последнего owner уже реализованы — `PATCH/DELETE /:id/members/:userId` → `WorkspaceService.changeMemberRole/removeMember` бросают `LastOwnerError`; менять их не нужно, только role-enum схем из Step 1.)

- [ ] **Step 3: invites/routes.ts — dual-token accept.** В `server/src/presentation/invites/routes.ts`:

1. Импорты — добавить:

```ts
import type { AcceptWorkspaceInvite } from '../../application/workspace/AcceptWorkspaceInvite.js';
import { WorkspaceInviteNotFoundError } from '../../domain/workspace/errors.js';
```

2. Deps:

```ts
type Deps = {
  readonly getByToken: GetInviteByToken;
  readonly acceptWorkspace: AcceptWorkspaceInvite;
  readonly acceptProject: AcceptProjectInvite;
};
```

3. Заменить POST-обработчик `/:token/accept` целиком на:

```ts
  // Accept — требует session. Токены двух поколений: сначала workspace_invites,
  // затем легаси project_invites (спека §3.1). Ответ: { workspaceId } | { projectId }.
  router.post(
    '/:token/accept',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const token = req.params['token'];
        if (typeof token !== 'string') {
          res.status(404).json({ error: 'invite_not_found' });
          return;
        }
        try {
          const { workspaceId } = await deps.acceptWorkspace.execute(token, req.user!.id);
          res.json({ workspaceId });
          return;
        } catch (err) {
          if (!(err instanceof WorkspaceInviteNotFoundError)) throw err;
          // Не workspace-токен — пробуем легаси project_invites.
        }
        const { projectId } = await deps.acceptProject.execute(token, req.user!.id);
        res.json({ projectId });
      } catch (e) {
        next(e);
      }
    },
  );
```

- [ ] **Step 4: снос project-invite-маршрутов.** В `server/src/presentation/projects/routes.ts` удалить:
  - блок `// Invites ---...` со всеми тремя маршрутами `GET/POST/DELETE /:id/invites*` (строки ~1241–1287);
  - тип `InviteDto` и функцию `inviteToDto` (строки ~194–220+);
  - поля Deps `createInvite`, `listInvites`, `deleteInvite` (строки ~124–126);
  - импорты `CreateProjectInvite`, `ListProjectInvites`, `DeleteProjectInvite` (строки 30–32) и `ProjectInvite` (строка 44);
  - `createInviteSchema` из импорта `./schemas.js` (строка ~65).

  В `server/src/presentation/projects/schemas.ts` удалить `export const createInviteSchema = ...` (блок ~строки 215–222) и строку `export type CreateInviteBody = z.infer<typeof createInviteSchema>;` (~строка 254).

  Join-request-маршруты (`POST /:id/join-requests`, resolve) НЕ трогать.

Продолжение (http.ts + index.ts + проверка) — в `task-07-part2.md`.

### Task 7 (part 2): http.ts + index.ts wiring

Продолжение task-07.md (шаги 1–4 сделаны).

- [ ] **Step 5: http.ts — AppDeps и mounts.** В `server/src/presentation/http.ts`:

1. Импорты типов — добавить:

```ts
import type { CreateWorkspaceInvite } from '../application/workspace/CreateWorkspaceInvite.js';
import type { ListWorkspaceInvites } from '../application/workspace/ListWorkspaceInvites.js';
import type { DeleteWorkspaceInvite } from '../application/workspace/DeleteWorkspaceInvite.js';
import type { AcceptWorkspaceInvite } from '../application/workspace/AcceptWorkspaceInvite.js';
```

и удалить импорты типов `CreateProjectInvite`, `ListProjectInvites`, `DeleteProjectInvite` (найти по grep — они использовались только в `AppDeps.projects`).

2. В `AppDeps.projects` удалить строки `readonly createInvite: CreateProjectInvite;`, `readonly listInvites: ListProjectInvites;`, `readonly deleteInvite: DeleteProjectInvite;`.

3. `AppDeps.workspaces` (строки ~370–372) заменить на:

```ts
  readonly workspaces: {
    readonly service: WorkspaceService;
    readonly invites: {
      readonly create: CreateWorkspaceInvite;
      readonly list: ListWorkspaceInvites;
      readonly delete: DeleteWorkspaceInvite;
    };
    readonly appUrl: string;
  };
```

4. `AppDeps.invites` (строки ~379–382) заменить на:

```ts
  readonly invites: {
    readonly getByToken: GetInviteByToken;
    readonly acceptWorkspace: AcceptWorkspaceInvite;
    readonly acceptProject: AcceptProjectInvite;
  };
```

5. Mounts: `app.use('/api/workspaces', workspacesRouter({ service: deps.workspaces.service }));` → `app.use('/api/workspaces', workspacesRouter(deps.workspaces));`
   и mount инвайтов (строки ~851–854) →

```ts
  app.use('/api/invites', invitesRouter({
    getByToken: deps.invites.getByToken,
    acceptWorkspace: deps.invites.acceptWorkspace,
    acceptProject: deps.invites.acceptProject,
  }));
```

- [ ] **Step 6: index.ts wiring.** В `server/src/index.ts`:

1. Импорты: удалить строки 100–102 (`import { CreateProjectInvite } ...`, `ListProjectInvites`, `DeleteProjectInvite`); добавить:

```ts
import { CreateWorkspaceInvite } from './application/workspace/CreateWorkspaceInvite.js';
import { AcceptWorkspaceInvite } from './application/workspace/AcceptWorkspaceInvite.js';
import { ListWorkspaceInvites } from './application/workspace/ListWorkspaceInvites.js';
import { DeleteWorkspaceInvite } from './application/workspace/DeleteWorkspaceInvite.js';
```

2. Из блока `projects:` createApp удалить инстансы `createInvite: new CreateProjectInvite({...})`, `listInvites: new ListProjectInvites({...})`, `deleteInvite: new DeleteProjectInvite({...})` (строки ~1503–1526).

3. Блок `workspaces:` (~строки 1557–1559) заменить на:

```ts
  workspaces: {
    service: workspaceService,
    invites: {
      create: new CreateWorkspaceInvite({
        workspaces: workspaceRepo,
        invites: workspaceInviteRepo,
        users: userRepo,
        notifications: notificationRepo,
        email: emailSender,
        idGen: idGenerator,
        randomToken: () => randomBytes(32).toString('hex'),
        now,
        ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 дней — как у project-инвайтов
        appUrl: appBaseUrl,
      }),
      list: new ListWorkspaceInvites({
        workspaces: workspaceRepo,
        invites: workspaceInviteRepo,
        now,
      }),
      delete: new DeleteWorkspaceInvite({
        workspaces: workspaceRepo,
        invites: workspaceInviteRepo,
      }),
    },
    appUrl: appBaseUrl,
  },
```

4. В блоке `invites:` (после правки Task 6) переименовать ключ `accept:` → `acceptProject:` и добавить:

```ts
    acceptWorkspace: new AcceptWorkspaceInvite({
      invites: workspaceInviteRepo,
      workspaces: workspaceRepo,
      now,
    }),
```

  Итоговый блок:

```ts
  invites: {
    getByToken: new GetInviteByToken({
      invites: projectInviteRepo,
      workspaceInvites: workspaceInviteRepo,
      projects: projectRepo,
      workspaces: workspaceRepo,
      users: userRepo,
      now,
    }),
    acceptWorkspace: new AcceptWorkspaceInvite({
      invites: workspaceInviteRepo,
      workspaces: workspaceRepo,
      now,
    }),
    acceptProject: new AcceptProjectInvite({
      invites: projectInviteRepo,
      projects: projectRepo,
      workspaces: workspaceRepo,
      now,
      activityRecorder,
    }),
  },
```

  Примечание: если `appBaseUrl` объявлен НИЖЕ createApp — использовать то же выражение, что в соседнем `projects.appUrl` (`process.env['APP_URL'] ?? process.env['PUBLIC_APP_URL'] ?? 'http://localhost:5173'`); сверить по факту grep-ом `appBaseUrl` в index.ts.

- [ ] **Step 7: компиляция + тесты + smoke.** Из `c:/www/ProjectsFlow/server`:
  1. `npx tsc -p tsconfig.json --noEmit` — 0 ошибок (использования `CreateProjectInvite`/`ListProjectInvites`/`DeleteProjectInvite` остались только внутри их собственных файлов — их удалит Task 10).
  2. `npm test` — полный набор зелёный.
  3. Убедиться grep-ом, что маршрутов больше нет: `rg -n "'/:id/invites'" server/src/presentation/projects/routes.ts` → пусто; `rg -n "'/:id/invites'" server/src/presentation/workspaces/routes.ts` → 2 совпадения (get/post).

- [ ] **Step 8: commit.**
  `git add server/src/presentation/workspaces/schemas.ts server/src/presentation/workspaces/routes.ts server/src/presentation/invites/routes.ts server/src/presentation/projects/routes.ts server/src/presentation/projects/schemas.ts server/src/presentation/http.ts server/src/index.ts && git commit -m "feat(workspace): REST-инвайты пространства (GET/POST/DELETE /api/workspaces/:id/invites), dual-token accept, снос project-invite-маршрутов"`

### Task 8: join-requests — accept зачисляет в пространство проекта

**Files:**
- Modify: `server/src/application/project/ResolveProjectJoinRequest.ts` (полная перезапись, сейчас 68 строк)
- Test (create): `server/src/application/project/ResolveProjectJoinRequest.test.ts`
- Modify: `server/src/application/project/RequestProjectJoin.ts` (только комментарий — поведение не меняется)
- Modify: `server/src/index.ts` (wiring `resolveJoinRequest`, ~строки 1542–1549)

**Interfaces:**
- Consumes: `projectRepo.getWorkspaceId(projectId): Promise<string|null>` (есть в интерфейсе `ProjectRepository`, строка 70); `workspaceRepo.getMembership/addMember`; `requireProjectAccess(deps, projectId, userId, 'invite_member')`; Task 4 (владельцы для нотификаций в `RequestProjectJoin` приходят из `listByProject` → ws-участники — код не меняется).
- Produces: `ResolveProjectJoinRequest.execute(joinRequestId, actorUserId, accept): Promise<{ status: JoinRequestStatus }>` — сигнатура прежняя; accept теперь = `workspace_members.addMember(ws проекта, requester, 'editor')`, без `project_members.add`, без prefs-копии, без `hubSync`.

- [ ] **Step 1: падающий тест.** Создать `server/src/application/project/ResolveProjectJoinRequest.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResolveProjectJoinRequest } from './ResolveProjectJoinRequest.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';

// Стиль фейков — как в DelegateExistingTask.test.ts: минимальные объекты + `as never`.

type JoinRequest = {
  id: string;
  projectId: string;
  requesterUserId: string;
  status: 'pending' | 'accepted' | 'declined';
};

function makeHarness(opts: {
  jr?: Partial<JoinRequest>;
  actorRole?: 'owner' | 'editor' | 'viewer' | null;
  wsMembers?: Array<{ workspaceId: string; userId: string; role: WorkspaceRole }>;
}) {
  const jr: JoinRequest = {
    id: 'jr-1',
    projectId: 'p-1',
    requesterUserId: 'u-req',
    status: 'pending',
    ...opts.jr,
  };
  const wsMembers = (opts.wsMembers ?? []).map((m) => ({ ...m }));
  const resolved: Array<{ id: string; status: string }> = [];

  const uc = new ResolveProjectJoinRequest({
    projects: {
      getById: async (id: string) =>
        id === 'p-1' ? { id: 'p-1', isInbox: false, ownerId: 'u-owner' } : null,
      getWorkspaceId: async (id: string) => (id === 'p-1' ? 'ws-1' : null),
    } as never,
    members: {
      // requireProjectAccess: членство актора в проекте (через пространство — Task 4).
      findForProject: async (_projectId: string, userId: string) =>
        userId === 'u-owner' && opts.actorRole !== null
          ? { projectId: 'p-1', userId, role: opts.actorRole ?? 'owner', joinedAt: new Date(0) }
          : null,
    } as never,
    joinRequests: {
      getById: async (id: string) => (id === jr.id ? { ...jr } : null),
      resolve: async (id: string, status: string) => {
        resolved.push({ id, status });
      },
    } as never,
    workspaces: {
      getMembership: async (workspaceId: string, userId: string) => {
        const m = wsMembers.find((x) => x.workspaceId === workspaceId && x.userId === userId);
        return m ? { workspaceId, userId, role: m.role } : null;
      },
      addMember: async (workspaceId: string, userId: string, role: WorkspaceRole) => {
        wsMembers.push({ workspaceId, userId, role });
      },
    },
    now: () => new Date('2026-07-13T12:00:00Z'),
  });

  return { uc, wsMembers, resolved };
}

test('accept: заявитель зачисляется в ПРОСТРАНСТВО проекта с ролью editor', async () => {
  const { uc, wsMembers, resolved } = makeHarness({});
  const res = await uc.execute('jr-1', 'u-owner', true);
  assert.equal(res.status, 'accepted');
  assert.deepEqual(wsMembers, [{ workspaceId: 'ws-1', userId: 'u-req', role: 'editor' }]);
  assert.deepEqual(resolved, [{ id: 'jr-1', status: 'accepted' }]);
});

test('accept: заявитель уже участник пространства — роль не трогаем', async () => {
  const { uc, wsMembers } = makeHarness({
    wsMembers: [{ workspaceId: 'ws-1', userId: 'u-req', role: 'owner' }],
  });
  await uc.execute('jr-1', 'u-owner', true);
  assert.equal(wsMembers.length, 1);
  assert.equal(wsMembers[0]?.role, 'owner');
});

test('decline: участник не добавляется, статус declined', async () => {
  const { uc, wsMembers, resolved } = makeHarness({});
  const res = await uc.execute('jr-1', 'u-owner', false);
  assert.equal(res.status, 'declined');
  assert.equal(wsMembers.length, 0);
  assert.deepEqual(resolved, [{ id: 'jr-1', status: 'declined' }]);
});

test('уже resolved заявка — идемпотентный ответ без побочек', async () => {
  const { uc, wsMembers, resolved } = makeHarness({ jr: { status: 'accepted' } });
  const res = await uc.execute('jr-1', 'u-owner', true);
  assert.equal(res.status, 'accepted');
  assert.equal(wsMembers.length, 0);
  assert.equal(resolved.length, 0);
});

test('не-владелец не может резолвить (requireProjectAccess invite_member)', async () => {
  const { uc } = makeHarness({ actorRole: null });
  await assert.rejects(() => uc.execute('jr-1', 'u-owner', true));
});
```

- [ ] **Step 2: убедиться, что падает.** Из `c:/www/ProjectsFlow/server`:
  `node --import tsx --test src/application/project/ResolveProjectJoinRequest.test.ts`
  Ожидаемо: конструктор не принимает `workspaces`, accept-тест падает (старый код зовёт `members.add`).

- [ ] **Step 3: перезапись ResolveProjectJoinRequest.** Заменить всё содержимое `server/src/application/project/ResolveProjectJoinRequest.ts` на:

```ts
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { JoinRequestStatus } from '../../domain/project/ProjectJoinRequest.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { ProjectJoinRequestRepository } from './ProjectJoinRequestRepository.js';
import type {
  WorkspaceMember,
  WorkspaceRole,
} from '../../domain/workspace/WorkspaceMember.js';
import { requireProjectAccess } from './projectAccess.js';

type WorkspacesPort = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly joinRequests: ProjectJoinRequestRepository;
  readonly workspaces: WorkspacesPort;
  readonly now: () => Date;
};

// Владелец (или admin) принимает/отклоняет заявку по git-коллизии. Accept → заявитель
// зачисляется в ПРОСТРАНСТВО проекта с ролью editor (спека unified-workspace §3.2):
// доступ к проекту дальше деривится через workspace_members, project_members не пишем.
export class ResolveProjectJoinRequest {
  constructor(private readonly deps: Deps) {}

  async execute(
    joinRequestId: string,
    actorUserId: string,
    accept: boolean,
  ): Promise<{ status: JoinRequestStatus }> {
    const jr = await this.deps.joinRequests.getById(joinRequestId);
    if (!jr) throw new ProjectNotFoundError();

    // Решать может только тот, кто вправе приглашать (owner проекта или admin-bypass).
    await requireProjectAccess(this.deps, jr.projectId, actorUserId, 'invite_member');

    if (jr.status !== 'pending') return { status: jr.status };

    if (accept) {
      const workspaceId = await this.deps.projects.getWorkspaceId(jr.projectId);
      if (!workspaceId) throw new ProjectNotFoundError();
      const existing = await this.deps.workspaces.getMembership(
        workspaceId,
        jr.requesterUserId,
      );
      if (!existing) {
        await this.deps.workspaces.addMember(workspaceId, jr.requesterUserId, 'editor');
      }
    }

    const status: Exclude<JoinRequestStatus, 'pending'> = accept ? 'accepted' : 'declined';
    await this.deps.joinRequests.resolve(joinRequestId, status, actorUserId, this.deps.now());
    return { status };
  }
}
```

  (Импорты `UserRepository` и `HubMembershipSync` из старой версии не переносятся.)

- [ ] **Step 4: прогнать — PASS.** `node --import tsx --test src/application/project/ResolveProjectJoinRequest.test.ts` — 5 тестов зелёные.

- [ ] **Step 5: RequestProjectJoin — только комментарий.** В `server/src/application/project/RequestProjectJoin.ts` заменить комментарий над классом (строки 21–22) на:

```ts
// Заявитель просится в чужой проект (по совпадению git-репо). Создаёт join-request +
// уведомляет владельцев (in-app push через SSE + best-effort email).
// После перехода на единое пространство код не менялся: «уже участник» и владельцы
// (listByProject → role 'owner') читаются через workspace_members (Task 4).
```

- [ ] **Step 6: wiring index.ts.** В `server/src/index.ts` заменить блок `resolveJoinRequest:` (~строки 1542–1549) на:

```ts
    resolveJoinRequest: new ResolveProjectJoinRequest({
      projects: projectRepo,
      members: projectMemberRepo,
      joinRequests: projectJoinRequestRepo,
      workspaces: workspaceRepo,
      now,
    }),
```

  (Ключи `users` и `hubSync` удаляются — новый Deps их не принимает.)

- [ ] **Step 7: компиляция + полный прогон + commit.** Из `c:/www/ProjectsFlow/server`: `npx tsc -p tsconfig.json --noEmit`; `npm test`. Затем:
  `git add server/src/application/project/ResolveProjectJoinRequest.ts server/src/application/project/ResolveProjectJoinRequest.test.ts server/src/application/project/RequestProjectJoin.ts server/src/index.ts && git commit -m "feat(workspace): accept join-request зачисляет заявителя в пространство проекта (editor), без project_members и hubSync"`

### Task 9: снос HubMembershipSync + упрощение WorkspaceService.moveProject

**Files:**
- Delete: `server/src/application/workspace/HubMembershipSync.ts`, `server/src/application/workspace/HubMembershipSync.test.ts`
- Modify: `server/src/application/project/RemoveProjectMember.ts` (убрать hubSync)
- Modify: `server/src/application/project/ProjectMemberRepository.ts` (только комментарий у `isMemberOfAnyProjectOwnedBy`)
- Modify: `server/src/application/workspace/WorkspaceService.ts` (moveProject без копирования участников; роли editor)
- Test (modify): `server/src/application/workspace/WorkspaceService.test.ts`
- Modify: `server/src/index.ts` (import стр. 23, инстанс стр. 363–367, wiring `removeMember` стр. 1493, конструктор `workspaceService` стр. 324–330)

**Interfaces:**
- Consumes: Task 6 и Task 8 уже убрали `hubSync` из `AcceptProjectInvite` и `ResolveProjectJoinRequest` — остаются ровно три точки: `RemoveProjectMember`, инстанс и import в `index.ts`. Секция A: `WorkspaceRole = 'owner'|'editor'|'viewer'`.
- Produces: `WorkspaceService` без порта `ProjectMembersPort` (Deps = `{ repo; projects; users; idGen }`); `addMember(workspaceId, actorId, email, role: WorkspaceRole = 'editor')`; `changeMemberRole` защищает последнего owner при ЛЮБОМ понижении (`role !== 'owner'`); `moveProject` больше не копирует участников (задокументированное следствие модели — спека §3.2).

- [ ] **Step 1: обновить WorkspaceService.test.ts (падающие тесты).** В `server/src/application/workspace/WorkspaceService.test.ts`:

1. В `Seed.projects` убрать поле `members?: string[]` и в makeFakes строку `const projects = (seed.projects ?? []).map((p) => ({ ...p, members: p.members ?? [p.ownerId] }));` заменить на `const projects = (seed.projects ?? []).map((p) => ({ ...p }));`.
2. Удалить целиком `const projectMembersPort = {...}` (строки ~136–141) и убрать `projectMembers: projectMembersPort` из конструктора `new WorkspaceService({...})` (строка ~149).
3. Все сиды/вызовы с ролью `'member'` заменить на `'editor'` (строки ~169, 187, 196, 205):
   - `{ workspaceId: 'w1', userId: 'u2', role: 'member' }` → `role: 'editor'`;
   - `service.changeMemberRole('w1', 'u1', 'u1', 'member')` → `'editor'`;
   - `service.addMember('w1', 'u1', 'nobody@x', 'member')` → `'editor'`;
   - `service.addMember('w1', 'u1', 'u2@x', 'member')` → `'editor'` и assert роли `'editor'`.
4. Тест `moveProject: moves and auto-adds project members to target workspace` (строки ~262–271) заменить на:

```ts
test('moveProject: участники НЕ копируются — аудитория проекта = аудитория целевого пространства', async () => {
  const { service, repo, projects } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }, { id: 'w2', ownerUserId: 'u1' }],
    members: [
      { workspaceId: 'w1', userId: 'u1', role: 'owner' },
      { workspaceId: 'w1', userId: 'u2', role: 'editor' }, // видел проект в w1
      { workspaceId: 'w2', userId: 'u1', role: 'owner' },
    ],
    projects: [{ id: 'p1', ownerId: 'u1', workspaceId: 'w1' }],
  });
  await service.moveProject('w1', 'u1', 'p1', 'w2');
  assert.equal(projects.find((p) => p.id === 'p1')?.workspaceId, 'w2');
  // u2 не перетащило в w2: он теряет доступ к p1 — задокументированное следствие модели.
  assert.deepEqual((await repo.listMembers('w2')).map((m) => m.userId), ['u1']);
});
```

5. Добавить в конец файла два теста:

```ts
test('addMember: роль по умолчанию — editor', async () => {
  const { service, repo } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    users: [{ id: 'u1', email: 'u1@x' }, { id: 'u2', email: 'u2@x' }],
  });
  await service.addMember('w1', 'u1', 'u2@x');
  assert.equal((await repo.getMembership('w1', 'u2'))?.role, 'editor');
});

test('changeMemberRole: понижение последнего owner до viewer тоже отклоняется', async () => {
  const { service } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
  });
  await assert.rejects(() => service.changeMemberRole('w1', 'u1', 'u1', 'viewer'), LastOwnerError);
});
```

- [ ] **Step 2: убедиться, что падает.** Из `c:/www/ProjectsFlow/server`:
  `node --import tsx --test src/application/workspace/WorkspaceService.test.ts`
  Ожидаемо: конструктор требует `projectMembers`; тест moveProject падает (старый код копирует участников); default-роль — 'member'.

- [ ] **Step 3: правка WorkspaceService.ts.** В `server/src/application/workspace/WorkspaceService.ts`:

1. Удалить тип `ProjectMembersPort` (строки 34–36) и поле `readonly projectMembers: ProjectMembersPort;` из `Deps` (строка 44).
2. `addMember`: `role: WorkspaceRole = 'member'` → `role: WorkspaceRole = 'editor'`.
3. `changeMemberRole`: заменить проверку понижения (строки 138–142) на:

```ts
    // Понижение owner'а: нельзя оставить пространство без владельца.
    if (target.role === 'owner' && role !== 'owner') {
      const owners = await this.deps.repo.countOwners(workspaceId);
      if (owners <= 1) throw new LastOwnerError();
    }
```

4. `moveProject`: удалить хвост метода (строки 182–186):

```ts
    // Все участники проекта должны стать участниками целевого пространства (идемпотентно).
    const members = await this.deps.projectMembers.listByProject(projectId);
    for (const m of members) {
      await this.deps.repo.addMember(targetWorkspaceId, m.userId, 'member');
    }
```

   и вместо него оставить комментарий:

```ts
    // Участники НЕ копируются: доступ к проекту деривится из workspace_members целевого
    // пространства (спека unified-workspace §3.2) — перенос просто меняет аудиторию.
```

- [ ] **Step 4: прогнать — PASS.** `node --import tsx --test src/application/workspace/WorkspaceService.test.ts` — все тесты зелёные.

- [ ] **Step 5: RemoveProjectMember без hubSync.** В `server/src/application/project/RemoveProjectMember.ts`:
  - удалить импорт `HubMembershipSync` (строка 9);
  - удалить из Deps поле `hubSync` с комментарием (строки 16–17);
  - удалить блок вызова (строки 38–43):

```ts
    // Убираем из хаб-чата владельца, если общих проектов больше нет (best-effort).
    try {
      await this.deps.hubSync?.onMemberRemoved(projectId, targetUserId);
    } catch {
      // Синк хаба не должен ломать удаление участника.
    }
```

  В `server/src/application/project/ProjectMemberRepository.ts` заменить комментарий над `isMemberOfAnyProjectOwnedBy` (строка ~50) на:
  `// Есть ли у userId общий (не-inbox) проект с ownerUserId. Считается через общие пространства.`

- [ ] **Step 6: index.ts.** В `server/src/index.ts`:
  - удалить `import { HubMembershipSync } from './application/workspace/HubMembershipSync.js';` (строка 23);
  - удалить инстанс с комментарием (строки ~361–367):

```ts
// Синк участников дефолт-хаба владельца с участниками его проектов (для общего чата).
// Дёргается best-effort из invite/accept/remove use-cases.
const hubMembershipSync = new HubMembershipSync({
  projects: projectRepo,
  members: projectMemberRepo,
  workspaces: workspaceRepo,
});
```

  - в конструкторе `workspaceService` (строки 324–330) удалить строку `projectMembers: projectMemberRepo,`;
  - в wiring `removeMember: new RemoveProjectMember({...})` (строка ~1493) удалить `hubSync: hubMembershipSync`;
  - `rg -n "hubMembershipSync|HubMembershipSync" server/src` → должно быть пусто.

- [ ] **Step 7: удалить файлы + финальная проверка + commit.**
  `git rm server/src/application/workspace/HubMembershipSync.ts server/src/application/workspace/HubMembershipSync.test.ts`
  Из `c:/www/ProjectsFlow/server`: `npx tsc -p tsconfig.json --noEmit`; `npm test` — зелёные. Затем:
  `git add server/src/application/project/RemoveProjectMember.ts server/src/application/project/ProjectMemberRepository.ts server/src/application/workspace/WorkspaceService.ts server/src/application/workspace/WorkspaceService.test.ts server/src/index.ts && git commit -m "refactor(workspace): снос HubMembershipSync — членство хаба управляется приглашениями; moveProject не копирует участников"`

### Task 10: финальная зачистка wiring — удаление легаси project-invite use-cases, сверка email/TTL

**Files:**
- Delete: `server/src/application/project/CreateProjectInvite.ts`, `server/src/application/project/ListProjectInvites.ts`, `server/src/application/project/DeleteProjectInvite.ts`
- Delete (после grep-проверки): `server/src/application/notifications/emails/inviteEmail.ts`
- Modify: `server/src/index.ts` (только если grep найдёт хвосты — Task 7 уже должен был убрать импорты/wiring)

**Interfaces:**
- Consumes: результаты Task 5–9 (workspace-инвайты реализованы и закоммичены; project-invite routes/wiring снесены в Task 7; email-шаблон `workspaceInviteEmail.ts` создан в Task 5 — этот таск его СВЕРЯЕТ, не создаёт).
- Produces: сервер без создания project-инвайтов; `project_invites` остаётся только на чтение (легаси-токены: `GetInviteByToken`/`AcceptProjectInvite` + `DrizzleProjectInviteRepository` + schema) — новые строки не создаются.

- [ ] **Step 1: убедиться, что use-cases осиротели.** Из корня репо:
  `rg -n "CreateProjectInvite|ListProjectInvites|DeleteProjectInvite" server/src --glob "!server/src/application/project/CreateProjectInvite.ts" --glob "!server/src/application/project/ListProjectInvites.ts" --glob "!server/src/application/project/DeleteProjectInvite.ts"`
  Ожидаемо: пусто. Если находятся ссылки в `server/src/index.ts` или `server/src/presentation/http.ts` — это недоделанный Task 7: удалить эти импорты/поля/инстансы точно по инструкции Task 7 Step 5–6 прежде чем продолжать.

- [ ] **Step 2: удалить файлы use-cases.**
  `git rm server/src/application/project/CreateProjectInvite.ts server/src/application/project/ListProjectInvites.ts server/src/application/project/DeleteProjectInvite.ts`

- [ ] **Step 3: удалить осиротевший email-шаблон проекта.** Проверить:
  `rg -n "renderInviteEmail|emails/inviteEmail" server/src`
  Единственным потребителем был `CreateProjectInvite` (удалён в Step 2). Если grep пуст — `git rm server/src/application/notifications/emails/inviteEmail.ts`. Если НЕ пуст (кто-то ещё импортирует) — оставить файл и зафиксировать это в commit-message.

- [ ] **Step 4: сверка workspace-инвайт-цепочки (read-only проверки).**
  1. Accept-URL в письме: `rg -n "/invite/" server/src/application/workspace/CreateWorkspaceInvite.ts server/src/application/notifications/emails/workspaceInviteEmail.ts` → в `CreateWorkspaceInvite` есть `` `${this.deps.appUrl.replace(/\/$/, '')}/invite/${invite.token}` ``.
  2. TTL: `rg -n "ttlMs" server/src/index.ts` → у `CreateWorkspaceInvite` wiring стоит `ttlMs: 7 * 24 * 60 * 60 * 1000`.
  3. Токен: `rg -n "randomToken" server/src/index.ts` → `() => randomBytes(32).toString('hex')` (64 hex-символа = CHAR(64) в `workspace_invites.token`).
  4. Легаси-чтение живо: `rg -ln "projectInvites" server/src` → только `schema.ts`, `DrizzleProjectInviteRepository.ts`; `rg -ln "ProjectInviteRepository" server/src/application` → `ProjectInviteRepository.ts`, `GetInviteByToken.ts`, `AcceptProjectInvite.ts` (+ их тесты).
  Любое расхождение — чинить по инструкции соответствующего таска (5/6/7), а не изобретать на месте.

- [ ] **Step 5: полная проверка сервера.** Из `c:/www/ProjectsFlow/server`:
  1. `npx tsc -p tsconfig.json --noEmit` — 0 ошибок.
  2. `npm test` — весь набор зелёный.
  Из корня: `npm run typecheck` и `npm run lint` (клиент не трогали, но ловим случайные хвосты).

- [ ] **Step 6: commit.**
  `git add -u server/src && git commit -m "chore(workspace): удалены легаси use-cases project-инвайтов и их email-шаблон — приглашения только в пространство, старые токены работают через dual-резолв"`
  (`git add -u` здесь безопасен: затронуты только заранее известные удаления из Step 2–3; НЕ использовать `git add -A`.)

# Секция C — SERVER: делегирование сразу accepted

### Task 11: Делегирование создаётся сразу `accepted` (+`responded_at`), письмо без кнопок принятия

**Files:**
- Modify: `server/src/application/task/DelegateExistingTask.ts` (строки 44–48 комментарий, 84–96 create)
- Modify: `server/src/application/task/ReassignTaskDelegation.ts` (строки 33–39 комментарий, 85–90 create)
- Modify: `server/src/application/task/CreateTask.ts` (строки 187–192 create в `delegateOrThrow`)
- Modify: `server/src/infrastructure/repositories/DrizzleTaskDelegationRepository.ts` (строки 79–86, insert)
- Modify: `server/src/application/task/TaskDelegationRepository.ts` (строки 13–15, комментарий у `status`)
- Modify: `server/src/application/notifications/emails/delegationEmail.ts` (полная замена текстов)
- Test (modify): `server/src/application/task/DelegateExistingTask.test.ts`
- Test (create): `server/src/application/task/ReassignTaskDelegation.test.ts`
- Test (create): `server/src/application/task/CreateTask.test.ts`

**Interfaces:**
- Consumes: `TaskDelegationRepository.create(input: CreateDelegationInput)` c полем `status?: TaskDelegationStatus` (существующий порт, не меняется).
- Produces: **инвариант** — все три пути создания делегации (`CreateTask`, `DelegateExistingTask`, `ReassignTaskDelegation`) создают строку `status: 'accepted'`, а Drizzle-реализация при `status === 'accepted'` пишет `responded_at = NOW()`. Уведомление `task_delegation` (in-app + email) сохраняется для не-self делегирований. На этот инвариант опираются Task 12 (canModify без гейта по статусу) и Task 15 (TG-composer).

Все команды — из каталога `c:/www/ProjectsFlow/server`.

- [ ] **Step 1: падающий тест — DelegateExistingTask создаёт accepted для чужого делегата.**
  В `server/src/application/task/DelegateExistingTask.test.ts` заменить тест `«обычное делегирование другому: pending + уведомление уходит»` (строки 92–99) на:
  ```ts
  test('обычное делегирование другому: сразу accepted + уведомление уходит', async () => {
    const h = makeHarness();
    const result = await h.delegate.execute('t1', OTHER_ID, OWNER_ID);
    await flushAsync();
    assert.equal(result.status, 'accepted');
    assert.equal(h.createdInputs[0]?.status, 'accepted');
    assert.ok(h.notifyCalls > 0);
  });
  ```
  Остальные тесты файла не трогать (self-тест уже ждёт accepted).

- [ ] **Step 2: убедиться, что тест красный.**
  ```
  node --import tsx --test src/application/task/DelegateExistingTask.test.ts
  ```
  Ожидаемо: `fail 1` — `result.status` равен `'pending'`, а не `'accepted'`.

- [ ] **Step 3: реализация — DelegateExistingTask всегда создаёт accepted.**
  В `server/src/application/task/DelegateExistingTask.ts`:
  1) Заменить блок create (строки 84–90):
  ```ts
    const created = await this.deps.delegations.create({
      id: this.deps.idGen(),
      taskId,
      delegateUserId,
      delegatorUserId: creatorUserId,
      // Делегирование без принятия/отказа: всегда сразу accepted (спека
      // 2026-07-13-unified-workspace §4). isSelf-особая ветка стала общим случаем.
      status: 'accepted',
    });
  ```
  2) Обновить комментарий у `const isSelf` (строки 44–47) на:
  ```ts
    // Самоделегирование РАЗРЕШЕНО: «назначить себя ответственным» (drag-перенос
    // инбокс-задачи в проект). isSelf влияет только на валидацию (себя нет в
    // shared-members) и на уведомления (себе не шлём) — статус у ВСЕХ делегирований
    // одинаковый: accepted сразу при создании.
    const isSelf = delegateUserId === creatorUserId;
  ```

- [ ] **Step 4: тест зелёный.**
  ```
  node --import tsx --test src/application/task/DelegateExistingTask.test.ts
  ```
  Ожидаемо: `pass 3, fail 0`.

- [ ] **Step 5: commit.**
  ```
  git add server/src/application/task/DelegateExistingTask.ts server/src/application/task/DelegateExistingTask.test.ts
  git commit -m "feat(delegations): DelegateExistingTask создаёт делегирование сразу accepted"
  ```

- [ ] **Step 6: падающий тест — ReassignTaskDelegation создаёт accepted.**
  Создать `server/src/application/task/ReassignTaskDelegation.test.ts` (полностью):
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { ReassignTaskDelegation } from './ReassignTaskDelegation.js';

  // Минимальные in-memory фейки по образцу DelegateExistingTask.test.ts.
  // Сценарий — inbox-проект: владелец переназначает с одного делегата на другого.

  const OWNER_ID = 'u-owner';
  const OLD_DELEGATE = 'u-old';
  const NEW_DELEGATE = 'u-new';

  type Created = {
    id: string;
    taskId: string;
    delegateUserId: string;
    delegatorUserId: string;
    status?: string;
  };

  function makeHarness() {
    const createdInputs: Created[] = [];
    const statusCalls: { id: string; status: string }[] = [];
    const counters = { notify: 0 };

    const reassign = new ReassignTaskDelegation({
      projects: {
        getById: async () => ({ id: 'p1', isInbox: true, ownerId: OWNER_ID }),
      } as never,
      members: {
        listSharedUsers: async () => [{ id: OLD_DELEGATE }, { id: NEW_DELEGATE }],
        findForProject: async () => null,
      } as never,
      tasks: {
        getById: async () => ({ id: 't1', projectId: 'p1', description: 'demo' }),
      } as never,
      delegations: {
        findActiveForTask: async () =>
          ({ id: 'd-old', taskId: 't1', delegateUserId: OLD_DELEGATE, status: 'accepted' }) as never,
        setStatus: async (id: string, s: string) => {
          statusCalls.push({ id, status: s });
          return null;
        },
        create: async (input: Created) => {
          createdInputs.push(input);
          return {
            ...input,
            delegateDisplayName: '',
            creatorUserId: input.delegatorUserId,
            creatorDisplayName: '',
            status: input.status ?? 'pending',
            createdAt: new Date(0),
            respondedAt: null,
            revertToUserId: null,
          };
        },
      } as never,
      users: {
        // notifyDelegated начинается с users.getById — считаем вход в notify по нему.
        getById: async (id: string) => {
          counters.notify += 1;
          return { id, email: 'x@x', displayName: 'X' };
        },
      } as never,
      notifications: { create: async () => {} } as never,
      email: { send: async () => {} } as never,
      idGen: () => 'id-new',
      appUrl: 'https://example.test',
    });

    return {
      reassign,
      createdInputs,
      statusCalls,
      get notifyCalls() {
        return counters.notify;
      },
    };
  }

  const flushAsync = async (): Promise<void> => new Promise((r) => setImmediate(r));

  test('переназначение: старая архивируется, новая — сразу accepted, уведомление уходит', async () => {
    const h = makeHarness();
    const result = await h.reassign.execute('t1', NEW_DELEGATE, OWNER_ID);
    await flushAsync();
    assert.deepEqual(h.statusCalls, [{ id: 'd-old', status: 'archived' }]);
    assert.equal(h.createdInputs[0]?.status, 'accepted');
    assert.equal(result.status, 'accepted');
    assert.ok(h.notifyCalls > 0);
  });

  test('дроп на текущего делегата — no-op (возвращается активная, ничего не создаётся)', async () => {
    const h = makeHarness();
    const result = await h.reassign.execute('t1', OLD_DELEGATE, OWNER_ID);
    assert.equal(result.id, 'd-old');
    assert.equal(h.createdInputs.length, 0);
    assert.equal(h.statusCalls.length, 0);
  });
  ```

- [ ] **Step 7: убедиться, что красный.**
  ```
  node --import tsx --test src/application/task/ReassignTaskDelegation.test.ts
  ```
  Ожидаемо: `fail 1` (первый тест: `createdInputs[0].status` — `undefined`, не `'accepted'`); второй тест — зелёный.

- [ ] **Step 8: реализация — ReassignTaskDelegation создаёт accepted.**
  В `server/src/application/task/ReassignTaskDelegation.ts` заменить блок create (строки 85–90):
  ```ts
    const created = await this.deps.delegations.create({
      id: this.deps.idGen(),
      taskId,
      delegateUserId,
      delegatorUserId: callerUserId,
      // Мгновенное делегирование: новая делегация сразу accepted (спека §4).
      status: 'accepted',
    });
  ```
  И в шапке класса (строка ~37) поправить фразу «создаётся новая pending» → «создаётся новая (сразу accepted)».

- [ ] **Step 9: тест зелёный.**
  ```
  node --import tsx --test src/application/task/ReassignTaskDelegation.test.ts
  ```
  Ожидаемо: `pass 2, fail 0`.

- [ ] **Step 10: commit.**
  ```
  git add server/src/application/task/ReassignTaskDelegation.ts server/src/application/task/ReassignTaskDelegation.test.ts
  git commit -m "feat(delegations): ReassignTaskDelegation создаёт новую делегацию сразу accepted"
  ```

- [ ] **Step 11: падающий тест — CreateTask с delegateUserId создаёт accepted.**
  Создать `server/src/application/task/CreateTask.test.ts` (полностью):
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { CreateTask } from './CreateTask.js';

  // Фокусный тест ветки delegateOrThrow (inbox-путь). requireProjectAccess проходит
  // через owner-membership фейка members.findForProject.

  const OWNER_ID = 'u-owner';
  const OTHER_ID = 'u-other';

  function makeHarness() {
    const createdDelegations: { status?: string }[] = [];
    const create = new CreateTask({
      projects: {
        getById: async () => ({ id: 'p1', isInbox: true, ownerId: OWNER_ID }),
      } as never,
      members: {
        findForProject: async () => ({
          projectId: 'p1',
          userId: OWNER_ID,
          role: 'owner',
          joinedAt: new Date(0),
        }),
        listSharedUsers: async () => [{ id: OTHER_ID }],
      } as never,
      tasks: {
        getById: async () => null,
        getPositionBounds: async () => null,
        create: async (input: unknown) => ({ ...(input as object), delegation: null }),
      } as never,
      delegations: {
        findActiveForTask: async () => null,
        create: async (input: { status?: string; delegatorUserId: string }) => {
          createdDelegations.push(input);
          return {
            ...input,
            delegateDisplayName: '',
            creatorUserId: input.delegatorUserId,
            creatorDisplayName: '',
            status: input.status ?? 'pending',
            createdAt: new Date(0),
            respondedAt: null,
            revertToUserId: null,
          };
        },
      } as never,
      users: {
        getById: async (id: string) => ({ id, email: 'x@x', displayName: 'X' }),
      } as never,
      notifications: { create: async () => {} } as never,
      email: { send: async () => {} } as never,
      idGen: () => 'id-1',
      appUrl: 'https://example.test',
    });
    return { create, createdDelegations };
  }

  test('создание задачи с делегатом: делегация сразу accepted', async () => {
    const h = makeHarness();
    const task = await h.create.execute({
      projectId: 'p1',
      ownerUserId: OWNER_ID,
      description: 'demo',
      status: 'todo',
      delegateUserId: OTHER_ID,
    });
    assert.equal(h.createdDelegations[0]?.status, 'accepted');
    assert.equal(task.delegation?.status, 'accepted');
  });
  ```

- [ ] **Step 12: убедиться, что красный.**
  ```
  node --import tsx --test src/application/task/CreateTask.test.ts
  ```
  Ожидаемо: `fail 1` (status `undefined`/`'pending'`).

- [ ] **Step 13: реализация — CreateTask.delegateOrThrow создаёт accepted.**
  В `server/src/application/task/CreateTask.ts` заменить блок create (строки 187–192):
  ```ts
    const created = await this.deps.delegations.create({
      id: this.deps.idGen(),
      taskId,
      delegateUserId,
      delegatorUserId: creatorUserId,
      // Мгновенное делегирование: сразу accepted (спека §4), делегат видит задачу
      // в «Поручено мне» и может завершать без «Принять».
      status: 'accepted',
    });
  ```

- [ ] **Step 14: тест зелёный.**
  ```
  node --import tsx --test src/application/task/CreateTask.test.ts
  ```
  Ожидаемо: `pass 1, fail 0`.

- [ ] **Step 15: commit.**
  ```
  git add server/src/application/task/CreateTask.ts server/src/application/task/CreateTask.test.ts
  git commit -m "feat(tasks): CreateTask с делегатом создаёт делегирование сразу accepted"
  ```

- [ ] **Step 16: Drizzle-репозиторий — `responded_at` при создании accepted-строки.**
  (DB-слой, юнит-теста без БД нет — проверка компиляцией.) В `server/src/infrastructure/repositories/DrizzleTaskDelegationRepository.ts` заменить insert в `create` (строки 79–86):
  ```ts
    await this.db.insert(taskDelegations).values({
      id: input.id,
      taskId: input.taskId,
      delegateUserId: input.delegateUserId,
      delegatorUserId: input.delegatorUserId,
      revertToUserId: input.revertToUserId ?? null,
      status: input.status ?? 'pending',
      // Мгновенное делегирование: accepted-строка отвечена в момент создания
      // (responded_at = created_at, спека §4).
      respondedAt: (input.status ?? 'pending') === 'accepted' ? new Date() : null,
    });
  ```
  В `server/src/application/task/TaskDelegationRepository.ts` обновить комментарий у `status` (строки 13–15):
  ```ts
    // Статус создаваемой делегации. Все актуальные пути создают 'accepted'
    // (мгновенное делегирование, спека §4); дефолт 'pending' — легаси.
    readonly status?: TaskDelegationStatus;
  ```

- [ ] **Step 17: письмо `delegationEmail` — без кнопок «Принять/Отклонить».**
  Полностью заменить содержимое `server/src/application/notifications/emails/delegationEmail.ts`:
  ```ts
  import type { EmailMessage } from '../EmailSender.js';

  export type DelegationEmailInput = {
    readonly to: string;
    readonly actorDisplayName: string;
    readonly taskExcerpt: string;
    readonly inboxUrl: string;
  };

  // Письмо «вам поручили задачу». Делегирование принимается автоматически (спека §4) —
  // кнопок «Принять/Отклонить» нет, одна кнопка «Открыть задачу» ведёт на
  // /inbox#delegation=<id>: юзер логинится и видит задачу в блоке «Поручено мне».
  export function renderDelegationEmail(input: DelegationEmailInput): EmailMessage {
    const subject = `${input.actorDisplayName} поручил(а) вам задачу в ProjectsFlow`;

    const text = [
      `${input.actorDisplayName} поручил(а) вам задачу:`,
      '',
      `«${input.taskExcerpt}»`,
      '',
      `Открыть: ${input.inboxUrl}`,
      '',
      'Задача уже в вашем списке «Поручено мне». Если она не ваша — можно снять её с себя в интерфейсе.',
    ].join('\n');

    const html = `<!DOCTYPE html>
  <html lang="ru">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr><td style="padding:28px 32px 8px;">
            <div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:#2563eb;">PROJECTSFLOW</div>
          </td></tr>
          <tr><td style="padding:8px 32px 0;">
            <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f172a;">Вам поручена задача</h1>
            <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#334155;">
              <strong style="color:#0f172a;">${input.actorDisplayName}</strong> поручил(а) вам задачу:
            </p>
            <blockquote style="margin:12px 0 0;padding:12px 14px;border-left:3px solid #2563eb;background:#f8fafc;font-size:14px;line-height:1.5;color:#0f172a;">
              ${input.taskExcerpt}
            </blockquote>
          </td></tr>
          <tr><td style="padding:20px 32px 28px;">
            <a href="${input.inboxUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 24px;border-radius:8px;">
              Открыть задачу
            </a>
            <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
              Задача уже в вашем списке «Поручено мне»:<br/>
              <a href="${input.inboxUrl}" style="color:#2563eb;word-break:break-all;">${input.inboxUrl}</a>
            </p>
          </td></tr>
          <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">Если задача не ваша — снимите её с себя в интерфейсе, создатель получит уведомление.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
  </html>`;

    return { to: input.to, subject, html, text };
  }
  ```

- [ ] **Step 18: компиляция + полный прогон серверных тестов.**
  ```
  npm run build
  npm test
  ```
  Ожидаемо: build без ошибок; все тесты зелёные (существующие тесты AcceptTaskDelegation.test.ts и др. не затронуты — сами use-cases Accept/Decline пока живы, их удаляют Task 12/15).

- [ ] **Step 19: commit.**
  ```
  git add server/src/infrastructure/repositories/DrizzleTaskDelegationRepository.ts server/src/application/task/TaskDelegationRepository.ts server/src/application/notifications/emails/delegationEmail.ts
  git commit -m "feat(delegations): responded_at при создании accepted-делегации; письмо о поручении без кнопок принятия"
  ```

# Секция C — SERVER: делегирование сразу accepted

### Task 12: Удалить accept/decline/pending и invite-delegate флоу (REST + use-cases + порт); `canModify` без гейта по статусу

**Files:**
- Delete: `server/src/application/task/InviteAndDelegateTask.ts`
- Delete: `server/src/application/task/ListMyPendingDelegations.ts`
- Modify: `server/src/presentation/delegations/routes.ts` (полная замена: убраны `GET /pending`, `POST /:id/accept`, `POST /:id/decline`)
- Modify: `server/src/presentation/tasks/routes.ts` (строка 26 импорт, 77 Deps, 543–568 route)
- Modify: `server/src/presentation/http.ts` (импорты 127–128, 134, 140; Deps.delegations 538–539, 542, 548; mount 785)
- Modify: `server/src/index.ts` (импорты 152, 158; createApp `delegations:` — убрать `accept`/`decline`/`listPending`/`inviteAndDelegate`, строки 2030–2051 и 2099–2109)
- Modify: `server/src/application/task/TaskDelegationRepository.ts` (убрать `DelegationWithTaskInfo` (строки 20–24) и `listPendingForDelegate` (57–58))
- Modify: `server/src/infrastructure/repositories/DrizzleTaskDelegationRepository.ts` (убрать метод `listPendingForDelegate` (124–162), импорт `DelegationWithTaskInfo`, константу `TASK_EXCERPT_LEN`)
- Modify: `server/src/application/task/ListTasksAssignedToMe.ts` (visible-фильтр 46–48, canModify 69–71, комментарии 26–28, 34–36, 42–45)
- Test (create): `server/src/application/task/ListTasksAssignedToMe.test.ts`

**ВАЖНО — НЕ трогать в этой задаче:** файлы `AcceptTaskDelegation.ts`, `DeclineTaskDelegation.ts`, `AcceptTaskDelegation.test.ts` — их всё ещё использует Telegram-composer (wiring `index.ts` строки 760–778). Их физически удаляет Task 15 вместе со снятием composer-зависимостей. Здесь удаляются только REST-роуты, `listPending`-цепочка, `InviteAndDelegateTask` и записи `accept`/`decline` в блоке `createApp({ delegations: ... })`.

**Interfaces:**
- Consumes: инвариант Task 11 «новые делегации всегда `accepted`».
- Produces:
  - REST-поверхность `/api/delegations`: остаются ТОЛЬКО `GET /assigned-to-me`, `GET /delegated-to-others`, `DELETE /:id` (withdraw), `POST /:id/relinquish`. (Клиентские правки — Секция E.)
  - `TaskDelegationRepository` без `listPendingForDelegate` и без типа `DelegationWithTaskInfo`.
  - `AssignedTaskView.canModify = isInbox || can(delegateRole,'move_task')` — без гейта по статусу делегации (гейт по роли сохранён).
  - `AppDeps.delegations` (http.ts) = `{ withdraw, relinquish, listAssignedToMe, listDelegatedToOthers, assignToProject, delegateExisting, reassignDelegation }`.

Все команды — из `c:/www/ProjectsFlow/server` (git-команды — из корня репо).

- [ ] **Step 1: падающий тест — canModify без гейта по статусу, pending_invite-строки не спец-кейсятся.**
  Создать `server/src/application/task/ListTasksAssignedToMe.test.ts` (полностью):
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { ListTasksAssignedToMe } from './ListTasksAssignedToMe.js';
  import type { AssignedDelegationRow } from './TaskDelegationRepository.js';
  import type { TaskDelegation, TaskDelegationStatus } from '../../domain/task/TaskDelegation.js';
  import type { ProjectRole } from '../../domain/project/ProjectMembership.js';

  // Минимальные in-memory фейки (tsx + node:test, без новых deps).

  function delegation(status: TaskDelegationStatus): TaskDelegation {
    return {
      id: 'd1',
      taskId: 't1',
      delegateUserId: 'me',
      delegateDisplayName: 'Я',
      creatorUserId: 'u-creator',
      creatorDisplayName: 'Создатель',
      status,
      createdAt: new Date(0),
      respondedAt: null,
      revertToUserId: null,
    };
  }

  function row(over: {
    status?: TaskDelegationStatus;
    isInbox?: boolean;
    delegateRole?: ProjectRole | null;
  }): AssignedDelegationRow {
    return {
      taskId: 't1',
      delegation: delegation(over.status ?? 'accepted'),
      projectId: 'p1',
      projectName: 'Проект',
      isInbox: over.isInbox ?? false,
      delegateRole: over.delegateRole === undefined ? 'editor' : over.delegateRole,
    };
  }

  function makeList(rows: AssignedDelegationRow[]): ListTasksAssignedToMe {
    return new ListTasksAssignedToMe({
      delegations: { listAssignedTo: async () => rows } as never,
      tasks: {
        listByIds: async (ids: readonly string[]) =>
          ids.map((id) => ({ id, projectId: 'p1', description: 'x' })),
      } as never,
      taskCommits: { countsByTasks: async () => new Map<string, number>() } as never,
      attachments: { countsByTasks: async () => new Map<string, number>() } as never,
      comments: { countsByTasks: async () => new Map<string, number>() } as never,
    });
  }

  test('canModify: editor именованного проекта — true БЕЗ гейта по статусу (легаси pending-строка)', async () => {
    const items = await makeList([row({ status: 'pending', delegateRole: 'editor' })]).execute('me');
    assert.equal(items.length, 1);
    assert.equal(items[0]!.canModify, true);
  });

  test('canModify: viewer — false (гейт по роли сохранён)', async () => {
    const items = await makeList([row({ delegateRole: 'viewer' })]).execute('me');
    assert.equal(items.length, 1);
    assert.equal(items[0]!.canModify, false);
  });

  test('inbox-строка: видима и canModify=true (роль null — норма для инбокса)', async () => {
    const items = await makeList([row({ isInbox: true, delegateRole: null })]).execute('me');
    assert.equal(items.length, 1);
    assert.equal(items[0]!.canModify, true);
  });

  test('именованный проект без роли (делегата убрали) — строка отфильтрована, даже для легаси pending_invite', async () => {
    const items = await makeList([
      row({ delegateRole: null }),
      row({ status: 'pending_invite', delegateRole: null }),
    ]).execute('me');
    assert.equal(items.length, 0);
  });
  ```

- [ ] **Step 2: убедиться, что красный.**
  ```
  node --import tsx --test src/application/task/ListTasksAssignedToMe.test.ts
  ```
  Ожидаемо: `fail 2` — тест 1 (canModify=false из-за гейта `status === 'accepted'`) и тест 4 (pending_invite-строка видима). Тесты 2–3 зелёные.

- [ ] **Step 3: реализация — ListTasksAssignedToMe без статусного гейта и pending_invite-веток.**
  В `server/src/application/task/ListTasksAssignedToMe.ts`:
  1) Заменить фильтр (строки 42–48):
  ```ts
    // Отбрасываем строки именованных проектов, где делегата уже убрали из проекта
    // (delegateRole === null && !isInbox). Inbox-строки оставляем (там role всегда null,
    // делегат видит задачу через taskAuthorization). pending_invite-флоу удалён (спека §4).
    const visible = rows.filter((r) => r.isInbox || r.delegateRole !== null);
  ```
  2) Заменить canModify (строки 69–71):
  ```ts
        canModify: r.isInbox || (r.delegateRole !== null && can(r.delegateRole, 'move_task')),
  ```
  3) Обновить комментарий у поля `canModify` в `AssignedTaskView` (строки 26–28):
  ```ts
    // inbox-делегат ИЛИ editor+ участник именованного проекта. Делегация всегда accepted
    // (мгновенное делегирование) — гейта по статусу нет, только по роли.
    readonly canModify: boolean;
  ```
  4) Обновить шапку класса (строка 34): «Все активные (pending|accepted) делегации» → «Все активные делегации (accepted; легаси-статусы добиты миграцией)».

- [ ] **Step 4: тест зелёный.**
  ```
  node --import tsx --test src/application/task/ListTasksAssignedToMe.test.ts
  ```
  Ожидаемо: `pass 4, fail 0`.

- [ ] **Step 5: commit.**
  ```
  git add server/src/application/task/ListTasksAssignedToMe.ts server/src/application/task/ListTasksAssignedToMe.test.ts
  git commit -m "feat(delegations): canModify без гейта по статусу делегации, убраны pending_invite-ветки видимости"
  ```

- [ ] **Step 6: routes — новая поверхность /api/delegations.**
  Полностью заменить `server/src/presentation/delegations/routes.ts`:
  ```ts
  import { Router, type NextFunction, type Request, type Response } from 'express';
  import type { WithdrawTaskDelegation } from '../../application/task/WithdrawTaskDelegation.js';
  import type { RelinquishTaskDelegation } from '../../application/task/RelinquishTaskDelegation.js';
  import type {
    AssignedTaskView,
    ListTasksAssignedToMe,
  } from '../../application/task/ListTasksAssignedToMe.js';
  import type { ListTasksDelegatedToOthers } from '../../application/task/ListTasksDelegatedToOthers.js';
  import { requireAuth } from '../middleware/requireAuth.js';
  import { toDto as taskToDto } from '../tasks/routes.js';

  // Делегирование мгновенное (accepted при создании, спека §4): accept/decline/pending
  // эндпоинтов больше нет. Остались списки и два «отката»: withdraw (создатель забирает)
  // и relinquish (делегат снимает с себя).
  type Deps = {
    readonly withdraw: WithdrawTaskDelegation;
    readonly relinquish: RelinquishTaskDelegation;
    readonly listAssignedToMe: ListTasksAssignedToMe;
    readonly listDelegatedToOthers: ListTasksDelegatedToOthers;
  };

  export function delegationsRouter(deps: Deps): Router {
    const r = Router();
    r.use(requireAuth);

    // Общий DTO-маппинг строк assigned-to-me / delegated-by-me (одинаковый view-shape):
    // counts вмерживаем в task (toDto подхватит их как у TaskWithCounts) — клиент рисует
    // строку теми же карточками.
    const assignedViewToDto = (v: AssignedTaskView) => ({
      task: taskToDto({
        ...v.task,
        commitCount: v.commitCount,
        attachmentCount: v.attachmentCount,
        commentCount: v.commentCount,
      }),
      projectId: v.projectId,
      projectName: v.projectName,
      isInbox: v.isInbox,
      canModify: v.canModify,
    });

    // GET /api/delegations/assigned-to-me — все активные делегации НА caller'а по всем
    // проектам, для вкладки «Для меня». Группировку делает клиент.
    r.get('/assigned-to-me', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const items = await deps.listAssignedToMe.execute(req.user!.id);
        res.json({ items: items.map(assignedViewToDto) });
      } catch (e) {
        next(e);
      }
    });

    // GET /api/delegations/delegated-to-others — все активные делегации «кому-то другому»,
    // видимые caller'у: в именованных проектах-участниках — от любого любому; inbox —
    // только собственные исходящие. Вкладка «Другим»; фильтры делает клиент.
    r.get('/delegated-to-others', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const items = await deps.listDelegatedToOthers.execute(req.user!.id);
        res.json({ items: items.map(assignedViewToDto) });
      } catch (e) {
        next(e);
      }
    });

    // DELETE /api/delegations/:id — создатель отзывает делегацию (забирает задачу назад).
    r.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
      try {
        await deps.withdraw.execute(req.params['id'] as string, req.user!.id);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    });

    // POST /api/delegations/:id/relinquish — ДЕЛЕГАТ складывает с себя активную делегацию
    // (drag карточки из блока делегирования на нижнюю доску «Входящих»).
    r.post('/:id/relinquish', async (req: Request, res: Response, next: NextFunction) => {
      try {
        await deps.relinquish.execute(req.params['id'] as string, req.user!.id);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    });

    return r;
  }
  ```

- [ ] **Step 7: tasks/routes.ts — убрать `POST /:taskId/invite-delegate`.**
  В `server/src/presentation/tasks/routes.ts`:
  1) Удалить импорт (строка 26): `import type { InviteAndDelegateTask } from '../../application/task/InviteAndDelegateTask.js';`
  2) Удалить из `Deps` (строка 77): `readonly inviteAndDelegate: InviteAndDelegateTask;`
  3) Удалить весь блок роута `POST /:taskId/invite-delegate` (строки 543–568, включая комментарий).

- [ ] **Step 8: удалить use-cases и порт listPendingForDelegate.**
  1) Удалить файлы:
  ```
  git rm server/src/application/task/InviteAndDelegateTask.ts server/src/application/task/ListMyPendingDelegations.ts
  ```
  2) В `server/src/application/task/TaskDelegationRepository.ts`:
     - удалить тип `DelegationWithTaskInfo` (строки 20–24 с комментарием);
     - удалить из интерфейса метод `listPendingForDelegate` (строки 56–58 с комментарием);
     - в комментарии `CreateDelegationInput.status` убрать упоминание `InviteAndDelegateTask` (если не сделано в Task 11);
     - в комментарии `listAssignedTo`/`listDelegatedToOthers` заменить «(pending|accepted)» на «активные».
  3) В `server/src/infrastructure/repositories/DrizzleTaskDelegationRepository.ts`:
     - удалить метод `listPendingForDelegate` (строки 124–162);
     - убрать `DelegationWithTaskInfo` из импорта типов (строка 8);
     - удалить константу `TASK_EXCERPT_LEN` (строка 17, больше не используется).

- [ ] **Step 9: http.ts + index.ts — wiring.**
  В `server/src/presentation/http.ts`:
  1) Удалить импорты (строки 127, 128, 134, 140):
     `AcceptTaskDelegation`, `DeclineTaskDelegation`, `ListMyPendingDelegations`, `InviteAndDelegateTask`.
  2) В `AppDeps.delegations` (строки 537–549) оставить:
  ```ts
    readonly delegations: {
      readonly withdraw: WithdrawTaskDelegation;
      readonly relinquish: RelinquishTaskDelegation;
      readonly listAssignedToMe: ListTasksAssignedToMe;
      readonly listDelegatedToOthers: ListTasksDelegatedToOthers;
      readonly assignToProject: MoveTaskToProject;
      readonly delegateExisting: DelegateExistingTask;
      readonly reassignDelegation: ReassignTaskDelegation;
    };
  ```
  3) В mount tasksRouter (строки 777–787) удалить строку `inviteAndDelegate: deps.delegations.inviteAndDelegate,`.

  В `server/src/index.ts`:
  4) Удалить импорты: строка 152 (`ListMyPendingDelegations`), строка 158 (`InviteAndDelegateTask`). Импорты `AcceptTaskDelegation` (148) и `DeclineTaskDelegation` (149) ОСТАВИТЬ — их использует composer-wiring (строки 760–778) до Task 15.
  5) В `createApp({ delegations: {...} })` (строки 2029–2110) удалить целиком записи `accept: new AcceptTaskDelegation({...})` (2030–2038), `decline: new DeclineTaskDelegation({...})` (2039–2048), `listPending: new ListMyPendingDelegations(taskDelegationRepo)` (2051), `inviteAndDelegate: new InviteAndDelegateTask({...})` (2099–2109). Записи `withdraw`, `relinquish`, `listAssignedToMe`, `listDelegatedToOthers`, `assignToProject`, `delegateExisting`, `reassignDelegation` — оставить.

- [ ] **Step 10: компиляция + полный прогон тестов.**
  ```
  npm run build
  npm test
  ```
  Ожидаемо: build без ошибок (в т.ч. нет «unused import»), все тесты зелёные. `AcceptTaskDelegation.test.ts` ещё существует и проходит — это ок, класс удалит Task 15.

- [ ] **Step 11: commit.**
  ```
  git add -A server/src/application/task/TaskDelegationRepository.ts server/src/infrastructure/repositories/DrizzleTaskDelegationRepository.ts server/src/presentation/delegations/routes.ts server/src/presentation/tasks/routes.ts server/src/presentation/http.ts server/src/index.ts
  git add -u server/src/application/task/InviteAndDelegateTask.ts server/src/application/task/ListMyPendingDelegations.ts
  git commit -m "feat(delegations): удалены accept/decline/pending REST и invite-delegate флоу — делегирование всегда accepted"
  ```
  (Точечное стейджирование: `git rm` из Step 8 уже застейджил удаления; НЕ использовать `git add -A` по всему репо — рядом могут работать другие сессии.)

# Секция C — SERVER: делегирование сразу accepted

### Task 13: RelinquishTaskDelegation — уведомление создателю «снял(а) с себя задачу» + email

**Files:**
- Modify: `server/src/application/task/RelinquishTaskDelegation.ts` (Deps + notifyResolved)
- Modify: `server/src/application/task/RelinquishTaskDelegation.test.ts` (новый harness + новые проверки)
- Modify: `server/src/application/notifications/emails/delegationDeclinedEmail.ts` (тексты: «отклонил» → «снял(а) с себя»)
- Modify: `server/src/index.ts` (строка ~2050: wiring `relinquish` — добавить deps)

**Interfaces:**
- Consumes: `NotificationRepository.create({id, userId, payload})`; payload-тип `TaskDelegationResolvedPayload` (`type:'task_delegation_resolved'`, `resolution:'declined'`) — существующий; `EmailSender.send(EmailMessage)`; `renderDelegationDeclinedEmail(input: DelegationDeclinedEmailInput)` (сигнатура НЕ меняется, меняются только тексты).
- Produces: на relinquish создателю прилетает in-app `task_delegation_resolved` (`resolution:'declined'`, actor = делегат) + email «X снял(а) с себя задачу». Клиентский рендер этой ветки — Секция E. `WithdrawTaskDelegation` НЕ меняется.

Все команды — из `c:/www/ProjectsFlow/server` (git — из корня).

- [ ] **Step 1: падающий тест — уведомление + email создателю.**
  Полностью заменить `server/src/application/task/RelinquishTaskDelegation.test.ts`:
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { RelinquishTaskDelegation } from './RelinquishTaskDelegation.js';
  import {
    DelegationWrongStateError,
    NotDelegateError,
  } from '../../domain/task/errors.js';

  // Минимальные in-memory фейки (tsx + node:test, без новых deps).

  const DELEGATE_ID = 'u-del';
  const CREATOR_ID = 'u-creator';

  type Harness = {
    relinquish: RelinquishTaskDelegation;
    setStatusCalls: { id: string; status: string }[];
    notifications: { userId: string; payload: Record<string, unknown> }[];
    emails: { to: string; subject: string }[];
  };

  function makeHarness(status: string): Harness {
    const setStatusCalls: Harness['setStatusCalls'] = [];
    const notifications: Harness['notifications'] = [];
    const emails: Harness['emails'] = [];
    const d = (s: string) => ({
      id: 'd1',
      taskId: 't1',
      delegateUserId: DELEGATE_ID,
      delegateDisplayName: 'Делегат',
      creatorUserId: CREATOR_ID,
      creatorDisplayName: 'Создатель',
      status: s,
      createdAt: new Date(0),
      respondedAt: null,
      revertToUserId: null,
    });
    const relinquish = new RelinquishTaskDelegation({
      delegations: {
        getById: async () => d(status),
        setStatus: async (id: string, s: string) => {
          setStatusCalls.push({ id, status: s });
          return d(s);
        },
      } as never,
      tasks: {
        getById: async () => ({ id: 't1', projectId: 'p1', description: 'demo task' }),
      } as never,
      users: {
        getById: async (id: string) => ({ id, email: 'creator@x', displayName: 'Создатель' }),
      } as never,
      notifications: {
        create: async (n: { userId: string; payload: Record<string, unknown> }) => {
          notifications.push({ userId: n.userId, payload: n.payload });
        },
      } as never,
      email: {
        send: async (m: { to: string; subject: string }) => {
          emails.push({ to: m.to, subject: m.subject });
        },
      } as never,
      idGen: () => 'n-1',
      appUrl: 'https://example.test',
    });
    return { relinquish, setStatusCalls, notifications, emails };
  }

  const flushAsync = async (): Promise<void> => new Promise((r) => setImmediate(r));

  test('делегат складывает accepted → withdrawn + уведомление создателю + email', async () => {
    const h = makeHarness('accepted');
    await h.relinquish.execute('d1', DELEGATE_ID);
    await flushAsync();
    assert.deepEqual(h.setStatusCalls, [{ id: 'd1', status: 'withdrawn' }]);
    assert.equal(h.notifications.length, 1);
    assert.equal(h.notifications[0]!.userId, CREATOR_ID);
    assert.equal(h.notifications[0]!.payload['type'], 'task_delegation_resolved');
    assert.equal(h.notifications[0]!.payload['resolution'], 'declined');
    assert.equal(h.notifications[0]!.payload['actorUserId'], DELEGATE_ID);
    assert.equal(h.notifications[0]!.payload['taskExcerpt'], 'demo task');
    assert.equal(h.emails.length, 1);
    assert.equal(h.emails[0]!.to, 'creator@x');
    assert.match(h.emails[0]!.subject, /снял/);
  });

  test('не-делегат получает NotDelegateError, без уведомлений', async () => {
    const h = makeHarness('accepted');
    await assert.rejects(() => h.relinquish.execute('d1', 'someone-else'), NotDelegateError);
    await flushAsync();
    assert.equal(h.setStatusCalls.length, 0);
    assert.equal(h.notifications.length, 0);
  });

  test('терминальный статус → DelegationWrongStateError, без уведомлений', async () => {
    const h = makeHarness('declined');
    await assert.rejects(() => h.relinquish.execute('d1', DELEGATE_ID), DelegationWrongStateError);
    await flushAsync();
    assert.equal(h.setStatusCalls.length, 0);
    assert.equal(h.notifications.length, 0);
  });
  ```

- [ ] **Step 2: убедиться, что красный.**
  ```
  node --import tsx --test src/application/task/RelinquishTaskDelegation.test.ts
  ```
  Ожидаемо: `fail 1` — первый тест: `h.notifications.length` равен 0 (use-case сейчас ничего не шлёт). Тесты 2–3 зелёные.

- [ ] **Step 3: реализация — notifyResolved в RelinquishTaskDelegation.**
  Полностью заменить `server/src/application/task/RelinquishTaskDelegation.ts`:
  ```ts
  import {
    DelegationNotFoundError,
    DelegationWrongStateError,
    NotDelegateError,
  } from '../../domain/task/errors.js';
  import type { TaskDelegation } from '../../domain/task/TaskDelegation.js';
  import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
  import type { TaskRepository } from './TaskRepository.js';
  import type { UserRepository } from '../user/UserRepository.js';
  import type { NotificationRepository } from '../notifications/NotificationRepository.js';
  import type { EmailSender } from '../notifications/EmailSender.js';
  import { renderDelegationDeclinedEmail } from '../notifications/emails/delegationDeclinedEmail.js';

  type Deps = {
    readonly delegations: TaskDelegationRepository;
    readonly tasks: TaskRepository;
    readonly users: UserRepository;
    readonly notifications: NotificationRepository;
    readonly email: EmailSender;
    readonly idGen: () => string;
    readonly appUrl: string;
  };

  // ДЕЛЕГАТ складывает с себя активную делегацию (drag карточки из блока делегирования на
  // нижнюю доску «Входящих»): status → withdrawn, задача возвращается создателю. Зеркало
  // WithdrawTaskDelegation, но с правом ДЕЛЕГАТА (withdraw — только создатель). После
  // отмены accept/decline-флоу (спека §4) это ЕДИНСТВЕННЫЙ «отказ» делегата — поэтому
  // создателю уходит уведомление task_delegation_resolved (resolution: declined) + email
  // «снял(а) с себя задачу» (важная инфо — нужно перераспределить). Best-effort: сам
  // relinquish не падает из-за уведомлений. Терминальные статусы — 409.
  export class RelinquishTaskDelegation {
    constructor(private readonly deps: Deps) {}

    async execute(delegationId: string, userId: string): Promise<void> {
      const existing = await this.deps.delegations.getById(delegationId);
      if (!existing) throw new DelegationNotFoundError(delegationId);
      if (existing.delegateUserId !== userId) throw new NotDelegateError();
      if (
        existing.status !== 'pending' &&
        existing.status !== 'accepted' &&
        existing.status !== 'pending_invite'
      ) {
        throw new DelegationWrongStateError(existing.status, 'pending|accepted|pending_invite');
      }
      const updated = await this.deps.delegations.setStatus(delegationId, 'withdrawn');

      void this.notifyResolved(updated ?? existing).catch((err: unknown) => {
        console.error('[delegation:relinquish] notify failed:', err);
      });
    }

    // Создателю: in-app task_delegation_resolved (declined, actor = делегат) + email.
    private async notifyResolved(delegation: TaskDelegation): Promise<void> {
      const task = await this.deps.tasks.getById(delegation.taskId);
      const creator = await this.deps.users.getById(delegation.creatorUserId);
      const taskExcerpt = (task?.description ?? '').slice(0, 120);
      const inboxUrl = `${this.deps.appUrl.replace(/\/$/, '')}/inbox`;

      await this.deps.notifications.create({
        id: this.deps.idGen(),
        userId: delegation.creatorUserId,
        payload: {
          type: 'task_delegation_resolved',
          delegationId: delegation.id,
          taskId: delegation.taskId,
          taskExcerpt,
          resolution: 'declined',
          actorUserId: delegation.delegateUserId,
          actorDisplayName: delegation.delegateDisplayName,
        },
      });

      if (creator?.email) {
        const message = renderDelegationDeclinedEmail({
          to: creator.email,
          delegateDisplayName: delegation.delegateDisplayName,
          taskExcerpt,
          inboxUrl,
        });
        await this.deps.email.send(message);
      }
    }
  }
  ```

- [ ] **Step 4: тексты письма — «снял(а) с себя задачу».**
  В `server/src/application/notifications/emails/delegationDeclinedEmail.ts` заменить только текстовые фрагменты (сигнатура и вход не меняются):
  1) Комментарий над функцией:
  ```ts
  // Письмо создателю: «делегат снял(а) с себя вашу задачу» (relinquish — единственный
  // способ отказа после отмены accept/decline-флоу). Кнопка ведёт на inbox; задача там
  // уже без ярлыка делегирования (статус delegation = withdrawn).
  ```
  2) `const subject = \`${input.delegateDisplayName} снял(а) с себя задачу\`;`
  3) В `text`: первая строка → `` `${input.delegateDisplayName} снял(а) с себя вашу задачу:` ``, последняя строка → `'Задача снова у вас — можно поручить другому или выполнить самим.'`
  4) В `html`: `<h1 ...>Задача возвращена</h1>`; абзац → `<strong ...>${input.delegateDisplayName}</strong> снял(а) с себя вашу задачу:`; финальный `<p>` → `Задача снова у вас — можно поручить другому или выполнить самим.`

- [ ] **Step 5: тест зелёный.**
  ```
  node --import tsx --test src/application/task/RelinquishTaskDelegation.test.ts
  ```
  Ожидаемо: `pass 3, fail 0`.

- [ ] **Step 6: wiring index.ts.**
  В `server/src/index.ts` в блоке `createApp({ delegations: {...} })` заменить строку
  `relinquish: new RelinquishTaskDelegation({ delegations: taskDelegationRepo }),` (строка ~2050; после Task 12 номер мог сместиться — искать по `new RelinquishTaskDelegation`) на:
  ```ts
      relinquish: new RelinquishTaskDelegation({
        delegations: taskDelegationRepo,
        tasks: taskRepo,
        users: userRepo,
        notifications: notificationRepo,
        email: emailSender,
        idGen: idGenerator,
        appUrl: appBaseUrl,
      }),
  ```

- [ ] **Step 7: компиляция + полный прогон.**
  ```
  npm run build
  npm test
  ```
  Ожидаемо: build чистый; все тесты зелёные. (`DeclineTaskDelegation` тоже использует `renderDelegationDeclinedEmail` — текстовая правка компиляцию не ломает; сам класс удаляется в Task 15.)

- [ ] **Step 8: commit.**
  ```
  git add server/src/application/task/RelinquishTaskDelegation.ts server/src/application/task/RelinquishTaskDelegation.test.ts server/src/application/notifications/emails/delegationDeclinedEmail.ts server/src/index.ts
  git commit -m "feat(delegations): relinquish уведомляет создателя — «снял(а) с себя задачу» + email"
  ```

# Секция C — SERVER: делегирование сразу accepted

### Task 14: Actionable-наборы уведомлений: `task_delegation` → вон, `workspace_invite` → внутрь; `WorkspaceInvitePayload` в домене

**Files:**
- Modify: `server/src/application/activity/GetActivityFeed.ts` (строки 5–11, `ACTIONABLE_TYPES`)
- Modify: `server/src/application/activity/GetActivityFeed.test.ts` (тесты `action`-вкладки)
- Modify: `server/src/infrastructure/repositories/DrizzleNotificationRepository.ts` (строки 73–85, `countActionableUnread`)
- Modify: `server/src/domain/notifications/Notification.ts` (новый `WorkspaceInvitePayload` + union; комментарий `TaskDelegationPayload` строки 55–56)

**Interfaces:**
- Consumes: `Notification`/`NotificationPayload` union (server domain); фейки `NotificationsPort` из существующего `GetActivityFeed.test.ts`.
- Produces:
  - `WorkspaceInvitePayload` — `{ type:'workspace_invite'; workspaceId; workspaceName; role:'editor'|'viewer'; inviteId; token; actorUserId; actorDisplayName }` в `server/src/domain/notifications/Notification.ts` (его создаёт `CreateWorkspaceInvite` из секции workspace-инвайтов; клиентское зеркало — Секция E).
  - Actionable-набор в ОБОИХ синхронных местах = `{workspace_invite, project_invite, join_request}` (бейдж «Действие» больше не считает делегирования).

Все команды — из `c:/www/ProjectsFlow/server` (git — из корня).

- [ ] **Step 1: падающий тест — action-вкладка: workspace_invite actionable, task_delegation — нет.**
  В `server/src/application/activity/GetActivityFeed.test.ts` заменить тест `«action: only actionable unread notifications, scoped»` (строки 92–103) на:
  ```ts
  test('action: workspace_invite/project_invite/join_request actionable; task_delegation и mention — нет', async () => {
    const feed = makeFeed({
      notifs: [
        notif('inv', 'project_invite', '2026-06-24T10:00:00Z', 'p1'),
        notif('wsinv', 'workspace_invite', '2026-06-24T10:30:00Z', null),
        notif('mention', 'comment_mention', '2026-06-24T11:00:00Z', 'p1'),
        notif('deleg', 'task_delegation', '2026-06-24T12:00:00Z', null),
        notif('readJoin', 'join_request', '2026-06-24T12:30:00Z', 'p1', new Date('2026-06-24T13:00:00Z')),
      ],
    });
    const items = await feed.execute('u1', 'w1', { tab: 'action', limit: 10 });
    // mention — не actionable; deleg — делегирование мгновенное, действия нет;
    // readJoin — прочитан; остаются wsinv (10:30) и inv (10:00), по убыванию времени.
    assert.deepEqual(
      items.map((i) => (i.type === 'notification' ? i.notification.id : '')),
      ['wsinv', 'inv'],
    );
  });
  ```
  Также в тесте `«all: project-less personal notification (inbox delegation) included»` (строки 83–90) ничего не менять — `task_delegation` в «Все» остаётся (информационное уведомление живо).

- [ ] **Step 2: убедиться, что красный.**
  ```
  node --import tsx --test src/application/activity/GetActivityFeed.test.ts
  ```
  Ожидаемо: `fail 1` — новый тест получает `['deleg', 'wsinv', 'inv']`-подобный результат (deleg actionable, wsinv — нет). Остальные тесты зелёные.

- [ ] **Step 3: реализация — ACTIONABLE_TYPES.**
  В `server/src/application/activity/GetActivityFeed.ts` заменить строки 5–11:
  ```ts
  // Уведомления, требующие действия (кнопка «Принять»). Только они формируют вкладку
  // «Требуется действие». task_delegation сюда НЕ входит: делегирование принимается
  // автоматически (спека §4), уведомление о нём — информационное.
  // Зеркало: DrizzleNotificationRepository.countActionableUnread — менять СИНХРОННО.
  const ACTIONABLE_TYPES: ReadonlySet<string> = new Set([
    'workspace_invite',
    'project_invite',
    'join_request',
  ]);
  ```

- [ ] **Step 4: тест зелёный.**
  ```
  node --import tsx --test src/application/activity/GetActivityFeed.test.ts
  ```
  Ожидаемо: `pass` по всем тестам файла, `fail 0`.

- [ ] **Step 5: countActionableUnread — тот же набор (DB-слой, проверка компиляцией).**
  В `server/src/infrastructure/repositories/DrizzleNotificationRepository.ts` в методе `countActionableUnread` (строки 73–85):
  1) Комментарий (строки 74–75) заменить на:
  ```ts
    // Actionable-типы (кнопка «Принять») — те же, что формируют вкладку «Действие».
    // Зеркало GetActivityFeed.ACTIONABLE_TYPES — менять СИНХРОННО. Делегирования
    // (task_delegation) не actionable: принимаются автоматически. Сводки/упоминания
    // сюда НЕ входят.
  ```
  2) Заменить список в `inArray(...)`:
  ```ts
          inArray(notifications.type, ['workspace_invite', 'project_invite', 'join_request']),
  ```

- [ ] **Step 6: домен — WorkspaceInvitePayload + комментарий TaskDelegationPayload.**
  В `server/src/domain/notifications/Notification.ts`:
  1) Сразу после блока `ProjectInvitePayload` (после строки 40) добавить:
  ```ts
  // Приглашение в пространство (единое членство, спека 2026-07-13 §3.1). Создаётся при
  // invite на email уже зарегистрированного юзера — он видит уведомление с кнопкой
  // «Принять» (token ведёт на /invite/:token, страница различает оба типа токенов).
  export type WorkspaceInvitePayload = {
    readonly type: 'workspace_invite';
    readonly workspaceId: string;
    readonly workspaceName: string;
    readonly role: 'editor' | 'viewer';
    readonly inviteId: string;
    readonly token: string;
    readonly actorUserId: string;
    readonly actorDisplayName: string;
  };
  ```
  2) Комментарий над `TaskDelegationPayload` (строки 55–56) заменить на:
  ```ts
  // Поручение задачи. Прилетает делегату; информационное — делегирование принимается
  // автоматически (спека §4), кнопок Принять/Отклонить нет.
  ```
  3) В union `NotificationPayload` (строки 154–165) добавить `| WorkspaceInvitePayload` после `| ProjectInvitePayload`.

- [ ] **Step 7: компиляция + полный прогон.**
  ```
  npm run build
  npm test
  ```
  Ожидаемо: build чистый (union расширен — существующие switch/if по `payload.type` не ломаются), тесты зелёные.

- [ ] **Step 8: commit.**
  ```
  git add server/src/application/activity/GetActivityFeed.ts server/src/application/activity/GetActivityFeed.test.ts server/src/infrastructure/repositories/DrizzleNotificationRepository.ts server/src/domain/notifications/Notification.ts
  git commit -m "feat(notifications): actionable-набор = workspace_invite/project_invite/join_request; task_delegation информационное; +WorkspaceInvitePayload"
  ```

# Секция C — SERVER: делегирование сразу accepted

### Task 15: TelegramComposerService без `da:`/`dd:` — задача сразу в проекте, карточка делегату с «Завершить/Комментировать»; удалить Accept/Decline use-cases

**Files:**
- Modify: `server/src/application/telegram/composer/TelegramComposerService.ts`
  (импорты 21–23; Deps 64–66; комментарий callback_data 131–132; `ParsedCallback` 166–167; `parseCallback` cases `da`/`dd` 206–209; `handleCallback` 617–618; `finalize` 770–811; `notifyDelegate` 851–894; удалить `handleAccept`/`handleDecline`/`pingCreator`/`answerDelegationError` 896–977; `notifySegmentDelegate` 1683–1691)
- Modify: `server/src/application/telegram/composer/TelegramComposerService.test.ts` (harness + тесты 351–366, 377–397, 514–540)
- Modify: `server/src/application/telegram/HandleTelegramWebhook.ts` (комментарий 123–124)
- Modify: `server/src/application/telegram/HandleTelegramWebhook.test.ts` (makeCbHarness + новый тест легаси-коллбэков)
- Modify: `server/src/application/telegram/taskActionKeyboard.ts` (комментарий 3–7)
- Modify: `server/src/index.ts` (импорты 148–149; composer-wiring 760–789: убрать `accept`/`decline`/`assignToProject`)
- Delete: `server/src/application/task/AcceptTaskDelegation.ts`, `server/src/application/task/DeclineTaskDelegation.ts`, `server/src/application/task/AcceptTaskDelegation.test.ts`

**Interfaces:**
- Consumes: инвариант Task 11 (`CreateTask` с `delegateUserId` создаёт делегирование сразу `accepted`, в т.ч. в именованном проекте — `delegateOrThrow` требует членства делегата, которое в едином пространстве даёт переписанный `ProjectMemberRepository.findForProject`); `taskActionKeyboard(taskId): InlineKeyboardMarkup` из `server/src/application/telegram/taskActionKeyboard.ts` (кнопки `nd:`/`nc:` — существующие обработчики `handleTaskDone`/`handleTaskCommentPrompt` в `HandleTelegramWebhook`).
- Produces: `TelegramComposerService` Deps БЕЗ `accept`/`decline`/`assignToProject` (итог: `{ drafts, taskMessages, members, projects, users, createTask, getOrCreateInbox, sendNotification, client, idGen, shortIdGen, appUrl, enqueueAiPromptJob, waitForAiPromptJob }`); TG-карточка делегату с `taskActionKeyboard`; легаси `da:`/`dd:`-коллбэки гасятся молча (parseCallback → null → ack). Классы `AcceptTaskDelegation`/`DeclineTaskDelegation` удалены из репозитория.

Все команды — из `c:/www/ProjectsFlow/server` (git — из корня).

- [ ] **Step 1: падающие тесты — обновить TelegramComposerService.test.ts.**
  1) В harness (`makeHarness`) удалить массивы и deps `accept`/`decline`/`assignToProject`:
     - удалить строки 59–61 (`accepted`, `declined`, `assigned`);
     - удалить deps-блоки `accept: {...}` (179–194), `decline: {...}` (195–210), `assignToProject: {...}` (211–216);
     - из `return` (строка 247) убрать `accepted, declined, assigned`.
  2) Заменить сбор `delegateMessages` (строки 58 и 217–222) — вместо `hasButtons` сохраняем сериализованную клавиатуру:
  ```ts
    const delegateMessages: { userId: string; buttons: string }[] = [];
  ```
  ```ts
      sendNotification: {
        async execute(cmd: any) {
          delegateMessages.push({
            userId: cmd.userId,
            buttons: JSON.stringify(cmd.replyMarkup ?? null),
          });
          return { status: 'ok' as const, messageId: 5000, chatId: 999 };
        },
      },
  ```
  3) Заменить тест `«+Проект текст @делегат → createTask в inbox ...»` (строки 351–366) на:
  ```ts
  test('+Проект текст @делегат → задача СРАЗУ в проекте, делегату карточка Завершить/Комментировать', async () => {
    const h = makeHarness();
    await h.service.startFromMessage(111, 500, '+Альфа Обнови билд @Вася');
    const draftId = [...h.drafts.keys()][0]!;
    await h.service.handleCallback(cq(`tc:${draftId}`));
    assert.equal(h.createTaskCalls[0]!.projectId, 'p1'); // сразу в проект, без переноса-на-accept
    assert.equal(h.createTaskCalls[0]!.delegateUserId, 'u2');
    assert.equal(h.delegateMessages.length, 1);
    assert.equal(h.delegateMessages[0]!.userId, 'u2');
    // Кнопки действий по задаче, НЕ «Принять/Отказать».
    assert.ok(h.delegateMessages[0]!.buttons.includes('nd:t1'));
    assert.ok(h.delegateMessages[0]!.buttons.includes('nc:t1'));
    assert.ok(!h.delegateMessages[0]!.buttons.includes('da:'));
    const d = h.drafts.get(draftId)!;
    assert.equal(d.status, 'confirmed');
    assert.equal(d.delegationId, 'del1');
  });
  ```
  4) Заменить тесты `«accept (da:) → ...»` и `«decline (dd:) → ...»` (строки 377–397) на один:
  ```ts
  test('легаси da:/dd: (старые кнопки в чатах) → молчаливый ack, без действий', async () => {
    const h = makeHarness();
    await h.service.handleCallback(cq('da:del1', 222));
    await h.service.handleCallback(cq('dd:del1', 222));
    assert.equal(h.createTaskCalls.length, 0);
    assert.equal(h.edits.length, 0);
    assert.equal(h.answers.length, 2); // оба коллбэка «отвечены», кнопка просто гаснет
  });
  ```
  5) В тесте `«AI: сегмент с исполнителем → ...»` (строки 514–540) заменить последнюю проверку `assert.ok(h.delegateMessages[0]!.hasButtons);` на:
  ```ts
    assert.ok(h.delegateMessages[0]!.buttons.includes('nd:t1'));
    assert.ok(!h.delegateMessages[0]!.buttons.includes('da:'));
  ```

- [ ] **Step 2: убедиться, что красный.**
  ```
  node --import tsx --test src/application/telegram/composer/TelegramComposerService.test.ts
  ```
  Ожидаемо: минимум 2 падения — делегатский тест (`projectId` = `'inbox1'`, buttons содержат `da:`) и AI-тест исполнителя (buttons содержат `da:`). Легаси-тест может падать по `edits.length` (текущий `handleAccept` при отсутствующем deps.accept уходит в error-ветку). Остальные тесты зелёные.

- [ ] **Step 3: реализация — TelegramComposerService.**
  В `server/src/application/telegram/composer/TelegramComposerService.ts`:
  1) Импорты: удалить строки 21–23 (`AcceptTaskDelegation`, `DeclineTaskDelegation`, `MoveTaskToProject`); добавить после строки 20 (`GetOrCreateInbox`):
  ```ts
  import { taskActionKeyboard } from '../taskActionKeyboard.js';
  ```
  2) `Deps` (строки 64–66): удалить поля `accept`, `decline`, `assignToProject`.
  3) Комментарий callback_data (строки 131–132) заменить на:
  ```ts
  // --- callback_data ---------------------------------------------------------
  // tp:<d>:<idx|i|?|pN>  td:<d>:<idx|n|pN>  tc:<d>  tx:<d>. Легаси da:/dd: (принять/
  // отказать) удалены — parseCallback вернёт null, старые кнопки гаснут молча.
  ```
  4) `ParsedCallback` (строки 166–167): удалить варианты `{ kind: 'accept'; ... }` и `{ kind: 'decline'; ... }`.
  5) `parseCallback` (строки 206–209): удалить `case 'da':` и `case 'dd':` (провалятся в `default: return null`).
  6) `handleCallback` (строки 617–618): удалить строки
  `if (cb.kind === 'accept') return this.handleAccept(cq, cb.delegationId);` и
  `if (cb.kind === 'decline') return this.handleDecline(cq, cb.delegationId);`.
  7) `finalize` — заменить delegate-ветку (строки 771–811, `if (draft.delegateUserId) { ... }` до `} else {`) на:
  ```ts
        if (draft.delegateUserId) {
          // Мгновенное делегирование (спека §4): задача создаётся СРАЗУ в выбранном
          // проекте (или во «Входящих», если проект не назван), делегация — accepted
          // при создании. Ветки «перенос в проект после accept» больше нет.
          const targetId =
            draft.projectId ?? (await this.deps.getOrCreateInbox.execute(userId)).id;
          const task = await this.deps.createTask.execute({
            projectId: targetId,
            ownerUserId: userId,
            description: text,
            status: draft.targetStatus ?? DEFAULT_COLUMN,
            delegateUserId: draft.delegateUserId,
          });
          const delegationId = task.delegation?.id ?? null;
          await this.deps.drafts.patch(draft.id, {
            status: 'confirmed',
            delegationId,
            extendTtlSeconds: CONFIRMED_TTL_SECONDS,
          });
          if (messageId) {
            await this.deps.taskMessages.upsert({
              tgChatId: chatId,
              tgMessageId: messageId,
              recipientUserId: userId,
              taskId: task.id,
              projectId: targetId,
            });
          }
          await this.notifyDelegate(draft, task.id, targetId, delegationId, userId, text);

          const delegateName =
            (await this.deps.users.getById(draft.delegateUserId))?.displayName ?? 'участнику';
          const projName = await this.projNameOf(draft.projectId);
          if (messageId) {
            await this.edit(
              chatId,
              messageId,
              `✅ Задача создана в <b>${escapeHtml(projName)}</b> и поручена <b>${escapeHtml(delegateName)}</b>.\n📝 ${markdownToTelegramHtml(excerpt(text))}\n\n↩️ Ответь на это сообщение, чтобы добавить комментарий.`,
            );
          }
          await this.deps.client.answerCallbackQuery(cqId, { text: 'Создано и поручено' });
        } else {
  ```
  8) `notifyDelegate` (строки 851–894) — заменить целиком:
  ```ts
    // TG-карточка делегату: делегация уже принята автоматически — кнопки действий по
    // задаче («Завершить»/«Комментировать»), НЕ «Принять/Отказать». Reply на карточку =
    // комментарий (существующий механизм telegram_task_messages).
    private async notifyDelegate(
      draft: TelegramTaskDraft,
      taskId: string,
      projectId: string,
      delegationId: string | null,
      creatorUserId: string,
      text: string,
    ): Promise<void> {
      if (!delegationId || !draft.delegateUserId) return;
      const creator = await this.deps.users.getById(creatorUserId);
      const creatorName = creator?.displayName ?? 'Коллега';
      const projName = draft.projectId
        ? ((await this.deps.projects.getById(draft.projectId))?.name ?? null)
        : null;
      const ctx = projName ? ` Проект: <b>${escapeHtml(projName)}</b>.` : ' (во «Входящие»).';
      const msg = `👤 <b>${escapeHtml(creatorName)}</b> поручил(а) тебе задачу:\n📝 <i>${mdToPlain(excerpt(text))}</i>.${ctx}`;
      const res = await this.deps.sendNotification.execute({
        userId: draft.delegateUserId,
        text: msg,
        parseMode: 'HTML',
        kind: 'task_delegation',
        taskId,
        replyMarkup: taskActionKeyboard(taskId),
        skipPrefsCheck: true, // важное — должно дойти независимо от prefs
        skipDedupCheck: true,
      });
      if (res.status === 'ok') {
        await this.deps.taskMessages.upsert({
          tgChatId: res.chatId,
          tgMessageId: res.messageId,
          recipientUserId: draft.delegateUserId,
          taskId,
          projectId,
        });
      }
    }
  ```
  9) Удалить целиком методы `handleAccept`, `handleDecline`, `pingCreator`, `answerDelegationError` (строки 896–977, включая комментарий `// --- Принять / Отказать (нажал делегат) ---`).
  10) `notifySegmentDelegate` (строки 1670–1711): заменить текст сообщения `делегирует тебе задачу` → `поручил(а) тебе задачу`; удалить локальную `const replyMarkup: InlineKeyboardMarkup = {...}` (строки 1684–1691) и в `sendNotification.execute` передать `replyMarkup: taskActionKeyboard(taskId),`; комментарий над методом заменить на `// TG-уведомление делегату сегмента: кнопки Завершить/Комментировать (in-app/email шлёт CreateTask).`

  Продолжение шагов — в `task-15-part2.md`.

### Task 15 — продолжение (часть 2)

- [ ] **Step 4: тесты композера зелёные.**
  ```
  node --import tsx --test src/application/telegram/composer/TelegramComposerService.test.ts
  ```
  Ожидаемо: все тесты `pass`, `fail 0` (в т.ч. легаси-тест: `parseCallback('da:...')` → null → молчаливый `answerCallbackQuery`).

- [ ] **Step 5: commit композера.**
  ```
  git add server/src/application/telegram/composer/TelegramComposerService.ts server/src/application/telegram/composer/TelegramComposerService.test.ts
  git commit -m "feat(telegram): композер без Принять/Отказать — задача с делегатом сразу в проекте, делегату карточка Завершить/Комментировать"
  ```
  ВНИМАНИЕ: коммит собирается (`npm run build`) только после Step 7 — wiring в `index.ts` ещё передаёт лишние deps `accept`/`decline`/`assignToProject` (extra-поля в object literal → TS-ошибка). Если хочется зелёный build на каждом коммите — поменять местами: сначала Step 7 (wiring), потом этот commit одним куском с ним. Допустимо объединить Step 5 и Step 8 в один коммит.

- [ ] **Step 6: падающий тест — легаси-коллбэки в вебхуке проваливаются в композер.**
  В `server/src/application/telegram/HandleTelegramWebhook.test.ts`:
  1) В `makeCbHarness` (строки 196–235) добавить трекинг коллбэков композера — заменить строку 228 на:
  ```ts
      composer: {
        async handleCallback(cq: any) {
          composerCallbacks.push(String(cq?.data ?? ''));
        },
        async startFromMessage() {},
        async handleInlineQuery() {},
      },
  ```
     и объявить массив рядом с остальными (после строки 202):
  ```ts
    const composerCallbacks: string[] = [];
  ```
     и вернуть его из harness (строка 234): `return { h: new HandleTelegramWebhook(deps as any), answers, edits, sent, moves, upserts, statusNotifs, composerCallbacks };`
  2) Добавить тест в конец файла:
  ```ts
  test('легаси da:/dd: коллбэки не роутятся отдельно — проваливаются в композер (гаснут молча)', async () => {
    const h = makeCbHarness();
    await h.h.execute(cbUpdate('da:del1'));
    await h.h.execute(cbUpdate('dd:del1'));
    assert.equal(h.moves.length, 0);
    assert.deepEqual(h.composerCallbacks, ['da:del1', 'dd:del1']);
  });
  ```
  3) Запустить и убедиться, что тест ЗЕЛЁНЫЙ сразу (роутинг вебхука и раньше отдавал их композеру — тест фиксирует контракт после удаления `da`/`dd` из parseCallback):
  ```
  node --import tsx --test src/application/telegram/HandleTelegramWebhook.test.ts
  ```
  Ожидаемо: `fail 0`. (Это регрессионный тест-контракт, не red-green: удаляемого роутинга в самом вебхуке не было.)
  4) В `server/src/application/telegram/HandleTelegramWebhook.ts` обновить комментарий (строки 123–124):
  ```ts
      // Нажатие inline-кнопки. `bt:` — навигация /tasks (наш handler); остальное (tp/td/
      // tc/tx/a*/ts) — конструктор задач. Легаси da:/dd: гаснут в композере молча.
  ```
  5) В `server/src/application/telegram/taskActionKeyboard.ts` заменить пункт комментария (строки 5–6) `«- делегирование (у него свои кнопки «Принять/Отказать» — приходит с явным replyMarkup).»` на:
  ```ts
  //  - task_done (завершать нечего), ralph_* (свой reply-поток), server_alert (не задача).
  //  Карточка поручения (task_delegation) шлётся композером с этой же клавиатурой явно.
  ```

- [ ] **Step 7: wiring index.ts + удаление Accept/Decline.**
  1) В `server/src/index.ts` в конструкторе `telegramComposer = new TelegramComposerService({...})` (строки ~734–797) удалить целиком записи:
     - `accept: new AcceptTaskDelegation({...}),` (строки 760–768),
     - `decline: new DeclineTaskDelegation({...}),` (строки 769–778),
     - `assignToProject: new MoveTaskToProject({...}),` (строки 779–789).
     Остальные deps (`drafts`, `taskMessages`, `members`, `projects`, `users`, `createTask`, `getOrCreateInbox`, `sendNotification`, `client`, `idGen`, `shortIdGen`, `appUrl`, `enqueueAiPromptJob`, `waitForAiPromptJob`) не трогать. Импорт `MoveTaskToProject` НЕ удалять — он используется в `createApp({ delegations: { assignToProject: ... } })`.
  2) Удалить импорты (строки 148–149): `AcceptTaskDelegation`, `DeclineTaskDelegation`.
  3) Удалить файлы:
  ```
  git rm server/src/application/task/AcceptTaskDelegation.ts server/src/application/task/DeclineTaskDelegation.ts server/src/application/task/AcceptTaskDelegation.test.ts
  ```
  4) Проверить, что упоминаний не осталось (ожидаемо — пусто):
  ```
  Grep: AcceptTaskDelegation|DeclineTaskDelegation по server/src → 0 совпадений
  ```

- [ ] **Step 8: компиляция + ПОЛНЫЙ прогон серверных тестов.**
  ```
  npm run build
  npm test
  ```
  Ожидаемо: build чистый; весь набор тестов зелёный (`AcceptTaskDelegation.test.ts` удалён, новые тесты композера/вебхука проходят).

- [ ] **Step 9: commit.**
  ```
  git add server/src/application/telegram/HandleTelegramWebhook.ts server/src/application/telegram/HandleTelegramWebhook.test.ts server/src/application/telegram/taskActionKeyboard.ts server/src/index.ts
  git commit -m "feat(delegations): удалены AcceptTaskDelegation/DeclineTaskDelegation и TG-коллбэки da:/dd: — делегирование принимается автоматически"
  ```
  (Удаления из `git rm` уже в индексе. НЕ `git add -A` по всему репо.)

### Task 16: Модуль assigneeBrowse — билдеры TG-меню «по ответственным» и карточек задач

**Files:**
- Create: `server/src/application/telegram/assigneeBrowse.ts`
- Test: `server/src/application/telegram/assigneeBrowse.test.ts`

**Interfaces:**
- Consumes (всё уже существует в репо, ничего из других задач не нужно):
  - `ProjectMemberRepository.listProjectsForUser(userId: string): Promise<ProjectWithRole[]>` (`server/src/application/project/ProjectMemberRepository.ts`; `ProjectWithRole` имеет `id`, `name`)
  - `TaskRepository.listByProject(projectId: string): Promise<Task[]>` (`server/src/application/task/TaskRepository.ts`; `Task` имеет `id`, `description: string|null`, `status`, `deadline: string|null` формата `'YYYY-MM-DD'`)
  - `TaskDelegationRepository.listActiveForTasks(taskIds: readonly string[]): Promise<Map<string, TaskDelegation>>` (`server/src/application/task/TaskDelegationRepository.ts`; `TaskDelegation` имеет `delegateUserId`, `delegateDisplayName`)
  - `splitDescription(description: string|null): { name: string; body: string }`, `formatDeadlineRu(iso: string, now?: Date): string`, `escapeHtml(s: string): string` из `server/src/domain/task/digestFormat.ts`
  - `taskActionKeyboard(taskId: string): InlineKeyboardMarkup` из `server/src/application/telegram/taskActionKeyboard.ts` (кнопки `✅ Завершить` `nd:<taskId>` + `💬 Комментировать` `nc:<taskId>`)
  - `InlineKeyboardMarkup`, `InlineKeyboardButton` из `server/src/application/telegram/TelegramClient.ts`
- Produces (нужны Task 17/18):
  - `type AssigneeBrowseDeps = { members: Pick<ProjectMemberRepository,'listProjectsForUser'>; tasks: Pick<TaskRepository,'listByProject'>; delegations: Pick<TaskDelegationRepository,'listActiveForTasks'> }`
  - `buildAssigneeMenu(deps: AssigneeBrowseDeps, userId: string): Promise<AssigneeMenu | null>` — `null` = у юзера нет проектов; `AssigneeMenu = { text: string; keyboard: InlineKeyboardMarkup }`; callback'и кнопок: `ba:<userId>`, `ba:none`, `bt:root`
  - `buildAssigneeTaskCards(deps: AssigneeBrowseDeps, viewerUserId: string, assigneeUserId: string | null, appUrl: string, now?: Date): Promise<AssigneeTaskCards>` — `assigneeUserId === null` значит «Без ответственного»; `AssigneeTaskCards = { assigneeName: string | null; totalCount: number; cards: AssigneeTaskCard[] }`; `AssigneeTaskCard = { taskId: string; projectId: string; text: string; keyboard: InlineKeyboardMarkup }`
  - Константы `ASSIGNEE_MENU_LIMIT = 12`, `ASSIGNEE_CARDS_LIMIT = 12`

Семантика (из спеки §5):
- «Открытая» задача = `status !== 'done'` (тот же фильтр, что в существующем `handleBrowseCallback` для `bt:p:`; захватывает `backlog/todo/in_progress/awaiting_clarification/manual`).
- Группировка экрана 1: по `delegateUserId` активной делегации (`listActiveForTasks`); задачи БЕЗ активной делегации идут в корзину «Без ответственного» (ответственность за создателем — отдельным юзером их не показываем).
- Экран 2: до 12 карточек, сортировка просроченные → по сроку (asc) → без срока; карточка = plain-название задачи (первая непустая строка описания без markdown, через `splitDescription().name` — НЕ обрывок всего описания), название проекта, строка `⏰ <срок>` (+ пометка «просрочено»); клавиатура = `taskActionKeyboard` + url-кнопка «Открыть в ProjectsFlow» (deep-link `?task=`).
- callback_data ≤ 64 байт: `ba:` (3) + UUID (36) = 39 — ок; префикс `ba:` не пересекается с nd/nc/nu/pd/px/bt/tp/td/tc/tx/da/dd/a*/ts.

Шаги:

- [ ] **Step 1: написать падающий тест меню (`buildAssigneeMenu`)**

  Создать файл `server/src/application/telegram/assigneeBrowse.test.ts` целиком:

  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { buildAssigneeMenu, type AssigneeBrowseDeps } from './assigneeBrowse.js';

  // Мини-фейки над узкими Pick-портами (конвенция репо: ручные in-memory стабы, без mock-библиотек).
  type Seed = {
    projects?: { id: string; name: string }[];
    tasksByProject?: Record<string, TaskSeed[]>;
    // taskId → делегат активной делегации; отсутствие ключа = без делегации.
    delegations?: Record<string, { delegateUserId: string; delegateDisplayName: string }>;
  };
  type TaskSeed = {
    id: string;
    description: string | null;
    status?: string;
    deadline?: string | null;
  };

  function makeDeps(seed: Seed): AssigneeBrowseDeps {
    return {
      members: {
        async listProjectsForUser() {
          return (seed.projects ?? []) as never;
        },
      },
      tasks: {
        async listByProject(projectId: string) {
          return (seed.tasksByProject?.[projectId] ?? []).map((t) => ({
            status: 'todo',
            deadline: null,
            ...t,
          })) as never;
        },
      },
      delegations: {
        async listActiveForTasks(taskIds: readonly string[]) {
          const m = new Map();
          for (const id of taskIds) {
            const d = seed.delegations?.[id];
            if (d) m.set(id, { id: `d-${id}`, taskId: id, status: 'accepted', ...d });
          }
          return m as never;
        },
      },
    };
  }

  // Все кнопки клавиатуры плоским списком — для удобных assert'ов.
  function flatButtons(kb: { inline_keyboard: ReadonlyArray<ReadonlyArray<{ text: string; callback_data?: string; url?: string }>> }) {
    return kb.inline_keyboard.flat();
  }

  test('menu: группировка по делегату, счётчики, ba:-callback', async () => {
    const deps = makeDeps({
      projects: [{ id: 'p1', name: 'Сайт' }, { id: 'p2', name: 'Бот' }],
      tasksByProject: {
        p1: [{ id: 't1', description: 'Задача 1' }, { id: 't2', description: 'Задача 2' }],
        p2: [{ id: 't3', description: 'Задача 3' }],
      },
      delegations: {
        t1: { delegateUserId: 'u-oleg', delegateDisplayName: 'Олег' },
        t3: { delegateUserId: 'u-oleg', delegateDisplayName: 'Олег' },
      },
    });
    const menu = await buildAssigneeMenu(deps, 'viewer');
    assert.ok(menu);
    const buttons = flatButtons(menu.keyboard);
    const oleg = buttons.find((b) => b.callback_data === 'ba:u-oleg');
    assert.ok(oleg, 'кнопка ответственного есть');
    assert.equal(oleg.text, '👤 Олег (2)');
    const none = buttons.find((b) => b.callback_data === 'ba:none');
    assert.ok(none, 'кнопка «Без ответственного» есть');
    assert.ok(none.text.includes('Без ответственного (1)'));
    assert.ok(buttons.some((b) => b.callback_data === 'bt:root'), 'кнопка «По проектам» есть');
    assert.ok(menu.text.includes('ответственным'));
  });

  test('menu: done-задачи не считаются; без делегаций — только «Без ответственного»', async () => {
    const deps = makeDeps({
      projects: [{ id: 'p1', name: 'Сайт' }],
      tasksByProject: {
        p1: [
          { id: 't1', description: 'Открытая' },
          { id: 't2', description: 'Готовая', status: 'done' },
        ],
      },
    });
    const menu = await buildAssigneeMenu(deps, 'viewer');
    assert.ok(menu);
    const buttons = flatButtons(menu.keyboard);
    assert.ok(!buttons.some((b) => (b.callback_data ?? '').startsWith('ba:') && b.callback_data !== 'ba:none'));
    const none = buttons.find((b) => b.callback_data === 'ba:none');
    assert.ok(none);
    assert.ok(none.text.includes('(1)'), 'done не посчитан');
  });

  test('menu: нет проектов → null', async () => {
    const menu = await buildAssigneeMenu(makeDeps({}), 'viewer');
    assert.equal(menu, null);
  });

  test('menu: проекты есть, открытых задач нет → текст-пустышка + только «По проектам»', async () => {
    const deps = makeDeps({
      projects: [{ id: 'p1', name: 'Сайт' }],
      tasksByProject: { p1: [{ id: 't1', description: 'x', status: 'done' }] },
    });
    const menu = await buildAssigneeMenu(deps, 'viewer');
    assert.ok(menu);
    const buttons = flatButtons(menu.keyboard);
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0]!.callback_data, 'bt:root');
    assert.ok(menu.text.includes('нет'));
  });
  ```

- [ ] **Step 2: убедиться, что тест падает**

  Из каталога `server/`:

  ```
  node --import tsx --test src/application/telegram/assigneeBrowse.test.ts
  ```

  Ожидаемо: падение на импорте — `Cannot find module './assigneeBrowse.js'` (файла ещё нет).

- [ ] **Step 3: реализовать `buildAssigneeMenu` (+ каркас модуля)**

  Создать `server/src/application/telegram/assigneeBrowse.ts` целиком:

  ```ts
  // Меню /tasks «по ответственным» (spec 2026-07-13-unified-workspace §5): чистые билдеры
  // текста+клавиатуры, без отправки в TG — отправляет HandleTelegramWebhook. Экран 1 —
  // кнопки «👤 Имя (N)» по делегатам активных делегаций + «Без ответственного (N)» +
  // «📁 По проектам» (существующая навигация bt:). Экран 2 — карточки задач ответственного.
  import type { InlineKeyboardButton, InlineKeyboardMarkup } from './TelegramClient.js';
  import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
  import type { TaskRepository } from '../task/TaskRepository.js';
  import type { TaskDelegationRepository } from '../task/TaskDelegationRepository.js';
  import type { Task } from '../../domain/task/Task.js';
  import type { TaskDelegation } from '../../domain/task/TaskDelegation.js';
  import { taskActionKeyboard } from './taskActionKeyboard.js';
  import {
    splitDescription,
    formatDeadlineRu,
    escapeHtml,
  } from '../../domain/task/digestFormat.js';

  // Узкие Pick'и от существующих портов — unit-тесты обходятся мини-фейками.
  export type AssigneeBrowseDeps = {
    readonly members: Pick<ProjectMemberRepository, 'listProjectsForUser'>;
    readonly tasks: Pick<TaskRepository, 'listByProject'>;
    readonly delegations: Pick<TaskDelegationRepository, 'listActiveForTasks'>;
  };

  // Лимиты v1 без пагинации (симметрично BROWSE_LIMIT в HandleTelegramWebhook).
  export const ASSIGNEE_MENU_LIMIT = 12;
  export const ASSIGNEE_CARDS_LIMIT = 12;

  export type AssigneeMenu = {
    readonly text: string;
    readonly keyboard: InlineKeyboardMarkup;
  };

  export type AssigneeTaskCard = {
    readonly taskId: string;
    readonly projectId: string;
    readonly text: string;
    readonly keyboard: InlineKeyboardMarkup;
  };

  export type AssigneeTaskCards = {
    // Имя ответственного (из делегации). null для режима «Без ответственного».
    readonly assigneeName: string | null;
    // Всего подходящих задач (до среза ASSIGNEE_CARDS_LIMIT).
    readonly totalCount: number;
    readonly cards: AssigneeTaskCard[];
  };

  type OpenTaskRow = {
    readonly task: Task;
    readonly projectId: string;
    readonly projectName: string;
  };

  // Все открытые (status !== 'done') задачи по всем проектам юзера + карта активных делегаций.
  async function collectOpenTasks(
    deps: AssigneeBrowseDeps,
    userId: string,
  ): Promise<{ hasProjects: boolean; rows: OpenTaskRow[]; delegationByTask: Map<string, TaskDelegation> }> {
    const projects = await deps.members.listProjectsForUser(userId);
    if (projects.length === 0) {
      return { hasProjects: false, rows: [], delegationByTask: new Map() };
    }
    const rows: OpenTaskRow[] = [];
    for (const p of projects) {
      const tasks = await deps.tasks.listByProject(p.id);
      for (const t of tasks) {
        if (t.status !== 'done') rows.push({ task: t, projectId: p.id, projectName: p.name });
      }
    }
    const delegationByTask =
      rows.length > 0
        ? await deps.delegations.listActiveForTasks(rows.map((r) => r.task.id))
        : new Map<string, TaskDelegation>();
    return { hasProjects: true, rows, delegationByTask };
  }

  // Экран 1: «👤 Имя (N)» → ba:<userId>; «Без ответственного (N)» → ba:none;
  // «📁 По проектам» → bt:root (обрабатывает существующий handleBrowseCallback, Task 17).
  // null = у юзера нет проектов вообще (вызывающий шлёт свою «📭»-заглушку).
  export async function buildAssigneeMenu(
    deps: AssigneeBrowseDeps,
    userId: string,
  ): Promise<AssigneeMenu | null> {
    const { hasProjects, rows, delegationByTask } = await collectOpenTasks(deps, userId);
    if (!hasProjects) return null;

    const byAssignee = new Map<string, { name: string; count: number }>();
    let noneCount = 0;
    for (const r of rows) {
      const d = delegationByTask.get(r.task.id) ?? null;
      if (!d) {
        // Без активной делегации ответственность за создателем — корзина «Без ответственного».
        noneCount += 1;
        continue;
      }
      const entry = byAssignee.get(d.delegateUserId);
      if (entry) entry.count += 1;
      else byAssignee.set(d.delegateUserId, { name: d.delegateDisplayName, count: 1 });
    }

    const assigneeButtons: InlineKeyboardButton[] = [...byAssignee.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, ASSIGNEE_MENU_LIMIT)
      .map(([uid, e]) => ({
        text: `👤 ${e.name.slice(0, 32)} (${e.count})`,
        callback_data: `ba:${uid}`,
      }));

    const keyboardRows: InlineKeyboardButton[][] = chunk2(assigneeButtons);
    if (noneCount > 0) {
      keyboardRows.push([{ text: `Без ответственного (${noneCount})`, callback_data: 'ba:none' }]);
    }
    keyboardRows.push([{ text: '📁 По проектам', callback_data: 'bt:root' }]);

    const overflowNote =
      byAssignee.size > ASSIGNEE_MENU_LIMIT
        ? `\n\n<i>Показаны первые ${ASSIGNEE_MENU_LIMIT} ответственных — остальные в интерфейсе.</i>`
        : '';
    const text =
      rows.length === 0
        ? '✨ Открытых задач нет.'
        : `👥 <b>Задачи по ответственным</b> — открытых: ${rows.length}${overflowNote}`;
    return { text, keyboard: { inline_keyboard: keyboardRows } };
  }

  // Разбивка кнопок по 2 в ряд (та же вёрстка, что в /tasks-браузере).
  function chunk2<T>(items: readonly T[]): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2) as T[]);
    return out;
  }
  ```

- [ ] **Step 4: прогнать тест — PASS**

  Из `server/`:

  ```
  node --import tsx --test src/application/telegram/assigneeBrowse.test.ts
  ```

  Ожидаемо: `pass 4`, `fail 0` (в тест-файле пока только menu-тесты и импортируется только `buildAssigneeMenu`).

- [ ] **Step 5: дописать падающие тесты карточек (`buildAssigneeTaskCards`)**

  В `server/src/application/telegram/assigneeBrowse.test.ts` заменить строку импорта на:

  ```ts
  import {
    buildAssigneeMenu,
    buildAssigneeTaskCards,
    ASSIGNEE_CARDS_LIMIT,
    type AssigneeBrowseDeps,
  } from './assigneeBrowse.js';
  ```

  и дописать в КОНЕЦ файла:

  ```ts
  test('cards: фильтр по делегату, plain-название (не markdown), проект, url-кнопка ?task=', async () => {
    const deps = makeDeps({
      projects: [{ id: 'p1', name: 'Сайт' }],
      tasksByProject: {
        p1: [
          { id: 't1', description: '## **Починить** [парсер](https://x)\n\nдлинное описание тела' },
          { id: 't2', description: 'Чужая задача' },
        ],
      },
      delegations: {
        t1: { delegateUserId: 'u-oleg', delegateDisplayName: 'Олег' },
        t2: { delegateUserId: 'u-vera', delegateDisplayName: 'Вера' },
      },
    });
    const res = await buildAssigneeTaskCards(deps, 'viewer', 'u-oleg', 'https://pf.test/');
    assert.equal(res.totalCount, 1);
    assert.equal(res.assigneeName, 'Олег');
    assert.equal(res.cards.length, 1);
    const card = res.cards[0]!;
    assert.equal(card.taskId, 't1');
    assert.equal(card.projectId, 'p1');
    assert.ok(card.text.includes('Починить парсер'), 'название — plain, markdown снят');
    assert.ok(!card.text.includes('**'), 'без сырой разметки');
    assert.ok(!card.text.includes('длинное описание тела'), 'тело описания не тянем');
    assert.ok(card.text.includes('Сайт'), 'проект в карточке');
    const buttons = card.keyboard.inline_keyboard.flat();
    assert.ok(buttons.some((b) => b.callback_data === 'nd:t1'), '✅ Завершить');
    assert.ok(buttons.some((b) => b.callback_data === 'nc:t1'), '💬 Комментировать');
    const urlBtn = buttons.find((b) => b.url !== undefined);
    assert.ok(urlBtn, 'url-кнопка есть');
    assert.equal(urlBtn.url, 'https://pf.test/projects/p1?task=t1');
    assert.equal(urlBtn.text, 'Открыть в ProjectsFlow');
  });

  test('cards: ba:none (assigneeUserId=null) → только задачи без делегации', async () => {
    const deps = makeDeps({
      projects: [{ id: 'p1', name: 'Сайт' }],
      tasksByProject: { p1: [{ id: 't1', description: 'Своя' }, { id: 't2', description: 'Делегирована' }] },
      delegations: { t2: { delegateUserId: 'u-x', delegateDisplayName: 'X' } },
    });
    const res = await buildAssigneeTaskCards(deps, 'viewer', null, 'https://pf.test');
    assert.equal(res.assigneeName, null);
    assert.equal(res.cards.length, 1);
    assert.equal(res.cards[0]!.taskId, 't1');
  });

  test('cards: сортировка просроченные → по сроку → без срока; пометка «просрочено»', async () => {
    const now = new Date(2026, 6, 13); // 13 июля 2026 (месяцы 0-based)
    const deps = makeDeps({
      projects: [{ id: 'p1', name: 'Сайт' }],
      tasksByProject: {
        p1: [
          { id: 't-nodl', description: 'Без срока' },
          { id: 't-future', description: 'Будущая', deadline: '2026-07-20' },
          { id: 't-over', description: 'Просроченная', deadline: '2026-07-01' },
          { id: 't-today', description: 'Сегодня', deadline: '2026-07-13' },
        ],
      },
    });
    const res = await buildAssigneeTaskCards(deps, 'viewer', null, 'https://pf.test', now);
    assert.deepEqual(
      res.cards.map((c) => c.taskId),
      ['t-over', 't-today', 't-future', 't-nodl'],
    );
    assert.ok(res.cards[0]!.text.includes('просрочено'), 'у просроченной есть пометка');
    assert.ok(!res.cards[1]!.text.includes('просрочено'), 'сегодняшняя не просрочена');
    assert.ok(res.cards[1]!.text.includes('сегодня'), 'formatDeadlineRu применён');
    assert.ok(!res.cards[3]!.text.includes('⏰'), 'без срока — без строки ⏰');
  });

  test('cards: лимит 12, totalCount — полный', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `t${i}`,
      description: `Задача ${i}`,
    }));
    const deps = makeDeps({
      projects: [{ id: 'p1', name: 'Сайт' }],
      tasksByProject: { p1: many },
    });
    const res = await buildAssigneeTaskCards(deps, 'viewer', null, 'https://pf.test');
    assert.equal(res.cards.length, ASSIGNEE_CARDS_LIMIT);
    assert.equal(res.totalCount, 15);
  });
  ```

- [ ] **Step 6: убедиться, что тесты карточек падают**

  Из `server/`:

  ```
  node --import tsx --test src/application/telegram/assigneeBrowse.test.ts
  ```

  Ожидаемо: `SyntaxError`/`TypeError` — `buildAssigneeTaskCards` не экспортируется из `./assigneeBrowse.js` (menu-тесты при этом тоже не добегут — это нормально для этого чекпоинта).

- [ ] **Step 7: реализовать `buildAssigneeTaskCards`**

  Дописать в КОНЕЦ `server/src/application/telegram/assigneeBrowse.ts` (после `buildAssigneeMenu`, перед `chunk2` или после — порядок не важен, hoisting функций):

  ```ts
  // Экран 2: карточки открытых задач выбранного ответственного в охвате viewerUserId.
  // assigneeUserId === null → задачи без активной делегации («Без ответственного»).
  // Сортировка: по сроку asc (просроченные оказываются первыми), задачи без срока — в конец.
  export async function buildAssigneeTaskCards(
    deps: AssigneeBrowseDeps,
    viewerUserId: string,
    assigneeUserId: string | null,
    appUrl: string,
    now: Date = new Date(),
  ): Promise<AssigneeTaskCards> {
    const { rows, delegationByTask } = await collectOpenTasks(deps, viewerUserId);
    let assigneeName: string | null = null;
    const matching = rows.filter((r) => {
      const d = delegationByTask.get(r.task.id) ?? null;
      if (assigneeUserId === null) return d === null;
      if (d !== null && d.delegateUserId === assigneeUserId) {
        assigneeName = d.delegateDisplayName;
        return true;
      }
      return false;
    });
    // Node sort стабильный: внутри «просроченных»/«будущих» порядок по сроку, без срока — хвост.
    matching.sort((a, b) => {
      const da = a.task.deadline;
      const db = b.task.deadline;
      if (da !== null && db !== null) return da < db ? -1 : da > db ? 1 : 0;
      if (da !== null) return -1;
      if (db !== null) return 1;
      return 0;
    });

    const base = appUrl.replace(/\/$/, '');
    const cards = matching.slice(0, ASSIGNEE_CARDS_LIMIT).map((r): AssigneeTaskCard => {
      const title = splitDescription(r.task.description).name;
      const lines = [`📌 <b>${escapeHtml(title)}</b>`, `📁 ${escapeHtml(r.projectName)}`];
      if (r.task.deadline !== null) {
        const overdue = isOverdue(r.task.deadline, now);
        lines.push(`⏰ ${formatDeadlineRu(r.task.deadline, now)}${overdue ? ' · ❗️ просрочено' : ''}`);
      }
      const url = `${base}/projects/${r.projectId}?task=${r.task.id}`;
      return {
        taskId: r.task.id,
        projectId: r.projectId,
        text: lines.join('\n'),
        keyboard: {
          inline_keyboard: [
            ...taskActionKeyboard(r.task.id).inline_keyboard,
            [{ text: 'Открыть в ProjectsFlow', url }],
          ],
        },
      };
    });
    return { assigneeName, totalCount: matching.length, cards };
  }

  // 'YYYY-MM-DD' строго раньше сегодняшней даты (локальная TZ, как formatDeadlineRu).
  function isOverdue(iso: string, now: Date): boolean {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return false;
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return date.getTime() < today.getTime();
  }
  ```

- [ ] **Step 8: прогнать ВСЕ тесты файла — PASS**

  Из `server/`:

  ```
  node --import tsx --test src/application/telegram/assigneeBrowse.test.ts
  ```

  Ожидаемо: `pass 8`, `fail 0` (4 menu + 4 cards).

- [ ] **Step 9: типы + commit**

  Из корня репо: `npm run build` (tsc обоих workspaces; tsx типы не проверяет — build обязателен). Ожидаемо: без ошибок.

  ```
  git add server/src/application/telegram/assigneeBrowse.ts server/src/application/telegram/assigneeBrowse.test.ts
  git commit -m "feat(telegram): assigneeBrowse — билдеры меню задач по ответственным и карточек (ba:/bt:root, сроки, лимит 12) + тесты"
  ```

### Task 17: HandleTelegramWebhook — /tasks → меню по ответственным, callback `ba:`, `bt:root`, регистрация карточек

**Files:**
- Modify: `server/src/application/telegram/HandleTelegramWebhook.ts` (импорты L1–33; Deps L71–115; роутинг callback'ов L125–137; `handleTasks` L791–811; `handleBrowseCallback` L813–913 — ветка `bt:root` и лейблы `bt:p:`; `sendReturningId` L943–956)
- Modify: `server/src/index.ts` (wiring `new HandleTelegramWebhook({...})` L852–881 — добавить `delegations`)
- Test: Create `server/src/application/telegram/HandleTelegramWebhook.assignee.test.ts`

**Interfaces:**
- Consumes (из Task 16, `server/src/application/telegram/assigneeBrowse.ts`):
  - `buildAssigneeMenu(deps: AssigneeBrowseDeps, userId: string): Promise<AssigneeMenu | null>` (`AssigneeMenu = { text: string; keyboard: InlineKeyboardMarkup }`, null = нет проектов)
  - `buildAssigneeTaskCards(deps: AssigneeBrowseDeps, viewerUserId: string, assigneeUserId: string | null, appUrl: string, now?: Date): Promise<AssigneeTaskCards>` (`{ assigneeName: string|null; totalCount: number; cards: { taskId; projectId; text; keyboard }[] }`)
  - `AssigneeBrowseDeps = { members: Pick<ProjectMemberRepository,'listProjectsForUser'>; tasks: Pick<TaskRepository,'listByProject'>; delegations: Pick<TaskDelegationRepository,'listActiveForTasks'> }`
- Consumes (существующее): `TaskDelegationRepository.listActiveForTasks` из `server/src/application/task/TaskDelegationRepository.ts`; `splitDescription` из `server/src/domain/task/digestFormat.ts`; в `index.ts` переменная `taskDelegationRepo` уже создана (используется соседним wiring'ом, напр. `MoveTask` на L869).
- Produces (нужно Task 18):
  - приватный метод `HandleTelegramWebhook.sendAssigneeMenu(chatId: number, ownerUserId: string): Promise<void>` — отправка меню «по ответственным» в чат от охвата произвольного юзера (Task 18 переиспользует для группы);
  - новый deps-ключ `delegations: Pick<TaskDelegationRepository, 'listActiveForTasks'>` в `Deps` HandleTelegramWebhook;
  - callback-роутинг `ba:` и ветка `bt:root` в `handleBrowseCallback`.

Поведение (спека §5): `/tasks` в личке показывает экран 1 «по ответственным»; нажатие `ba:<userId>`/`ba:none` шлёт заголовок + до 12 карточек задач, каждая карточка регистрируется в `telegram_task_messages` (reply на неё = комментарий — существующий механизм `handleTaskReplyComment`); кнопка «📁 По проектам» (`bt:root`) показывает СТАРЫЙ экран выбора проекта (`bt:p:` навигация не меняется). Попутный фикс из спеки: кнопки задач в `bt:p:` подписываются plain-названием (первая строка описания), а не обрывком всего описания.

Шаги:

- [ ] **Step 1: написать падающие тесты роутинга**

  Создать `server/src/application/telegram/HandleTelegramWebhook.assignee.test.ts` целиком (стиль — как существующий `HandleTelegramWebhook.test.ts`: ручные стабы + `as any`):

  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { HandleTelegramWebhook, type TelegramUpdate } from './HandleTelegramWebhook.js';

  // Харнесс для /tasks + ba:/bt:root: фейки members/tasks/delegations с данными,
  // клиент копит отправленные сообщения/ответы, taskMessages копит upsert'ы.
  function makeHarness(opts?: {
    userId?: string | null;
    projects?: { id: string; name: string }[];
    tasksByProject?: Record<string, any[]>;
    delegations?: Record<string, { delegateUserId: string; delegateDisplayName: string }>;
  }) {
    const sent: { chatId: number; text: string; replyMarkup: any }[] = [];
    const answers: { id: string; text?: string; showAlert?: boolean }[] = [];
    const upserts: any[] = [];
    const userId = opts && 'userId' in opts ? opts.userId! : 'viewer1';

    const deps = {
      users: { async findUserIdByTelegramUserId() { return userId; } },
      members: {
        async listProjectsForUser() { return opts?.projects ?? []; },
        async findForProject() { return { role: 'editor' }; },
      },
      tasks: {
        async listByProject(pid: string) {
          return (opts?.tasksByProject?.[pid] ?? []).map((t: any) => ({
            status: 'todo', deadline: null, ...t,
          }));
        },
        async getById() { return null; },
      },
      delegations: {
        async listActiveForTasks(ids: readonly string[]) {
          const m = new Map<string, any>();
          for (const id of ids) {
            const d = opts?.delegations?.[id];
            if (d) m.set(id, { id: `d-${id}`, taskId: id, status: 'accepted', ...d });
          }
          return m;
        },
      },
      client: {
        async sendMessage(i: any) {
          sent.push({ chatId: i.chatId, text: i.text, replyMarkup: i.replyMarkup });
          return { kind: 'ok' as const, messageId: 100 + sent.length };
        },
        async answerCallbackQuery(id: string, o?: any) { answers.push({ id, ...(o ?? {}) }); },
      },
      appUrl: 'https://pf.test',
      signingSecret: 's',
      botUsername: 'ProjectsFlow_Bot',
      ralphQuestionMessages: { async findByMessage() { return null; } },
      taskMessages: {
        async findByMessage() { return null; },
        async upsert(i: any) { upserts.push(i); },
      },
      groupOwners: { async getOwnerUserId() { return null; } },
      createComment: {},
      moveTask: {},
      confirmCloseProposal: {},
      dismissCloseProposal: {},
      dispatchCommentNotifications: {},
      composer: { async handleCallback() {}, async startFromMessage() {}, async handleInlineQuery() {} },
      maybeReopenForClarification: {},
      notifyTaskChanged() {},
      notifyCommentAdded() {},
      notifyStatusChanged() {},
    };
    return { h: new HandleTelegramWebhook(deps as any), sent, answers, upserts };
  }

  function tasksUpdate(): TelegramUpdate {
    return {
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 111 },
        chat: { id: 111, type: 'private' },
        text: '/tasks',
      },
    };
  }

  function cbUpdate(data: string): TelegramUpdate {
    return {
      update_id: 1,
      callback_query: {
        id: 'cq1',
        from: { id: 111 },
        message: { message_id: 10, chat: { id: 111 } },
        data,
      },
    } as any;
  }

  const seed = {
    projects: [{ id: 'p1', name: 'Сайт' }],
    tasksByProject: {
      p1: [
        { id: 't1', description: 'Делегированная Олегу' },
        { id: 't2', description: 'Ничья задача' },
      ],
    },
    delegations: { t1: { delegateUserId: 'u-oleg', delegateDisplayName: 'Олег' } },
  };

  test('/tasks → меню по ответственным (ba:-кнопки, ba:none, bt:root), НЕ список проектов', async () => {
    const h = makeHarness(seed);
    await h.h.execute(tasksUpdate());
    assert.equal(h.sent.length, 1);
    const kb = h.sent[0]!.replyMarkup.inline_keyboard.flat();
    assert.ok(kb.some((b: any) => b.callback_data === 'ba:u-oleg'));
    assert.ok(kb.some((b: any) => b.callback_data === 'ba:none'));
    assert.ok(kb.some((b: any) => b.callback_data === 'bt:root'));
    assert.ok(!kb.some((b: any) => (b.callback_data ?? '').startsWith('bt:p:')), 'проекты не на первом экране');
  });

  test('/tasks: нет проектов → «📭»-заглушка', async () => {
    const h = makeHarness({ projects: [] });
    await h.h.execute(tasksUpdate());
    assert.equal(h.sent.length, 1);
    assert.ok(h.sent[0]!.text.includes('📭'));
  });

  test('/tasks: непривязанный → просьба привязать', async () => {
    const h = makeHarness({ userId: null });
    await h.h.execute(tasksUpdate());
    assert.ok(h.sent[0]!.text.includes('привяжи'));
  });

  test('ba:<uid> → заголовок + карточки с nd/nc/url, каждая регистрируется в taskMessages', async () => {
    const h = makeHarness(seed);
    await h.h.execute(cbUpdate('ba:u-oleg'));
    // 1 заголовок + 1 карточка
    assert.equal(h.sent.length, 2);
    assert.ok(h.sent[0]!.text.includes('Олег'));
    const card = h.sent[1]!;
    assert.ok(card.text.includes('Делегированная Олегу'));
    const kb = card.replyMarkup.inline_keyboard.flat();
    assert.ok(kb.some((b: any) => b.callback_data === 'nd:t1'));
    assert.ok(kb.some((b: any) => b.callback_data === 'nc:t1'));
    assert.ok(kb.some((b: any) => b.url === 'https://pf.test/projects/p1?task=t1'));
    // Регистрация reply→комментарий: upsert ровно для карточки (заголовок не регистрируем).
    assert.equal(h.upserts.length, 1);
    assert.deepEqual(
      { taskId: h.upserts[0].taskId, projectId: h.upserts[0].projectId, recipientUserId: h.upserts[0].recipientUserId },
      { taskId: 't1', projectId: 'p1', recipientUserId: 'viewer1' },
    );
    assert.ok(h.answers.some((a) => a.id === 'cq1'), 'callback подтверждён');
  });

  test('ba:none → задачи без делегации', async () => {
    const h = makeHarness(seed);
    await h.h.execute(cbUpdate('ba:none'));
    assert.equal(h.sent.length, 2);
    assert.ok(h.sent[0]!.text.includes('Без ответственного'));
    assert.ok(h.sent[1]!.text.includes('Ничья задача'));
  });

  test('ba: у ответственного нет открытых задач → alert без сообщений', async () => {
    const h = makeHarness(seed);
    await h.h.execute(cbUpdate('ba:u-ghost'));
    assert.equal(h.sent.length, 0);
    assert.ok(h.answers.some((a) => a.showAlert === true));
  });

  test('ba: непривязанный → alert «привяжи», без карточек', async () => {
    const h = makeHarness({ ...seed, userId: null });
    await h.h.execute(cbUpdate('ba:u-oleg'));
    assert.equal(h.sent.length, 0);
    assert.ok(h.answers.some((a) => a.showAlert === true));
  });

  test('bt:root → старый экран «Выбери проект» (bt:p:-кнопки)', async () => {
    const h = makeHarness(seed);
    await h.h.execute(cbUpdate('bt:root'));
    assert.equal(h.sent.length, 1);
    assert.ok(h.sent[0]!.text.includes('Выбери проект'));
    const kb = h.sent[0]!.replyMarkup.inline_keyboard.flat();
    assert.ok(kb.some((b: any) => b.callback_data === 'bt:p:p1'));
    assert.ok(h.answers.some((a) => a.id === 'cq1'));
  });

  test('bt:p: кнопки задач подписаны plain-названием (первой строкой), не телом описания', async () => {
    const h = makeHarness({
      ...seed,
      tasksByProject: {
        p1: [{ id: 't1', description: '## **Название** задачи\n\nдлинное тело которое не должно попасть в кнопку' }],
      },
    });
    await h.h.execute(cbUpdate('bt:p:p1'));
    const kb = h.sent[0]!.replyMarkup.inline_keyboard.flat();
    const btn = kb.find((b: any) => b.callback_data === 'bt:t:t1');
    assert.ok(btn);
    assert.ok(btn.text.includes('Название задачи'), 'markdown снят');
    assert.ok(!btn.text.includes('длинное тело'), 'тело не попало в лейбл');
  });
  ```

- [ ] **Step 2: убедиться, что тесты падают**

  Из `server/`:

  ```
  node --import tsx --test src/application/telegram/HandleTelegramWebhook.assignee.test.ts
  ```

  Ожидаемо: fail — `/tasks` шлёт «Выбери проект» вместо ba:-меню; `ba:*` уходит в `composer.handleCallback` (0 сообщений); `bt:root` парсится как kind `'ro'` и молча падает в финальный `answerCallbackQuery` (0 сообщений).

- [ ] **Step 3: реализация в HandleTelegramWebhook.ts**

  3a. Импорты (после существующего импорта `taskActionKeyboard`, около L15):

  ```ts
  import type { TaskDelegationRepository } from '../task/TaskDelegationRepository.js';
  import { buildAssigneeMenu, buildAssigneeTaskCards } from './assigneeBrowse.js';
  ```

  и в существующий импорт из `digestFormat.js` (L28–32) добавить `splitDescription`:

  ```ts
  import {
    stripAllMarkdown,
    markdownToRich,
    extractImageSrcs,
    splitDescription,
  } from '../../domain/task/digestFormat.js';
  ```

  3b. В `type Deps` (после `readonly tasks: TaskRepository;`, L74):

  ```ts
    // Активные делегации задач — меню /tasks «по ответственным» (ba:-callbacks). Узкий Pick:
    // билдерам assigneeBrowse нужен только listActiveForTasks.
    readonly delegations: Pick<TaskDelegationRepository, 'listActiveForTasks'>;
  ```

  3c. Роутинг callback'ов в `execute()` — добавить строку ПЕРЕД `if (data.startsWith('bt:'))` (L135):

  ```ts
        if (data.startsWith('ba:')) return this.handleAssigneeCallback(cq);
  ```

  3d. Заменить тело `handleTasks` (L791–811) на два метода + перенести старый список проектов в `sendProjectList`:

  ```ts
    // --- /tasks: экран 1 «по ответственным» → карточки задач; «📁 По проектам» (bt:root)
    //     ведёт на старый браузер проект → задачи → карточка. ---
    private async handleTasks(tgUserId: number, chatId: number): Promise<void> {
      const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
      if (!userId) {
        await this.reply(chatId, '⚠️ Сначала привяжи Telegram через /profile.');
        return;
      }
      await this.sendAssigneeMenu(chatId, userId);
    }

    // Меню «по ответственным». ownerUserId — чей охват проектов показываем (в личке —
    // сам вызывающий; в группе — владелец привязки, см. handleGroupAssigneeMenu).
    private async sendAssigneeMenu(chatId: number, ownerUserId: string): Promise<void> {
      const menu = await buildAssigneeMenu(this.assigneeDeps(), ownerUserId);
      if (!menu) {
        await this.reply(chatId, '📭 У тебя пока нет проектов. Напиши текст — создам задачу во «Входящие».');
        return;
      }
      await this.reply(chatId, menu.text, menu.keyboard);
    }

    // Узкий deps-набор для билдеров assigneeBrowse.
    private assigneeDeps() {
      return {
        members: this.deps.members,
        tasks: this.deps.tasks,
        delegations: this.deps.delegations,
      };
    }

    // Экран «По проектам» (бывший корень /tasks) — вторичная навигация с кнопки bt:root.
    private async sendProjectList(chatId: number, userId: string): Promise<void> {
      const projects = await this.deps.members.listProjectsForUser(userId);
      if (projects.length === 0) {
        await this.reply(chatId, '📭 У тебя пока нет проектов. Напиши текст — создам задачу во «Входящие».');
        return;
      }
      const shown = projects.slice(0, BROWSE_LIMIT);
      const rows = chunk2(
        shown.map((p) => ({ text: p.name.slice(0, 40), callback_data: `bt:p:${p.id}` })),
      );
      const note =
        projects.length > BROWSE_LIMIT
          ? `\n\n<i>Показаны первые ${BROWSE_LIMIT} из ${projects.length} — остальные в интерфейсе.</i>`
          : '';
      await this.reply(chatId, `📂 <b>Выбери проект:</b>${note}`, { inline_keyboard: rows });
    }

    // ba:<userId> | ba:none — карточки открытых задач выбранного ответственного (экран 2).
    // Охват — проекты НАЖАВШЕГО (гейт членства встроен: listProjectsForUser). Каждая карточка
    // регистрируется в telegram_task_messages → reply на неё = комментарий (handleTaskReplyComment).
    private async handleAssigneeCallback(cq: TelegramCallbackQuery): Promise<void> {
      const chatId = cq.message?.chat.id ?? cq.from.id;
      const userId = await this.deps.users.findUserIdByTelegramUserId(cq.from.id);
      if (!userId) {
        await this.answerNeedsLink(cq.id);
        return;
      }
      const arg = (cq.data ?? '').slice('ba:'.length);
      const assigneeUserId = arg === 'none' ? null : arg;
      const result = await buildAssigneeTaskCards(
        this.assigneeDeps(),
        userId,
        assigneeUserId,
        this.deps.appUrl,
      );
      if (result.cards.length === 0) {
        await this.deps.client.answerCallbackQuery(cq.id, {
          text: 'Открытых задач не нашлось.',
          showAlert: true,
        });
        return;
      }
      const who = assigneeUserId === null ? 'Без ответственного' : (result.assigneeName ?? 'Ответственный');
      const extra =
        result.totalCount > result.cards.length
          ? ` (первые ${result.cards.length} из ${result.totalCount})`
          : '';
      await this.reply(chatId, `👤 <b>${escapeHtml(who)}</b> — открытые задачи${extra}:`);
      for (const card of result.cards) {
        const messageId = await this.sendReturningId(chatId, card.text, card.keyboard);
        if (messageId !== null) {
          try {
            await this.deps.taskMessages.upsert({
              tgChatId: chatId,
              tgMessageId: messageId,
              recipientUserId: userId,
              taskId: card.taskId,
              projectId: card.projectId,
            });
          } catch (err) {
            console.warn('[tg-webhook] assignee card taskMessage upsert failed:', err);
          }
        }
      }
      await this.deps.client.answerCallbackQuery(cq.id);
    }
  ```

  3e. В `handleBrowseCallback` (L813) — сразу ПОСЛЕ гейта «непривязанный» (после блока `if (!userId) {...}`, перед `const body = data.slice('bt:'.length);`) вставить:

  ```ts
      // bt:root — экран «По проектам» из меню по ответственным.
      if (data === 'bt:root') {
        await this.sendProjectList(chatId, userId);
        await this.deps.client.answerCallbackQuery(cq.id);
        return;
      }
  ```

  3f. Фикс лейблов задач в ветке `kind === 'p:'` (L849–854) — заменить построение label:

  ```ts
        const rows = shown.map((t) => {
          // Есть картинки в описании → префикс 🖼 (в кнопке видно, что внутри фото).
          const hasImg = extractImageSrcs(t.description).length > 0;
          // Лейбл — plain-НАЗВАНИЕ (первая непустая строка без markdown), не обрывок описания.
          const cap = hasImg ? 52 : 56;
          const title = splitDescription(t.description).name;
          const clipped = title.length <= cap ? title : title.slice(0, cap - 1).trimEnd() + '…';
          return [{ text: `${hasImg ? '🖼 ' : ''}${clipped}`, callback_data: `bt:t:${t.id}` }];
        });
  ```

  3g. `sendReturningId` (L943) — добавить опциональный `replyMarkup`:

  ```ts
    // Как reply, но возвращает message_id (для маппинга task-сообщения). null при ошибке.
    private async sendReturningId(
      chatId: number,
      text: string,
      replyMarkup?: InlineKeyboardMarkup,
    ): Promise<number | null> {
      try {
        const res = await this.deps.client.sendMessage({
          chatId,
          text,
          parseMode: 'HTML',
          disableWebPagePreview: true,
          replyMarkup,
        });
        return res.kind === 'ok' ? res.messageId : null;
      } catch (err) {
        console.warn('[tg-webhook] sendReturningId failed', err);
        return null;
      }
    }
  ```

- [ ] **Step 4: прогнать тесты — PASS, старые не сломаны**

  Из `server/`:

  ```
  node --import tsx --test src/application/telegram/HandleTelegramWebhook.assignee.test.ts
  node --import tsx --test src/application/telegram/HandleTelegramWebhook.test.ts
  ```

  Ожидаемо: оба файла `fail 0`. (Старый тест-файл не задаёт `delegations` в deps — он с `as any`, а /tasks в нём не гоняется, поэтому не падает.)

- [ ] **Step 5: wiring в index.ts**

  В `server/src/index.ts` в конструктор `new HandleTelegramWebhook({...})` (L852) после `tasks: taskRepo,` (L855) добавить строку:

  ```ts
    delegations: taskDelegationRepo,
  ```

  (Переменная `taskDelegationRepo` уже объявлена выше — используется в `MoveTask` на L869.)

- [ ] **Step 6: сборка + commit**

  Из корня репо: `npm run build` — ожидаемо без ошибок TS (tsx в тестах типы не проверяет, build обязателен).

  ```
  git add server/src/application/telegram/HandleTelegramWebhook.ts server/src/application/telegram/HandleTelegramWebhook.assignee.test.ts server/src/index.ts
  git commit -m "feat(telegram): /tasks — меню задач по ответственным (ba:-карточки с reply-комментированием), «По проектам» переехал на bt:root, plain-названия кнопок задач"
  ```

### Task 18: Группа — «пустое» упоминание бота → меню по ответственным владельца привязки; describe-меню /tasks

**Files:**
- Modify: `server/src/application/telegram/HandleTelegramWebhook.ts` (метод `execute()` — вставка между reply-веткой L171–173 и командным роутингом L176; новый приватный метод `handleGroupAssigneeMenu` рядом с `sendAssigneeMenu`)
- Modify: `server/src/index.ts` (блок `setMyCommands` L2483–2489 — описание `/tasks`)
- Test: Create `server/src/application/telegram/HandleTelegramWebhook.groupMenu.test.ts`

**Interfaces:**
- Consumes (из Task 17, `HandleTelegramWebhook.ts`):
  - приватный метод `sendAssigneeMenu(chatId: number, ownerUserId: string): Promise<void>` — отправляет меню «по ответственным» (или «📭»-заглушку, если у юзера нет проектов);
  - deps-ключ `delegations: Pick<TaskDelegationRepository,'listActiveForTasks'>` уже в `Deps`.
- Consumes (существующее): `TelegramGroupOwnerRepository.getOwnerUserId(tgChatId: number): Promise<string | null>` (`deps.groupOwners`, `server/src/application/telegram/TelegramGroupOwnerRepository.ts`); `TelegramClient.setMyCommands(commands: readonly TelegramBotCommand[]): Promise<void>`.
- Produces: приватный метод `handleGroupAssigneeMenu(chatId: number): Promise<void>` (терминальный, никем дальше не потребляется).

Поведение (спека §5, решение «Что такое „вызов" бота»): в группе «пустое» @упоминание (после вырезания `@bot` текст пуст) показывает то же меню «по ответственным», охват — пространство/проекты ВЛАДЕЛЬЦА привязки группы (`telegram_group_owners`); упоминание с текстом — как раньше, задача через composer; reply на сообщение бота — по-прежнему приоритетнее (комментарий/ralph-answer). Группа не привязана → просьба отправить `/start`. Личка не меняется (пустой текст в личке невозможен: `!msg.text` отсеивается раньше, а `/tasks` уже показывает меню — Task 17).

Шаги:

- [ ] **Step 1: написать падающие тесты группового «пустого» упоминания**

  Создать `server/src/application/telegram/HandleTelegramWebhook.groupMenu.test.ts` целиком:

  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { HandleTelegramWebhook, type TelegramUpdate } from './HandleTelegramWebhook.js';

  // Харнесс группового чата: привязка группы (boundOwner) + данные для меню по ответственным.
  function makeHarness(opts?: {
    boundOwner?: string | null;
    senderUserId?: string | null;
    projects?: { id: string; name: string }[];
  }) {
    const sent: { chatId: number; text: string; replyMarkup: any }[] = [];
    const composerCalls: { text: string }[] = [];
    const menuScopeUsers: string[] = [];
    let ralphLookups = 0;
    const boundOwner = opts?.boundOwner ?? null;
    const senderUserId = opts && 'senderUserId' in opts ? (opts.senderUserId ?? null) : 'sender1';

    const deps = {
      users: { async findUserIdByTelegramUserId() { return senderUserId; } },
      members: {
        // Фиксируем, ЧЕЙ охват запросили — меню должно строиться от владельца привязки.
        async listProjectsForUser(userId: string) {
          menuScopeUsers.push(userId);
          return opts?.projects ?? [{ id: 'p1', name: 'Сайт' }];
        },
        async findForProject() { return { role: 'editor' }; },
      },
      tasks: {
        async listByProject() {
          return [{ id: 't1', description: 'Задача владельца', status: 'todo', deadline: null }];
        },
      },
      delegations: {
        async listActiveForTasks() {
          return new Map([
            ['t1', { id: 'd1', taskId: 't1', status: 'accepted', delegateUserId: 'u-oleg', delegateDisplayName: 'Олег' }],
          ]);
        },
      },
      client: {
        async sendMessage(i: any) {
          sent.push({ chatId: i.chatId, text: i.text, replyMarkup: i.replyMarkup });
          return { kind: 'ok' as const, messageId: 1 };
        },
        async answerCallbackQuery() {},
      },
      appUrl: 'https://pf.test',
      signingSecret: 's',
      botUsername: 'ProjectsFlow_Bot',
      ralphQuestionMessages: { async findByMessage() { ralphLookups += 1; return null; } },
      taskMessages: { async findByMessage() { return null; }, async upsert() {} },
      groupOwners: {
        async getOwnerUserId() { return boundOwner; },
        async bindIfAbsent() { return { ownerUserId: 'x', created: false }; },
      },
      createComment: {},
      moveTask: {},
      confirmCloseProposal: {},
      dismissCloseProposal: {},
      dispatchCommentNotifications: {},
      composer: {
        async startFromMessage(_u: number, _c: number, text: string) { composerCalls.push({ text }); },
        async handleCallback() {},
        async handleInlineQuery() {},
      },
      maybeReopenForClarification: {},
      notifyTaskChanged() {},
      notifyCommentAdded() {},
      notifyStatusChanged() {},
    };
    return {
      h: new HandleTelegramWebhook(deps as any),
      sent,
      composerCalls,
      menuScopeUsers,
      ralphLookups: () => ralphLookups,
    };
  }

  function groupMsg(text: string, reply?: { is_bot: boolean }): TelegramUpdate {
    return {
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 111, first_name: 'U' },
        chat: { id: -500, type: 'supergroup', title: 'Рабочий чат' },
        text,
        ...(reply ? { reply_to_message: { message_id: 9, from: { id: 999, is_bot: reply.is_bot } } } : {}),
      },
    };
  }

  test('группа: пустое @упоминание + привязка → меню по ответственным от ВЛАДЕЛЬЦА привязки', async () => {
    const h = makeHarness({ boundOwner: 'owner1' });
    await h.h.execute(groupMsg('@ProjectsFlow_Bot'));
    assert.equal(h.composerCalls.length, 0, 'composer не вызван');
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.menuScopeUsers, ['owner1'], 'охват — владелец привязки, не отправитель');
    const kb = h.sent[0]!.replyMarkup.inline_keyboard.flat();
    assert.ok(kb.some((b: any) => b.callback_data === 'ba:u-oleg'));
    assert.ok(kb.some((b: any) => b.callback_data === 'bt:root'));
  });

  test('группа: пустое @упоминание с пробелами/регистром → тоже меню', async () => {
    const h = makeHarness({ boundOwner: 'owner1' });
    await h.h.execute(groupMsg('  @projectsflow_bot  '));
    assert.equal(h.sent.length, 1);
    assert.equal(h.composerCalls.length, 0);
    assert.deepEqual(h.menuScopeUsers, ['owner1']);
  });

  test('группа: пустое @упоминание БЕЗ привязки → просьба /start, без меню и composer', async () => {
    const h = makeHarness({ boundOwner: null });
    await h.h.execute(groupMsg('@ProjectsFlow_Bot'));
    assert.equal(h.composerCalls.length, 0);
    assert.equal(h.menuScopeUsers.length, 0);
    assert.equal(h.sent.length, 1);
    assert.ok(h.sent[0]!.text.includes('/start'));
  });

  test('группа: @упоминание С ТЕКСТОМ → composer (создание задачи), как раньше', async () => {
    const h = makeHarness({ boundOwner: 'owner1' });
    await h.h.execute(groupMsg('@ProjectsFlow_Bot купить домен'));
    assert.equal(h.composerCalls.length, 1);
    assert.equal(h.composerCalls[0]!.text, 'купить домен');
    assert.equal(h.menuScopeUsers.length, 0, 'меню не показано');
  });

  test('группа: reply на бота с текстом-упоминанием → reply-ветка приоритетнее меню', async () => {
    const h = makeHarness({ boundOwner: 'owner1' });
    await h.h.execute(groupMsg('@ProjectsFlow_Bot', { is_bot: true }));
    assert.equal(h.ralphLookups(), 1, 'дошли до handleReply');
    assert.equal(h.menuScopeUsers.length, 0, 'меню не показано');
  });

  test('группа: пустое упоминание, владелец привязан, но без проектов → «📭»-заглушка', async () => {
    const h = makeHarness({ boundOwner: 'owner1', projects: [] });
    await h.h.execute(groupMsg('@ProjectsFlow_Bot'));
    assert.equal(h.sent.length, 1);
    assert.ok(h.sent[0]!.text.includes('📭'));
  });
  ```

- [ ] **Step 2: убедиться, что тесты падают**

  Из `server/`:

  ```
  node --import tsx --test src/application/telegram/HandleTelegramWebhook.groupMenu.test.ts
  ```

  Ожидаемо: fail — сейчас пустой текст после вырезания упоминания уходит в `composer.startFromMessage` (`composerCalls.length === 1`, меню не отправляется). Тесты «с текстом» и «reply» могут проходить уже сейчас — это ок.

- [ ] **Step 3: реализация в HandleTelegramWebhook.ts**

  3a. В `execute()` — вставить МЕЖДУ reply-веткой и командным роутингом, т.е. сразу после блока

  ```ts
      if (msg.reply_to_message?.message_id) {
        return this.handleReply(tgUserId, chatId, msg.reply_to_message.message_id, text);
      }
  ```

  добавить:

  ```ts
      // «Пустое» @упоминание в группе (только @bot, без другого текста) → меню задач
      // «по ответственным» в охвате ВЛАДЕЛЬЦА привязки группы (telegram_group_owners).
      // Сюда попадаем только если бот был упомянут/reply'нут (гейт isGroup выше), а после
      // вырезания @упоминания текст пуст. Упоминание с текстом — ниже, composer как раньше.
      if (isGroup && text.length === 0) {
        return this.handleGroupAssigneeMenu(chatId);
      }
  ```

  3b. Новый приватный метод — добавить сразу после `sendAssigneeMenu` (введён в Task 17):

  ```ts
    // Пустое @упоминание в группе: меню по ответственным от имени владельца привязки.
    // Не привязано → подсказка /start (та же привязка, что ловит задачи непривязанных).
    private async handleGroupAssigneeMenu(chatId: number): Promise<void> {
      const ownerUserId = await this.deps.groupOwners.getOwnerUserId(chatId);
      if (!ownerUserId) {
        await this.reply(
          chatId,
          '⚠️ Группа не привязана к аккаунту. Отправь /start, чтобы привязать её к себе, — и вызывай меню задач пустым упоминанием.',
        );
        return;
      }
      await this.sendAssigneeMenu(chatId, ownerUserId);
    }
  ```

- [ ] **Step 4: прогнать тесты — PASS, соседние файлы не сломаны**

  Из `server/`:

  ```
  node --import tsx --test src/application/telegram/HandleTelegramWebhook.groupMenu.test.ts
  node --import tsx --test src/application/telegram/HandleTelegramWebhook.test.ts
  node --import tsx --test src/application/telegram/HandleTelegramWebhook.assignee.test.ts
  ```

  Ожидаемо: все `fail 0`. Особо важен старый тест «группа: @упоминание + текст → задача из очищенного текста» — он гарантирует, что упоминание С текстом по-прежнему идёт в composer.

- [ ] **Step 5: обновить describe-меню бота (setMyCommands)**

  В `server/src/index.ts` в блоке `setMyCommands` (L2483–2489) заменить строку

  ```ts
        { command: 'tasks', description: 'Мои проекты и задачи' },
  ```

  на

  ```ts
        { command: 'tasks', description: 'Задачи по ответственным' },
  ```

  (Остальные команды не трогаем; это UI-строка меню «/» в TG-клиенте, применится при следующем старте сервера.)

- [ ] **Step 6: сборка + commit**

  Из корня репо: `npm run build` — ожидаемо без ошибок TS.

  ```
  git add server/src/application/telegram/HandleTelegramWebhook.ts server/src/application/telegram/HandleTelegramWebhook.groupMenu.test.ts server/src/index.ts
  git commit -m "feat(telegram): пустое @упоминание в группе — меню задач по ответственным владельца привязки; /tasks в describe-меню бота"
  ```

### Task 19: Client domain/application/infrastructure — инвайты пространства (WorkspaceInvite)

**Files:**
- Create: `client/src/domain/workspace/WorkspaceInvite.ts`
- Modify: `client/src/application/workspace/WorkspaceRepository.ts` (весь файл 27 строк — добавить import, input-тип и 3 метода в интерфейс)
- Modify: `client/src/infrastructure/http/HttpWorkspaceRepository.ts` (добавить DTO+маппер после строки 35, 3 метода в конец класса перед строкой 128)
- НЕ трогать: `client/src/infrastructure/di/container.tsx` — `workspaceRepository` уже экспонирован через `useContainer()` (строки 126, 166, 213), новые методы доступны автоматически.
- Test: нет (клиент; проверка `npm run typecheck` + `npm run lint`)

**Interfaces:**
- Consumes (серверная секция, REST-контракт — новые роуты workspace-инвайтов; клиент должен бить в эти URL):
  - `GET /api/workspaces/:id/invites` → `200 { invites: WorkspaceInviteDto[] }` (pending-инвайты, без token/url)
  - `POST /api/workspaces/:id/invites` body `{ role: 'editor'|'viewer', email: string|null }` → `201 { invite: WorkspaceInviteDto & { token: string; url: string } }`
  - `DELETE /api/workspaces/:id/invites/:inviteId` → `204`
  - `WorkspaceInviteDto = { id, workspaceId, role: 'editor'|'viewer', email: string|null, expiresAt: ISO-string, acceptedAt: ISO-string|null, acceptedByUserId: string|null, createdByUserId: string, createdAt: ISO-string, token?: string, url?: string }`
  - ⚠️ Перед реализацией сверь фактические пути/shape с серверным `server/src/presentation/workspaces/routes.ts` (серверные задачи уже выполнены к этому моменту) — если сервер отдаёт иначе, правь DTO под сервер, а не наоборот.
- Produces (используют Task 20, 22):
  - `WorkspaceInviteRole = 'editor' | 'viewer'` (из `@/domain/workspace/WorkspaceInvite`)
  - `WorkspaceInvite` тип (см. код ниже)
  - `CreateWorkspaceInviteInput = { role: WorkspaceInviteRole; email: string | null }` (из `@/application/workspace/WorkspaceRepository`)
  - `WorkspaceRepository.listInvites(workspaceId: string): Promise<WorkspaceInvite[]>`
  - `WorkspaceRepository.createInvite(workspaceId: string, input: CreateWorkspaceInviteInput): Promise<WorkspaceInvite>`
  - `WorkspaceRepository.deleteInvite(workspaceId: string, inviteId: string): Promise<void>`

Примечание по объёму: удаление invite-методов из `ProjectRepository` НЕ входит в эту задачу — оно выполняется в Task 20 одновременно с миграцией всех точек вызова (иначе typecheck между задачами красный). Dual-семантика `InviteRepository.accept` — в Task 21 (вместе с InvitePage). Эта задача — чисто аддитивная.

#### Шаги

- [ ] **Step 1: Создать домен-тип WorkspaceInvite.**
  Создать файл `client/src/domain/workspace/WorkspaceInvite.ts`:
  ```ts
  // Приглашение в пространство (workspace_invites, зеркало бывших project_invites).
  // Mirrors server/src/domain/workspace/WorkspaceInvite.ts.

  export type WorkspaceInviteRole = 'editor' | 'viewer';

  export type WorkspaceInvite = {
    readonly id: string;
    readonly workspaceId: string;
    readonly role: WorkspaceInviteRole;
    // Информационный email (кому отправлено письмо). null = «бесхозная» ссылка.
    readonly email: string | null;
    readonly expiresAt: Date;
    readonly acceptedAt: Date | null;
    readonly acceptedByUserId: string | null;
    readonly createdByUserId: string;
    readonly createdAt: Date;
    // token и url есть только в ответе на create, в листинге их нет.
    readonly token?: string;
    readonly url?: string;
  };
  ```

- [ ] **Step 2: Расширить интерфейс WorkspaceRepository.**
  В `client/src/application/workspace/WorkspaceRepository.ts` — добавить import (после строки 1) и тип + 3 метода. Итоговый файл целиком:
  ```ts
  import type { Workspace, WorkspaceMember, WorkspaceRole } from '@/domain/workspace/Workspace';
  import type { WorkspaceInvite, WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';

  export type CreateWorkspaceInput = {
    readonly name: string;
    readonly icon: string | null;
  };

  export type UpdateWorkspaceInput = {
    readonly name?: string;
    readonly icon?: string | null;
  };

  export type CreateWorkspaceInviteInput = {
    readonly role: WorkspaceInviteRole;
    readonly email: string | null;
  };

  export interface WorkspaceRepository {
    list(): Promise<Workspace[]>;
    create(input: CreateWorkspaceInput): Promise<Workspace>;
    rename(id: string, patch: UpdateWorkspaceInput): Promise<Workspace>;
    switchCurrent(id: string): Promise<void>;
    remove(id: string): Promise<void>;

    listMembers(id: string): Promise<WorkspaceMember[]>;
    addMember(id: string, email: string, role: WorkspaceRole): Promise<WorkspaceMember>;
    changeMemberRole(id: string, userId: string, role: WorkspaceRole): Promise<void>;
    removeMember(id: string, userId: string): Promise<void>;

    // Токен-инвайты в пространство (аналог бывших project-инвайтов). token/url — только
    // в ответе на create; listInvites отдаёт pending без токена.
    listInvites(workspaceId: string): Promise<WorkspaceInvite[]>;
    createInvite(workspaceId: string, input: CreateWorkspaceInviteInput): Promise<WorkspaceInvite>;
    deleteInvite(workspaceId: string, inviteId: string): Promise<void>;

    listProjects(id: string): Promise<Array<{ id: string; name: string; icon: string | null }>>;
    moveProject(workspaceId: string, projectId: string, targetWorkspaceId: string): Promise<void>;
  }
  ```

- [ ] **Step 3: Реализация в HttpWorkspaceRepository.**
  В `client/src/infrastructure/http/HttpWorkspaceRepository.ts`:
  1. Дополнить импорты (строки 1–11):
  ```ts
  import type { WorkspaceInvite, WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';
  import type {
    CreateWorkspaceInput,
    CreateWorkspaceInviteInput,
    UpdateWorkspaceInput,
    WorkspaceRepository,
  } from '@/application/workspace/WorkspaceRepository';
  ```
  2. После `type ProjectDto = ...` (строка 35) добавить:
  ```ts
  type WorkspaceInviteDto = {
    id: string;
    workspaceId: string;
    role: WorkspaceInviteRole;
    email: string | null;
    expiresAt: string;
    acceptedAt: string | null;
    acceptedByUserId: string | null;
    createdByUserId: string;
    createdAt: string;
    token?: string;
    url?: string;
  };

  function inviteFromDto(dto: WorkspaceInviteDto): WorkspaceInvite {
    return {
      ...dto,
      expiresAt: new Date(dto.expiresAt),
      acceptedAt: dto.acceptedAt ? new Date(dto.acceptedAt) : null,
      createdAt: new Date(dto.createdAt),
    };
  }
  ```
  3. В класс `HttpWorkspaceRepository` — после метода `removeMember` (строка 112) добавить:
  ```ts
  async listInvites(workspaceId: string): Promise<WorkspaceInvite[]> {
    const { invites } = await httpClient.get<{ invites: WorkspaceInviteDto[] }>(
      `/workspaces/${workspaceId}/invites`,
    );
    return invites.map(inviteFromDto);
  }

  async createInvite(
    workspaceId: string,
    input: CreateWorkspaceInviteInput,
  ): Promise<WorkspaceInvite> {
    const { invite } = await httpClient.post<{ invite: WorkspaceInviteDto }>(
      `/workspaces/${workspaceId}/invites`,
      input,
    );
    return inviteFromDto(invite);
  }

  async deleteInvite(workspaceId: string, inviteId: string): Promise<void> {
    await httpClient.delete<void>(`/workspaces/${workspaceId}/invites/${inviteId}`);
  }
  ```

- [ ] **Step 4: Проверка.**
  Из корня репо:
  ```
  npm run typecheck
  npm run lint
  ```
  Оба зелёные (0 errors). Если typecheck ругается на неиспользуемый `CreateWorkspaceInviteInput` в импорте Http-репо — проверь, что метод `createInvite` реально добавлен в класс.

- [ ] **Step 5: Commit.**
  ```
  git add client/src/domain/workspace/WorkspaceInvite.ts client/src/application/workspace/WorkspaceRepository.ts client/src/infrastructure/http/HttpWorkspaceRepository.ts
  git commit -m "feat(workspace): клиентские инвайты пространства — домен WorkspaceInvite, list/create/deleteInvite в WorkspaceRepository и Http-реализации"
  ```

### Task 20: InviteDialog → пространство; все точки создания инвайтов; ProjectRepository -= invite-методы

**Files:**
- Modify (полная переработка): `client/src/presentation/components/project/InviteDialog.tsx`
- Modify: `client/src/presentation/components/project/TeamSection.tsx` (убрать project-инвайт-лист: строки 18, 41, 63–67, 84–104, 159–171, 274–324, 327–332)
- Modify: `client/src/presentation/components/project/ProjectSharePopover.tsx` (ShareTab, строки 38–64)
- Modify: `client/src/presentation/components/project/MembersInviteForm.tsx` + точка вызова `client/src/presentation/components/project/MembersHoverPanel.tsx:67`
- Modify (полная переработка): `client/src/presentation/components/profile/ProjectsShareCard.tsx`
- Modify: `client/src/application/project/ProjectRepository.ts` (удалить строки 4 (частично), 109–112, 194–196)
- Modify: `client/src/infrastructure/http/HttpProjectRepository.ts` (удалить InviteDto/inviteFromDto строки 124–~150 и методы 396–413)
- Modify: `client/src/infrastructure/mock/MockProjectRepository.ts` (удалить строки 3, 260–272)
- Test: нет (клиент; `npm run typecheck` + `npm run lint`)

**Interfaces:**
- Consumes (из Task 19): `WorkspaceInvite`, `WorkspaceInviteRole` из `@/domain/workspace/WorkspaceInvite`; `workspaceRepository.createInvite(workspaceId, { role, email }): Promise<WorkspaceInvite>` через `useContainer()`. Существующие: `useCurrentWorkspace(): { workspace: Workspace | null; loading }` из `@/presentation/hooks/useCurrentWorkspace`; `projectRepository.listSharedMembers(): Promise<SharedMember[]>` (остаётся).
- Produces (использует Task 22):
  - `InviteDialog` новые props: `{ open: boolean; onClose: () => void; workspaceId?: string; onCreated?: (invite: WorkspaceInvite) => void }` — без `workspaceId` берёт активное пространство юзера.
  - `ProjectRepository` БЕЗ `listInvites/createInvite/deleteInvite/CreateInviteInput` (listMembers/updateMemberRole/removeMember/transferOwnership/requestJoin/resolveJoinRequest/listSharedMembers — остаются).

#### Шаги

- [ ] **Step 1: Переписать InviteDialog на приглашение в пространство.**
  Полностью заменить содержимое `client/src/presentation/components/project/InviteDialog.tsx`:
  ```tsx
  import { useEffect, useState, type FormEvent } from 'react';
  import { Copy, Loader2, Users } from 'lucide-react';
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '@/components/ui/dialog';
  import { Button } from '@/components/ui/button';
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from '@/components/ui/dropdown-menu';
  import { Input } from '@/components/ui/input';
  import { Label } from '@/components/ui/label';
  import { toast } from '@/components/ui/sonner';
  import type { WorkspaceInvite, WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';
  import type { SharedMember } from '@/application/project/ProjectRepository';
  import { useContainer } from '@/infrastructure/di/container';
  import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';

  type Props = {
    open: boolean;
    onClose: () => void;
    // Пространство, в которое приглашаем. Не задано — активное пространство юзера
    // (кейс «пригласить из проекта»: проект живёт в текущем пространстве).
    workspaceId?: string;
    onCreated?: (invite: WorkspaceInvite) => void;
  };

  // Диалог приглашения в ПРОСТРАНСТВО (единая точка: из настроек пространства, со страницы
  // проекта, из панели участников). Приглашённый получает доступ ко всем проектам
  // пространства, включая будущие. Роль editor/viewer, email опционален (без email —
  // «бесхозная» токен-ссылка).
  export function InviteDialog({ open, onClose, workspaceId, onCreated }: Props): React.ReactElement {
    const { workspaceRepository, projectRepository } = useContainer();
    const { workspace } = useCurrentWorkspace();
    const targetWorkspaceId = workspaceId ?? workspace?.id ?? null;
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<WorkspaceInviteRole>('editor');
    const [submitting, setSubmitting] = useState(false);
    const [created, setCreated] = useState<WorkspaceInvite | null>(null);
    // Люди, с которыми caller уже состоит в общих пространствах — выбор одним кликом.
    const [sharedMembers, setSharedMembers] = useState<SharedMember[] | null>(null);

    useEffect(() => {
      if (!open) {
        setEmail('');
        setRole('editor');
        setCreated(null);
        return;
      }
      let cancelled = false;
      projectRepository
        .listSharedMembers()
        .then((list) => {
          if (!cancelled) setSharedMembers(list);
        })
        .catch(() => {
          if (!cancelled) setSharedMembers([]);
        });
      return () => {
        cancelled = true;
      };
    }, [open, projectRepository]);

    const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
      e.preventDefault();
      if (!targetWorkspaceId) {
        toast.error('Пространство ещё не загружено — попробуйте ещё раз');
        return;
      }
      setSubmitting(true);
      try {
        const invite = await workspaceRepository.createInvite(targetWorkspaceId, {
          role,
          email: email.trim().length > 0 ? email.trim() : null,
        });
        setCreated(invite);
        onCreated?.(invite);
      } catch (e2) {
        toast.error(`Не удалось: ${(e2 as Error).message}`);
      } finally {
        setSubmitting(false);
      }
    };

    const copyUrl = async (): Promise<void> => {
      if (!created?.url) return;
      try {
        await navigator.clipboard.writeText(created.url);
        toast.success('Скопировано');
      } catch {
        toast.error('Не удалось скопировать. Скопируй из поля ниже вручную.');
      }
    };

    const hasSharedMembers = sharedMembers !== null && sharedMembers.length > 0;

    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Пригласить в пространство</DialogTitle>
            <DialogDescription>
              Участник получит доступ ко всем проектам пространства, включая будущие. Если у
              получателя есть аккаунт — придёт уведомление и письмо; иначе отправь ссылку любым
              каналом. Срок действия — 7 дней.
            </DialogDescription>
          </DialogHeader>

          {created ? (
            <div className="space-y-3">
              <Label htmlFor="invite-url">Ссылка</Label>
              <div className="flex gap-2">
                <Input
                  id="invite-url"
                  value={created.url ?? ''}
                  readOnly
                  onFocus={(e) => e.target.select()}
                  className="font-mono text-xs"
                />
                <Button type="button" variant="outline" size="icon" onClick={() => void copyUrl()}>
                  <Copy className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {created.email
                  ? 'Уведомление и письмо отправлены. Ссылку также можно скопировать и переслать вручную.'
                  : 'Это единственная возможность увидеть ссылку. Если потеряешь — отзови приглашение и создай новое.'}
              </p>
              <DialogFooter>
                <Button variant="ghost" onClick={onClose}>
                  Готово
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="invite-email">Email</Label>
                  {hasSharedMembers && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                          <Users className="size-3.5" />
                          Из знакомых
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
                        {sharedMembers!.map((m) => (
                          <DropdownMenuItem key={m.id} onSelect={() => setEmail(m.email)}>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm">{m.displayName}</p>
                              <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="kolya@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  Если email пустой — создастся «бесхозная» ссылка: её можно отправить вручную.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Роль</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={role === 'editor' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setRole('editor')}
                    className="flex-1"
                  >
                    Редактор
                  </Button>
                  <Button
                    type="button"
                    variant={role === 'viewer' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setRole('viewer')}
                    className="flex-1"
                  >
                    Наблюдатель
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {role === 'editor'
                    ? 'Редактор: создаёт/правит задачи, комментарии, KB во всех проектах пространства. Не управляет командой.'
                    : 'Наблюдатель: только смотрит проекты пространства. Может оставлять комментарии.'}
                </p>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
                  Отмена
                </Button>
                <Button type="submit" disabled={submitting || !targetWorkspaceId}>
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                  Пригласить
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    );
  }
  ```

- [ ] **Step 2: TeamSection — убрать project-инвайт-лист, перевести на новый InviteDialog.**
  В `client/src/presentation/components/project/TeamSection.tsx`:
  1. Импорты: удалить `import type { ProjectInvite } from '@/domain/project/ProjectInvite';` (строка 18); из lucide-импорта (строка 2) убрать `Copy`; добавить `import type { WorkspaceInvite } from '@/domain/workspace/WorkspaceInvite';`.
  2. Удалить стейт `const [invites, setInvites] = useState<ProjectInvite[]>([]);` (строка 41).
  3. В `loadAll` (строки 58–75) удалить блок:
  ```ts
        if (canInvite) {
          const invitesList = await projectRepository.listInvites(project.id);
          if (cancelled) return;
          setInvites(invitesList);
        }
  ```
  (`canInvite` остаётся — гейтит кнопку «Пригласить»; из deps эффекта строка 80 его НЕ убирать.)
  4. Заменить `handleInviteCreated` (строки 84–93) на:
  ```ts
  const handleInviteCreated = (invite: WorkspaceInvite): void => {
    if (invite.url) {
      // Сразу копируем ссылку — самый частый следующий шаг.
      void navigator.clipboard.writeText(invite.url).then(
        () => toast.success('Ссылка скопирована'),
        () => toast.success('Приглашение создано'),
      );
    }
  };
  ```
  5. Удалить целиком `handleRevokeInvite` (строки 95–104) и `handleCopyInvite` (строки 159–171).
  6. Удалить JSX-блок «Ожидают принятия» — `{canInvite && invites.length > 0 && ( ... )}` (строки 274–324).
  7. Заменить рендер диалога (строки 327–332) на:
  ```tsx
      <InviteDialog
        open={showInviteDialog}
        onClose={() => setShowInviteDialog(false)}
        onCreated={handleInviteCreated}
      />
  ```
  (Полная переработка TeamSection на участников пространства — Task 22; здесь только совместимость.)

- [ ] **Step 3: ProjectSharePopover (ShareTab) — email-инвайты идут в пространство.**
  В `client/src/presentation/components/project/ProjectSharePopover.tsx`:
  1. Добавить импорты:
  ```ts
  import type { WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';
  import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
  ```
  2. В `ShareTab` (строка 38) заменить начало функции (строки 39–43):
  ```ts
  function ShareTab({ project, members, canInvite }: Omit<Props, 'isOwner'>): React.ReactElement {
    const { workspaceRepository } = useContainer();
    const { workspace } = useCurrentWorkspace();
    const { user } = useCurrentUser();
    const [draft, setDraft] = useState('');
    const [role, setRole] = useState<WorkspaceInviteRole>('editor');
    const [submitting, setSubmitting] = useState(false);
  ```
  3. Заменить `invite` (строки 50–64):
  ```ts
  // Инвайт теперь в ПРОСТРАНСТВО проекта: приглашённый увидит все проекты пространства.
  const invite = async (): Promise<void> => {
    if (emails.length === 0 || !workspace) return;
    setSubmitting(true);
    const settled = await Promise.allSettled(
      emails.map((email) => workspaceRepository.createInvite(workspace.id, { role, email })),
    );
    setSubmitting(false);
    const ok = settled.filter((s) => s.status === 'fulfilled').length;
    if (ok === settled.length) {
      toast.success(ok === 1 ? 'Приглашение отправлено' : `Отправлено приглашений: ${ok}`);
      setDraft('');
    } else {
      toast.error(`${ok} ок, ${settled.length - ok} с ошибкой`);
    }
  };
  ```
  4. `project` из props ShareTab теперь используется только в `copyLink` — оставить. Тип `ProjectRole` (строка 9) остаётся для `ROLE_LABEL`/members. Проверить lint на неиспользуемые импорты (если `ProjectRole`-only-import где-то повис — убрать).

Продолжение шагов — в `task-20-part2.md` (это ЧАСТЬ ТОЙ ЖЕ задачи 20, выполнять подряд, коммит один в конце).

### Task 20 (part 2) — продолжение шагов. Выполнять после part 1, коммит общий в конце.

- [ ] **Step 4: MembersInviteForm — инвайты в пространство, prop projectId убрать.**
  В `client/src/presentation/components/project/MembersInviteForm.tsx`:
  1. Импорты: заменить `import type { ProjectInviteRole } from '@/domain/project/ProjectInvite';` на:
  ```ts
  import type { WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';
  import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
  ```
  2. Сигнатура и начало компонента (строки 20–29) →
  ```ts
  // Компактная форма приглашения в ПРОСТРАНСТВО — живёт в подвале панели участников
  // (см. MembersHoverPanel). Несколько email сразу (чипсы), «Из знакомых», роль, отправка
  // батчем через workspaceRepository.createInvite. Приглашённый получает доступ ко всем
  // проектам пространства.
  export function MembersInviteForm(): React.ReactElement {
    const { workspaceRepository, projectRepository } = useContainer();
    const { workspace } = useCurrentWorkspace();
    const [emailDraft, setEmailDraft] = useState('');
    const [emails, setEmails] = useState<string[]>([]);
    const [role, setRole] = useState<WorkspaceInviteRole>('editor');
    const [shared, setShared] = useState<SharedMember[] | null>(null);
    const [submitting, setSubmitting] = useState(false);
  ```
  3. В `handleSubmit` (строки 79–100) заменить создание:
  ```ts
    const finalEmails = previewEmails;
    if (finalEmails.length === 0 || !workspace) return;
    setSubmitting(true);
    const settled = await Promise.allSettled(
      finalEmails.map((email) => workspaceRepository.createInvite(workspace.id, { role, email })),
    );
  ```
  (остальное тело без изменений).
  4. Заголовок формы (строка 107): `Пригласить в проект` → `Пригласить в пространство`.
  5. На кнопке отправки добавить в `disabled`: `submitting || previewEmails.length === 0 || !workspace`.
  6. В `client/src/presentation/components/project/MembersHoverPanel.tsx` строка 67:
  `{canInvite && projectId && <MembersInviteForm projectId={projectId} />}` → `{canInvite && <MembersInviteForm />}`. Если после этого `projectId` в MembersHoverPanel больше нигде не используется — убрать его из props/деструктуризации (проверит lint/tsc noUnusedParameters; если используется где-то ещё — оставить).

- [ ] **Step 5: ProjectsShareCard (профиль) — приглашение в текущее пространство вместо мультивыбора проектов.**
  Полностью заменить содержимое `client/src/presentation/components/profile/ProjectsShareCard.tsx`:
  ```tsx
  import { useEffect, useState } from 'react';
  import { Loader2, UserPlus, Users, X } from 'lucide-react';
  import { Button } from '@/components/ui/button';
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '@/components/ui/card';
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from '@/components/ui/dropdown-menu';
  import { Input } from '@/components/ui/input';
  import { Label } from '@/components/ui/label';
  import { toast } from '@/components/ui/sonner';
  import type { SharedMember } from '@/application/project/ProjectRepository';
  import type { WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';
  import { useContainer } from '@/infrastructure/di/container';
  import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';

  // Простая email-валидация: UX-уровень, строгую делает сервер.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Карточка «Пригласить в пространство» в профиле. Раньше приглашала в выбранные проекты
  // по отдельности; теперь доступ единый — приглашаем в активное пространство (все проекты,
  // включая будущие).
  export function ProjectsShareCard(): React.ReactElement {
    const { workspaceRepository, projectRepository } = useContainer();
    const { workspace } = useCurrentWorkspace();

    const [emailDraft, setEmailDraft] = useState('');
    const [emails, setEmails] = useState<string[]>([]);
    const [role, setRole] = useState<WorkspaceInviteRole>('editor');
    const [shared, setShared] = useState<SharedMember[] | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
      let cancelled = false;
      projectRepository
        .listSharedMembers()
        .then((list) => {
          if (!cancelled) setShared(list);
        })
        .catch(() => {
          if (!cancelled) setShared([]);
        });
      return () => {
        cancelled = true;
      };
    }, [projectRepository]);

    const addEmail = (raw: string): void => {
      const trimmed = raw.trim().toLowerCase();
      if (!trimmed) return;
      if (!EMAIL_RE.test(trimmed)) {
        toast.error(`Невалидный email: ${trimmed}`);
        return;
      }
      setEmails((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    };

    const commitDraft = (): void => {
      emailDraft
        .split(/[\s,;]+/)
        .filter((s) => s.length > 0)
        .forEach(addEmail);
      setEmailDraft('');
    };

    const removeEmail = (e: string): void => {
      setEmails((prev) => prev.filter((x) => x !== e));
    };

    // Учитываем и неподтверждённый драфт — счётчик/кнопка честные.
    const previewEmails = (() => {
      const set = new Set(emails);
      emailDraft
        .split(/[\s,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && EMAIL_RE.test(s))
        .forEach((t) => set.add(t));
      return [...set];
    })();

    const handleSubmit = async (): Promise<void> => {
      const finalEmails = previewEmails;
      if (finalEmails.length === 0 || !workspace) return;
      setSubmitting(true);
      const settled = await Promise.allSettled(
        finalEmails.map((email) => workspaceRepository.createInvite(workspace.id, { role, email })),
      );
      setSubmitting(false);
      const ok = settled.filter((s) => s.status === 'fulfilled').length;
      const fail = settled.length - ok;
      if (fail === 0) {
        toast.success(ok === 1 ? 'Приглашение отправлено' : `Отправлено приглашений: ${ok}`);
        setEmails([]);
        setEmailDraft('');
      } else {
        const firstErr = settled.find((s) => s.status === 'rejected') as
          | PromiseRejectedResult
          | undefined;
        const msg = firstErr ? (firstErr.reason as Error).message : '';
        toast.error(`${ok} ок, ${fail} с ошибкой${msg ? ` — ${msg}` : ''}`);
      }
    };

    return (
      <Card>
        <CardHeader>
          <CardTitle>Пригласить в пространство</CardTitle>
          <CardDescription>
            Участники получат доступ ко всем проектам пространства
            {workspace ? ` «${workspace.name}»` : ''}, включая будущие. Зарегистрированным
            придёт уведомление в системе, остальным — письмо со ссылкой.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="share-emails">Кого пригласить</Label>
              {shared && shared.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                      <Users className="size-3.5" />
                      Из знакомых
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
                    {shared.map((m) => (
                      <DropdownMenuItem key={m.id} onSelect={() => addEmail(m.email)}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{m.displayName}</p>
                          <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {emails.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {emails.map((e) => (
                  <li
                    key={e}
                    className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs"
                  >
                    <span>{e}</span>
                    <button
                      type="button"
                      onClick={() => removeEmail(e)}
                      aria-label={`Убрать ${e}`}
                      className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <Input
              id="share-emails"
              type="email"
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
                  e.preventDefault();
                  commitDraft();
                }
              }}
              onBlur={commitDraft}
              placeholder="kolya@example.com, lena@example.com"
            />
            <p className="text-xs text-muted-foreground">
              Разделители — запятая, точка с запятой, пробел или Enter.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Роль</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={role === 'editor' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRole('editor')}
                className="flex-1"
              >
                Редактор
              </Button>
              <Button
                type="button"
                variant={role === 'viewer' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRole('viewer')}
                className="flex-1"
              >
                Наблюдатель
              </Button>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || previewEmails.length === 0 || !workspace}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              Пригласить{previewEmails.length > 0 ? ` (${previewEmails.length})` : ''}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  ```

- [ ] **Step 6: Удалить invite-методы из ProjectRepository + реализаций.**
  1. `client/src/application/project/ProjectRepository.ts`:
     - строка 4: `import type { ProjectInvite, ProjectInviteRole } from '@/domain/project/ProjectInvite';` — удалить целиком (других использований в файле после удаления ниже нет).
     - удалить тип `CreateInviteInput` (строки 109–112).
     - удалить из интерфейса (строки 194–196):
     ```ts
     listInvites(projectId: string): Promise<ProjectInvite[]>;
     createInvite(projectId: string, input: CreateInviteInput): Promise<ProjectInvite>;
     deleteInvite(projectId: string, inviteId: string): Promise<void>;
     ```
     - в комментарии над `listMembers` (строка 185) «members + invites» → «members».
  2. `client/src/infrastructure/http/HttpProjectRepository.ts`:
     - удалить `InviteDto` и `inviteFromDto` (строки 124–~150);
     - удалить методы `listInvites`/`createInvite`/`deleteInvite` (строки 396–413);
     - из импорта строки 3 убрать `ProjectInvite, ProjectInviteRole` (если после удаления не используются — проверит tsc); убрать `CreateInviteInput` из импорта типов репозитория.
  3. `client/src/infrastructure/mock/MockProjectRepository.ts`:
     - удалить строку 3 (`import type { ProjectInvite } ...`);
     - удалить методы `listInvites`/`createInvite`/`deleteInvite` (строки 260–272);
     - убрать `CreateInviteInput` из импорта типов, если был.

- [ ] **Step 7: Проверка и commit.**
  ```
  npm run typecheck
  npm run lint
  ```
  Оба зелёные. Типовые хвосты: неиспользуемые импорты (`Copy` в TeamSection, `ProjectInviteRole` где-то) — убрать по подсказкам eslint. Затем:
  ```
  git add client/src/presentation/components/project/InviteDialog.tsx client/src/presentation/components/project/TeamSection.tsx client/src/presentation/components/project/ProjectSharePopover.tsx client/src/presentation/components/project/MembersInviteForm.tsx client/src/presentation/components/project/MembersHoverPanel.tsx client/src/presentation/components/profile/ProjectsShareCard.tsx client/src/application/project/ProjectRepository.ts client/src/infrastructure/http/HttpProjectRepository.ts client/src/infrastructure/mock/MockProjectRepository.ts
  git commit -m "feat(workspace): приглашения ведут в пространство — InviteDialog/ShareTab/формы на workspace-инвайты, project-инвайты удалены из клиентского репозитория"
  ```

### Task 21: InvitePage dual-token; уведомления — workspace_invite, task_delegation без кнопок, chat_mention

**Files:**
- Create: `client/src/domain/invite/InvitePreview.ts`
- Create: `client/src/presentation/chat/openChatEvent.ts`
- Delete: `client/src/domain/project/ProjectInvite.ts` (после Task 20 его используют только invite-preview файлы, которые правим здесь)
- Modify: `client/src/application/project/InviteRepository.ts` (весь файл, 8 строк)
- Modify: `client/src/infrastructure/http/HttpInviteRepository.ts` (весь файл, 28 строк)
- Modify: `client/src/presentation/pages/InvitePage.tsx` (строки 9, 11–14, 57–73, 85, 103–124)
- Modify: `client/src/domain/notifications/Notification.ts` (добавить 2 payload-типа, расширить union строки 113–122)
- Modify: `client/src/presentation/notifications/NotificationItem.tsx` (строки 14, 90–173)
- Modify: `client/src/presentation/notifications/useNotificationActions.ts` (строки 13–21, 51–66, 68–114, 172–181)
- Modify: `client/src/presentation/hooks/useNotificationStream.ts` (строки 34–51)
- Modify: `client/src/presentation/layout/Sidebar.tsx` (эффект после setRailPersist, строка ~84)
- Modify: `client/src/presentation/chat/CommunicationPanel.tsx` (эффект в CommunicationPanel)
- Test: нет (клиент; `npm run typecheck` + `npm run lint`)

**Interfaces:**
- Consumes (серверные секции; сверить с фактическим кодом сервера перед реализацией):
  - `GET /api/invites/:token` → `200 { preview: { workspaceName?: string|null; projectName?: string|null; role: 'editor'|'viewer'; inviterDisplayName: string|null; inviteEmail: string|null; expiresAt: ISO } }` — dual-token: у workspace-инвайта заполнен `workspaceName`, у legacy project-инвайта — `projectName`.
  - `POST /api/invites/:token/accept` → `200 { workspaceId?: string|null; projectId?: string|null }` — ws-инвайт: `workspaceId`, `projectId=null`; legacy project-токен: оба (accept зачисляет в пространство проекта).
  - Notification payload `workspace_invite` (сервер): `{ type:'workspace_invite', workspaceId, workspaceName, role:'editor'|'viewer', inviteId, token, actorUserId, actorDisplayName }`.
  - Notification payload `chat_mention` (сервер, УЖЕ существует): `{ type:'chat_mention', workspaceId, workspaceName, messageId, messageSeq, messageExcerpt, actorUserId, actorDisplayName }`.
- Produces:
  - `InvitePreview`, `InviteAcceptResult`, `InviteRole`, `InviteTargetKind` из `@/domain/invite/InvitePreview`
  - `InviteRepository.getPreview(token): Promise<InvitePreview>`; `InviteRepository.accept(token): Promise<InviteAcceptResult>`
  - `WorkspaceInvitePayload`, `ChatMentionPayload` в клиентском Notification-union
  - `NotificationActions` БЕЗ `handleAcceptDelegation`/`handleDeclineDelegation`, С `handleAcceptWorkspaceInvite`
  - `OPEN_CHAT_EVENT = 'pf:open-chat'` из `@/presentation/chat/openChatEvent`

#### Шаги

- [ ] **Step 1: Домен InvitePreview (dual-token).**
  Создать `client/src/domain/invite/InvitePreview.ts`:
  ```ts
  // Превью инвайта по токену для /invite/:token (anon-страница). Dual-token: токен может
  // быть workspace-инвайтом (новые) или legacy project-инвайтом (уже разосланные ссылки).
  export type InviteRole = 'editor' | 'viewer';
  export type InviteTargetKind = 'workspace' | 'project';

  export type InvitePreview = {
    readonly kind: InviteTargetKind;
    // Название пространства (kind='workspace') или legacy-проекта (kind='project').
    readonly targetName: string;
    readonly role: InviteRole;
    readonly inviterDisplayName: string | null;
    readonly inviteEmail: string | null;
    readonly expiresAt: Date;
  };

  // Результат accept: ws-инвайт → workspaceId; legacy project-инвайт → projectId (+ его
  // пространство). Клиент ведёт на проект, если он есть, иначе на главную.
  export type InviteAcceptResult = {
    readonly workspaceId: string | null;
    readonly projectId: string | null;
  };
  ```

- [ ] **Step 2: InviteRepository + Http-реализация.**
  Заменить содержимое `client/src/application/project/InviteRepository.ts`:
  ```ts
  import type { InviteAcceptResult, InvitePreview } from '@/domain/invite/InvitePreview';

  // Anon-friendly: GET preview не требует логина, accept — требует. Dual-token:
  // обслуживает и workspace-инвайты, и legacy project-инвайты (см. InvitePreview.kind).
  // Используется страницей /invite/:token и кнопкой «Принять» в уведомлениях.
  export interface InviteRepository {
    getPreview(token: string): Promise<InvitePreview>;
    accept(token: string): Promise<InviteAcceptResult>;
  }
  ```
  Заменить содержимое `client/src/infrastructure/http/HttpInviteRepository.ts`:
  ```ts
  import type {
    InviteAcceptResult,
    InvitePreview,
    InviteRole,
  } from '@/domain/invite/InvitePreview';
  import type { InviteRepository } from '@/application/project/InviteRepository';
  import { httpClient } from './httpClient';

  type PreviewDto = {
    workspaceName?: string | null;
    projectName?: string | null;
    role: InviteRole;
    inviterDisplayName: string | null;
    inviteEmail: string | null;
    expiresAt: string;
  };

  export class HttpInviteRepository implements InviteRepository {
    async getPreview(token: string): Promise<InvitePreview> {
      const { preview } = await httpClient.get<{ preview: PreviewDto }>(`/invites/${token}`);
      const isWorkspace = preview.workspaceName != null;
      return {
        kind: isWorkspace ? 'workspace' : 'project',
        targetName: preview.workspaceName ?? preview.projectName ?? '',
        role: preview.role,
        inviterDisplayName: preview.inviterDisplayName,
        inviteEmail: preview.inviteEmail,
        expiresAt: new Date(preview.expiresAt),
      };
    }

    async accept(token: string): Promise<InviteAcceptResult> {
      const res = await httpClient.post<{ workspaceId?: string | null; projectId?: string | null }>(
        `/invites/${token}/accept`,
      );
      return { workspaceId: res.workspaceId ?? null, projectId: res.projectId ?? null };
    }
  }
  ```
  Удалить файл `client/src/domain/project/ProjectInvite.ts` (`git rm client/src/domain/project/ProjectInvite.ts`). Если tsc после этого найдёт забытые импорты из него — это недоделки Task 20, починить по месту (заменить на аналог из `@/domain/workspace/WorkspaceInvite`).

- [ ] **Step 3: InvitePage — dual-token превью и accept-редирект.**
  В `client/src/presentation/pages/InvitePage.tsx`:
  1. Строка 9: `import type { ProjectInvitePreview } from '@/domain/project/ProjectInvite';` → `import type { InvitePreview } from '@/domain/invite/InvitePreview';`; в `LoadState` (строка 18) `preview: ProjectInvitePreview` → `preview: InvitePreview`.
  2. Заменить `accept` (строки 57–73):
  ```ts
  const accept = async (): Promise<void> => {
    if (!token) return;
    setAccepting(true);
    try {
      const res = await inviteRepository.accept(token);
      if (res.projectId) {
        // Legacy project-токен: accept зачислил в пространство проекта — ведём на проект.
        toast.success('Вы добавлены в проект');
        navigate(`/projects/${res.projectId}`, { replace: true });
      } else {
        toast.success('Вы присоединились к пространству');
        navigate('/', { replace: true });
      }
    } catch (e) {
      const msg =
        e instanceof HttpError && e.status === 410
          ? 'Приглашение больше не действительно.'
          : `Не удалось принять: ${(e as Error).message}`;
      toast.error(msg);
    } finally {
      setAccepting(false);
    }
  };
  ```
  3. Заголовок (строка 85): `Приглашение в проект` → `Приглашение`.
  4. Текст превью (строки 105–110) заменить на:
  ```tsx
  <p>
    Тебя приглашают в {state.preview.kind === 'workspace' ? 'пространство' : 'проект'}{' '}
    <span className="font-semibold">«{state.preview.targetName}»</span> с правами{' '}
    <span className="font-semibold">{ROLE_LABEL[state.preview.role]}</span>.
  </p>
  {state.preview.kind === 'workspace' && (
    <p className="text-muted-foreground">
      Доступ — ко всем проектам пространства, включая будущие.
    </p>
  )}
  ```
  Остальное (inviter/email/expires, кнопки, login-ветка) — без изменений.

- [ ] **Step 4: Клиентский Notification-union — workspace_invite и chat_mention.**
  В `client/src/domain/notifications/Notification.ts` после `ProjectInvitePayload` (строка 34) добавить:
  ```ts
  // Приглашение в пространство: кнопка «Принять» (token → /invites/:token/accept).
  export type WorkspaceInvitePayload = {
    readonly type: 'workspace_invite';
    readonly workspaceId: string;
    readonly workspaceName: string;
    readonly role: 'editor' | 'viewer';
    readonly inviteId: string;
    readonly token: string;
    readonly actorUserId: string;
    readonly actorDisplayName: string;
  };

  // Упоминание в чате пространства. Клик ведёт во вкладку «Чат» сайдбара.
  export type ChatMentionPayload = {
    readonly type: 'chat_mention';
    readonly workspaceId: string;
    readonly workspaceName: string;
    readonly messageId: string;
    readonly messageSeq: number;
    readonly messageExcerpt: string;
    readonly actorUserId: string;
    readonly actorDisplayName: string;
  };
  ```
  В union `NotificationPayload` (строки 113–122) добавить `| WorkspaceInvitePayload` (после `ProjectInvitePayload`) и `| ChatMentionPayload` (в конец). Комментарий `TaskDelegationPayload` (строка 48): «Прилетает делегату с кнопками Accept/Decline» → «Информационное: делегация создаётся сразу принятой, кнопок нет». Комментарий `TaskDelegationResolvedPayload` (строки 58–59): → «Делегат снял(а) с себя задачу (relinquish). resolution:'accepted' — легаси-записи старого флоу.»

Продолжение шагов — в `task-21-part2.md` (та же задача, коммит один в конце).

### Task 21 (part 2) — продолжение шагов. Выполнять после part 1, коммит общий в конце.

- [ ] **Step 5: Событие «открыть чат» + слушатели.**
  1. Создать `client/src/presentation/chat/openChatEvent.ts`:
  ```ts
  // Window-событие «переключись на чат в сайдбаре»: Sidebar переводит rail на 'chat',
  // CommunicationPanel — вкладку на 'chat'. Диспатчится кликом по chat_mention-уведомлению.
  export const OPEN_CHAT_EVENT = 'pf:open-chat';
  ```
  2. В `client/src/presentation/layout/Sidebar.tsx`: добавить импорт `import { OPEN_CHAT_EVENT } from '@/presentation/chat/openChatEvent';` (и `useEffect` в react-импорт, если его там нет). После объявления `setRailPersist` (useCallback, строки 77–84) добавить:
  ```ts
  // Клик по chat_mention-уведомлению в ленте — переключаемся на вкладку «Чат».
  useEffect(() => {
    const onOpenChat = (): void => setRailPersist('chat');
    window.addEventListener(OPEN_CHAT_EVENT, onOpenChat);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpenChat);
  }, [setRailPersist]);
  ```
  3. В `client/src/presentation/chat/CommunicationPanel.tsx`: импорт `useEffect` (строка 1: `import { useEffect, useState } from 'react';`) и `import { OPEN_CHAT_EVENT } from './openChatEvent';`. Внутри `CommunicationPanel` после объявления `select` (строка ~41) добавить:
  ```ts
  // chat_mention: внешний сигнал «открой чат» — переключаем вкладку панели.
  useEffect(() => {
    const onOpenChat = (): void => {
      setTab('chat');
      try {
        localStorage.setItem(STORAGE_KEY, 'chat');
      } catch {
        /* ignore */
      }
    };
    window.addEventListener(OPEN_CHAT_EVENT, onOpenChat);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpenChat);
  }, []);
  ```

- [ ] **Step 6: useNotificationActions — workspace_invite accept, chat_mention клик, минус accept/decline делегации.**
  В `client/src/presentation/notifications/useNotificationActions.ts`:
  1. Импорты: добавить `import { OPEN_CHAT_EVENT } from '@/presentation/chat/openChatEvent';` и `import { useWorkspacesContext } from '@/presentation/hooks/WorkspacesProvider';`. Из деструктуризации `useContainer()` (строки 31–32) убрать `taskDelegationRepository`.
  2. Тип `NotificationActions` (строки 13–21) заменить на:
  ```ts
  export type NotificationActions = {
    readonly delegationUi: Record<string, DelegationUiState>;
    readonly markRead: (n: Notification) => Promise<void>;
    readonly handleClick: (n: Notification) => void;
    readonly handleAcceptInvite: (n: Notification) => void;
    readonly handleAcceptWorkspaceInvite: (n: Notification) => void;
    readonly handleResolveJoin: (n: Notification, accept: boolean) => void;
  };
  ```
  3. После `const { applyAppend, refresh: refreshProjects } = useProjectsContext();` (строка 35) добавить:
  ```ts
  const { refresh: refreshWorkspaces } = useWorkspacesContext();
  ```
  4. В `handleClick` (строки 51–66): строку 59 (`task_delegation`/`task_delegation_resolved` → navigate('/inbox')) ОСТАВИТЬ (клик по инфо-уведомлению по-прежнему ведёт во «Входящие»); после неё добавить ветку:
  ```ts
  else if (p.type === 'chat_mention') {
    // Переключаем сайдбар на чат (rail + вкладка панели); localStorage — чтобы выбор пережил
    // remount, событие — чтобы сработало на уже смонтированных Sidebar/CommunicationPanel.
    try {
      localStorage.setItem('pf_sidebar_rail', 'chat');
      localStorage.setItem('pf_comm_tab', 'chat');
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(OPEN_CHAT_EVENT));
  }
  ```
  и комментарий в конце: `// project_invite / workspace_invite: переход — по кнопке «Принять».`
  5. Удалить целиком `resolveDelegationError` (строки 68–81), `handleAcceptDelegation` (83–98), `handleDeclineDelegation` (100–114).
  6. Добавить (рядом с `handleAcceptInvite`):
  ```ts
  const handleAcceptWorkspaceInvite = (n: Notification): void => {
    if (n.payload.type !== 'workspace_invite' || delegationUi[n.id]) return;
    const { token, workspaceName } = n.payload;
    setDelegationUi((s) => ({ ...s, [n.id]: 'busy' }));
    void (async () => {
      try {
        await inviteRepository.accept(token);
        setDelegationUi((s) => ({ ...s, [n.id]: 'accepted' }));
        await markRead(n);
        // Приглашённый видит новое пространство и его проекты сразу.
        refreshWorkspaces();
        refreshProjects();
        toast.success(`Вы присоединились к пространству «${workspaceName}»`);
      } catch (e) {
        if (e instanceof HttpError && (e.status === 410 || e.status === 409)) {
          setDelegationUi((s) => ({ ...s, [n.id]: 'resolved' }));
          await markRead(n);
          toast.success('Приглашение уже использовано — убрал из действий');
          return;
        }
        setDelegationUi((s) => {
          const next = { ...s };
          delete next[n.id];
          return next;
        });
        toast.error(`Не удалось принять приглашение: ${(e as Error).message}`);
      }
    })();
  };
  ```
  7. В return (строки 172–181) — убрать `handleAcceptDelegation`, `handleDeclineDelegation`, добавить `handleAcceptWorkspaceInvite`.
  8. `handleAcceptInvite` (legacy project_invite) НЕ трогать — `inviteRepository.accept` теперь возвращает `InviteAcceptResult`, но результат там не используется, навигация идёт по `payload.projectId`; всё компилируется как есть.

- [ ] **Step 7: NotificationItem — новые ветки, делегирование без кнопок.**
  В `client/src/presentation/notifications/NotificationItem.tsx`:
  1. Комментарий (строки 14–15): «(принять/отклонить инвайт/делегацию/join-request)» → «(принять инвайт в пространство/проект, join-request; делегирование — информационное)».
  2. После ветки `project_invite` (после строки 117) добавить ветку workspace_invite (тот же паттерн):
  ```tsx
  {payload.type === 'workspace_invite' && (
    <>
      <p className="text-sm leading-tight">
        <span className="font-medium">{payload.actorDisplayName ?? 'Кто-то'}</span> приглашает вас в
        пространство <span className="font-medium">«{payload.workspaceName}»</span> как{' '}
        {roleLabel[payload.role]}
      </p>
      {delegationUi === 'accepted' ? (
        <p className="clear-left pt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          ✓ Принято
        </p>
      ) : delegationUi === 'resolved' ? (
        <p className="clear-left pt-1 text-xs text-muted-foreground">Уже обработано</p>
      ) : (
        <div className="clear-left pt-1">
          <Button
            size="sm"
            disabled={delegationUi === 'busy'}
            onClick={(e) => {
              e.stopPropagation();
              actions.handleAcceptWorkspaceInvite(n);
            }}
          >
            Принять
          </Button>
        </div>
      )}
    </>
  )}
  ```
  3. Ветку `task_delegation` (строки 119–160) заменить на информационную (без кнопок и delegationUi):
  ```tsx
  {payload.type === 'task_delegation' && (
    <>
      <p className="text-sm leading-tight">
        <span className="font-medium">{payload.actorDisplayName ?? 'Кто-то'}</span> поручил вам задачу:
      </p>
      <p className="line-clamp-2 text-xs italic text-muted-foreground">
        «{payload.taskExcerpt || '(без описания)'}»
      </p>
    </>
  )}
  ```
  4. Ветку `task_delegation_resolved` (строки 162–173) заменить (рендер только declined = «снял с себя»; легаси-'accepted' записи не рендерят текст):
  ```tsx
  {payload.type === 'task_delegation_resolved' && payload.resolution === 'declined' && (
    <p className="text-sm leading-tight">
      <span className="font-medium">{payload.actorDisplayName}</span> снял(а) с себя задачу
      {payload.taskExcerpt && (
        <>
          {' '}
          <span className="italic text-muted-foreground">«{payload.taskExcerpt}»</span>
        </>
      )}
    </p>
  )}
  ```
  5. После ветки `task_assigned_to_project` добавить ветку chat_mention:
  ```tsx
  {payload.type === 'chat_mention' && (
    <>
      <p className="text-sm leading-tight">
        <span className="font-medium">{payload.actorDisplayName ?? 'Кто-то'}</span> упомянул(а) вас в
        чате <span className="font-medium">«{payload.workspaceName}»</span>
      </p>
      {payload.messageExcerpt && (
        <p className="line-clamp-2 text-xs text-muted-foreground">«{payload.messageExcerpt}»</p>
      )}
    </>
  )}
  ```

- [ ] **Step 8: SSE-toast для workspace_invite и chat_mention.**
  В `client/src/presentation/hooks/useNotificationStream.ts` (строки 34–51) расширить:
  ```ts
  type StreamPayload =
    | { type: 'comment_mention'; projectName: string; actorDisplayName: string }
    | { type: 'project_invite'; projectName: string; actorDisplayName: string }
    | { type: 'workspace_invite'; workspaceName: string; actorDisplayName: string }
    | { type: 'chat_mention'; workspaceName: string; actorDisplayName: string }
    | { type: 'join_request'; projectName: string; requesterDisplayName: string };

  function toastFor(payload: StreamPayload): void {
    switch (payload.type) {
      case 'project_invite':
        toast(`${payload.actorDisplayName} пригласил вас в «${payload.projectName}»`);
        break;
      case 'workspace_invite':
        toast(`${payload.actorDisplayName} пригласил вас в пространство «${payload.workspaceName}»`);
        break;
      case 'comment_mention':
        toast(`${payload.actorDisplayName} упомянул вас в «${payload.projectName}»`);
        break;
      case 'chat_mention':
        toast(`${payload.actorDisplayName} упомянул вас в чате «${payload.workspaceName}»`);
        break;
      case 'join_request':
        toast(`${payload.requesterDisplayName} просит доступ к «${payload.projectName}»`);
        break;
    }
  }
  ```

- [ ] **Step 9: Проверка и commit.**
  ```
  npm run typecheck
  npm run lint
  ```
  Оба зелёные (следить за неиспользуемыми импортами в useNotificationActions после удаления хендлеров — например `taskDelegationRepository`). Затем:
  ```
  git add client/src/domain/invite/InvitePreview.ts client/src/presentation/chat/openChatEvent.ts client/src/application/project/InviteRepository.ts client/src/infrastructure/http/HttpInviteRepository.ts client/src/presentation/pages/InvitePage.tsx client/src/domain/notifications/Notification.ts client/src/presentation/notifications/NotificationItem.tsx client/src/presentation/notifications/useNotificationActions.ts client/src/presentation/hooks/useNotificationStream.ts client/src/presentation/layout/Sidebar.tsx client/src/presentation/chat/CommunicationPanel.tsx
  git rm client/src/domain/project/ProjectInvite.ts
  git commit -m "feat(notifications): dual-token InvitePage, тип workspace_invite и chat_mention в клиенте, делегирование без кнопок принятия"
  ```

### Task 22: TeamSection — участники пространства; WorkspaceSettingsPage — роли editor/viewer + инвайты

**Files:**
- Modify: `client/src/domain/workspace/Workspace.ts` (строка 1: WorkspaceRole)
- Modify: `client/src/infrastructure/http/HttpWorkspaceRepository.ts` (нормализация legacy-роли 'member', строки 27–33, 45, 53–61)
- Modify: `client/src/presentation/pages/WorkspaceSettingsPage.tsx` (MembersCard строки 168–343; + новая InvitesCard; + рендер в WorkspaceSettingsPage строка 86)
- Modify (полная переработка): `client/src/presentation/components/project/TeamSection.tsx`
- Test: нет (клиент; `npm run typecheck` + `npm run lint`)

**Interfaces:**
- Consumes:
  - из Task 19: `WorkspaceInvite`, `workspaceRepository.listInvites/createInvite/deleteInvite`
  - из Task 20: `InviteDialog` props `{ open; onClose; workspaceId?; onCreated? }`
  - серверная секция: `PATCH /api/workspaces/:id/members/:userId` принимает `role: 'editor'|'viewer'` (роли пространства owner/editor/viewer после миграции); `GET /api/workspaces/:id/members` отдаёт `role: 'owner'|'editor'|'viewer'` (у старого кода мог быть 'member' — клиент нормализует)
  - существующие: `useWorkspaceMembers(workspaceId)` (`client/src/presentation/hooks/useWorkspaceMembers.ts` — сигнатуры не меняются, типизировано WorkspaceRole), `useCurrentWorkspace()`, `useCurrentUser()`
- Produces:
  - `WorkspaceRole = 'owner' | 'editor' | 'viewer'` (клиентский домен)
  - `TeamSection` (props `{ project: Project }` не меняются) — read-only список участников пространства + «Пригласить» + «Управлять командой»

#### Шаги

- [ ] **Step 1: Расширить WorkspaceRole в домене.**
  В `client/src/domain/workspace/Workspace.ts` строка 1:
  ```ts
  // Роли пространства (после унификации доступа): owner управляет командой, editor
  // редактирует все проекты, viewer только смотрит. Legacy 'member' мигрирован в 'editor'.
  export type WorkspaceRole = 'owner' | 'editor' | 'viewer';
  ```

- [ ] **Step 2: Нормализация роли в HttpWorkspaceRepository.**
  В `client/src/infrastructure/http/HttpWorkspaceRepository.ts`:
  1. В `WorkspaceDto` (строка 20) и `MemberDto` (строка 29) поменять тип поля role на `role?: string;` (сервер старой версии мог отдавать 'member').
  2. После `type ProjectDto ...` добавить:
  ```ts
  // Старый бэк отдавал 'member' — маппим в 'editor' (миграция БД переводит роли так же).
  function normalizeRole(role: string | undefined): WorkspaceRole {
    if (role === 'owner' || role === 'editor' || role === 'viewer') return role;
    return 'editor';
  }
  ```
  3. В `fromDto` строка 45: `role: dto.role ?? 'member',` → `role: normalizeRole(dto.role),`.
  4. В `memberFromDto` строка 56: `role: dto.role,` → `role: normalizeRole(dto.role),`.

- [ ] **Step 3: WorkspaceSettingsPage — роли owner/editor/viewer и «Выйти».**
  В `client/src/presentation/pages/WorkspaceSettingsPage.tsx`:
  1. Добавить импорты:
  ```ts
  import { Copy, UserPlus } from 'lucide-react'; // дополнить существующий lucide-импорт
  import type { WorkspaceInvite } from '@/domain/workspace/WorkspaceInvite';
  import { useContainer } from '@/infrastructure/di/container';
  import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
  import { InviteDialog } from '@/presentation/components/project/InviteDialog';
  ```
  2. Общий словарь ролей (после `ROLE_SELECT_CLASS`, строка 37):
  ```ts
  const WS_ROLE_LABEL: Record<WorkspaceRole, string> = {
    owner: 'Владелец',
    editor: 'Редактор',
    viewer: 'Наблюдатель',
  };
  ```
  3. В `MembersCard`:
     - строка 180: `useState<WorkspaceRole>('member')` → `useState<WorkspaceRole>('editor')`;
     - добавить `const { user: currentUser } = useCurrentUser();` рядом с хуками;
     - селект роли участника (строки 248–256) →
     ```tsx
     <select
       className={ROLE_SELECT_CLASS}
       value={m.role}
       onChange={(e) => void handleRole(m.userId, e.target.value as WorkspaceRole)}
       aria-label="Роль участника"
     >
       <option value="owner">Владелец</option>
       <option value="editor">Редактор</option>
       <option value="viewer">Наблюдатель</option>
     </select>
     ```
     - read-only метка (строки 272–276) →
     ```tsx
     <span className="text-xs text-muted-foreground">{WS_ROLE_LABEL[m.role]}</span>
     ```
     и сразу после неё — «Выйти» для себя-не-владельца (выход из пространства):
     ```tsx
     {!canManage && currentUser?.id === m.userId && m.role !== 'owner' && (
       <Button
         variant="ghost"
         size="sm"
         className="text-xs text-muted-foreground hover:text-destructive"
         onClick={() => {
           if (window.confirm('Выйти из пространства? Доступ вернёт только новое приглашение.')) {
             void handleRemove(m.userId);
           }
         }}
       >
         Выйти
       </Button>
     )}
     ```
     - селект роли в форме добавления по email (строки 294–302) →
     ```tsx
     <select
       className={ROLE_SELECT_CLASS}
       value={role}
       onChange={(e) => setRole(e.target.value as WorkspaceRole)}
       aria-label="Роль нового участника"
     >
       <option value="editor">Редактор</option>
       <option value="viewer">Наблюдатель</option>
     </select>
     ```
     (owner по email не назначаем — владение передаётся отдельно.)

- [ ] **Step 4: WorkspaceSettingsPage — карточка «Приглашения» (токен-ссылки).**
  1. Добавить компонент в конец файла:
  ```tsx
  function InvitesCard({ workspaceId }: { workspaceId: string }): React.ReactElement {
    const { workspaceRepository } = useContainer();
    const [invites, setInvites] = useState<WorkspaceInvite[] | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);

    useEffect(() => {
      let cancelled = false;
      workspaceRepository
        .listInvites(workspaceId)
        .then((list) => {
          if (!cancelled) setInvites(list);
        })
        .catch(() => {
          if (!cancelled) setInvites([]);
        });
      return () => {
        cancelled = true;
      };
    }, [workspaceRepository, workspaceId]);

    const handleCreated = (invite: WorkspaceInvite): void => {
      setInvites((prev) => [...(prev ?? []), invite]);
      if (invite.url) {
        void navigator.clipboard.writeText(invite.url).then(
          () => toast.success('Ссылка скопирована'),
          () => toast.success('Приглашение создано'),
        );
      }
    };

    const copyUrl = async (invite: WorkspaceInvite): Promise<void> => {
      if (!invite.url) {
        // Для существующих pending-инвайтов сервер не отдаёт token/url — только в момент create.
        toast.error('Ссылка доступна только в момент создания. Отзови и создай новое.');
        return;
      }
      try {
        await navigator.clipboard.writeText(invite.url);
        toast.success('Скопировано');
      } catch {
        toast.error('Не удалось скопировать.');
      }
    };

    const revoke = async (invite: WorkspaceInvite): Promise<void> => {
      if (!window.confirm('Отозвать приглашение?')) return;
      try {
        await workspaceRepository.deleteInvite(workspaceId, invite.id);
        setInvites((prev) => (prev ?? []).filter((i) => i.id !== invite.id));
        toast.success('Приглашение отозвано');
      } catch (e) {
        toast.error(`Не удалось: ${(e as Error).message}`);
      }
    };

    return (
      <Card>
        <CardHeader>
          <CardTitle>Приглашения</CardTitle>
          <CardDescription>
            Токен-ссылки в пространство: получатель открывает ссылку и получает доступ ко всем
            проектам. Срок действия — 7 дней.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
            <UserPlus className="size-4" />
            Создать приглашение
          </Button>
          {invites !== null && invites.length > 0 && (
            <ul className="divide-y">
              {invites.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate">
                      {inv.email ?? <span className="italic text-muted-foreground">без email</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {inv.role === 'editor' ? 'редактор' : 'наблюдатель'} · истекает{' '}
                      {inv.expiresAt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => void copyUrl(inv)}
                    aria-label="Скопировать ссылку"
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    onClick={() => void revoke(inv)}
                    aria-label="Отозвать"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        <InviteDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          workspaceId={workspaceId}
          onCreated={handleCreated}
        />
      </Card>
    );
  }
  ```
  2. В `WorkspaceSettingsPage` рендер (строка 86) — после `<MembersCard ... />` добавить:
  ```tsx
  {isOwner && <InvitesCard workspaceId={workspace.id} />}
  ```

- [ ] **Step 5: TeamSection — read-only участники пространства.**
  Полностью заменить содержимое `client/src/presentation/components/project/TeamSection.tsx`:
  ```tsx
  import { useEffect, useState } from 'react';
  import { Link } from 'react-router-dom';
  import { Settings2, UserPlus } from 'lucide-react';
  import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
  import { Button } from '@/components/ui/button';
  import { toast } from '@/components/ui/sonner';
  import { cn } from '@/lib/utils';
  import type { Project } from '@/domain/project/Project';
  import type { WorkspaceMember, WorkspaceRole } from '@/domain/workspace/Workspace';
  import type { WorkspaceInvite } from '@/domain/workspace/WorkspaceInvite';
  import { useContainer } from '@/infrastructure/di/container';
  import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
  import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
  import { getInitials } from '@/presentation/layout/projectIcons';
  import { OverviewSection } from '@/presentation/components/project/OverviewSection';
  import { InviteDialog } from './InviteDialog';

  const ROLE_LABEL: Record<WorkspaceRole, string> = {
    owner: 'владелец',
    editor: 'редактор',
    viewer: 'наблюдатель',
  };

  const ROLE_BADGE_CLASS: Record<WorkspaceRole, string> = {
    owner: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    editor: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
    viewer: 'bg-muted text-muted-foreground',
  };

  // Секция «Команда» на странице проекта. После унификации доступа команда — это участники
  // ПРОСТРАНСТВА проекта (read-only список). Управление ролями/удаление/инвайт-лист — на
  // странице настроек пространства (ссылка «Управлять командой» для owner'а).
  export function TeamSection({ project }: { project: Project }): React.ReactElement | null {
    const { workspaceRepository } = useContainer();
    const { user: currentUser } = useCurrentUser();
    const { workspace } = useCurrentWorkspace();
    const [members, setMembers] = useState<WorkspaceMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [showInviteDialog, setShowInviteDialog] = useState(false);

    const isOwner = workspace?.role === 'owner';
    const canInvite = workspace?.role === 'owner' || workspace?.role === 'editor';

    // В inbox команды не бывает — секцию не показываем.
    const skip = project.isInbox;
    const workspaceId = workspace?.id ?? null;

    useEffect(() => {
      if (skip || !workspaceId) return;
      let cancelled = false;
      setLoading(true);
      workspaceRepository
        .listMembers(workspaceId)
        .then((list) => {
          if (!cancelled) setMembers(list);
        })
        .catch((e: unknown) => {
          if (!cancelled) toast.error(`Не удалось загрузить команду: ${(e as Error).message}`);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [workspaceRepository, workspaceId, skip]);

    if (skip) return null;

    const handleInviteCreated = (invite: WorkspaceInvite): void => {
      if (invite.url) {
        void navigator.clipboard.writeText(invite.url).then(
          () => toast.success('Ссылка скопирована'),
          () => toast.success('Приглашение создано'),
        );
      }
    };

    return (
      <OverviewSection
        title="Команда"
        actions={
          <div className="flex items-center gap-1.5">
            {isOwner && workspaceId && (
              <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
                <Link to={`/workspaces/${workspaceId}/settings`}>
                  <Settings2 className="size-4" />
                  Управлять командой
                </Link>
              </Button>
            )}
            {canInvite && (
              <Button size="sm" variant="outline" onClick={() => setShowInviteDialog(true)}>
                <UserPlus className="size-4" />
                Пригласить
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Участники пространства{workspace ? ` «${workspace.name}»` : ''} — им доступны все его
            проекты.
          </p>
          {loading ? (
            <div className="space-y-2">
              <div className="h-10 animate-pulse rounded-md bg-muted" />
              <div className="h-10 animate-pulse rounded-md bg-muted" />
            </div>
          ) : (
            <ul className="space-y-1">
              {members.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40"
                >
                  <Avatar className="size-8 shrink-0">
                    {m.avatarUrl ? (
                      <AvatarImage src={m.avatarUrl} alt={m.displayName ?? ''} />
                    ) : null}
                    <AvatarFallback>{getInitials(m.displayName ?? m.email ?? '?')}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.displayName ?? '—'}
                      {currentUser?.id === m.userId && (
                        <span className="ml-1 text-xs text-muted-foreground">(ты)</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                      ROLE_BADGE_CLASS[m.role],
                    )}
                  >
                    {ROLE_LABEL[m.role]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <InviteDialog
          open={showInviteDialog}
          onClose={() => setShowInviteDialog(false)}
          workspaceId={workspaceId ?? undefined}
          onCreated={handleInviteCreated}
        />
      </OverviewSection>
    );
  }
  ```
  Примечание: `project.role`/`projectRepository.updateMemberRole/removeMember/transferOwnership` из этой секции уходят — сами методы в `ProjectRepository` остаются (их использует панель участников и т.п.; серверная их судьба — вне этой задачи).

- [ ] **Step 6: Проверка и commit.**
  ```
  npm run typecheck
  npm run lint
  ```
  Оба зелёные. Внимание: после widening WorkspaceRole tsc может подсветить другие места со строковыми литералами роли — исправить по месту ('member' → 'editor'). Затем:
  ```
  git add client/src/domain/workspace/Workspace.ts client/src/infrastructure/http/HttpWorkspaceRepository.ts client/src/presentation/pages/WorkspaceSettingsPage.tsx client/src/presentation/components/project/TeamSection.tsx
  git commit -m "feat(workspace): команда пространства — TeamSection read-only со ссылкой «Управлять», роли owner/editor/viewer и карточка инвайтов в настройках"
  ```

### Task 23: Делегирование-UI без принятия/отказа — PendingCard, accept/decline, invite-delegate долой

**Files:**
- Modify: `client/src/presentation/components/tasks/AssignedToMeBlock.tsx` (строки 121–125, 171–177, 188, 259–282, 441–513, 596–623, 699–718, 787–806, 855–860, 1208–1259, 1712–1775 + импорты)
- Modify (полная переработка): `client/src/presentation/components/tasks/DelegationBadge.tsx`
- Modify: `client/src/presentation/components/tasks/assignedGrouping.ts` (строки 40–44, 105, 147, 176, 208, 232)
- Modify (полная переработка): `client/src/application/task/TaskDelegationRepository.ts`
- Modify (полная переработка): `client/src/infrastructure/http/HttpTaskDelegationRepository.ts`
- Modify: `client/src/application/task/TaskRepository.ts` (строки 159–168), `client/src/infrastructure/http/HttpTaskRepository.ts` (строки 421–427)
- Modify: `client/src/domain/task/TaskDelegation.ts` (комментарии)
- НЕ трогать: `DelegateTaskButton.tsx`, `DelegateSelect.tsx` (используют только delegate/reassign/withdraw — остаются), `InboxUnifiedDnd.tsx` (invite-путь там уже недостижим, строка 338).
- Test: нет (клиент; `npm run typecheck` + `npm run lint`)

**Interfaces:**
- Consumes (серверная секция): REST `POST /api/delegations/:id/accept`, `POST /api/delegations/:id/decline`, `GET /api/delegations/pending`, `POST /api/projects/:pid/tasks/:tid/invite-delegate` — УДАЛЕНЫ на сервере; `DELETE /api/delegations/:id` (withdraw) и `POST /api/delegations/:id/relinquish` — остаются; делегация создаётся сразу `status='accepted'`.
- Produces:
  - `TaskDelegationRepository` = `{ listAssignedToMe(); listDelegatedToOthers(); withdraw(id); relinquish(id) }` (минус listMyPending/accept/decline/PendingDelegation)
  - `TaskRepository` без `inviteDelegate`
  - `DelegationBadge` рендерит только `accepted`-делегации

#### Шаги

- [ ] **Step 1: assignedGrouping.ts — убрать pendingScore.**
  В `client/src/presentation/components/tasks/assignedGrouping.ts`:
  1. Удалить блок (строки 40–44):
  ```ts
  // pending / pending_invite (ожидают «Принять»/«Вступить») всегда поднимаются над
  // принятыми — требуют действия.
  function pendingScore(t: AssignedTask): number {
    return t.delegation.status === 'pending' || t.delegation.status === 'pending_invite' ? 1 : 0;
  }
  ```
  2. Строка 105: `for (const g of groups) g.items.sort((a, b) => pendingScore(b) - pendingScore(a));` — удалить целиком (порядок внутри проекта не менялся из-за пустых скоров? нет: скор теперь всегда 0, sort бесполезен).
  3. Строка 147: `pendingScore(b) - pendingScore(a) || b.createdAt.getTime() - a.createdAt.getTime();` → `b.createdAt.getTime() - a.createdAt.getTime();`
  4. Строки 176 и 208: `pendingScore(b) - pendingScore(a) || (a.deadline ?? '').localeCompare(b.deadline ?? '');` → `(a.deadline ?? '').localeCompare(b.deadline ?? '');`
  5. Строка 232: `pendingScore(b) - pendingScore(a) || a.position - b.position;` → `a.position - b.position;`

- [ ] **Step 2: DelegationBadge — только accepted.**
  Полностью заменить содержимое `client/src/presentation/components/tasks/DelegationBadge.tsx`:
  ```tsx
  import { ArrowRight } from 'lucide-react';
  import { UserAvatarHover } from '@/presentation/components/user/UserAvatarHover';
  import type { TaskDelegation } from '@/domain/task/TaskDelegation';

  type Props = {
    delegation: TaskDelegation;
    // Текущий пользователь — определяет перспективу «от кого / кому».
    currentUserId: string;
  };

  // Компактный индикатор делегирования на карточке задачи. Делегация создаётся сразу
  // принятой (accepted) — состояний «ждёт ответа»/«ожидает вступления» больше нет.
  // «Кто → кому» — две авы со стрелкой; «от кого / кому мне» — одна ава.
  export function DelegationBadge({ delegation, currentUserId }: Props): React.ReactElement | null {
    if (delegation.status !== 'accepted') return null;

    const isCreator = delegation.creatorUserId === currentUserId;
    const isDelegate = delegation.delegateUserId === currentUserId;
    const arrow = <ArrowRight className="size-3 shrink-0 text-muted-foreground/60" />;

    // Наблюдатель: обе стороны «кто → кому».
    if (!isCreator && !isDelegate) {
      return (
        <span className="inline-flex items-center gap-1">
          <UserAvatarHover
            displayName={delegation.creatorDisplayName}
            avatarUrl={delegation.creatorAvatarUrl}
            subtitle="поручил(а)"
          />
          {arrow}
          <UserAvatarHover
            displayName={delegation.delegateDisplayName}
            avatarUrl={delegation.delegateAvatarUrl}
            subtitle="выполняет"
          />
        </span>
      );
    }

    // Я — делегат: «от кого».
    if (isDelegate) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="opacity-70">от</span>
          <UserAvatarHover
            displayName={delegation.creatorDisplayName}
            avatarUrl={delegation.creatorAvatarUrl}
            subtitle="поручил(а) вам"
          />
        </span>
      );
    }

    // Я — создатель: «кому».
    return (
      <span className="inline-flex items-center gap-1">
        {arrow}
        <UserAvatarHover
          displayName={delegation.delegateDisplayName}
          avatarUrl={delegation.delegateAvatarUrl}
          subtitle="выполняет"
        />
      </span>
    );
  }
  ```

- [ ] **Step 3: Репозитории — минус listMyPending/accept/decline/inviteDelegate.**
  1. Заменить содержимое `client/src/application/task/TaskDelegationRepository.ts`:
  ```ts
  import type { AssignedTask } from '@/domain/task/AssignedTask';

  export interface TaskDelegationRepository {
    // Все поручённые мне задачи (accepted) по всем проектам — плоским списком.
    // Группировку (проект/дата/дедлайн/приоритет) делает презентация (assignedGrouping.ts).
    listAssignedToMe(): Promise<AssignedTask[]>;
    // Все активные делегирования «кому-то другому», видимые мне, по всем проектам —
    // вкладка «Другим». Тот же shape: delegation.creator* — от кого, delegate* — кому.
    listDelegatedToOthers(): Promise<AssignedTask[]>;
    // Создатель забирает задачу обратно (в т.ч. уже принятую) — drop на свою аву.
    withdraw(id: string): Promise<void>;
    // ДЕЛЕГАТ снимает с себя задачу (право отказа постфактум) — создателю уйдёт
    // уведомление task_delegation_resolved/declined.
    relinquish(id: string): Promise<void>;
  }
  ```
  2. Заменить содержимое `client/src/infrastructure/http/HttpTaskDelegationRepository.ts`:
  ```ts
  import type { TaskDelegationRepository } from '@/application/task/TaskDelegationRepository';
  import type { AssignedTask } from '@/domain/task/AssignedTask';
  import { httpClient } from './httpClient';
  import { fromDto as taskFromDto, type TaskDto } from './HttpTaskRepository';

  type AssignedItemDto = {
    task: TaskDto;
    projectId: string;
    projectName: string;
    isInbox: boolean;
    canModify: boolean;
  };

  export class HttpTaskDelegationRepository implements TaskDelegationRepository {
    async listAssignedToMe(): Promise<AssignedTask[]> {
      return this.fetchAssignedList('/delegations/assigned-to-me');
    }

    async listDelegatedToOthers(): Promise<AssignedTask[]> {
      return this.fetchAssignedList('/delegations/delegated-to-others');
    }

    // Общий фетчер assigned-to-me / delegated-to-others — сервер отдаёт одинаковый view-shape.
    private async fetchAssignedList(path: string): Promise<AssignedTask[]> {
      const { items } = await httpClient.get<{ items: AssignedItemDto[] }>(path);
      const out: AssignedTask[] = [];
      for (const it of items) {
        const task = taskFromDto(it.task);
        if (!task.delegation) continue; // сервер гарантирует наличие; страхуемся
        out.push({
          ...task,
          delegation: task.delegation,
          projectId: it.projectId,
          projectName: it.projectName,
          isInbox: it.isInbox,
          canModify: it.canModify,
        });
      }
      return out;
    }

    async withdraw(id: string): Promise<void> {
      await httpClient.delete<void>(`/delegations/${id}`);
    }

    async relinquish(id: string): Promise<void> {
      await httpClient.post<void>(`/delegations/${id}/relinquish`, {});
    }
  }
  ```
  3. В `client/src/application/task/TaskRepository.ts` удалить объявление `inviteDelegate` с комментарием (строки 165–168) и в комментарии над `reassign` (строки 159–164) убрать последние два предложения про `delegate_not_*`/флоу приглашения; заменить «создаётся новая pending» → «создаётся новая (сразу accepted)».
  4. В `client/src/infrastructure/http/HttpTaskRepository.ts` удалить метод `inviteDelegate` (строки 421–427).

- [ ] **Step 4: domain/task/TaskDelegation.ts — комментарии.**
  Union `TaskDelegationStatus` НЕ сужать (в БД остаются исторические записи). Обновить шапку файла (строки 1–3):
  ```ts
  // Делегирование одной задачи одному пользователю. См. db/039.
  // Новые делегации создаются сразу accepted (мгновенное делегирование, спека 2026-07-13);
  // pending/declined/pending_invite остались в union только как исторические значения БД.
  ```
  Если `TASK_DELEGATION_STATUSES` / `ACTIVE_DELEGATION_STATUSES` нигде в client/src не используются (проверить: `rg -n "TASK_DELEGATION_STATUSES|ACTIVE_DELEGATION_STATUSES" client/src --glob '!**/TaskDelegation.ts'`) — удалить обе константы.

Продолжение (AssignedToMeBlock) — в `task-23-part2.md` (та же задача, коммит один в конце).

### Task 23 (part 2) — AssignedToMeBlock. Выполнять после part 1, коммит общий в конце.

- [ ] **Step 5: AssignedToMeBlock — убрать pending-механику.**
  Все правки в `client/src/presentation/components/tasks/AssignedToMeBlock.tsx`:

  1. Удалить хелпер и комментарий (строки 121–125):
  ```ts
  // «Ждёт моего ответа» во вкладке «Для меня»: обычное делегирование (pending) ИЛИ
  // приглашение+делегирование (pending_invite — «Вступить/Отклонить»). Обе рисуются
  // карточкой с кнопками действия, а не «принятой».
  const isAwaitingResponse = (t: AssignedTask): boolean =>
    t.delegation.status === 'pending' || t.delegation.status === 'pending_invite';
  ```

  2. Деструктуризация ProjectsProvider (строки 174–177): `refreshProjects` использовался только в `resolve()` — заменить
  ```ts
  const { refresh: refreshProjects, data: allProjects } = useProjectsContext();
  ```
  на
  ```ts
  // data — для фантомной колонки «Другой проект…» (условие «видны не все мои проекты»).
  const { data: allProjects } = useProjectsContext();
  ```
  (двухстрочный комментарий над строкой про refresh при accept — удалить).

  3. Удалить стейт `const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());` (строка 188).

  4. Удалить целиком функцию `resolve` (строки 259–282, `const resolve = async (delegationId, action ...)`).

  5. Удалить invite-флоу (строки 441–513 частично):
     - стейт (строки 441–444):
     ```ts
     // Задача, которую переназначаем не-участнику проекта → всплывашка «пригласить?» (Фаза 3).
     const [inviteFlow, setInviteFlow] = useState<{ item: AssignedTask; member: SharedMember } | null>(
       null,
     );
     ```
     - в `reassignTo` (строки 450–468): комментарий над функцией сократить до «Переназначить ответственного (drop карточки на кубик человека). Делегат — любой участник пространства; после успеха — refresh.»; catch-блок
     ```ts
     } catch (e) {
       const code = e instanceof HttpError ? e.body.error : '';
       if (code === 'delegate_not_project_member' || code === 'delegate_not_in_shared_members') {
         setInviteFlow({ item, member }); // «его нет в проекте, пригласить?»
       } else {
         toast.error(`Не удалось переназначить: ${(e as Error).message}`);
       }
     }
     ```
     заменить на
     ```ts
     } catch (e) {
       toast.error(`Не удалось переназначить: ${(e as Error).message}`);
     }
     ```
     - удалить целиком `confirmInvite` (строки 496–513, useCallback с `taskRepository.inviteDelegate`).

  6. Рендер карточек — оба места. Первое (deadline-канбан, строки 699–718): заменить
  ```tsx
  <DraggableTask key={item.id} item={item} disabled={!item.canModify}>
    {tab === 'toMe' && isAwaitingResponse(item) ? (
      <PendingCard
        item={item}
        busy={resolvingIds.has(item.delegation.id)}
        onAccept={() => void resolve(item.delegation.id, 'accept')}
        onDecline={() => void resolve(item.delegation.id, 'decline')}
      />
    ) : (
      <AcceptedCard
        item={item}
        currentUserId={user?.id ?? null}
        onOpen={() => setDrawerTask(item)}
        onChanged={handleToggled}
      />
    )}
  </DraggableTask>
  ```
  на
  ```tsx
  <DraggableTask key={item.id} item={item} disabled={!item.canModify}>
    <AcceptedCard
      item={item}
      currentUserId={user?.id ?? null}
      onOpen={() => setDrawerTask(item)}
      onChanged={handleToggled}
    />
  </DraggableTask>
  ```
  (комментарий над этим блоком про «Принять/Отклонить»/«Вступить» — удалить). Второе место (группы-колонки, строки 787–806): аналогично — оставить только `<AcceptedCard item={item} currentUserId={user?.id ?? null} onOpen={() => setDrawerTask(item)} onChanged={handleToggled} showCreatedAt={grouping === 'created'} hideProjectLabel={grouping === 'project'} />` внутри `DraggableTask`.

  7. Счётчик «ждут ответа» (строки 603–606): удалить
  ```ts
  const pendingCount = visibleTasks.filter(isAwaitingResponse).length;
  // Русская плюрализация: 1/21/31 «ждёт ответа», иначе «ждут ответа» (11 — исключение).
  const pendingWord =
    pendingCount % 10 === 1 && pendingCount % 100 !== 11 ? 'ждёт ответа' : 'ждут ответа';
  ```
  и в подзаголовке (строки 654–657) заменить
  ```tsx
  <p className="mt-0.5 truncate text-xs text-muted-foreground">
    {subtitleBase}
    {pendingCount > 0 && ` · ${pendingCount} ${pendingWord}`}
  </p>
  ```
  на
  ```tsx
  <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitleBase}</p>
  ```

  8. Удалить JSX диалога (строки 855–860):
  ```tsx
  {/* Дроп на не-участника проекта → «его нет в проекте, пригласить и поручить?». */}
  <InviteToDelegateDialog
    flow={inviteFlow}
    onClose={() => setInviteFlow(null)}
    onConfirm={confirmInvite}
  />
  ```

  9. Удалить целиком компонент `InviteToDelegateDialog` (строки 1208–1259, включая комментарий над ним).

  10. Удалить целиком компонент `PendingCard` (строки 1712–1775, включая комментарий).

  11. Импорты — убрать ставшие неиспользуемыми (сверить с eslint): `Check` из lucide; `Avatar, AvatarFallback` из `@/components/ui/avatar`; `avatarColor, getInitials` из projectIcons (если getInitials больше нигде в файле не используется — иначе оставить); `HttpError` из `@/lib/HttpError`; `Send` из lucide НЕ убирать (используется в InboxFilterSection). `X` НЕ убирать (кнопка «Сбросить» фильтров).

- [ ] **Step 6: Проверка и commit.**
  ```
  npm run typecheck
  npm run lint
  ```
  Оба зелёные. Внимательно: eslint подскажет оставшиеся неиспользуемые импорты/переменные после вырезаний — дочистить. Затем:
  ```
  git add client/src/presentation/components/tasks/AssignedToMeBlock.tsx client/src/presentation/components/tasks/DelegationBadge.tsx client/src/presentation/components/tasks/assignedGrouping.ts client/src/application/task/TaskDelegationRepository.ts client/src/infrastructure/http/HttpTaskDelegationRepository.ts client/src/application/task/TaskRepository.ts client/src/infrastructure/http/HttpTaskRepository.ts client/src/domain/task/TaskDelegation.ts
  git commit -m "feat(tasks): мгновенное делегирование в UI — убраны PendingCard/accept/decline/invite-delegate, бейдж только accepted"
  ```

### Task 24: Финальная зачистка клиента + сборка

**Files:**
- Modify: по результатам grep (ожидаемо — точечные комментарии/хвосты; список ниже)
- Test: нет (`npm run typecheck` + `npm run lint` + `npm run build`)

**Interfaces:**
- Consumes: результат Task 19–23 (весь клиентский код уже мигрирован).
- Produces: чистый клиент без легаси invite/pending-делегирования; зелёный `npm run build`.

#### Шаги

- [ ] **Step 1: Grep-аудит легаси-упоминаний.**
  Выполнить из корня (PowerShell, или rg напрямую):
  ```
  rg -n "pending_invite|inviteDelegate|invite-delegate|acceptDelegation|declineDelegation|handleAcceptDelegation|handleDeclineDelegation|listMyPending|PendingDelegation|PendingCard|InviteToDelegateDialog|isAwaitingResponse|pendingScore" client/src
  rg -n "createInvite|listInvites|deleteInvite" client/src
  rg -n "ProjectInvite" client/src
  rg -n "delegations/pending|/accept'|/decline'|delegations/\$\{id\}/accept" client/src
  ```
  Разрешённые (ожидаемые) вхождения — НЕ трогать:
  - `client/src/domain/task/TaskDelegation.ts` — `'pending_invite'`/`'pending'`/`'declined'` внутри union `TaskDelegationStatus` (исторические значения БД, помечены комментарием из Task 23).
  - `createInvite/listInvites/deleteInvite` на `workspaceRepository` (`@/application/workspace/WorkspaceRepository`, `HttpWorkspaceRepository`, `InviteDialog`, `WorkspaceSettingsPage`, `ProjectSharePopover`, `MembersInviteForm`, `ProjectsShareCard`) — это НОВЫЕ workspace-методы.
  - `ProjectInvitePayload` / `'project_invite'` в `client/src/domain/notifications/Notification.ts`, `NotificationItem.tsx`, `useNotificationActions.ts`, `useNotificationStream.ts` — легаси-уведомления в БД должны продолжать рендериться и приниматься.
  Всё ОСТАЛЬНОЕ найденное — легаси, устранить в Step 2.

- [ ] **Step 2: Устранить найденные хвосты.**
  Типовые кандидаты (проверить каждый, даже если grep в Step 1 их не показал — правки могли разъехаться):
  1. `client/src/domain/task/AssignedTask.ts` — если в комментариях упоминается pending/«Принять» — переформулировать («делегация всегда accepted»).
  2. `client/src/presentation/components/tasks/InboxUnifiedDnd.tsx` строка ~338 — комментарий «инвайт-флоу (delegate_not_*) здесь недостижим» → «любая ошибка — честный тост» (инвайт-флоу больше не существует в принципе).
  3. `client/src/presentation/components/tasks/DelegateSelect.tsx` строки 138–141 — hint «Пригласите кого-то в проект — потом сможете делегировать» → «Пригласите кого-то в пространство — потом сможете делегировать.» Аналогично `DelegateTaskButton.tsx` строка ~207.
  4. Комментарии про «pending» в `client/src/application/task/TaskDelegationRepository.ts` / `HttpTaskRepository.ts` / хуках — привести к «accepted сразу».
  5. Любые оставшиеся импорты из удалённого `@/domain/project/ProjectInvite` — заменить/удалить (tsc их и так подсветит).
  Для каждого правимого файла — точечная правка, без рефакторинга вокруг.

- [ ] **Step 3: Полная проверка клиента.**
  ```
  npm run typecheck
  npm run lint
  npm run build
  ```
  Все три зелёные. `npm run build` собирает оба workspace — если упадёт СЕРВЕРНАЯ часть по причинам вне клиентских задач (например, незавершённая параллельная серверная работа), зафиксировать это в отчёте и прогнать клиентскую сборку отдельно: `npm run build -w client` (или `cd client && npx vite build`) — она обязана быть зелёной.

- [ ] **Step 4: Commit.**
  ```
  git add <точечные файлы из Step 2>
  git commit -m "chore(client): финальная зачистка легаси инвайтов и pending-делегирования, зелёная сборка"
  ```
  Если Step 2 не нашёл ни одного хвоста — коммит не нужен; зафиксировать в отчёте «grep чистый, build зелёный».

---

## Секция F — финальная и прод-верификация (Task 25–26)

## Секция F: Финальная верификация (Task 25 — Task 26)

### Task 25: Полный локальный прогон (тесты, typecheck, lint, build) + grep-свипы на мёртвые ссылки

**Files:**
- Test: весь серверный набор `server/src/**/*.test.ts` (запуск, не создание)
- Modify (только если свипы/прогоны найдут остатки): файлы по результатам свипа — типично `server/src/index.ts`, `server/src/presentation/http.ts`, `server/src/presentation/delegations/routes.ts`, `server/src/infrastructure/telegram/composer/TelegramComposerService.ts`, `client/src/presentation/**`
- Никаких новых файлов не создаётся.

**Interfaces:**
- Consumes: конечное состояние кода после Task 1–24 (все удаления по спеке §3–§6 уже выполнены; миграции секции A лежат в `db/110_*.sql`, `db/111_*.sql`, `db/112_*.sql`).
- Produces: зелёный локальный прогон + гарантия «0 мёртвых ссылок»; при необходимости — фикс-коммит `fix(workspace): финальная верификация — зачистка мёртвых ссылок по grep-свипу`.

- [ ] **Step 1: Прогнать весь серверный тест-набор.**
  ```powershell
  cd c:\www\ProjectsFlow\server; npm test
  ```
  (эквивалент `node --import tsx --test "src/**/*.test.ts"`, node:test). Ожидание: `# fail 0` в сводке, exit code 0. Если есть падения — перейти к Step 8 (процедура фикса), исправить, вернуться сюда и прогнать заново до зелёного. Точечный перезапуск одного файла: `node --import tsx --test src/application/workspace/WorkspaceService.test.ts`.

- [ ] **Step 2: Typecheck клиента.**
  ```powershell
  cd c:\www\ProjectsFlow; npm run typecheck
  ```
  Ожидание: `tsc --noEmit` завершился без ошибок, exit code 0. (Сервер typecheck'ится компиляцией в Step 4 — `npm run build` включает `tsc -p server/tsconfig.json`.)

- [ ] **Step 3: Lint клиента.**
  ```powershell
  cd c:\www\ProjectsFlow; npm run lint
  ```
  Ожидание: 0 errors (warnings допустимы, если они были ДО этой ветки — сверить с `git stash`-free baseline не нужно, просто 0 новых `Dependency not allowed` от eslint-plugin-boundaries и 0 `no-unused-vars` в затронутых файлах).

- [ ] **Step 4: Полная сборка обоих workspace'ов + landing.**
  ```powershell
  cd c:\www\ProjectsFlow; npm run build
  ```
  Ожидание: client (vite build), landing и server (`tsc`) собрались без ошибок, exit code 0. Ошибка `TS2307 Cannot find module './HubMembershipSync.js'` или подобная = мёртвый импорт → Step 8.

- [ ] **Step 5: Проверить нумерацию новых миграций.**
  ```powershell
  Get-ChildItem c:\www\ProjectsFlow\db\11*.sql | Select-Object Name
  ```
  Ожидание: ровно три файла с префиксами `110_`, `111_`, `112_` (имена — как их создала секция A, например `110_workspace_member_roles.sql`, `111_workspace_invites.sql`, `112_backfill_workspace_members_and_delegations.sql`), без дублей номеров. Дубль номера (как исторический казус двух `101_*.sql`) для НОВЫХ файлов недопустим — `migrate.mjs` сортирует по имени, порядок собьётся. Если секция A использовала другие номера — зафиксировать фактические имена: они понадобятся в Task 26 Step 3.

- [ ] **Step 6: Grep-свип №1 — удалённые серверные сущности.** Из корня `c:\www\ProjectsFlow` (использовать `rg`; можно тем же паттерном через Grep-tool):
  ```powershell
  rg -n "HubMembershipSync" server/src client/src
  rg -n "AcceptTaskDelegation|DeclineTaskDelegation" server/src client/src
  rg -n "InviteAndDelegateTask|inviteAndDelegate|invite-delegate|inviteDelegate" server/src client/src
  rg -n "listPendingForDelegate|ListMyPendingDelegations|listMyPending" server/src client/src
  rg -n "'/pending'" server/src/presentation/delegations client/src
  ```
  Ожидание для КАЖДОЙ команды: пустой вывод, exit code 1 (rg возвращает 1 при «ничего не найдено» — это успех). Любой матч = мёртвая ссылка → Step 8. Совпадения в `docs/`, `db/*.sql` и memory-файлах НЕ ищем и не считаем (историю не чистим).

- [ ] **Step 7: Grep-свип №2 — `pending_invite`, `da:`/`dd:`, revert-логика, клиентские остатки.**
  ```powershell
  rg -n "pending_invite" server/src client/src
  ```
  Ожидание: совпадения ТОЛЬКО в двух местах-исключениях (историческое значение ENUM, спека §4 «ENUM не сужаем»): (а) `server/src/infrastructure/db/schema.ts` — строка `mysqlEnum('status', [...])` таблицы `taskDelegations`; (б) `server/src/domain/task/TaskDelegation.ts` — union `TaskDelegationStatus` / массив `TASK_DELEGATION_STATUSES`. Совпадение где-либо ещё (в т.ч. в `ACTIVE_DELEGATION_STATUSES`, в `DrizzleTaskDelegationRepository.ACTIVE_STATUSES`, в любом use-case, в presentation, во всём `client/src`) = дефект → Step 8. Дополнительно убедиться, что активные статусы не содержат исторических значений:
  ```powershell
  rg -n -A 2 "ACTIVE_DELEGATION_STATUSES|const ACTIVE_STATUSES" server/src
  ```
  Ожидание: оба массива не содержат `'pending_invite'` (после миграции 112 активная делегация — только `accepted`).
  ```powershell
  rg -n "revertToUserId|revert_to_user_id" server/src client/src
  ```
  Ожидание: только `schema.ts` (определение колонки), `domain/task/TaskDelegation.ts` (поле типа) и `DrizzleTaskDelegationRepository.ts` (маппинг колонки в toDomain). В use-case'ах и клиенте — 0.
  ```powershell
  rg -n "d[ad]:\$\{|'d[ad]:'" server/src client/src
  ```
  Ожидание: пусто (TG-callback'и `da:`/`dd:` удалены; `nd:`/`nc:`/`nu:`/`bt:`/`ba:` под паттерн не попадают).
  ```powershell
  rg -n "PendingCard|InviteToDelegateDialog|confirmInvite|isAwaitingResponse|handleAcceptDelegation|handleDeclineDelegation" client/src
  rg -n "ждёт ответа|ждут ответа" client/src
  ```
  Ожидание: пусто по обеим.

- [ ] **Step 8: Процедура фикса найденного (выполнять только при матчах/красных прогонах).** Для каждого совпадения из Step 6–7: открыть файл на указанной строке; удалить (а) строку `import ... from '...'` мёртвого символа, (б) все использования символа в файле — если использование является цельным блоком (маршрут `router.post(...)`/поле deps-объекта в `index.ts`/`http.ts`/JSX-блок кнопки), удалить блок целиком, включая ставшие неиспользуемыми локальные переменные; удаляемые файлы целиком (например, забытый `server/src/application/task/AcceptTaskDelegation.ts`) удалять вместе с их `*.test.ts`. После каждого фикса перегнать затронутую проверку: серверный файл → `cd server; npm test` + `npm run build:server` из корня; клиентский → `npm run typecheck` + `npm run lint`. Повторять Step 6–7 до полностью пустого вывода.

- [ ] **Step 9: Коммит фиксов (только если Step 8 что-то менял).**
  ```powershell
  cd c:\www\ProjectsFlow
  git status --short   # убедиться, что в staged попадают ТОЛЬКО файлы из Step 8 — не git add -A
  git add <точные пути изменённых/удалённых файлов>
  git commit -m "fix(workspace): финальная верификация — зачистка мёртвых ссылок по grep-свипу"
  ```
  Если Step 1–7 прошли зелёными с первого раза и правок не было — коммит не нужен, задача завершена.

---

### Task 26: Прод-верификация после деплоя (push → CI → миграции → demo-сценарий → TG вручную → зачистка)

**Files:**
- Create (scratchpad, НЕ в репо): `<scratchpad>\prod-verify.mjs`, `<scratchpad>\ui-check.mjs`, `<scratchpad>\demo-cleanup.sql` (где `<scratchpad>` — сессионная scratchpad-директория исполнителя)
- Modify: нет (код репо не трогаем; это чеклист-прогон)

**Interfaces:**
- Consumes: серверные эндпоинты после Task 1–24: `POST /api/workspaces/:id/invites {role,email}` → `{ invite: { url } }` (секция инвайтов), `GET /api/invites/:token` (превью, различает оба типа токенов), `POST /api/invites/:token/accept`, `POST /api/projects/:pid/tasks/:tid/delegate {delegateUserId}` (сразу accepted), `GET /api/delegations/assigned-to-me`, `POST /api/delegations/:id/relinquish` (204), удалённые `POST /api/delegations/:id/accept|decline` и `GET /api/delegations/pending` (теперь 404). Существующие: `POST /api/auth/register {email,displayName,password}` → 201 + Set-Cookie; `GET/POST /api/projects`; `POST /api/projects/:pid/tasks {description}`; `GET /api/workspaces`; `GET /api/notifications` → `{notifications}`.
- Produces: подтверждённый прод-статус фичи; зачищенные demo-аккаунты (`remaining_demo_users=0`).

- [ ] **Step 1: Push в main и дождаться CI.**
  ```powershell
  cd c:\www\ProjectsFlow
  git log --oneline -3           # убедиться, что HEAD содержит все коммиты Task 1-25
  git push github HEAD:main
  ```
  Если push падает с «Repository not found» — применить обход из `C:\Users\Yaroslav\.claude\projects\c--www-ProjectsFlow\memory\github-push-credential-workaround.md` (push с `-c credential.helper='store --file=…'`). Затем дождаться деплой-workflow:
  ```powershell
  gh run list --workflow "Deploy to projectsflow.ru" --limit 1 --json databaseId,status,headSha
  gh run watch <databaseId> --exit-status
  ```
  Ожидание: conclusion `success` (workflow сам гоняет typecheck/lint/build, заливает tarball, гоняет `scripts/migrate.mjs` на сервере и рестартит pm2 — см. `.github/workflows/deploy.yml`). Git-операции на этой машине медленные — запускать push/watch в фоне (`run_in_background`), не sleep-циклом.

- [ ] **Step 2: Убедиться, что живой бандл — это наш SHA (маркер `__PF_BUILD__` = GITHUB_SHA, коммит 0bda75e).**
  ```powershell
  $sha = git rev-parse HEAD
  $html = (Invoke-WebRequest -UseBasicParsing https://projectsflow.ru/login).Content
  $null = $html -match 'assets/(index-[\w-]+\.js)'
  $js = (Invoke-WebRequest -UseBasicParsing "https://projectsflow.ru/assets/$($Matches[1])").Content
  $js.Contains($sha.Substring(0,7))
  ```
  Ожидание: `True`. `False` = живой бандл не наш (возможно, параллельный ручной деплой из чужого worktree затёр `client/dist` — см. memory `manual-deploy-clobbers-frontend`): перезапустить CI на main (`gh run rerun <id>`), повторить проверку.

- [ ] **Step 3: Проверить применение миграций 110–112 и схему на проде.** SSH — порт 22 (50222 с этой машины refused), hostkey из memory; пароли SSH/DB — `docs/ONBOARDING.md` §1:
  ```powershell
  plink -ssh -P 22 -pw "<SSH_PASSWORD>" -hostkey "SHA256:NwU1dGS29JAjs2K5LfEtu3DLFgg04yo7ZEA4iOGkM6E" -batch projectsflow@projectsflow.ru "mysql -u projectsflow -p'<DB_PASSWORD>' projectsflow -e \"SELECT name FROM _migrations WHERE name LIKE '11%' ORDER BY name; SHOW COLUMNS FROM workspace_members LIKE 'role'; SHOW TABLES LIKE 'workspace_invites'; SELECT COUNT(*) AS not_migrated FROM task_delegations WHERE status IN ('pending','pending_invite');\""
  ```
  Ожидание, четыре блока: (1) три строки `110_*.sql`, `111_*.sql`, `112_*.sql` (фактические имена — из Task 25 Step 5); (2) колонка `role` с Type `enum('owner','editor','viewer')`; (3) таблица `workspace_invites` существует; (4) `not_migrated = 0`. Любое расхождение — читать лог деплоя (`gh run view <id> --log`) на шаге «Extract, install, migrate, restart»; НЕ править прод-БД руками.

- [ ] **Step 4: Написать API-скрипт demo-сценария.** Записать в `<scratchpad>\prod-verify.mjs` (Node 22, глобальный fetch):
  ```js
  // prod-verify.mjs — сквозной demo-прогон: пространство, инвайт, мгновенное делегирование, relinquish, изоляция
  const BASE = 'https://projectsflow.ru';
  const ts = Date.now();
  const mk = (n) => ({ email: `demo.uws${ts}.${n}@projectsflow.ru`, password: 'DemoPass123!', displayName: `Demo ${n.toUpperCase()}`, cookie: '', id: '' });
  const A = mk('a'), B = mk('b'), C = mk('c');
  let failures = 0;
  const check = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`); if (!cond) failures++; };

  async function api(user, method, path, body, expectStatus) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', ...(user?.cookie ? { cookie: user.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc && user) user.cookie = sc.split(';')[0];
    let json = null;
    try { json = await res.clone().json(); } catch { /* 204/non-json */ }
    if (expectStatus !== undefined && res.status !== expectStatus) {
      check(false, `${method} ${path}: статус ${res.status}, ожидали ${expectStatus} ${JSON.stringify(json)?.slice(0, 300)}`);
    }
    return { status: res.status, json };
  }

  // 1. Регистрация трёх demo-аккаунтов (лимит 5 регистраций/IP/10мин — не перезапускать чаще)
  for (const u of [A, B, C]) {
    const r = await api(u, 'POST', '/api/auth/register', { email: u.email, displayName: u.displayName, password: u.password }, 201);
    u.id = r.json?.user?.id ?? '';
    check(Boolean(u.cookie && u.id), `регистрация ${u.email}`);
  }

  // 2. A: текущее пространство, два проекта, две задачи
  const wsBody = (await api(A, 'GET', '/api/workspaces', undefined, 200)).json;
  const wsList = wsBody.workspaces ?? wsBody;
  const wsA = wsList.find((w) => w.isCurrent) ?? wsList[0];
  check(Boolean(wsA?.id), 'у A есть текущее пространство');
  const p1 = (await api(A, 'POST', '/api/projects', { name: `Demo Alpha ${ts}` }, 201)).json.project;
  const p2 = (await api(A, 'POST', '/api/projects', { name: `Demo Beta ${ts}` }, 201)).json.project;
  const t1r = (await api(A, 'POST', `/api/projects/${p1.id}/tasks`, { description: `Проверить делегирование ${ts}` }, 201)).json;
  const t2r = (await api(A, 'POST', `/api/projects/${p1.id}/tasks`, { description: `Останется у делегата для UI ${ts}` }, 201)).json;
  const task1 = t1r.task ?? t1r, task2 = t2r.task ?? t2r;
  check(Boolean(p1?.id && p2?.id && task1?.id && task2?.id), 'A создал 2 проекта и 2 задачи');

  // 3. Workspace-инвайт (токен-ссылка, роль editor)
  const invBody = (await api(A, 'POST', `/api/workspaces/${wsA.id}/invites`, { role: 'editor', email: null }, 201)).json;
  const inv = invBody.invite ?? invBody;
  const token = (inv?.url ?? '').match(/invite\/([0-9a-f]{64})/)?.[1] ?? inv?.token;
  check(Boolean(token), 'создан workspace-инвайт, есть токен');

  // 4. Анонимное превью + принятие B
  check((await fetch(`${BASE}/api/invites/${token}`)).ok, 'GET /api/invites/:token — превью доступно анониму');
  await api(B, 'POST', `/api/invites/${token}/accept`, {}, 200);

  // 5. B видит ВСЕ проекты пространства A; Входящие A — НЕ видит
  const aProjects = (await api(A, 'GET', '/api/projects', undefined, 200)).json.projects;
  const bProjects = (await api(B, 'GET', '/api/projects', undefined, 200)).json.projects;
  check(bProjects.some((p) => p.id === p1.id) && bProjects.some((p) => p.id === p2.id), 'B видит оба проекта пространства A');
  const aInbox = aProjects.find((p) => p.isInbox);
  check(!aInbox || !bProjects.some((p) => p.id === aInbox.id), 'B НЕ видит Входящие A (инвариант приватности)');

  // 6. Делегирование A→B: мгновенно accepted, без принятия
  const d1 = (await api(A, 'POST', `/api/projects/${p1.id}/tasks/${task1.id}/delegate`, { delegateUserId: B.id })).json;
  await api(A, 'POST', `/api/projects/${p1.id}/tasks/${task2.id}/delegate`, { delegateUserId: B.id });
  const asgBody = (await api(B, 'GET', '/api/delegations/assigned-to-me', undefined, 200)).json;
  const items = asgBody.items ?? asgBody.tasks ?? asgBody;
  const item1 = items.find((i) => (i.task?.id ?? i.id) === task1.id);
  check(Boolean(item1), 'задача сразу в «Поручено мне» у B (без кнопок принятия)');
  check(item1?.canModify === true, 'canModify=true сразу (делегация создана accepted)');
  const delId = d1?.delegation?.id ?? d1?.id ?? item1?.delegation?.id;
  check(Boolean(delId), 'получен id делегации');
  check(item1?.delegation ? item1.delegation.status === 'accepted' : true, 'status=accepted у делегации');

  // 7. Accept/decline/pending — эндпоинты удалены
  check((await fetch(`${BASE}/api/delegations/${delId}/accept`, { method: 'POST', headers: { cookie: B.cookie } })).status === 404, 'POST /accept → 404');
  check((await fetch(`${BASE}/api/delegations/${delId}/decline`, { method: 'POST', headers: { cookie: B.cookie } })).status === 404, 'POST /decline → 404');
  check((await fetch(`${BASE}/api/delegations/pending`, { headers: { cookie: B.cookie } })).status === 404, 'GET /pending → 404');

  // 8. B снимает с себя задачу 1 → создателю приходит уведомление
  await api(B, 'POST', `/api/delegations/${delId}/relinquish`, {}, 204);
  const notifs = (await api(A, 'GET', '/api/notifications', undefined, 200)).json.notifications;
  check(notifs.some((n) => { const p = n.payload ?? n; return p.type === 'task_delegation_resolved' && p.resolution === 'declined'; }),
    'A получил уведомление «снял(а) с себя задачу» (task_delegation_resolved/declined)');

  // 9. Третье лицо C: изоляция
  const cProjects = (await api(C, 'GET', '/api/projects', undefined, 200)).json.projects;
  check(!cProjects.some((p) => p.id === p1.id || p.id === p2.id), 'C (не участник) не видит проекты пространства A');

  const { writeFileSync } = await import('node:fs');
  writeFileSync(new URL('./demo-creds.json', import.meta.url), JSON.stringify({ email: B.email, password: B.password }));
  console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ЗЕЛЁНЫЕ' : `\nПРОВАЛОВ: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
  ```

- [ ] **Step 5: Прогнать API-сценарий.**
  ```powershell
  node <scratchpad>\prod-verify.mjs
  ```
  Ожидание: все строки `PASS`, финал «ВСЕ ПРОВЕРКИ ЗЕЛЁНЫЕ», exit 0. При `FAIL` — это прод-дефект: зафиксировать какой именно чек упал, найти причину в коде соответствующей секции, исправить локально (через полный цикл Task 25) и повторить с push. НЕ перезапускать скрипт чаще 1 раза в 10 минут (rate-limit 5 регистраций/IP; повторный запуск создаёт НОВУЮ тройку `demo.uws<ts>.*` — старую снесёт Step 8).

- [ ] **Step 6: Визуальная проверка UI делегата (скриншот, Chromium+swiftshader — не Playwright MCP).** Записать в `<scratchpad>\ui-check.mjs`:
  ```js
  // ui-check.mjs — логин demo-B, «Поручено мне» без кнопок принятия и бейджа «ждёт ответа»
  import { chromium } from 'playwright-core';
  import { readdirSync, readFileSync } from 'node:fs';
  import { join } from 'node:path';
  const creds = JSON.parse(readFileSync(new URL('./demo-creds.json', import.meta.url), 'utf8'));
  const mp = join(process.env.LOCALAPPDATA, 'ms-playwright');
  const dir = readdirSync(mp).filter((d) => d.startsWith('chromium-')).sort().pop();
  const browser = await chromium.launch({ executablePath: join(mp, dir, 'chrome-win64', 'chrome.exe'), args: ['--use-gl=swiftshader', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto('https://projectsflow.ru/login');
  await page.fill('input[type="email"]', creds.email);
  await page.fill('input[type="password"]', creds.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/app|projects|inbox/, { timeout: 20000 });
  await page.goto('https://projectsflow.ru/inbox');
  await page.waitForTimeout(2500);
  const body = await page.textContent('body');
  console.log('нет «ждёт ответа/ждут ответа»:', !/ждёт ответа|ждут ответа/.test(body));
  await page.screenshot({ path: new URL('./prod-assigned-to-me.png', import.meta.url).pathname.slice(1), fullPage: true });
  await browser.close();
  ```
  Запуск (playwright-core уже в корневых devDependencies; если корневой `npm install` его выпилил — `npm install --no-save playwright-core`):
  ```powershell
  cd c:\www\ProjectsFlow; node <scratchpad>\ui-check.mjs
  ```
  Ожидание: `нет «ждёт ответа/ждут ответа»: true`. Открыть `prod-assigned-to-me.png` (Read) и глазами убедиться: task2 виден в «Поручено мне» карточкой БЕЗ кнопок «Принять»/«Отклонить» и без янтарного бейджа; чекбокс завершения доступен.

- [ ] **Step 7: Telegram — ручная проверка юзером (бот боевой, агент НЕ автоматизирует).** Передать юзеру чеклист и дождаться подтверждения:
  1. В личке бота отправить `/tasks` → экран «По ответственным»: кнопки `👤 Имя (N)` по каждому ответственному с открытыми задачами + `Без ответственного (N)`, внизу вторичная `📁 По проектам`.
  2. Нажать кнопку ответственного → карточки задач (до 12; просроченные → по сроку → без срока), в карточке: **название задачи** (не обрывок описания), проект, `⏰ срок` («сегодня/завтра/дата», просрочка помечена), кнопки «✅ Завершить», «💬 Комментировать», url «Открыть в ProjectsFlow» (deep-link `?task=`).
  3. В привязанной группе отправить голое `@<имя_бота>` (без текста) → то же меню по пространству владельца привязки.
  4. В той же группе `@<имя_бота> проверить создание задачи` → создаётся задача через composer (как раньше), меню НЕ показывается.
  5. Попросить коллегу/со второго аккаунта делегировать задачу привязанному юзеру → TG-уведомление «вам поручена задача» приходит БЕЗ кнопок «Принять/Отказать», с кнопками «✅ Завершить / 💬 Комментировать / Открыть».
  Если юзер недоступен — явно пометить пункт «TG: ждёт ручной проверки юзера» в итоговом отчёте, НЕ считать задачу проваленной.

- [ ] **Step 8: Зачистка demo-данных на проде.** Записать в `<scratchpad>\demo-cleanup.sql` (ownership-chain, FK-off; НИКОГДА не скоупить по `dispatcher_user_id` и не трогать `1q2w3e4r5t6y7u89o0pi@gmail.com` / `admin@projectsflow.ru`):
  ```sql
  SET FOREIGN_KEY_CHECKS=0;
  CREATE TEMPORARY TABLE tmp_u AS SELECT id FROM users WHERE email LIKE 'demo.%';
  CREATE TEMPORARY TABLE tmp_w AS SELECT w.id FROM workspaces w JOIN tmp_u u ON w.owner_user_id=u.id;
  CREATE TEMPORARY TABLE tmp_p AS SELECT p.id FROM projects p JOIN tmp_w w ON p.workspace_id=w.id;
  CREATE TEMPORARY TABLE tmp_t AS SELECT t.id FROM tasks t JOIN tmp_p p ON t.project_id=p.id;
  DELETE tc FROM task_comments tc JOIN tmp_t t ON tc.task_id=t.id;
  DELETE td FROM task_delegations td JOIN tmp_t t ON td.task_id=t.id;
  DELETE td2 FROM task_delegations td2 JOIN tmp_u u ON td2.delegate_user_id=u.id OR td2.delegator_user_id=u.id;
  DELETE tk FROM tasks tk JOIN tmp_t t ON tk.id=t.id;
  DELETE pm FROM project_members pm JOIN tmp_p p ON pm.project_id=p.id;
  DELETE pm2 FROM project_members pm2 JOIN tmp_u u ON pm2.user_id=u.id;
  DELETE pr FROM projects pr JOIN tmp_p p ON pr.id=p.id;
  DELETE wm FROM workspace_members wm JOIN tmp_w w ON wm.workspace_id=w.id;
  DELETE wm2 FROM workspace_members wm2 JOIN tmp_u u ON wm2.user_id=u.id;
  DELETE wi FROM workspace_invites wi JOIN tmp_w w ON wi.workspace_id=w.id;
  DELETE ws FROM workspaces ws JOIN tmp_w w ON ws.id=w.id;
  DELETE n FROM notifications n JOIN tmp_u u ON n.user_id=u.id;
  DELETE s FROM sessions s JOIN tmp_u u ON s.user_id=u.id;
  DELETE us FROM users us JOIN tmp_u u ON us.id=u.id;
  SET FOREIGN_KEY_CHECKS=1;
  SELECT COUNT(*) AS remaining_demo_users FROM users WHERE email LIKE 'demo.%';
  ```
  Запуск и проверка:
  ```powershell
  Get-Content <scratchpad>\demo-cleanup.sql -Raw | plink -ssh -P 22 -pw "<SSH_PASSWORD>" -hostkey "SHA256:NwU1dGS29JAjs2K5LfEtu3DLFgg04yo7ZEA4iOGkM6E" -batch projectsflow@projectsflow.ru "mysql -u projectsflow -p'<DB_PASSWORD>' projectsflow"
  ```
  Ожидание: последняя строка вывода `remaining_demo_users` = `0`. Затем локальная уборка: удалить `<scratchpad>\prod-verify.mjs`, `ui-check.mjs`, `demo-creds.json`, `demo-cleanup.sql`, `prod-assigned-to-me.png`; убедиться, что Chromium из Step 6 закрыт (скрипт вызывает `browser.close()`; если процесс завис — `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ? { $_.CommandLine -match 'swiftshader' } | % { Stop-Process -Id $_.ProcessId -Force }`). Коммитов в этой задаче нет — итог: отчёт юзеру со статусами всех шагов (включая «TG: подтверждено юзером / ждёт проверки»).


---

## Приложение: сводка новых интерфейсов между секциями

```
[A-db-domain] server/src/domain/workspace/WorkspaceMember.ts: export type WorkspaceRole = 'owner' | 'editor' | 'viewer' (расширен с 'owner'|'member'; WorkspaceMember без изменений)
[A-db-domain] server/src/infrastructure/db/schema.ts: workspaceMembers.role = mysqlEnum('role', ['owner','editor','viewer']).notNull().default('editor')
[A-db-domain] server/src/infrastructure/db/schema.ts: export const workspaceInvites = mysqlTable('workspace_invites', { id, workspaceId: char(36) NOT NULL, role: mysqlEnum(['editor','viewer']).default('editor'), token: char(64), email: varchar(255)|null, expiresAt: timestamp NOT NULL, acceptedAt: timestamp|null, acceptedByUserId: char(36)|null, createdByUserId: char(36) NOT NULL, createdAt }) + uq_ws_invites_token(token), idx_ws_invites_workspace(workspaceId), idx_ws_invites_expires(expiresAt)
[A-db-domain] server/src/infrastructure/db/schema.ts: export type WorkspaceInviteRow = typeof workspaceInvites.$inferSelect; export type NewWorkspaceInviteRow = typeof workspaceInvites.$inferInsert
[A-db-domain] server/src/domain/workspace/WorkspaceInvite.ts: export type WorkspaceInviteRole = 'editor' | 'viewer'; export type WorkspaceInvite = { id; workspaceId; role: WorkspaceInviteRole; token; email: string|null; expiresAt: Date; acceptedAt: Date|null; acceptedByUserId: string|null; createdByUserId: string; createdAt: Date }
[A-db-domain] db/110_workspace_member_roles.sql — workspace_members.role ENUM('owner','editor','viewer'), member→editor
[A-db-domain] db/111_workspace_invites.sql — CREATE TABLE workspace_invites (FK workspace_id → workspaces ON DELETE CASCADE)
[A-db-domain] db/112_unified_membership_backfill.sql — бэкфилл workspace_members из project_members не-inbox проектов (INSERT IGNORE, высшая роль owner/editor→editor, иначе viewer) + task_delegations pending/pending_invite→accepted с responded_at=COALESCE(responded_at,NOW())
[A-db-domain] Побочно (ripple Task 1, для сведения соседних секций): WorkspaceService.addMember дефолт роли 'editor'; changeMemberRole guard 'последний owner' срабатывает на ЛЮБОЕ понижение (role !== 'owner'); presentation/workspaces/schemas.ts z.enum(['owner','editor','viewer']); ChatRoomRow.role/ChatRoomSummary.role: WorkspaceRole; HubMembershipSync.addMember(…, role: WorkspaceRole) и добавляет 'editor'
[B-server-workspace] workspaceMembershipView.ts: deriveMembership(project: ProjectAccessRow, userId: string, wsMember: WorkspaceMemberAccessRow|null): ProjectMembership|null; deriveProjectMembers(project, wsMembers): ProjectMembership[]; deriveOwnersCount(project, wsOwnerCount): number
[B-server-workspace] DrizzleProjectMemberRepository — интерфейс ProjectMemberRepository без изменений, но читает через projects.workspace_id→workspace_members; add/setNotificationPrefs/setFavorite/reorder* стали upsert-ами ленивых строк project_members
[B-server-workspace] domain/workspace/WorkspaceInvite.ts: WorkspaceInviteRole = 'editor'|'viewer'; type WorkspaceInvite
[B-server-workspace] domain/workspace/errors.ts += WorkspaceInviteNotFoundError, WorkspaceInviteExpiredError, WorkspaceInviteAlreadyUsedError (errorHandler: 404 invite_not_found / 410 invite_expired / 410 invite_used)
[B-server-workspace] schema.ts += workspaceInvites (таблица workspace_invites), WorkspaceInviteRow
[B-server-workspace] application/workspace/WorkspaceInviteRepository.ts: interface { create; getById; findByToken; listPendingByWorkspace(workspaceId, now); markAccepted; delete } + DrizzleWorkspaceInviteRepository
[B-server-workspace] emails/workspaceInviteEmail.ts: renderWorkspaceInviteEmail({to, workspaceName, actorDisplayName, role, acceptUrl}): EmailMessage
[B-server-workspace] Notification.ts += WorkspaceInvitePayload { type:'workspace_invite'; workspaceId; workspaceName; role; inviteId; token; actorUserId; actorDisplayName }
[B-server-workspace] CreateWorkspaceInvite.execute({workspaceId, actorUserId, role, email}) → {invite}; AcceptWorkspaceInvite.execute(token, userId) → {workspaceId}; ListWorkspaceInvites.execute(workspaceId, actorUserId) → WorkspaceInvite[]; DeleteWorkspaceInvite.execute(workspaceId, actorUserId, inviteId) → void
[B-server-workspace] GetInviteByToken: InvitePreview = { kind: 'workspace'|'project'; targetName; role; inviterDisplayName; inviteEmail; expiresAt } (HTTP-превью дублирует projectName=targetName для совместимости)
[B-server-workspace] AcceptProjectInvite.execute(token, userId) → {projectId} — легаси-токен зачисляет в workspace_members пространства проекта
[B-server-workspace] REST: GET/POST/DELETE /api/workspaces/:id/invites (POST → 201 {invite:{..., token, url}}); POST /api/invites/:token/accept → {workspaceId}|{projectId}; PATCH /api/workspaces/:id/members/:userId {role:'owner'|'editor'|'viewer'}; удалены /api/projects/:id/invites*
[B-server-workspace] ResolveProjectJoinRequest.execute(joinRequestId, actorUserId, accept) — accept = addMember(ws проекта, requester, 'editor')
[B-server-workspace] WorkspaceService: Deps без projectMembers; addMember(..., role: WorkspaceRole = 'editor'); changeMemberRole защищает последнего owner при role !== 'owner'; moveProject без копирования участников; HubMembershipSync удалён
[C-server-delegation] Инвариант: CreateTask/DelegateExistingTask/ReassignTaskDelegation создают делегацию status:'accepted'; DrizzleTaskDelegationRepository.create пишет responded_at=NOW() при status==='accepted'
[C-server-delegation] REST /api/delegations: остаются только GET /assigned-to-me, GET /delegated-to-others, DELETE /:id (withdraw), POST /:id/relinquish — /pending, /:id/accept, /:id/decline и POST /:taskId/invite-delegate удалены
[C-server-delegation] TaskDelegationRepository: без listPendingForDelegate и типа DelegationWithTaskInfo
[C-server-delegation] AssignedTaskView.canModify = isInbox || can(delegateRole,'move_task') — без гейта по статусу делегации
[C-server-delegation] AppDeps.delegations (http.ts) = { withdraw, relinquish, listAssignedToMe, listDelegatedToOthers, assignToProject, delegateExisting, reassignDelegation }
[C-server-delegation] RelinquishTaskDelegation Deps = { delegations, tasks, users, notifications, email, idGen, appUrl }; на relinquish создателю уходит task_delegation_resolved (resolution:'declined', actor=делегат) + email renderDelegationDeclinedEmail («снял(а) с себя задачу»)
[C-server-delegation] WorkspaceInvitePayload (server domain/notifications/Notification.ts): { type:'workspace_invite'; workspaceId; workspaceName; role:'editor'|'viewer'; inviteId; token; actorUserId; actorDisplayName } — создаёт CreateWorkspaceInvite (секция workspace), клиентское зеркало — секция E
[C-server-delegation] Actionable-набор уведомлений (GetActivityFeed.ACTIONABLE_TYPES и DrizzleNotificationRepository.countActionableUnread) = {workspace_invite, project_invite, join_request}
[C-server-delegation] TelegramComposerService Deps без accept/decline/assignToProject; finalize с делегатом создаёт задачу сразу в draft.projectId; карточка делегату с taskActionKeyboard(taskId) (nd:/nc:); классы AcceptTaskDelegation/DeclineTaskDelegation удалены; легаси da:/dd: гаснут молча
[D-telegram-menu] server/src/application/telegram/assigneeBrowse.ts: type AssigneeBrowseDeps = { members: Pick<ProjectMemberRepository,'listProjectsForUser'>; tasks: Pick<TaskRepository,'listByProject'>; delegations: Pick<TaskDelegationRepository,'listActiveForTasks'> }
[D-telegram-menu] buildAssigneeMenu(deps: AssigneeBrowseDeps, userId: string): Promise<AssigneeMenu | null> — null = нет проектов; AssigneeMenu = { text: string; keyboard: InlineKeyboardMarkup }; callback'и кнопок ba:<userId> / ba:none / bt:root
[D-telegram-menu] buildAssigneeTaskCards(deps: AssigneeBrowseDeps, viewerUserId: string, assigneeUserId: string | null, appUrl: string, now?: Date): Promise<AssigneeTaskCards>; AssigneeTaskCards = { assigneeName: string | null; totalCount: number; cards: AssigneeTaskCard[] }; AssigneeTaskCard = { taskId: string; projectId: string; text: string; keyboard: InlineKeyboardMarkup }
[D-telegram-menu] константы ASSIGNEE_MENU_LIMIT = 12, ASSIGNEE_CARDS_LIMIT = 12 (assigneeBrowse.ts)
[D-telegram-menu] HandleTelegramWebhook.Deps: новый ключ delegations: Pick<TaskDelegationRepository,'listActiveForTasks'> (wiring в index.ts: delegations: taskDelegationRepo)
[D-telegram-menu] HandleTelegramWebhook (private, переиспользуется внутри секции): sendAssigneeMenu(chatId: number, ownerUserId: string): Promise<void>; sendProjectList(chatId: number, userId: string): Promise<void>; handleAssigneeCallback(cq: TelegramCallbackQuery): Promise<void>; handleGroupAssigneeMenu(chatId: number): Promise<void>
[D-telegram-menu] callback-протокол TG: новый префикс ba:<userId>|ba:none (39 байт ≤ 64); bt:root — корень браузера «По проектам» (бывший /tasks); карточки ba: регистрируются в telegram_task_messages (reply = комментарий); sendReturningId получает 3-й опциональный параметр replyMarkup?: InlineKeyboardMarkup
[E-client] client domain: WorkspaceInviteRole = 'editor' | 'viewer'; WorkspaceInvite (id, workspaceId, role, email, expiresAt, acceptedAt, acceptedByUserId, createdByUserId, createdAt, token?, url?) — @/domain/workspace/WorkspaceInvite
[E-client] client application: CreateWorkspaceInviteInput = { role: WorkspaceInviteRole; email: string | null }; WorkspaceRepository += listInvites(workspaceId): Promise<WorkspaceInvite[]>, createInvite(workspaceId, input): Promise<WorkspaceInvite>, deleteInvite(workspaceId, inviteId): Promise<void>
[E-client] client domain: WorkspaceRole widened to 'owner' | 'editor' | 'viewer' (Task 22; HttpWorkspaceRepository нормализует legacy 'member' → 'editor')
[E-client] InviteDialog new props: { open: boolean; onClose: () => void; workspaceId?: string; onCreated?: (invite: WorkspaceInvite) => void } — приглашает в пространство (fallback: useCurrentWorkspace)
[E-client] client domain: InvitePreview { kind: 'workspace'|'project'; targetName; role; inviterDisplayName; inviteEmail; expiresAt }, InviteAcceptResult { workspaceId: string|null; projectId: string|null } — @/domain/invite/InvitePreview; InviteRepository.getPreview→InvitePreview, accept→InviteAcceptResult
[E-client] client notifications union += WorkspaceInvitePayload (type 'workspace_invite': workspaceId, workspaceName, role, inviteId, token, actor*) и ChatMentionPayload (type 'chat_mention': workspaceId, workspaceName, messageId, messageSeq, messageExcerpt, actor*)
[E-client] NotificationActions: -= handleAcceptDelegation/handleDeclineDelegation, += handleAcceptWorkspaceInvite(n)
[E-client] OPEN_CHAT_EVENT = 'pf:open-chat' — @/presentation/chat/openChatEvent (Sidebar/CommunicationPanel слушают, клик по chat_mention диспатчит)
[E-client] ProjectRepository -= listInvites/createInvite/deleteInvite/CreateInviteInput (Task 20); TaskRepository -= inviteDelegate; TaskDelegationRepository = { listAssignedToMe; listDelegatedToOthers; withdraw; relinquish } (минус listMyPending/PendingDelegation/accept/decline)
[E-client] DelegationBadge рендерит только delegation.status === 'accepted' (props без изменений)
[F-verify] (нет новых интерфейсов кода — секция верификационная)
[F-verify] Артефакт-скрипты (scratchpad, вне репо): prod-verify.mjs — сквозной API-прогон demo-сценария на https://projectsflow.ru; ui-check.mjs — скриншот «Поручено мне» под demo-делегатом; demo-cleanup.sql — ownership-chain зачистка users WHERE email LIKE 'demo.%' (включая новую таблицу workspace_invites)
[F-verify] Критерий готовности всей фичи: cd server && npm test (fail 0) + npm run typecheck + npm run lint + npm run build зелёные; rg-свипы HubMembershipSync|AcceptTaskDelegation|DeclineTaskDelegation|InviteAndDelegateTask|listPendingForDelegate|da:/dd: → 0 в server/src+client/src; pending_invite/revertToUserId только в schema.ts + domain/task/TaskDelegation.ts (+ toDomain-маппинг репозитория)
```

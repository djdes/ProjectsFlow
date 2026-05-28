# Inbox: чекбокс выполнения + делегирование задач

**Дата:** 2026-05-27
**Тип:** feature spec (две связанные подсистемы)
**Статус:** утверждено пользователем, готово к плану

## Контекст

Сейчас «Входящие» — это inbox-project (`projects.is_inbox=true`) с обычной task-инфраструктурой
(`status` ENUM, KanbanBoard, TaskListView). Done-задачи зачёркиваются в List-view, но в UI
нет одного-клика «выполнено», и нет способа делегировать задачу другому участнику без
привязки её к конкретному проекту.

Эта spec вводит две связанные подсистемы:

- **Phase A.** Чекбокс «выполнено» слева в inbox + toggle «Скрыть выполненные».
- **Phase B.** Делегирование inbox-задачи одному из участников моих общих проектов;
  in-app + email уведомления; accept/decline у делегата; перенос задачи в проект.

Подсистемы можно катить независимо (Phase A — UI-only, Phase B — full-stack). План разобьёт
их на две фазы; merge — двумя PR'ами.

## Out of scope

- Делегирование задач, которые уже привязаны к реальному проекту (только inbox).
- Авто-приглашение делегата в проект при assign-to-project.
- Telegram-уведомления о делегировании (есть инфра, добавим отдельным PR).
- Bulk-делегирование, history view, аналитика делегирований.
- Делегирование нескольким людям одновременно (one-to-one only; см. «Решения» ниже).

## Решения (зафиксированы в брейншторме)

1. **One-to-one делегирование.** Одна задача = один делегат. Чтобы раздать троим —
   создаются три задачи. Это убирает race-conditions и неоднозначность «кто делает».
2. **Visibility через ассоциацию.** Задача физически живёт в inbox создателя. Делегат
   видит её через `task_delegations`-таблицу. Один источник истины для `status`.
3. **Reject → возврат в inbox создателя** как обычная задача + in-app notification
   «Х отклонил». Никаких permanent «отклонённых» строк в UI.
4. **Чекбокс — только для inbox.** Не показываем в проектных Kanban'ах (там drag-drop).
   Не показываем для задач с `delegatedToAgent=true` (там Ralph ведёт, прерывать нельзя).
5. **Чекбокс мапится в `status`.** Tick → `status='done'`. Untick → `status='todo'`.
   Предыдущий статус не помним (для inbox это OK — статусы кроме todo/done там почти
   не используются).
6. **После accept** оба (создатель и делегат) видят и редактируют задачу. Удалить — только
   создатель. Это требует расширить authorization в существующих `move`/`update`.
7. **Самоделегирование запрещено** (фильтр в дропдауне).
8. **Cancel pending делегирования** (withdraw) — да, создателю кнопка «Отозвать» до accept'а.
   Уведомление делегату при withdraw не шлём.
9. **Assign-to-project**: задача мигрирует в реальный проект → исчезает у обоих из inbox-view;
   delegation row → `archived`; делегат получает email «задача перенесена». Если делегат
   не member проекта — теряет доступ полностью (auto-invite не делаем).

## Phase A — Чекбокс + Скрыть выполненные

### Поведение

- В каждой строке inbox (TaskListView row, KanbanCard) — круглый чекбокс слева от текста.
- Виден только если `task.projectId === inbox.id` **и** `task.delegatedToAgent === false`.
- Click: optimistic toggle. Done → перечёркнутый text, чекбокс заливается; un-tick →
  возвращается в `todo`.
- Под капотом — `taskRepository.move(projectId, taskId, { targetStatus, beforeTaskId: null, afterTaskId: lastTaskIdInTarget })`.
- В шапке Inbox справа от ViewToggle — toggle **«Скрыть выполненные»** с иконкой `EyeOff`.
  Сохраняется в `localStorage` под ключом `inbox.hide-done` (boolean).
- Фильтр hide-done применяется в `TaskListView` и `KanbanBoard` (в Kanban — скрывает done-карточки в done-колонке, сама колонка остаётся).

### Затрагиваемые файлы

- `client/src/presentation/components/tasks/InboxCheckbox.tsx` (новый).
- `client/src/presentation/components/tasks/TaskListView.tsx` — рендер чекбокса в `TaskListRow`,
  фильтр hide-done.
- `client/src/presentation/components/tasks/KanbanCard.tsx` — рендер чекбокса в карточке
  (если показывается для inbox).
- `client/src/presentation/components/tasks/KanbanBoard.tsx` — фильтр hide-done.
- `client/src/presentation/pages/InboxPage.tsx` — `HideDoneToggle` рядом с `ViewToggle`,
  прокидывает prop `hideDone` в KanbanBoard/TaskListView.

### Без server-side изменений

Phase A полностью на клиенте.

## Phase B — Делегирование во входящие

### Поведение

**Создание делегированной задачи:**

1. В TaskDrawer (create mode для inbox) и в `QuickAddTodo` (только если inbox) — под textarea
   дропдаун **«Делегировать»** с дефолтом «Никому». Опции — люди из shared-проектов,
   без меня.
2. При submit с `delegateUserId !== null`: backend создаёт `tasks` row в inbox создателя +
   `task_delegations` row со `status='pending'` атомарно. Публикует in-app notification +
   шлёт email делегату.
3. В UI создателя задача появляется с ярлыком **«Делегировано: Иван (ожидает)»**.

**Делегат получает:**

1. In-app notification с типом `task_delegation` и кнопками «Принять» (зелёная) /
   «×Отклонить» (серая) в `NotificationsPage`.
2. Email с теми же двумя кнопками. Кнопка «Принять» делает POST на эндпоинт через
   ссылку с `?accept=<token>` или просто ведёт на `/inbox#delegation=<id>` (см. ниже про
   email accept-flow).
3. В разделе **Входящие** делегата — **отдельный блок сверху «Делегировано мне»** (только
   если есть pending). Каждая строка: задача-excerpt + «Принять» / «×Отклонить».

**Email accept-flow.** Простейший вариант: кнопка в письме ведёт на `<APP_URL>/inbox#delegation=<id>`.
Пользователь логинится (если нужно), попадает на inbox, видит блок «Делегировано мне» —
с подсветкой нужной строки. **Не делаем magic-token accept** (избегаем сценария, когда
любой обладатель письма принимает за пользователя).

**Accept:**

- `task_delegations.status = 'accepted'`, `responded_at = NOW()`.
- У создателя ярлык меняется на **«Делегировано: Иван (принято)»**.
- У делегата задача появляется в обычном списке inbox с ярлыком **«От: Я-Создатель»**.
- Создатель получает in-app notification `task_delegation_resolved` с
  `resolution: 'accepted'`. Email — нет (избегаем спама; статус и так виден сразу в UI).

**Decline:**

- `task_delegations.status = 'declined'`, `responded_at = NOW()`.
- У создателя ярлык «Делегировано…» исчезает (задача снова обычная inbox-задача).
- Создатель получает in-app notification `task_delegation_resolved` с
  `resolution: 'declined'`. Email — да (важная информация что нужно перераспределить).

**Withdraw создателем (cancel pending):**

- Только пока `status='pending'`. В UI создателя на карточке — кнопка «Отозвать».
- `task_delegations.status = 'withdrawn'`. Задача снова обычная inbox-задача.
- Уведомление делегату не шлём (он ещё не действовал).

**Видимость и редактирование после accept:**

- Оба видят задачу. Оба могут менять `description`, attachments, comments, чекбокс
  выполнено.
- Только создатель может удалить.
- Last-write-wins на description (стандартное поведение).

**Assign-to-project:**

- Inbox-задача (`tasks.project_id === inboxId`) может быть перенесена в реальный проект
  через **новый селект «Проект»** в шапке TaskDrawer (edit mode, только для inbox-задач).
- Submit: `taskRepository.assignToProject(taskId, targetProjectId)`. Server обновляет
  `tasks.project_id`, archive's любую активную delegation (`status='archived'`).
- Если был активный delegate — он получает email и in-app notification
  `task_assigned_to_project`.
- Если делегат — member target проекта: видит задачу в проекте обычным образом.
- Если делегат не member: теряет доступ. Создатель может потом invite его, если нужно.

### Модель данных

**Миграция `db/039_task_delegations.sql`:**

```sql
-- Делегирование inbox-задач. One-to-one: одна активная (pending|accepted)
-- делегация на задачу. Архивные/отклонённые остаются для истории.
CREATE TABLE task_delegations (
  id              CHAR(36)    NOT NULL,
  task_id         CHAR(36)    NOT NULL,
  delegate_user_id CHAR(36)   NOT NULL,
  status          ENUM('pending','accepted','declined','withdrawn','archived')
                  NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at    TIMESTAMP   NULL,
  PRIMARY KEY (id),
  KEY idx_task_status (task_id, status),
  KEY idx_delegate_status (delegate_user_id, status),
  CONSTRAINT fk_td_task FOREIGN KEY (task_id)
    REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_td_user FOREIGN KEY (delegate_user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Инвариант «не более одной активной (pending|accepted)» проверяем в application
(`INSERT` обёрнут транзакцией с `SELECT ... FOR UPDATE` на task row).

**Domain `TaskDelegation`** (parallel на client/ и server/):

```ts
export type TaskDelegationStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'archived';

export type TaskDelegation = {
  readonly id: string;
  readonly taskId: string;
  readonly delegateUserId: string;
  readonly delegateDisplayName: string;
  readonly creatorUserId: string;
  readonly creatorDisplayName: string;
  readonly status: TaskDelegationStatus;
  readonly createdAt: Date;
  readonly respondedAt: Date | null;
};
```

В `Task` добавляем поле `delegation: TaskDelegation | null` — join'ом в list-endpoint.

### Server use-cases (новые)

| Use-case | Назначение | Авторизация |
|---|---|---|
| `CreateInboxTaskWithDelegation` | расширение CreateTask: + delegateUserId? | caller = owner inbox |
| `AcceptTaskDelegation` | sets accepted | caller = delegate |
| `DeclineTaskDelegation` | sets declined | caller = delegate |
| `WithdrawTaskDelegation` | sets withdrawn | caller = creator, status=pending |
| `ListMyPendingDelegations` | для верхнего блока inbox | caller = delegate |
| `AssignInboxTaskToProject` | перенос task в проект | caller = creator |
| `ListSharedMembers` | люди из моих shared проектов | caller = self |

**Authorization update в существующих use-cases:**

- `MoveTask`, `UpdateTask`, `Create/Update/Delete TaskComment`, `Upload/Delete TaskAttachment`
  для inbox-задачи с активной accepted delegation — разрешить и creator'у, и delegate'у.
- `DeleteTask` — только creator.

Все правила собираем в одну helper-функцию `canModifyTask(userId, task, delegation?)` в
`server/src/domain/task/permissions.ts` (новый файл, по образцу `project/permissions.ts`).

### Notifications

Расширяем `NotificationPayload` discriminated union (mirrored на client/server):

```ts
// Новые типы:

export type TaskDelegationPayload = {
  type: 'task_delegation';
  delegationId: string;
  taskId: string;
  taskExcerpt: string;          // первые ~120 символов description
  actorUserId: string;          // creator
  actorDisplayName: string;
};

export type TaskDelegationResolvedPayload = {
  type: 'task_delegation_resolved';
  delegationId: string;
  taskId: string;
  taskExcerpt: string;
  resolution: 'accepted' | 'declined';
  delegateUserId: string;
  delegateDisplayName: string;
};

export type TaskAssignedToProjectPayload = {
  type: 'task_assigned_to_project';
  taskId: string;
  taskExcerpt: string;
  projectId: string;
  projectName: string;
  actorUserId: string;          // creator
  actorDisplayName: string;
};
```

Email-шаблоны (`server/src/application/notifications/emails/`):

- `delegationEmail.ts` — кнопки «Принять» / «Отклонить» (ведут на `/inbox#delegation=<id>`).
- `delegationDeclinedEmail.ts` — только для resolution='declined' (accepted — без email).
- `taskAssignedToProjectEmail.ts` — для делегата при assign-to-project.

`NotificationPrefs` (db/024) уже имеет per-member email-prefs. Для inbox-уведомлений
prefs хранятся global для пользователя (отдельный механизм — пока всегда шлём email,
unsubscribe через MarkAllRead не критичен в MVP).

### Endpoints

| Method | Path | Назначение |
|---|---|---|
| POST | `/api/projects/:inboxId/tasks` | extend body: `delegateUserId?: string` |
| POST | `/api/tasks/:taskId/assign-to-project` | move inbox-task в проект, body: `{ targetProjectId }` |
| GET | `/api/delegations/pending` | мои pending как делегата |
| POST | `/api/delegations/:id/accept` | |
| POST | `/api/delegations/:id/decline` | |
| DELETE | `/api/delegations/:id` | withdraw (creator-only, status=pending) |
| GET | `/api/users/me/shared-members` | список людей из моих shared проектов |

Все эндпоинты `server/src/presentation/delegations/routes.ts` (новый файл).

### Client-side изменения

**Новые компоненты:**

- `presentation/components/tasks/InboxCheckbox.tsx` — Phase A.
- `presentation/components/tasks/PendingDelegationsBlock.tsx` — блок «Делегировано мне» сверху.
- `presentation/components/tasks/DelegateSelect.tsx` — dropdown в форме создания (single-select).
- `presentation/components/tasks/DelegationBadge.tsx` — ярлык «Делегировано: Х» / «От: Х».
- `presentation/components/tasks/AssignToProjectSelect.tsx` — селект в шапке TaskDrawer.

**Application ports (новые):**

- `application/task/TaskDelegationRepository.ts` — `listMyPending`, `accept`, `decline`,
  `withdraw`.
- Extend `ProjectRepository`: `listSharedMembers()`.
- Extend `TaskRepository.create`: `CreateTaskInput.delegateUserId?: string`.
- New `TaskRepository.assignToProject(taskId, targetProjectId)`.

**Infrastructure (client):**

- HTTP-адаптеры в `client/src/infrastructure/http/`: новый `HttpTaskDelegationRepository`,
  расширить `HttpTaskRepository` (поле `delegateUserId` в create, новый `assignToProject`),
  `HttpProjectRepository` (`listSharedMembers`).
- Если в репо есть mock-fallback'и — расширить параллельно.

**Изменения существующих компонентов:**

- `InboxPage.tsx` — `HideDoneToggle` + рендер `PendingDelegationsBlock` сверху.
- `TaskListView.tsx` — `InboxCheckbox`, `DelegationBadge`, фильтр hide-done.
- `KanbanCard.tsx` — `InboxCheckbox`, `DelegationBadge` (только если projectIsInbox).
- `KanbanBoard.tsx` — пропс `hideDone` для фильтрации.
- `QuickAddTodo.tsx` — `DelegateSelect` под textarea (только если inbox).
- `TaskDrawer.tsx` (create mode для inbox) — `DelegateSelect`.
- `TaskDrawer.tsx` (edit mode для inbox-задач) — `AssignToProjectSelect` в шапке.
- `NotificationsPage.tsx` — рендер трёх новых типов notifications, кнопки accept/decline.

## Архитектурные правила Clean Architecture (проверка)

- `domain/task/TaskDelegation.ts` — entity, no deps.
- `application/task/TaskDelegationRepository.ts` — port, deps on domain.
- `infrastructure/mock/MockTaskDelegationRepository.ts` — adapter, deps on domain+application.
- DI-контейнер `infrastructure/di/container.tsx` — регистрирует mock.
- Презентация — только через `useContainer()`. Никаких прямых импортов из `infrastructure/mock/`.

## План реализации (укрупнённо)

**Phase A** (UI-only, 1 PR):
1. `InboxCheckbox` component.
2. Интеграция в `TaskListRow` + `KanbanCard`.
3. `HideDoneToggle` + фильтр в `InboxPage`/`TaskListView`/`KanbanBoard`.
4. Smoke-test в dev-сервере.

**Phase B** (full-stack, 1 PR):
1. Миграция `db/039_task_delegations.sql`.
2. Server domain `TaskDelegation` + `permissions.ts`.
3. Server use-cases (Create/Accept/Decline/Withdraw/AssignToProject/ListPending/ListSharedMembers).
4. Notification types + email-шаблоны + publisher hooks.
5. Endpoints + routes.
6. Authorization update в существующих use-cases (move/update/comment/attachment).
7. Client domain + application port + mock-адаптер.
8. UI: `PendingDelegationsBlock`, `DelegateSelect`, `DelegationBadge`,
   `AssignToProjectSelect`.
9. Интеграция в `InboxPage`, `QuickAddTodo`, `TaskDrawer`, `NotificationsPage`.
10. Smoke-test полного flow в dev-сервере (через mock-адаптеры).

## Риски и митигация

- **Authorization-расширение** в существующих use-cases может задеть unrelated flow.
  Митигация: helper `canModifyTask` с unit-тестами; явные `assert` в use-case'ах.
- **Race condition** на одновременном accept/decline. Митигация: транзакция с
  `SELECT ... FOR UPDATE` на task row; check status='pending' перед update.
- **Email spam** при множественных делегированиях. Митигация: для accepted — email не
  шлём; для declined — шлём (важная инфо).
- **Backend полноценный** (CLAUDE.md устарел; в `server/src/` уже работающий Express
  с Drizzle/SMTP/NotificationHub/SSE). Phase B делаем полноценно: миграция + drizzle
  schema + use-cases + routes + email через SmtpEmailSender. UI ходит через HTTP-адаптеры,
  не через mock — но если в `infrastructure/` найдём mock-fallback, обновим и его.

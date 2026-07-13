# «Мои задачи» во «Входящих» + чистка концепта «владелец проекта»

Дата: 2026-07-13. Статус: решения юзера получены (обе фичи — «да»). Сервер + клиент.
Продолжение единого пространства ([[unified-workspace-instant-delegation]]).

## Контекст (из разбора wf_d6e4215e)

- «Входящие → Для меня» грузится ТОЛЬКО из `task_delegations` (delegate=me, status IN('accepted')).
  Отдельного поля «ответственный» нет — «ответственный=я» = accepted self-delegation.
- `CreateTask` СЕЙЧАС запрещает self (`CreateTask.ts:164` `throw new SelfDelegationError()`), а
  `DelegateExistingTask` self РАЗРЕШАЕТ (accepted, без уведомления себе; `DelegateExistingTask.ts:44-92`).
- Доски ИМЕНОВАННЫХ проектов показывают ВСЕ задачи независимо от делегации (фильтр
  `!delegation` только для inbox-доски, `KanbanBoard.tsx:537-539`). → self-delegation задачи в
  именованном проекте НЕ убирает её с доски проекта. Безопасно.
- Роль на Обзоре = `workspace_members.role` (`workspaceMembershipView.ts:32-42`);
  `projects.owner_id` для не-inbox в отображении/правах роли НЕ участвует. Поэтому создатель
  проекта в общем пространстве Дениса показан «редактором», а «владельцем» — Денис (owner
  пространства). db/112 забэкфиллил owner-не-пространства → editor.
- `projects.owner_id` ещё нужен: inbox-приватность, git-PAT грантор, монитор-нотификации,
  commit-sync автор, перенос проекта, `isOwner`-маркер, admin. НЕ удаляем.
- Побочный баг: `routes.ts:129-147` fallback (`getProject.execute`) отдаёт `role='owner'`
  захардкоженно → по прямой ссылке любой видит danger zone (сервер при DELETE всё равно
  отклонит, но UI врёт).

## Fix A — задачи, где ты ответственный, попадают в «Для меня»

Решение юзера: ДА, единый список «мои задачи».

### A1. Сервер: разрешить self-delegation в CreateTask
`server/src/application/task/CreateTask.ts` `delegateOrThrow` (~163): по образцу
`DelegateExistingTask.execute`:
- `const isSelf = delegateUserId === creatorUserId;` — убрать `throw SelfDelegationError` для self.
- Для isSelf пропустить проверку членства делегата (себя нет в shared-members; своё право уже
  проверено `requireProjectAccess('delegate_task')` для не-inbox; для inbox — `project.ownerId===creator`).
- Создать делегацию `status:'accepted'`, `delegatorUserId=creator`. Для isSelf — БЕЗ уведомления.
- Сверься с `DelegateExistingTask.ts:44-92` — там точная логика веток inbox/named + isSelf; повтори её.
- `SelfDelegationError` можно оставить в кодовой базе (вдруг ещё где-то), но CreateTask его для self
  больше НЕ кидает. Проверь, что никакой тест не ждёт SelfDelegationError от CreateTask (обнови/удали).

### A2. Клиент: композер по умолчанию ставит ответственным СЕБЯ (для общих проектов)
`client/src/presentation/components/tasks/TaskComposer.tsx` (селектор `DelegateSelect` рендерится
при `isInbox || isShared`, `:490-498`; `delegateUserId` стейт):
- Инициализировать `delegateUserId` значением текущего юзера (`user.id`) когда `isShared && !isInbox`
  (именованный общий проект) — чтобы новая задача по умолчанию «на мне» → попала в «Для меня».
  Для `isInbox` оставить `null` (inbox-задачи живут на inbox-доске, само-делегирование увело бы их
  в блок «Для меня» — не нужно).
- Юзер может сменить ответственного на другого (делегирование) или очистить (нет ответственного).
- После submit сбрасывать обратно к дефолту (self для shared) — как остальные поля композера.
- Проверь, доступен ли `user` в композере (`useCurrentUser`); если нет — прокинуть/взять из хука.
- НЕ бэкфилим существующие задачи. Только новые. (Юзеру «шор» задачу в «Для меня» вернём отдельно
  разово ИЛИ он перетащит её на свой аватар — существующий путь DelegateExistingTask self.)

### A3. Проверки
- Именованный общий проект: создал задачу (дефолт-ответственный=я) → появляется в «Для меня» И
  остаётся на доске проекта (с бейджем-аватаром «ответственный=я»).
- Делегировал другому в композере → у него в «Для меня», на доске его аватар. В «Другим» у меня.
- Очистил ответственного → нет делегации, не в «Для меня» (как раньше).
- «Другим» (`listDelegatedToOthers`) НЕ показывает self-делегации (там есть `ne(delegator, me)` —
  подтверждено). Проверь, что так и осталось.

## Fix B — «владелец проекта»: создатель может удалять; ярлык «Создал», не «Владелец»

Решение юзера: владелец пространства (Денис) + создатель могут удалять/управлять; слово
«владелец» с уровня проекта убрать, показывать «Создал: <имя>».

### B1. Сервер: создатель проекта получает owner-роль на СВОЁМ проекте
`server/src/infrastructure/repositories/workspaceMembershipView.ts` `projectRowVisibility`/
`deriveMembership` (~32-42): для НЕ-inbox — сейчас `role = wsMember.role`. Добавить: если
`project.ownerId === userId` → `role = 'owner'` (создатель = owner своего проекта, поверх
ws-роли editor). Это даёт создателю право `delete_project`/danger zone (`permissions.ts:59`),
плюс владелец пространства уже owner. Синхронно проверь ВСЕ места, где роль деривится
одинаково (`deriveMembership`, `listByProject` для members-DTO, любые дубли предиката) — чтобы
create-task/move-права и members-список были консистентны. НЕ трогай inbox-ветку.
- Убедись: `DrizzleProjectMemberRepository.listByProject` и `findForProject` дают ту же
  апгрейд-логику (иначе роль разъедется между «мой доступ» и «список участников»).

### B2. Клиент: не показывать «Владелец» как роль проекта; показать «Создал»
- `client/src/presentation/components/project/TeamSection.tsx` (`ROLE_LABEL`, `:139`, `:41`) и
  `MembersHoverPanel.tsx` (`:99`): НЕ бейджить project-роль словом «Владелец». Роли участников
  показывать как «Редактор»/«Наблюдатель». Создателя (флаг `isOwner` в members-DTO, из
  `projects.owner_id`) пометить нейтрально «Создал» (или «Создатель»). Кнопку «Управлять командой»
  оставить как есть (гейт `workspace?.role==='owner'` — управление участниками = владелец пространства).
- Danger zone на `ProjectPage.tsx:104` (`data.role==='owner' && !isInbox`) теперь истинна и для
  создателя (после B1) — это и требовалось (создатель может удалить свой проект). Не менять.

### B3. Сервер: починить fallback-роль
`server/src/presentation/projects/routes.ts:129-147` (`toDto`/`getProject.execute` fallback): вместо
хардкода `fallbackRole='owner'` отдавать реальную derived-роль пользователя для этого проекта
(через тот же membership-view). Чтобы direct-link не показывал editor'у danger zone. Если derived-роль
получить в этом пути сложно — как минимум не отдавать `'owner'` по умолчанию (взять реальную или
безопасный минимум), но лучше реальную.

## Границы / не-цели
- НЕ бэкфилим self-delegation существующим задачам (только новые). Отдельно, по желанию юзера —
  разовый self-delegation для его «шор».
- НЕ трогаем `projects.owner_id` в БД (нужен, см. контекст).
- НЕ меняем inbox-ветку прав/ролей (приватность инбокса по owner_id — как есть).
- НЕ откатываем workspace-merge; создатель-owner — это узкий апгрейд роли на своём проекте.
- Гейт: `npm run -w @projectsflow/server typecheck` + сервер-тесты + client typecheck/lint/build.
  Обнови/добавь тесты: CreateTask self-delegation, projectRowVisibility owner-upgrade, fallback-role.

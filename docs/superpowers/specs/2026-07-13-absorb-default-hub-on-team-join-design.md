# Авто-слияние личного хаба в команду при вступлении (durability)

Дата: 2026-07-13. Статус: дизайн утверждён юзером («дожимай», «слить, не скрывать»).
Серверное изменение. Продолжение ручного мёржа ядра-5 (см.
[[unified-workspace-instant-delegation]] FOLLOW-UP #2) — теперь то же самое, но автоматически
и навсегда, чтобы новый приглашённый в команду не получал второй «Пространство».

## Проблема

Каждый юзер при регистрации получает личный `kind='default'` хаб (`createDefaultWorkspace`,
`index.ts:355`). Хаб — агрегирующая вьюха, реального контента в нём только его «Входящие»
(`is_inbox` проект). Свитчер (`DrizzleWorkspaceRepository.listForUser`) всегда показывает свой
дефолт-хаб + командные пространства. Пока юзер соло — хаб это его единственное пространство
(нужен). Как только его приглашают в команду — он видит ДВА «Пространства» (хаб + команда).
Ручной мёрж починил текущих 5, но НОВЫЙ приглашённый регрессирует.

## Решение: absorb-on-join

При вступлении в командное пространство (accept invite / owner добавил по email) — если у
юзера есть личный дефолт-хаб И в нём НЕТ проектов кроме «Входящих» — слить хаб в эту команду
(перенести «Входящие» + активность, удалить хаб, переставить current). «Слить», не «скрыть»
(как просил юзер). Соло-юзер (без команды) хаб сохраняет — ему негде иначе жить.

**Safety-гейт (важно):** если в дефолт-хабе есть НЕ-inbox проекты (юзер создавал проекты, пока
был соло) — НЕ сливаем (иначе его приватные проекты стали бы видны всей команде). Хаб остаётся,
юзер увидит 2 пространства — приемлемый безопасный компромисс для редкого случая; данные не
раскрываем молча. (У новых юзеров хаб почти всегда пуст, т.к. `resolveWorkspaceForNewProject`
уводит новые проекты в команду.)

## Изменения

### 1. Порт `WorkspaceRepository` (`application/workspace/WorkspaceRepository.ts`)
Новый метод:
```ts
/**
 * Слить личный дефолт-хаб юзера в целевое КОМАНДНОЕ пространство при вступлении: перенести
 * его «Входящие» (+ activity) в target, удалить хаб, переставить current на target.
 * No-op (вернуть false) если: у юзера нет дефолт-хаба; target не 'team'; в хабе есть НЕ-inbox
 * проекты (не раскрываем приватное). Идемпотентно и транзакционно.
 */
absorbDefaultHubInto(userId: string, targetWorkspaceId: string): Promise<boolean>;
```

### 2. Реализация `DrizzleWorkspaceRepository.absorbDefaultHubInto`
Транзакция (`this.db.transaction`), зеркало ручного SQL-мёржа:
- Найти дефолт-хаб юзера (`kind='default'`, owner=userId). Нет → `return false`.
- Проверить target: `getById(targetWorkspaceId)`, если `kind !== 'team'` → `return false`.
- Посчитать НЕ-inbox проекты в хабе (`projects WHERE workspace_id=hub AND is_inbox=false`).
  >0 → `return false` (safety).
- В транзакции:
  - `UPDATE projects SET workspace_id=target, name=CONCAT('inbox:', owner_id) WHERE workspace_id=hub AND is_inbox=true` — перенос «Входящих» + collision-safe имя (uq(workspace_id,name); имя не видно — лейбл захардкожен в UI). (0 или 1 строка — хаб имеет ≤1 inbox.)
  - `UPDATE activity_events SET workspace_id=target WHERE workspace_id=hub` — сохранить историю (activity_events CASCADE на удаление ws — двигать ДО delete).
  - `DELETE FROM workspaces WHERE id=hub` — cascade чистит workspace_members (вкл. кросс-хаб), chat, chat_reads, invites; projects.workspace_id уже перенесён (RESTRICT ок).
  - Если `users.current_workspace_id == hub` → `UPDATE users SET current_workspace_id=target`.
- `return true`.

Использовать существующие импорты (`projects`, `workspaces`, `workspaceMembers`, `users`) +
добавить `activityEvents` из `../db/schema.js`. Драйзл-эквиваленты UPDATE/DELETE, `sql`-хелпер
для `CONCAT`.

### 3. Вызвать после создания членства
- **`AcceptWorkspaceInvite.execute`** (`application/workspace/AcceptWorkspaceInvite.ts`): расширить
  `WorkspacesPort` методом `absorbDefaultHubInto`; после блока с `addMember`/`getMembership`
  (когда членство гарантировано) вызвать `await this.deps.workspaces.absorbDefaultHubInto(userId, invite.workspaceId)`.
  Вызывать даже если членство уже было (идемпотентно; чинит тех, кто вступил до фичи и ещё с хабом).
- **`WorkspaceService.addMember`** (`application/workspace/WorkspaceService.ts`): после
  `repo.addMember(...)` вызвать `await this.deps.repo.absorbDefaultHubInto(user.id, workspaceId)`.

Никаких изменений в signup (`createDefaultWorkspace` остаётся — соло-юзеру хаб нужен).

## Тесты
- Unit на use-case уровне (мок-репо) + существующие suite'ы `AcceptWorkspaceInvite`/`WorkspaceService`
  не должны падать. Добавить кейсы для новой логики:
  - вступление с пустым хабом → absorb вызван; репо-мок возвращает true.
  - вступление, хаб с не-inbox проектом → absorb вернул false (skip), хаб цел.
  - target не team → no-op.
  - идемпотентность: уже участник → absorb всё равно зовётся, но no-op если хаба нет.
- Если есть интеграционные Drizzle-тесты с реальной схемой — добавить проверку транзакции
  (inbox перенесён+переименован, activity перенесена, хаб удалён, current переставлен). Если
  инфраструктуры для БД-теста нет — покрыть логику на уровне порта/юз-кейса, метод репозитория
  проверить вручную по коду (зеркало верифицированного ручного SQL).

## Границы / не-цели
- Только сервер. Клиент не трогаем.
- Signup-поведение НЕ меняем.
- Соло-юзеров и хабы с приватными проектами НЕ трогаем (safety).
- Не трогаем ручной мёрж ядра-5 (уже на проде).
- Гейт: `npm run -w @projectsflow/server typecheck` (или корневой typecheck) + сервер-тесты + lint.

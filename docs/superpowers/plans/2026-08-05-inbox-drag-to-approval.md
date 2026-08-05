# Перетаскивание задач в полку «На утверждении» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Во «Входящих» задачу можно сдать на приёмку перетаскиванием в полку «На утверждении», а не только галочкой «выполнено».

**Architecture:** Полка `ApprovalShelf` получает `useDroppable` (как уже есть у `InProgressShelf`), родитель считает предикат «можно ли бросить сюда эту карточку» и гасит цель через `disabled`. Дроп зовёт существующий `taskRepository.move` с явным `targetStatus: 'pending_approval'`. Серверных изменений нет.

**Tech Stack:** React 19 + TypeScript, dnd-kit, node:test (тесты клиента гоняются `npm test -w @projectsflow/client`).

## Global Constraints

- Спека: `docs/superpowers/specs/2026-08-05-inbox-drag-to-approval-design.md`.
- Пользовательские строки — на русском; код, типы и технические комментарии — на английском (CLAUDE.md, п. 7).
- Слои клиента: `presentation` не импортирует из `infrastructure/http/*` напрямую — только через `useContainer()` (CLAUDE.md, п. 2). В этом файле контейнер уже используется.
- Серверных файлов и миграций план НЕ трогает.
- Работать в текущем worktree `.claude/worktrees/manual-tasks-batch`; `git add` — только перечисленными путями, никогда `git add -A`.

---

### Task 1: Предикат «можно ли отправить задачу на приёмку»

Чистая функция рядом с остальными хелперами инбокс-доски — чтобы правило было покрыто тестом без React и не размазалось по обработчику drag'а.

**Files:**
- Modify: `client/src/presentation/components/tasks/inboxBlockTasks.ts`
- Test: `client/src/presentation/components/tasks/inboxBlockTasks.test.ts`

**Interfaces:**
- Consumes: тип `InboxBlockTask` из того же файла (union `AssignedInboxBlockTask | PersonalInboxBlockTask`; у обоих есть `status: TaskStatus` и `assignee: { userId: string }`). В тестах — существующие хелперы `task(id, overrides): Task` и `assigned(id): AssignedTask`; второй в Step 1 расширяется до `assigned(id, overrides)`.
- Produces: `canSendToApproval(task: InboxBlockTask, currentUserId: string | null): boolean` — используется в Task 2 и Task 3.

- [ ] **Step 1: Написать падающий тест**

Сначала расширить существующий хелпер `assigned` (строка ~36) так, чтобы он принимал
переопределения — сейчас он их не принимает, а тестам нужны разные `assignee` и `status`.
Существующий вызов `assigned('duplicate')` от этого не ломается:

```ts
function assigned(id: string, overrides: Partial<Task> = {}): AssignedTask {
  return {
    ...task(id, { projectId: 'inbox-other', ...overrides }),
    projectName: 'Входящие',
    isInbox: true,
    canModify: true,
  };
}
```

Заменить импорт на строке 5:

```ts
import {
  asAssignedInboxBlockTask,
  buildToMeInboxBlockTasks,
  canSendToApproval,
  isPersonalInboxBlockTask,
} from './inboxBlockTasks';
```

Дописать в конец файла (`task()` по умолчанию ставит ответственным `'me'`):

```ts
test('canSendToApproval: свою задачу сдать можно', () => {
  assert.equal(canSendToApproval(asAssignedInboxBlockTask(assigned('t1')), 'me'), true);
});

test('canSendToApproval: чужую задачу сдать нельзя', () => {
  // «Сдать работу за другого» — не то действие, которое отдаётся жесту.
  const t = assigned('t2', {
    assignee: { userId: 'other', displayName: 'Коллега', avatarUrl: null },
  });
  assert.equal(canSendToApproval(asAssignedInboxBlockTask(t), 'me'), false);
});

test('canSendToApproval: задача уже на утверждении — повторно нельзя', () => {
  const t = assigned('t3', { status: 'pending_approval' });
  assert.equal(canSendToApproval(asAssignedInboxBlockTask(t), 'me'), false);
});

test('canSendToApproval: без текущего юзера цель недоступна', () => {
  assert.equal(canSendToApproval(asAssignedInboxBlockTask(assigned('t4')), null), false);
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npm test -w @projectsflow/client`
Expected: FAIL — `canSendToApproval is not a function` / ошибка импорта.

- [ ] **Step 3: Реализовать предикат**

Дописать в `client/src/presentation/components/tasks/inboxBlockTasks.ts`:

```ts
/**
 * Можно ли отправить задачу на приёмку жестом (дроп в полку «На утверждении»).
 *
 * Только СВОЮ задачу: «сдать работу за другого» — не то действие, которое стоит отдавать
 * перетаскиванию. Повторная сдача уже сданной задачи смысла не имеет.
 *
 * Гейта «приёмка включена в пространстве» здесь нет намеренно: полка рендерится только
 * когда приёмка включена, поэтому там, где её нет, нет и цели дропа.
 */
export function canSendToApproval(
  task: InboxBlockTask,
  currentUserId: string | null,
): boolean {
  if (!currentUserId) return false;
  if (task.assignee.userId !== currentUserId) return false;
  return task.status !== 'pending_approval';
}
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npm test -w @projectsflow/client`
Expected: PASS, все 4 новых теста зелёные, ранее существовавшие не сломаны.

- [ ] **Step 5: Коммит**

```bash
git add client/src/presentation/components/tasks/inboxBlockTasks.ts client/src/presentation/components/tasks/inboxBlockTasks.test.ts
git commit -m "feat(inbox): предикат «можно ли сдать задачу на приёмку»"
```

---

### Task 2: Полка «На утверждении» принимает дроп

Полка становится целью dnd-kit и умеет гаснуть, когда бросать в неё нельзя.

**Files:**
- Modify: `client/src/presentation/components/tasks/AssignedToMeBlock.tsx` (компонент `ApprovalShelf`, объявлен на строке ~1854; место рендера — строка ~1213)

**Interfaces:**
- Consumes: `canSendToApproval` из Task 1; существующий `useDroppable` из `@dnd-kit/core` (уже импортирован в файле).
- Produces: droppable с `id: 'approval-shelf'` и `data: { type: 'approval' }` — эту `data` читает обработчик из Task 3. Новый проп `ApprovalShelf`: `canDrop: boolean`.

- [ ] **Step 1: Добавить проп и droppable в `ApprovalShelf`**

В типе пропсов `ApprovalShelf` (после `currentUserId: string | null;`) добавить:

```ts
  // Можно ли бросить в полку карточку, которую тащат прямо сейчас. Считает родитель:
  // только он знает, что именно в руке (activeDrag). false — цель погашена.
  canDrop: boolean;
```

Добавить `canDrop` в деструктуризацию параметров (рядом с `currentUserId`).

Первой строкой тела компонента (перед `return`) добавить:

```ts
  // Цель дропа. disabled гасит её целиком: недоступная полка не попадает в коллизии,
  // не подсвечивается и не может принять карточку.
  const { setNodeRef, isOver } = useDroppable({
    id: 'approval-shelf',
    data: { type: 'approval' },
    disabled: !canDrop,
  });
```

- [ ] **Step 2: Повесить ref и подсветку на контейнер полки**

Внутренний `<div>` полки (тот, что с классами `rounded-xl border border-violet-300/50 …`) получает `ref={setNodeRef}` и подсветку при наведении — по образцу `InProgressShelf`:

```tsx
      <div
        ref={setNodeRef}
        className={cn(
          'rounded-xl border border-violet-300/50 bg-violet-100/40 px-2.5 py-2 transition-colors duration-150 dark:border-violet-400/20 dark:bg-violet-400/[0.07]',
          isOver &&
            'border-violet-400/80 bg-violet-200/60 dark:border-violet-300/50 dark:bg-violet-400/[0.16]',
        )}
      >
```

`cn` в файле уже импортирован.

- [ ] **Step 3: Прокинуть `canDrop` из родителя**

В месте рендера `<ApprovalShelf …>` (строка ~1214) добавить проп:

```tsx
          canDrop={activeDrag ? canSendToApproval(activeDrag, user?.id ?? null) : false}
```

`activeDrag` — это `InboxBlockTask | null` (состояние объявлено на строке ~788), то есть сама карточка, а не обёртка. Карточки, которые тащат с нижней доски проекта, `activeDrag` не заполняют — для них цель останется погашенной, и это правильно: полка инбокса про свои задачи.

Добавить `canSendToApproval` в существующий импорт из `./inboxBlockTasks` в шапке файла.

- [ ] **Step 4: Проверить сборку типов**

Run: `npm run typecheck` (из корня репозитория)
Expected: без ошибок. Ошибка «Property 'canDrop' is missing» означает, что проп не прокинут в Step 3.

- [ ] **Step 5: Коммит**

```bash
git add client/src/presentation/components/tasks/AssignedToMeBlock.tsx
git commit -m "feat(inbox): полка «На утверждении» — цель перетаскивания"
```

---

### Task 3: Дроп меняет статус задачи

Обработчик завершения перетаскивания получает ветку для новой цели.

**Files:**
- Modify: `client/src/presentation/components/tasks/AssignedToMeBlock.tsx` (`handleDragEnd`, строка ~999; рядом добавляется коллбек `sendToApproval`)

**Interfaces:**
- Consumes: `data: { type: 'approval' }` из Task 2; `taskRepository.move` из `useContainer()` (в файле уже используется, см. `setWorkStatus`); `canSendToApproval` из Task 1.
- Produces: ничего для последующих задач (терминальная).

- [ ] **Step 1: Добавить коллбек отправки на приёмку**

Сразу после `setWorkStatus` (заканчивается на строке ~935) добавить:

```ts
  // Отправить свою задачу на приёмку жестом. Явный 'pending_approval' сервер пропускает
  // без подмены (подмена срабатывает только на 'done'), а уведомление принимающему шлёт
  // сам MoveTask — отдельного вызова не нужно.
  const sendToApproval = useCallback(
    async (item: InboxBlockTask): Promise<void> => {
      try {
        await taskRepository.move(item.projectId, item.id, {
          targetStatus: 'pending_approval',
          beforeTaskId: null,
          afterTaskId: null,
        });
        await refresh();
        onChanged?.();
      } catch (e) {
        toast.error(`Не удалось отправить на утверждение: ${(e as Error).message}`);
      }
    },
    [taskRepository, refresh, onChanged],
  );
```

`useCallback`, `toast`, `refresh`, `onChanged` в файле уже есть.

- [ ] **Step 2: Добавить ветку в `handleDragEnd`**

Расширить тип `data` (строка ~1003) новым значением `type` — он уже объявлен как `{ type?: string; … }`, менять сигнатуру не требуется. Сразу ПОСЛЕ ветки `data.type === 'work'` вставить:

```ts
    // Дроп в полку «На утверждении»: сдать свою работу. Предикат повторяем и здесь —
    // disabled на цели защищает от промаха мышью, но не от гонки состояний.
    if (data.type === 'approval') {
      if (canSendToApproval(item, user?.id ?? null)) void sendToApproval(item);
      return;
    }
```

- [ ] **Step 3: Проверить типы и линт**

Run: `npm run typecheck` затем `npm run lint`
Expected: обе команды без ошибок. Единственный ожидаемый warning — предсуществующий `react-hooks/exhaustive-deps` в `DashboardSections.tsx:634`, он к этой работе отношения не имеет.

- [ ] **Step 4: Прогнать тесты клиента**

Run: `npm test -w @projectsflow/client`
Expected: PASS, включая 4 теста из Task 1.

- [ ] **Step 5: Коммит**

```bash
git add client/src/presentation/components/tasks/AssignedToMeBlock.tsx
git commit -m "feat(inbox): дроп в «На утверждении» отправляет задачу на приёмку"
```

---

### Task 4: Проверка на проде

Локальный full-stack прогон недоступен (миграция 054 ломает локальную БД), поэтому проверка — после автодеплоя.

**Files:** изменений нет.

**Interfaces:**
- Consumes: задачи 1–3 в `main`.
- Produces: подтверждение работоспособности.

- [ ] **Step 1: Влить в main и дождаться деплоя**

```bash
git push github worktree-manual-tasks-batch:main
```

Дождаться, пока короткий SHA нового коммита появится в entry-бандле:

```bash
entry=$(curl -s https://projectsflow.ru/login | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://projectsflow.ru/assets/$entry" | grep -c "$(git rev-parse --short=7 HEAD)"
```

Expected: `1` (SHA вшит в бандл через `__PF_BUILD__`).

- [ ] **Step 2: Проверить жест в браузере**

Открыть «Входящие» в пространстве с ВКЛЮЧЁННОЙ приёмкой и проверить:

1. своя задача перетаскивается в «На утверждении» → карточка уезжает в полку, руководителю приходит уведомление;
2. та же задача перетаскивается в «Вручную» → статус `manual` (регрессия существующего поведения);
3. на вкладке «Для всех» чужая задача при переносе НЕ подсвечивает полку «На утверждении» и не принимается ею.

- [ ] **Step 3: Зафиксировать результат**

Если всё сходится — сообщить пользователю и оставить решение о переносе kanban-задачи в `done` за ним (ритуал CLAUDE.md: в `done` двигаем только с явного подтверждения). Если пункт 3 не выполняется — вернуться к Task 2, Step 3: скорее всего `canDrop` считается не от той карточки.

---

## Заметки для исполнителя

- **Почему нет серверных задач.** `MoveTask.resolveTargetStatus` подменяет статус только когда запрошен `done`; явный `pending_approval` проходит как есть. Zod-схема `taskStatusSchema` принимает `pending_approval` начиная с коммита `28f14af7`. Уведомление принимающему шлёт сам `MoveTask`.
- **Полку «Вручную» не трогаем.** Она уже цель дропа (`id: 'work-in-progress'`). Task 4 лишь проверяет, что мы её не сломали.
- **Обратная тяга не делается** сознательно: задача на утверждении заморожена для всех, кроме принимающего, а выход из полки уже закрыт кнопками «Принять» / «Вернуть в работу» / «Отозвать».

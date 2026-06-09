# Дизайн: центрированная колонка «Входящих» + группировка «Поручено мне»

**Дата:** 2026-06-09
**Статус:** утверждён, ждёт реализации
**Скоуп:** только раздел «Входящие» (`InboxPage`) + блок «Поручено мне». Канбан, другие страницы — не трогаем.

## Контекст

Два независимых улучшения раздела «Входящие», запрошенных пользователем (референс — Todoist):

1. **Узкая центрированная читаемая колонка** на широких мониторах + показ длинного
   текста задач (сейчас он обрезается до 2 строк).
2. **Переключатель группировки** в блоке «Поручено мне» (сейчас всегда по проекту):
   по проекту / дате создания / дедлайну / приоритету. Выбор сохраняется **за
   аккаунтом** (на сервере).

Части независимы и могут реализовываться/ревьюиться по отдельности.

---

## Часть 1 — Центрированная колонка + раскрываемый длинный текст

### 1.1 Ширина колонки

`InboxPage` ([client/src/presentation/pages/InboxPage.tsx](../../../client/src/presentation/pages/InboxPage.tsx))
оборачивает контент в колонку, ширина которой **зависит от режима отображения**:

- **Список (`view === 'list'`)** → `mx-auto w-full max-w-3xl` (~768px, по центру).
  В колонку входят: шапка (заголовок «Входящие» + тогглы), описание, блок «Поручено
  мне», сам список. Левый край заголовка выровнен со списком (вид Todoist).
- **Канбан (`view === 'kanban'`)** → без ограничения ширины (как сейчас) — доске
  нужно место.

**Решение (утверждено):** центрируем **весь столбец вместе с шапкой**, а не только тело.

Реализация: единственный класс-переключатель на обёртке. Внешний корневой `<div>`
страницы оставляем как раскладку на всю высоту (`flex h-full flex-col`), а внутрь
кладём контент-обёртку с условным `max-w`:

```tsx
const columnClass = cn(
  'flex w-full flex-1 flex-col gap-4 sm:gap-6',
  view === 'list' && 'mx-auto max-w-3xl',
);
```

Паддинги (`p-4 sm:p-6`) остаются на корне, чтобы на узких экранах колонка не липла
к краям. При переключении list→kanban шапка плавно расширяется на всю ширину — это
ожидаемо (канва расширяется под доску).

### 1.2 Раскрываемый длинный текст

Новый переиспользуемый презентационный компонент
`client/src/presentation/components/tasks/ExpandableMarkdown.tsx`:

**Контракт:**
```tsx
type Props = {
  children: string;           // markdown-текст задачи
  className?: string;         // доп. классы для Markdown (line-through/opacity для done)
  clampLines?: number;        // по умолчанию 12
};
```

**Поведение:**
- Рендерит `<Markdown className={cn(MARKDOWN_COMPACT, className, clampClass)}>` где
  `clampClass` = `line-clamp-[12]` в свёрнутом состоянии, отсутствует в развёрнутом.
  `line-clamp-N` задаёт вызывающая сторона — так и задумано в `MARKDOWN_COMPACT`
  ([Markdown.tsx:61](../../../client/src/presentation/components/markdown/Markdown.tsx#L61)).
- Измеряет переполнение: ref на корневой div Markdown (через обёртку —
  `wrapRef.current.firstElementChild`), сравнивает `scrollHeight > clientHeight + 1`
  **в свёрнутом состоянии**. Результат запоминается в «липком» флаге `canExpand`
  (сбрасывается/перепроверяется при смене `children`), чтобы кнопка «Свернуть» не
  исчезала после раскрытия. Перепроверка при ресайзе — `ResizeObserver` (обновляет
  только когда свёрнуто).
- Если `canExpand` — под текстом маленькая кнопка-ссылка:
  - свёрнуто → «Показать полностью»
  - развёрнуто → «Свернуть»
  - `onClick` делает `e.stopPropagation()` — клик по строке (открытие drawer) не
    срабатывает. Стиль: `text-xs text-primary hover:underline`.

**Где применяется (только Входящие):**
- `TaskListView` → строка задачи `TaskListRow`
  ([TaskListView.tsx:294-300](../../../client/src/presentation/components/tasks/TaskListView.tsx#L294-L300)).
- `AssignedToMeBlock` → `AcceptedRow`
  ([AssignedToMeBlock.tsx:203-211](../../../client/src/presentation/components/tasks/AssignedToMeBlock.tsx#L203-L211)).

**Где НЕ применяется:**
- `KanbanCard` и прочие потребители `Markdown` — сохраняют текущий `line-clamp` (скоуп
  только Входящие).
- `PendingRow` excerpt «X поручил вам: «…»»
  ([AssignedToMeBlock.tsx:274](../../../client/src/presentation/components/tasks/AssignedToMeBlock.tsx#L274))
  остаётся `line-clamp-2` — это строка-уведомление, а не тело задачи.

**Техническая проверка при реализации:** убедиться, что `line-clamp-[12]` (arbitrary
value) поддерживается текущей версией Tailwind проекта; если нет — добавить утилиту в
конфиг или использовать `max-h` + `overflow-hidden` как fallback.

---

## Часть 2 — Группировка «Поручено мне» (за аккаунтом)

### 2.1 Группировка — чистая презентация

Сервер уже отдаёт плоский список (`/api/delegations/assigned-to-me`,
[ListTasksAssignedToMe.ts:36](../../../server/src/application/task/ListTasksAssignedToMe.ts#L36):
«Группировку по проекту делает клиент»). Группировку по проекту сейчас делает клиентский
репозиторий
([HttpTaskDelegationRepository.ts:41-70](../../../client/src/infrastructure/http/HttpTaskDelegationRepository.ts#L41-L70)).

**Изменение:** `listAssignedToMe()` возвращает **плоский `AssignedTask[]`** (без
группировки). Группировку выносим в чистый презентационный хелпер.

- Порт `TaskDelegationRepository.listAssignedToMe(): Promise<AssignedTask[]>`
  ([client/src/application/task/TaskDelegationRepository.ts:15](../../../client/src/application/task/TaskDelegationRepository.ts#L15)).
- Http-импл: маппим `items` в `AssignedTask[]`, без построения `Map` групп.
- Единственный потребитель — `AssignedToMeBlock`; других нет.

### 2.2 Хелпер группировки

`client/src/presentation/components/tasks/assignedGrouping.ts` — чистая функция:

```ts
export type AssignedGrouping = 'project' | 'created' | 'deadline' | 'priority';

export function groupAssignedTasks(
  tasks: AssignedTask[],
  mode: AssignedGrouping,
  now: Date,
): AssignedGroup[];
```

`AssignedGroup` остаётся `{ projectId? / key, label, isInbox, items }` — обобщаем поле
ключа группы (для не-project режимов `projectId` не используется как идентификатор;
вводим `key: string`). Заголовок группы получает иконку под режим (опционально).

**Бакеты (порядок фиксированный):**

| Режим | Бакеты по порядку |
|---|---|
| `project` (дефолт, как сейчас) | по проекту; inbox → «Личные · {делегатор}». Порядок — первого появления. |
| `created` | Сегодня · Вчера · На этой неделе · Ранее |
| `deadline` | Просрочено · Сегодня · Завтра · На этой неделе · Позже · Без дедлайна |
| `priority` | Срочно (1) · Высокий (2) · Средний (3) · Низкий (4) · Без приоритета |

- Пустые бакеты не рендерятся.
- Внутри бакета порядок: pending — наверх (как сейчас,
  [AssignedToMeBlock.tsx:130-132](../../../client/src/presentation/components/tasks/AssignedToMeBlock.tsx#L130-L132)),
  затем по релевантному ключу (created — новее выше; deadline — ближе выше; priority —
  по позиции).
- Границы дней («сегодня/вчера/неделя») считаем от переданного `now` (локальная TZ),
  чтобы функция была чистой и тестируемой.
- `priority` — `TaskPriority = 1|2|3|4` (1=Срочно … 4=Низкий),
  [priorityMeta.ts](../../../client/src/domain/task/priorityMeta.ts); `null` → «Без приоритета».

### 2.3 UI-переключатель

В шапке секции «Поручено мне»
([AssignedToMeBlock.tsx:110-115](../../../client/src/presentation/components/tasks/AssignedToMeBlock.tsx#L110-L115))
справа — компактный `DropdownMenu` (shadcn, уже в `components/ui/dropdown-menu`):
триггер **«Группировка: {label} ▾»**, пункты: Проект / Дата создания / Дедлайн /
Приоритет (radio-группа, текущий отмечен). Кириллица — пользовательские строки.

### 2.4 Персистентность (сервер, за аккаунтом)

Зеркалит существующий паттерн `users.default_kanban_colors`
([057_kanban_settings.sql](../../../db/057_kanban_settings.sql),
[kanbanColorsRoutes.ts](../../../server/src/presentation/me/kanbanColorsRoutes.ts)).

**Миграция** `db/069_user_ui_prefs.sql` (append-only, MariaDB):
```sql
-- 069: Персональные UI-настройки клиента (обобщённый bag).
-- Сейчас хранит { inboxAssignedGrouping }. NULL = дефолты.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ui_prefs JSON DEFAULT NULL
  AFTER default_kanban_colors;
```

**Домен** (зеркало client/server, как `KanbanSettings`):
- `client/src/domain/user/UiPrefs.ts` и `server/src/domain/user/UiPrefs.ts`:
  ```ts
  export type AssignedGrouping = 'project' | 'created' | 'deadline' | 'priority';
  export type UiPrefs = { inboxAssignedGrouping?: AssignedGrouping };
  export const DEFAULT_ASSIGNED_GROUPING: AssignedGrouping = 'project';
  ```
  (Клиентский `AssignedGrouping` из 2.2 импортируется отсюда — единый источник.)

**Сервер:**
- Схема `users.uiPrefs: json('ui_prefs').$type<UiPrefs | null>()`
  ([schema.ts](../../../server/src/infrastructure/db/schema.ts), после `defaultKanbanColors`).
- `UserRepository` (порт + Drizzle): `getUiPrefs(userId): Promise<UiPrefs | null>` и
  `setUiPrefs(userId, prefs): Promise<void>` (read-merge-write, как
  `updateTelegramPrefs`/`setDefaultKanbanColors`; `parseJsonCol`).
- `server/src/presentation/me/uiPrefsRoutes.ts` — клон `kanbanColorsRoutes`:
  - `GET /me/ui-prefs` → `{ prefs: UiPrefs }` (`{}` если NULL).
  - `PUT /me/ui-prefs` → валидирует zod-схемой (`inboxAssignedGrouping` enum), мержит,
    возвращает `{ prefs }`.
  - zod-схема рядом с `kanbanDefaultColorsSchema` в
    [projects/schemas.ts](../../../server/src/presentation/projects/schemas.ts) или в
    новом `me/schemas.ts`.
- Маунт в [index.ts](../../../server/src/index.ts) / [http.ts](../../../server/src/presentation/http.ts)
  рядом с `meKanbanColorsRouter` (`requireAuth` уже внутри роутера).

**Клиент:**
- `UserRepository` (порт + `HttpUserRepository` + `MockUserRepository`):
  `getUiPrefs(): Promise<UiPrefs>` (GET, нормализация строкового JSON как в
  `getDefaultKanbanColors`), `setUiPrefs(prefs): Promise<UiPrefs>` (PUT).

**Поток в `AssignedToMeBlock`:**
- При первой загрузке — `Promise.all([listAssignedToMe(), getUiPrefs()])`. Блок уже
  возвращает `null` пока `loading`
  ([AssignedToMeBlock.tsx:101](../../../client/src/presentation/components/tasks/AssignedToMeBlock.tsx#L101)) —
  гейтим первый рендер на оба запроса ⇒ **нет «мигания» группировки** и тип `User`
  (личность) не засоряется prefs (как и kanban-colors — вне `/auth/me`).
- Локальный стейт `grouping: AssignedGrouping` (init из prefs, дефолт `'project'`).
- Смена в дропдауне — **оптимистично**: мгновенно перегруппировываем, `setUiPrefs(mode)`
  летит в фоне; при ошибке — toast, стейт оставляем (не критично).

---

## Затронутые файлы (оценка)

**Клиент (~7):**
- `presentation/pages/InboxPage.tsx` — условная ширина колонки.
- `presentation/components/tasks/ExpandableMarkdown.tsx` — новый.
- `presentation/components/tasks/TaskListView.tsx` — использовать `ExpandableMarkdown`.
- `presentation/components/tasks/AssignedToMeBlock.tsx` — `ExpandableMarkdown`,
  дропдаун группировки, поток prefs, плоский список.
- `presentation/components/tasks/assignedGrouping.ts` — новый (хелпер + тесты).
- `domain/user/UiPrefs.ts` — новый.
- `infrastructure/http/HttpTaskDelegationRepository.ts`,
  `application/task/TaskDelegationRepository.ts`,
  `infrastructure/http/HttpUserRepository.ts`,
  `application/user/UserRepository.ts`, мок-репо — правки портов/имплов.

**Сервер (~7):**
- `db/069_user_ui_prefs.sql` — новый.
- `domain/user/UiPrefs.ts` — новый.
- `infrastructure/db/schema.ts` — колонка.
- `application/user/UserRepository.ts` (порт),
  `infrastructure/repositories/DrizzleUserRepository.ts` (get/set).
- `presentation/me/uiPrefsRoutes.ts` — новый; `me/schemas.ts` или дополнение
  `projects/schemas.ts`.
- `index.ts` / `presentation/http.ts` — маунт.

## Тестирование

- **Юнит (vitest):** `groupAssignedTasks` — по каждому режиму, граничные даты
  (полночь, начало недели), `null` deadline/priority, пустые бакеты, pending-наверх.
- **Сервер:** `getUiPrefs/setUiPrefs` merge; `PUT /me/ui-prefs` валидация enum (400 на
  мусоре).
- **Ручная проверка:** широкий монитор — список центрирован ~768px, канбан во всю
  ширину; длинная задача (>12 строк) показывает «Показать полностью», клик по кнопке
  не открывает drawer; смена группировки переживает reload (и в другом браузере при
  том же аккаунте).

## Не входит (YAGNI)

- Группировка/центрирование на других страницах и в канбане.
- Режим «без группировки» (плоский) — не запрашивался.
- Сортировка внутри группы как отдельная настройка.
- Перенос kanban-/notification-prefs в общий `ui_prefs` (отдельная задача при желании).

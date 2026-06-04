# Kanban: мультивыделение задач + массовые действия

**Дата:** 2026-06-04
**Тип:** feature spec (две связанные фазы)
**Статус:** утверждено пользователем («сделай всё сам»), готово к плану

## Контекст

На Kanban-доске проекта (`KanbanBoard.tsx`, dnd-kit) у каждой колонки есть меню-троеточие
(`KanbanColumnMenu.tsx`: переименование, цвет, скрытие). Сейчас с задачами можно работать
только по одной: drag-drop, открытие дравера, badge-действия. Нет способа выбрать пачку
задач и применить действие сразу ко всем.

Эта spec вводит **режим мультивыделения в стиле мессенджера** (Telegram/WhatsApp):
из меню колонки — пункт «Выделить», после чего на карточках появляются чекбоксы,
а снизу — плавающая панель массовых действий.

## Решения (зафиксированы в брейншторме)

1. **Охват — одна колонка.** «Выделить» включает режим только в той колонке, из меню
   которой вызван. Чекбоксы появляются только на её карточках. «Выделить всё» / «Никого» —
   в пределах этой колонки. (Чтобы оперировать другой колонкой — выйти и войти заново.)
   Одновременно активна максимум одна колонка-в-режиме.
2. **Полное desktop-взаимодействие.** Клик = тогл; **Shift+клик** = диапазон (по визуальному
   порядку карточек в колонке); **Ctrl/Cmd+клик** = добавить/убрать; **Esc** = выход;
   кнопки «Всё» / «Никого» / ✕. На время режима в этой колонке drag-drop и открытие
   дравера по клику **отключены** (клик тогает выбор).
3. **Набор массовых действий** (панель снизу, видна при N ≥ 1):
   - Мутации: **Делегировать · Дедлайн · Приоритет · В колонку · Ralph-режим · Удалить**.
   - Экспорт: **Скопировать · На почту · В Telegram**.
4. **Мутации — циклом по существующим one-task эндпоинтам.** Не вводим 6 серверных
   bulk-эндпоинтов. `useBulkTaskActions` гоняет существующие `update`/`move`/`delete`/
   `delegate` пулом (ограниченная конкуррентность) с обработкой частичных ошибок
   («7 из 8 обновлено»). Оптимистичные апдейты через уже существующий `useTasks`.
5. **Дайджест экспорта — единый источник правды на сервере.** Один эндпоинт строит и
   рендерит список во все каналы (plain-text для буфера, HTML для письма, MarkdownV2 для
   Telegram). Это исключает дрейф форматирования между «Скопировать» и «Отправить».
6. **Формат дайджеста — «развёрнутый по группам».** Группировка по приоритету
   (P1→P2→P3→P4→без), нумерация перезапускается внутри каждой группы, дедлайн/исполнитель/
   ссылка — отдельной строкой под названием.
7. **Имя задачи = первая строка описания.** У `Task` нет поля `title`; берём первую
   непустую строку `description`, чистим markdown (заголовки/жирный/код/ссылки→текст),
   обрезаем до ~80 символов. Пустое описание → «(без описания)».
8. **Получатель отправки — «Я» по умолчанию + выбор участников.** Диалог: чекбокс «Я»
   (предвыбран) + участники проекта. «Я» = текущий пользователь (его email / его
   привязанный `tg_chat_id`). Сервер сам резолвит контакты по userId.
9. **Никаких изменений схемы БД.** Фича не добавляет таблиц/колонок. `Task` уже содержит
   `priority`, `deadline`, `delegation`, `description` — всё нужное.

## Out of scope

- Серверные bulk-эндпоинты для мутаций (используем циклы по one-task API).
- Кросс-колоночное и кросс-проектное выделение (только одна колонка за раз).
- Сохранение выборки между перезагрузками / undo массовых операций.
- Произвольный текст-сопроводиловка при отправке (шлём только сам дайджест).
- Экспорт в PDF/CSV (только текст/HTML/MarkdownV2 в три канала).
- Выбор формата дайджеста в UI (формат один — «развёрнутый по группам»).

---

## Фаза 1 — Режим выделения + массовые мутации (client-only)

Независимо катимая, ценная сама по себе. Без серверных изменений.

### Поведение

- В `KanbanColumnMenu` — новый пункт **«Выделить»** (иконка `CheckSquare`/`ListChecks`)
  над блоком «Скрыть колонку». `onClick` → `onSelect(status)`.
- `KanbanBoard` держит состояние выделения:
  ```ts
  const [selectionStatus, setSelectionStatus] = useState<VisibleKanbanStatus | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const anchorIdRef = useRef<string | null>(null); // якорь для Shift-диапазона
  ```
  Вход: `setSelectionStatus(status); setSelectedIds(new Set())`. Выход (`exitSelection`):
  обнуляет оба + `anchorIdRef`. Вход в режим отключает dnd-сенсоры (или `disabled` на
  `useSortable`/`useDroppable`) для карточек этой колонки.
- `KanbanColumn` (активная колонка): рендерит **selection-header** вместо обычного
  (счётчик «Выбрано N», кнопки «Всё»/«Никого»/✕) и прокидывает в карточки
  `selectable`, `selected`, `onSelectToggle(id, modifiers)`.
- `KanbanCard` в режиме: слева круглый чекбокс (как `InboxCheckbox` визуально), вся
  карточка кликабельна для тогла; `onClick` НЕ открывает дравер, dnd-listeners сняты.
  Модификаторы (`shiftKey`, `metaKey`/`ctrlKey`) прокидываются в `onSelectToggle`.
- Логика выбора — чистый редьюсер `selectionReducer` (юнит-тестируемый):
  - `toggle(id)` — инвертировать.
  - `range(id, orderedIds, anchorId)` — выбрать диапазон между якорем и id включительно.
  - `add(id)` — добавить.
  - `all(orderedIds)` / `none()`.
- **Esc** на доске в режиме → `exitSelection`. Глобальный listener только пока
  `selectionStatus !== null`.

### Панель массовых действий — `BulkActionBar.tsx` (новый)

Плавающая по центру снизу (как toast-бар), `position: fixed`, поверх доски. Видна при
`selectionStatus !== null && selectedIds.size > 0`. Слева — «Выбрано N», далее кнопки;
на узких экранах лишние сворачиваются в «Ещё» (`DropdownMenu`). Деструктивное «Удалить» —
красным, в конце группы мутаций.

| Кнопка | Поповер/диалог | Под капотом (на каждую выбранную) |
|---|---|---|
| Делегировать | member-picker (как `DelegateTaskButton`) | `taskRepository.delegate(projectId, id, userId)` |
| Дедлайн | `DeadlinePicker` (+ «Очистить») | `update(projectId, id, { deadline })` |
| Приоритет | P1–P4 + «Снять» | `update(projectId, id, { priority })` |
| В колонку | список видимых статусов | `move(projectId, id, { targetStatus, afterTaskId })` |
| Ralph-режим | normal/silent/grillme | `update(projectId, id, { ralphMode })` |
| Удалить | confirm-диалог | `delete(projectId, id)` |

«В колонку»: задачи добавляются в конец целевой колонки; позиции считаются
последовательно (каждый следующий `afterTaskId` = предыдущий перемещённый), чтобы порядок
сохранился. После успешного move выбранные исчезают из исходной колонки — выходим из
режима (или оставляем выбор пустым).

### Хук `useBulkTaskActions.ts` (новый)

Обёртка над методами `useTasks`. Гоняет операции пулом (конкуррентность ~5),
собирает `{ ok: number; failed: Array<{ id; error }> }`, возвращает для toast'а
(«Готово: 7 из 8; 1 ошибка»). Использует уже существующие оптимистичные `update`/`move`/
`remove`/`delegate`, поэтому доска обновляется по ходу. После завершения — `exitSelection`
(или сохраняем выбор при частичной ошибке, чтобы повторить только провалившиеся).

### Затрагиваемые файлы (Фаза 1)

- `KanbanColumnMenu.tsx` — пункт «Выделить» + prop `onSelect`.
- `KanbanBoard.tsx` — состояние выделения, отключение dnd в режиме, проброс пропсов,
  Esc-listener, рендер `BulkActionBar`.
- `KanbanColumn.tsx` — selection-header (счётчик + Всё/Никого/✕), проброс в карточки.
- `KanbanCard.tsx` — чекбокс + режим тогла, снятие dnd/drawer в режиме, модификаторы.
- `presentation/components/tasks/BulkActionBar.tsx` — **новый**.
- `presentation/components/tasks/selection/selectionReducer.ts` — **новый** (+ тесты).
- `presentation/hooks/useBulkTaskActions.ts` — **новый**.
- Возможные мелкие поповеры (`BulkPriorityPopover`, `BulkMovePopover`, `BulkRalphPopover`)
  или инлайн внутри `BulkActionBar`; member-picker и `DeadlinePicker` переиспользуются.

### Без серверных изменений (Фаза 1)

Полностью на клиенте, поверх существующего HTTP-API.

---

## Фаза 2 — Дайджест и экспорт (full-stack)

### Поведение (клиент)

В `BulkActionBar` — группа экспорта: **Скопировать · На почту · В Telegram**.

- **Скопировать:** запрос к эндпоинту `channel='clipboard'`, получаем `{ text }`,
  кладём в буфер. Чтобы не потерять user-gesture при await, используем
  `navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobPromise })])`;
  fallback — `await fetch(); navigator.clipboard.writeText(text)`.
- **На почту / В Telegram:** открывается **recipient-picker** (чекбокс «Я» предвыбран +
  участники проекта, multiSelect). По «Отправить» — запрос с `channel` и списком
  получателей. Toast с результатом («Отправлено: 2; пропущено: 1 — не привязан Telegram»).

### Эндпоинт

```
POST /api/projects/:projectId/tasks/digest
body: {
  taskIds: string[],                                  // 1..N, валидируем принадлежность проекту
  channel: 'clipboard' | 'email' | 'telegram',
  recipients?: Array<'self' | { userId: string }>     // обязателен для email/telegram
}
→ 200 {
  text: string,                                        // plain-text рендер (всегда)
  delivery?: {                                         // только для email/telegram
    delivered: Array<{ userId: string; channel: string }>,
    skipped:   Array<{ userId: string; reason: string }>  // not_connected/not_started/no_email/...
  }
}
```

Авторизация: `requireProjectAccess('read_project')` внутри use-case. `clipboard` ничего не
шлёт — только строит и возвращает текст.

### Server use-cases (новые)

- **`BuildTaskDigest`** — чистая сборка модели дайджеста:
  - грузит задачи по `taskIds` (фильтр по `projectId` — чужие игнорируем/400),
  - грузит участников проекта для display-name исполнителей,
  - группирует по `priority` (1→4, затем `null`), сортирует внутри группы по `position`,
  - на каждую: имя (первая строка `description`, markdown-strip, ≤80), дедлайн (RU),
    исполнитель (`delegation.delegateDisplayName`), deep-link
    `${APP_URL}/projects/{projectId}?task={taskId}`.
  - Рендереры: `renderDigestText()` (буфер), `renderDigestHtml()` (письмо),
    `renderDigestMarkdownV2()` (Telegram, с экранированием спецсимволов). Каждый —
    чистая функция от модели → юнит-тесты на фикстурах.
- **`SendTaskDigest`** — резолвит получателей (`'self'` → caller; `{userId}` → участник,
  проверка членства), для `email` → `EmailSender.send({to,subject,html,text})`,
  для `telegram` → `SendAgentTelegramNotification.execute({userId,text,parseMode:'MarkdownV2',
  kind:'task_digest'})`. Собирает `delivered`/`skipped` (включая статусы
  `not_connected`/`not_started`/нет email). Best-effort, не валит весь запрос на одной ошибке.

`BuildTaskDigest` и `SendTaskDigest` можно объединить в один `ExportTasksDigest` use-case с
веткой по `channel`.

### Сервер — затрагиваемые файлы (Фаза 2)

- `server/src/application/task/BuildTaskDigest.ts` — **новый** (+ тесты).
- `server/src/application/task/digest/render{Text,Html,MarkdownV2}.ts` — **новые** (+ тесты).
- `server/src/application/task/SendTaskDigest.ts` (или `ExportTasksDigest.ts`) — **новый**.
- `server/src/domain/task/digestFormat.ts` — приоритет-лейблы/эмодзи, RU-дата, markdown-strip
  (чистые хелперы).
- Метод получения задач по ids: переиспользуем `TaskRepository.list(projectId)` + фильтр,
  либо добавляем `getByIds(projectId, ids)`.
- `server/src/presentation/tasks/routes.ts` — роут `POST /:projectId/tasks/digest`
  (zod-схема), проброс use-case.
- `server/src/index.ts` — wiring use-case (инжект `EmailSender`,
  `SendAgentTelegramNotification`, репозитории).

### Клиент — затрагиваемые файлы (Фаза 2)

- `application/task/TaskRepository.ts` — порт `digest(projectId, input): Promise<TaskDigestResult>`
  (или отдельный `TaskExportRepository`).
- `infrastructure/http/HttpTaskRepository.ts` (или `HttpTaskExportRepository`) — реализация.
- `infrastructure/di/container.tsx` — wiring.
- `BulkActionBar.tsx` — кнопки экспорта + вызов.
- `presentation/components/tasks/RecipientPickerDialog.tsx` — **новый** (Я + участники).
- `presentation/components/tasks/copyToClipboard.ts` — **новый** (ClipboardItem + fallback).
- `KanbanBoard.tsx` / `TasksPage.tsx` — прочитать `?task=` из URL и открыть дравер
  (для кликабельных ссылок из письма/ТГ). Небольшое дополнение к маршруту.

### Формат дайджеста (эталон)

```
*Задачи — 6*  ·  Проект «Сайт»

🔴 P1 · Срочно
1. Починить деплой на прод
   ⏰ 5 июн · 👤 Анна · 🔗 открыть
2. Ответить клиенту
   ⏰ сегодня

🟠 P2 · Высокий
1. Ревью PR #42

⚪ Без приоритета
1. Обновить README
```

- Заголовок: «Задачи — N · Проект «…»».
- Группы (только непустые): P1 🔴 Срочно, P2 🟠 Высокий, P3 🟡 Средний, P4 ⚪ Низкий,
  «Без приоритета» (лейблы P1–P4 синхронизировать с существующим `PriorityBadge`).
- Строка-мета под именем — только присутствующие поля (нет дедлайна → строки нет;
  нет исполнителя → опускаем; ссылка — всегда).
- HTML-рендер: те же данные в `<h3>`/`<ol>`/`<li>` с `<a href>`; MarkdownV2 — с экранированием.

## Архитектурные правила (Clean Architecture, проверка)

- Клиент: порт `digest` в `application/task/`, реализация — в `infrastructure/http/`,
  презентация ходит только через `useContainer()`. Никаких прямых импортов адаптеров в
  компонентах. Состояние выделения — презентационное, живёт в `KanbanBoard` (не в domain).
- Сервер: `BuildTaskDigest`/`SendTaskDigest` — application; рендереры и `digestFormat` —
  чистые модули; авторизация через `requireProjectAccess`. Роут — тонкий, валидирует zod
  и зовёт use-case.

## План реализации (укрупнённо)

**Фаза 1 (client-only, 1 PR):**
1. `selectionReducer` + юнит-тесты (toggle/range/add/all/none).
2. Пункт «Выделить» в `KanbanColumnMenu`.
3. Состояние выделения в `KanbanBoard` + отключение dnd + Esc.
4. selection-header в `KanbanColumn`, чекбокс/режим в `KanbanCard`.
5. `useBulkTaskActions` (пул + частичные ошибки) + тесты.
6. `BulkActionBar` + поповеры действий; интеграция мутаций.
7. Smoke-тест в dev (`npm run dev:client`), `npm run lint` + `npm run typecheck`.

**Фаза 2 (full-stack, 1 PR):**
1. Сервер: `digestFormat` + рендереры (text/html/markdownv2) + тесты на фикстурах.
2. Сервер: `BuildTaskDigest` + `SendTaskDigest`/`ExportTasksDigest` + тесты.
3. Сервер: роут `POST /:projectId/tasks/digest` + wiring в `index.ts`.
4. Клиент: порт + HTTP-адаптер + DI.
5. Клиент: `copyToClipboard`, `RecipientPickerDialog`, кнопки экспорта в `BulkActionBar`.
6. Клиент: чтение `?task=` для deep-link открытия дравера.
7. Smoke-тест полного flow (copy + отправка себе на почту/ТГ в dev).

## Риски и митигация

- **Конфликт режима выделения с dnd-kit.** Митигация: при `selectionStatus === колонка`
  карточки получают `disabled` в `useSortable`, сенсоры не активируются; клик обрабатывается
  как тогл. Покрыть ручным smoke-тестом drag↔select переключения.
- **Частичные ошибки массовых мутаций.** Митигация: пул возвращает per-id результат; toast
  показывает «N из M»; выбор провалившихся сохраняется для повтора.
- **Clipboard после await.** Митигация: `ClipboardItem` с promise-значением + fallback на
  `writeText`.
- **Отправка в чужие каналы (email/TG).** Митигация: сервер сам рендерит из авторитетных
  данных (клиент не шлёт произвольный текст); получатели валидируются как участники проекта;
  `kind:'task_digest'` уважает дедуп/префы Telegram.
- **Имя из markdown-описания** может быть пустым/мусорным. Митигация: strip + fallback
  «(без описания)»; обрезка с многоточием.
- **Backend полноценный** (CLAUDE.md-статус устарел: в `server/src/` рабочий Express с
  Drizzle/SMTP/Telegram-ботом/SSE). Фазу 2 делаем по-настоящему через `EmailSender` и
  `SendAgentTelegramNotification`.

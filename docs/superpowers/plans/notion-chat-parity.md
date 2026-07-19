# План: паритет AI-чата ProjectsFlow с Notion AI

Референс: [reference/notion-ai-chat/behavior.md](../../../reference/notion-ai-chat/behavior.md) (снят вживую, 1440×900).
Разведка кода: `client/src/presentation/components/ai/*`, `server/src/{domain,application,presentation}/ai-conversation/*`, `db/132_ai_conversations.sql`.

Ключевое поведенческое правило референса, ради которого всё затевается:

> **Чтение и создание выполняются без подтверждения. Подтверждение требуют только
> разрушительные операции. После выполнения — мягкое удаление (корзина) и Undo.**

У нас сейчас ровно наоборот: подтверждается **любой** план целиком, а удаление —
физическое и необратимое (undo существует только в памяти вкладки).

---

## 1. Текущее состояние против целевого

| Аспект | Сейчас | Цель (Notion) | Дельта |
| --- | --- | --- | --- |
| Подтверждение созидательных действий (`create_project`, `create_task`, `update_task`) | Обязательный `Dialog` «Выполнить предложенные действия?» на весь план ([AiActionPlanCard.tsx](../../../client/src/presentation/components/ai/AiActionPlanCard.tsx)) | Выполняются молча, результат виден в Artifacts | Убрать confirm для неразрушительных типов |
| Подтверждение удаления | Тот же общий диалог, без перечня объектов | Отдельная карточка `Needs review` → `Delete N pages?` со **списком** объектов до решения | Новая карточка + резолв имён до исполнения |
| Удаление задач | Физическое `DELETE`, восстановление = создание задачи с **новым id** (`restoreTask`, AiActionPlanCard.tsx:225) | Мягкое: корзина + `View in Trash` | Миграция `tasks.deleted_at` + trash-API |
| Undo | Локальный журнал в стейте карточки, одноразовый, гибнет при F5 | Undo после выполнения, переживает перезагрузку | Серверный batch-журнал |
| Серверный след «AI применил действия» | Нет вообще: план парсится и исполняется на клиенте, сервер не знает | Есть журнал действий за диалог | Новая таблица батчей |
| Панель Knowledge (что агент смотрел) | Нет. Правая панель `AgentDetails` — **захардкоженный текст** | Список источников + чип с числом результатов, `Show more` | Реальные источники из run-контекста |
| Панель Artifacts (что агент создал) | Нет; «Результаты» считаются регуляркой по наличию ``` в теле | Накопительные карточки `Created · …` за весь диалог | Из batch-журнала |
| Шаги агента | Нет. Роли `system`/`tool` есть в домене, но `ConversationMessage` их не рендерит — молча выпадают | Сворачиваемый блок `N steps` с человекочитаемыми ярлыками (`Thought`, `Queried database`) | Контракт шагов + collapsible |
| Композер | `<textarea>`, **Enter отправляет**, фиксированные `rows`, не растёт | `div[role=textbox]` contenteditable, растёт по контенту, **Enter НЕ отправляет**, только кнопка; кнопка серая при пустом | Переписать композер |
| Пресеты | 3 карточки на лендинге `/ai`, исчезают после старта | 4 пресета под композером, исчезают в начатом диалоге | Выровнять раскладку/число |
| История диалогов | Группировка Сегодня/Прошлая неделя/Последние 30 дней **уже есть** ([AiConversationListPanel.tsx](../../../client/src/presentation/components/ai/AiConversationListPanel.tsx)) | + относительное время (`Now`, `20h`, `2d`, `Jul 13`), иконка, sticky `New chat` | Косметика + sticky-кнопка |
| Действия над сообщением | Копировать + 👍/👎 (локальный `useState`, никуда не шлётся) | Feedback persist, `Edit message` на своём сообщении | Реакции в metadata (Edit — вне scope, см. §5) |
| Стриминг токенов | Нет; SSE-событие триггерит полный `listMessages({limit:100})` | В референсе **не наблюдался** | Не делаем (§5) |

---

## 2–3. Вертикальные срезы

Каждый срез доводится до работающего состояния и может быть выкачен отдельно.

### Срез A. Подтверждение только деструктивных операций + корзина + Undo

Самая ценная механика и точка входа для всех остальных срезов (даёт серверный журнал,
из которого потом кормятся Artifacts).

**Миграции**

- `db/134_task_soft_delete.sql` — `ALTER TABLE tasks ADD COLUMN deleted_at TIMESTAMP NULL`,
  `ADD COLUMN deleted_by CHAR(36) NULL`, индекс `(project_id, deleted_at)`.
  Append-only, MariaDB-синтаксис. **Все существующие выборки задач должны получить
  `AND deleted_at IS NULL`** — это самая рискованная часть миграции (см. риски).
- `db/135_ai_action_batches.sql` — журнал исполнения плана:
  - `ai_action_batches`: `id`, `conversation_id`, `message_id`, `owner_user_id`, `project_id NULL`,
    `status ENUM('pending_review','applied','rejected','undone')`, `plan_json`, `applied_at`,
    `undone_at`, `idempotency_key VARCHAR(100)` + UNIQUE `(conversation_id, idempotency_key)`.
  - `ai_action_batch_items`: `batch_id`, `action_id`, `type`, `entity_kind ENUM('project','task')`,
    `entity_id`, `title`, `status ENUM('pending','done','failed','undone')`, `before_json`,
    `error_message`. `before_json` — снимок для отката `update_task`.

**domain (server)** — `server/src/domain/ai-action/AiActionBatch.ts`: типы `AiActionBatch`,
`AiActionBatchItem`, `AiActionType`, предикат `isDestructiveAction(type)`
(`delete_task`, `delete_all_tasks` → true). `server/src/domain/ai-action/errors.ts`:
`BATCH_NOT_FOUND`, `BATCH_STATE_CONFLICT`, `BATCH_ALREADY_APPLIED`.
`server/src/domain/task/Task.ts` — поле `deletedAt`.

**application (server)** — `server/src/application/ai-action/AiActionBatchRepository.ts` (порт),
`AiActionBatchService.ts` с use-case'ами:
`createBatch` (из плана, статус `applied` для неразрушительных / `pending_review` для деструктивных),
`applyBatch(batchId, expectedStatus)` — идемпотентно по `idempotency_key`,
`rejectBatch`, `undoBatch` (обратный порядок items, `restoreTask` по **тому же id**),
`listBatchesForConversation`.
`server/src/application/task/DeleteTask.ts` → мягкое удаление; новый
`server/src/application/task/RestoreDeletedTask.ts`; `ListTrashedTasks.ts`.

**infrastructure (server)** — `server/src/infrastructure/repositories/DrizzleAiActionBatchRepository.ts`
(транзакции + `SELECT ... FOR UPDATE` на батче, как в `DrizzleAiConversationRepository`),
`server/src/infrastructure/db/schema.ts` (+ 2 таблицы, + `deletedAt/deletedBy` в `tasks`).

**presentation (server)** — `server/src/presentation/ai-action/routes.ts`, монтируется в
[http.ts](../../../server/src/presentation/http.ts) под `/api/ai/action-batches`:
`POST /` (создать батч из плана), `POST /:id/apply`, `POST /:id/reject`, `POST /:id/undo`,
`GET /conversations/:id/batches`. Плюс `GET /api/projects/:id/trash`,
`POST /api/projects/:id/trash/:taskId/restore` в существующих
[tasks/routes.ts](../../../server/src/presentation/tasks/routes.ts).
Zod-схемы — `server/src/presentation/ai-action/schemas.ts`.
Инструкция агента [agentRoutes.ts:actionProtocol](../../../server/src/presentation/ai-conversation/agentRoutes.ts)
дополняется: деструктивные действия обязаны нести человекочитаемый `title` затрагиваемых
объектов (или их фильтр), чтобы карточку можно было отрисовать до исполнения.

**client**
- `client/src/domain/ai-action/AiActionBatch.ts` — зеркальные типы + `isDestructiveAction`.
- `client/src/application/ai-action/AiActionBatchRepository.ts` — порт
  (`create/apply/reject/undo/listForConversation`), по образцу
  [SiteEditorRepository.ts](../../../client/src/application/site-editor/SiteEditorRepository.ts).
- `client/src/infrastructure/http/HttpAiActionBatchRepository.ts` + регистрация в
  `client/src/infrastructure/di/container.tsx`.
- `client/src/presentation/components/ai/AiActionPlanCard.tsx` — переписывается:
  неразрушительные действия исполняются **сразу** при появлении плана (guard от повторного
  запуска — `batchId` из ответа сервера, не локальный флаг); деструктивные рендерят новую
  `client/src/presentation/components/ai/AiDestructiveReviewCard.tsx`.
- `AiDestructiveReviewCard.tsx` — по спецификации §2 референса: заголовок «Удалить N задач?»,
  две кнопки в ряд («Отклонить» нейтральная `bg-hover`, «Удалить» — единственная цветная,
  `variant="destructive"`), под ними скроллируемый список объектов с иконками.
  Базовые метрики берём из
  [ConfirmDeleteDialog.tsx](../../../client/src/presentation/components/tasks/ConfirmDeleteDialog.tsx),
  но это **inline-карточка в ленте, не модалка**.
- `client/src/presentation/components/ai/AiActionResultCard.tsx` — состояние после
  выполнения: «Готово», список затронутого, ссылка «Открыть корзину», кнопка «Отменить».
- Корзина: `client/src/presentation/components/tasks/TrashSheet.tsx` (`Sheet side="right"`,
  `showClose={false}`) + пункт в меню проекта.

**Точки риска**

1. **`deleted_at IS NULL` придётся добавить во ВСЕ выборки задач** — доска, списки, поиск,
   digest, telegram, агент-раннер, аналитика. Пропущенное место = удалённые задачи
   «воскресают» в одном виде и отсутствуют в другом. Мера: единый хелпер
   `notDeleted(tasks)` в `DrizzleTaskRepository` и грепом пройти все `from(tasks)`.
2. `actionProtocol()` на сервере и валидатор в `AiActionPlanCard` — **связанный контракт**;
   правка одной стороны молча ломает планы (блок не парсится и уезжает в текст).
   Менять только парой, тест `AiActionPlanCard.test.ts` обновлять синхронно.
3. Автоисполнение неразрушительных действий без подтверждения означает, что **галлюцинация
   агента сразу материализуется**. Смягчение: лимит ≤200 действий (уже есть),
   идемпотентность по `idempotency_key`, и всегда доступный Undo батча.
4. Порядок исполнения строго последовательный: `create_project` заполняет `refs`, на которые
   ссылаются последующие `create_task`. `Promise.all` сломает и резолв, и корректность отката.
5. Undo `delete` теперь возвращает **тот же id** (soft-restore), а не создаёт новый —
   ссылки/комментарии/история версий переживают откат. Старый `restoreTask` (client) удаляется.
6. Оптимистичная блокировка: `applyBatch` должен принимать статус-guard и возвращать текущее
   состояние вместо ошибки при повторе (паттерн `ResolveProjectJoinRequest`).

**Критерий готовности**

- Промпт «создай проект с тремя задачами» → задачи создаются **без диалога**, в ленте
  появляется результат-карточка.
- Промпт «удали все задачи» → карточка `Needs review` со списком всех N задач по названиям;
  ничего не удалено до нажатия.
- «Удалить» → задачи пропадают с доски, в корзине проекта видны, кнопка «Отменить» возвращает
  их с прежними id и позициями.
- F5 посреди диалога: карточка сохраняет состояние (`applied`/`pending_review`), Undo доступен.
- Повторный клик «Удалить» (двойной клик / ретрай) не удаляет дважды.
- Тесты: `server/src/application/ai-action/AiActionBatchService.test.ts` (apply/reject/undo,
  идемпотентность, конфликт статусов), `server/src/presentation/ai-action/routes.test.ts`,
  клиентский `AiActionPlanCard.test.ts` (деструктивное → review, созидательное → auto-apply).

---

### Срез B. Панели Knowledge / Artifacts

Заменяют декоративный `AgentDetails`.

**domain (server)** — `server/src/domain/ai-conversation/AiKnowledgeSource.ts`:
`{ id, kind: 'project'|'task'|'kb_page'|'document', title, subtitle, href }`.
Artifacts — производные от `ai_action_batch_items` среза A, отдельной сущности не заводим.

**application** — `AiConversationService.listKnowledge(conversationId)` собирает источники из
`context_snapshot_json` рана (уже есть колонка в `ai_conversation_runs`, сейчас не используется
для UI); `AiActionBatchService.listArtifacts(conversationId)` — плоский список успешных items
за весь диалог, накопительно.

**infrastructure** — воркер при `POST .../complete` дополнительно шлёт
`knowledge: [{kind,id,title,subtitle}]` (nullable, обратно совместимо) → пишется в
`metadata_json` рана. Миграция не нужна.

**presentation (server)** — `GET /api/ai/conversations/:id/knowledge`,
`GET /api/ai/conversations/:id/artifacts` в
[ai-conversation/routes.ts](../../../server/src/presentation/ai-conversation/routes.ts).

**client** — порт расширяется теми же двумя методами
([AiConversationRepository.ts](../../../client/src/application/ai-chat/AiConversationRepository.ts)),
адаптер — [HttpAiConversationRepository.ts](../../../client/src/infrastructure/http/HttpAiConversationRepository.ts).
UI: `client/src/presentation/components/ai/AiKnowledgePanel.tsx` и `AiArtifactsPanel.tsx`,
обе — сворачиваемые секции в правой колонке шириной **318px** (референс §4), вместо
`AgentDetails` в [AiConversationView.tsx](../../../client/src/presentation/components/ai/AiConversationView.tsx).
Чип-пилюля с числом: `rounded-full bg-hover`. `Show more` после 6 элементов.
Требуется примитив `client/src/components/ui/collapsible.tsx`
(`npx shadcn@latest add collapsible`) — keyframes `accordion-down/up` в
[tailwind.config.ts](../../../client/tailwind.config.ts) уже есть.

**Точки риска**

1. `AiConversationView` обслуживает три контекста (персональный `/ai`, `StudioChatPane`,
   `StudioMobileChatSheet`) через флаг `personalWorkspace = !projectName && !hideHeader && !compact`.
   Панели показываем **только** в персональном режиме и от `xl:` — иначе студия сломается.
2. Artifacts — **журнал за диалог, а не состояние рабочего пространства** (референс §2.1:
   после удаления карточки `Created` остались). Не пересчитывать по факту существования сущности.
3. Новая зависимость `@radix-ui/react-collapsible` — мелкая, в духе стека, но по CLAUDE.md §8
   подтвердить у владельца.

**Критерий готовности**

- «Перечисли проекты и задачи» → в Knowledge появляются реальные проекты/задачи с подписями,
  чип показывает их число.
- «Создай проект с тремя задачами» → 4 карточки в Artifacts.
- После удаления задач Artifacts **не** уменьшается.
- Панели переживают перезагрузку (данные с сервера, не из стейта).
- В студии проекта и на мобиле раскладка не изменилась.

---

### Срез C. Блок шагов агента

**domain (server)** — `server/src/domain/ai-conversation/AiAgentStep.ts`:
`{ id, kind: 'thought'|'query'|'read'|'write'|'review', label, detail?, startedAt, durationMs? }`.
`label` — человекочитаемая строка на русском («Размышление», «Запрос к базе»), формируется
**на сервере**, не в UI.

**application** — `AiConversationService.completeRun` принимает `steps` и кладёт их в
`metadata_json` ассистентского сообщения. Миграция не нужна — колонка есть в `132`.
Событие `message.updated` уже существует.

**infrastructure/presentation (server)** — `steps` добавляются в схему `completeRunSchema`
([schemas.ts](../../../server/src/presentation/ai-conversation/schemas.ts)) как **optional**
массив ≤50 элементов; `actionProtocol()` в
[agentRoutes.ts](../../../server/src/presentation/ai-conversation/agentRoutes.ts) описывает
воркеру формат шагов. DTO сообщения отдаёт `steps` клиенту.

**client** — `AiMessage.metadata.steps` в
[domain/ai-chat/AiConversation.ts](../../../client/src/domain/ai-chat/AiConversation.ts);
компонент `client/src/presentation/components/ai/AiAgentStepsBlock.tsx`: строка «N шагов ⌄»
(`text-muted-foreground`, 14px/20px), отступ пунктов 26px, шаг 32px; каждый пункт
раскрывается отдельно. Рендерится **над** телом ответа в `ConversationMessage`.
Строка `Needs review` среза A становится последним шагом блока (референс §3).

**Точки риска**

1. Порядок парсинга тела сообщения строго `attachments → action plan → markdown`. Блок шагов
   живёт в `metadata`, **не в теле** — не добавлять четвёртый маркер в body.
2. Анимация раскрытия глушится и `prefers-reduced-motion`, и `html.pf-no-motion`.
3. Пока воркер не шлёт `steps`, блок просто не рендерится — деградация обязана быть тихой
   (старые сообщения без metadata).
4. Не путать со статусом `running`: три точки «Формирую ответ» остаются, блок шагов
   появляется вместе с ними и дополняется.

**Критерий готовности**

- Ответ с шагами показывает «2 шага ⌄», разворачивается, каждый пункт раскрывается отдельно.
- Сообщения без `steps` выглядят как раньше.
- После F5 шаги на месте (лежат в БД).
- Клавиатурная навигация: `aria-expanded`/`aria-controls`, Tab/Enter работают.

---

### Срез D. Паритет композера

**Только presentation, без домена и миграций.**

**client** — [AiComposer.tsx](../../../client/src/presentation/components/ai/AiComposer.tsx):

- `<textarea>` → `div[role="textbox"] contenteditable`, растёт по контенту (без `rows`,
  без `max-h-48` со внутренним скроллом до разумного потолка ~40vh).
- **Enter вставляет перенос строки, НЕ отправляет.** Отправка — только клик по круглой кнопке.
  Это ломающее изменение мышечной памяти: показать одноразовую подсказку под композером.
- Кнопка отправки: `disabled` + нейтральная при пустом поле, `bg-primary` при заполненном.
- Фокус — синяя рамка ~2px вокруг всего блока (`ring-2 ring-ring`), не вокруг поля ввода.
- Левые контролы: `+` (вложение, существующая логика скрепки), `⚙`. Правые: «Авто» (модель),
  кнопка отправки. Микрофон — заглушка/не рисуем (§5).
- Пресеты: 4 карточки под композером на пустом чате
  ([AiPage.tsx](../../../client/src/presentation/pages/AiPage.tsx)), исчезают после первого
  сообщения.
- Кнопка «Стоп» во время генерации — вызывает уже существующий, но **никем не используемый**
  `cancelRun` из порта.

**Точки риска**

1. Черновик в `sessionStorage` по ключу `pf-ai-draft:<conversationId|new>` разделяют
   `AiComposer` и `AiPage.create/createAndSend` (проброс пресет-промпта, восстановление после
   ошибки). Ключ **не переименовывать**; при contenteditable сохранять **plain text**, не HTML.
2. Вставка из буфера: contenteditable по умолчанию тащит HTML/стили. Обязательный
   `onPaste` → `preventDefault` + `insertText`. Отдельная ветка для картинок (существующая
   `prepareAiAttachment`) должна остаться выше текстовой.
3. IME (китайский/японский ввод) и мобильная клавиатура: не вешать логику на `keyDown` без
   проверки `isComposing`.
4. Индикатор «Формирую ответ» сейчас врёт: `sending` сбрасывается в `finally` сразу после
   ответа POST, а не по завершению рана. Кнопку «Стоп» гейтить по **статусу assistant-сообщения**
   (`queued`/`running`), а не по `sending`.
5. Мобильные инсеты: `min-h-*` + padding, никогда `h-*` вместе с `pb-[env(safe-area-inset-*)]`.

**Критерий готовности**

- Enter даёт перенос строки; отправка только кнопкой; Shift+Enter — тоже перенос.
- Поле растёт от 1 строки до потолка, потом скроллится внутри.
- Кнопка серая/неактивна при пустом и пробельном вводе.
- Вставка форматированного текста из Word/браузера даёт plain text.
- Черновик переживает переключение чатов и F5.
- Во время генерации доступна «Стоп», нажатие переводит сообщение в `cancelled`.
- Мобильная раскладка 320/375px не ломается.

---

### Срез E. История диалогов: Today / Past week / Past 30 days

Группировка **уже реализована** в
[AiConversationListPanel.tsx](../../../client/src/presentation/components/ai/AiConversationListPanel.tsx)
(Сегодня / Прошлая неделя / Последние 30 дней / Ранее). Срез — доведение до референса.

**Только presentation.** Добавляем:

- Относительное время справа от заголовка: `Сейчас`, `20 ч`, `2 д`, `13 июл`, `1 нед` —
  чистая функция `client/src/presentation/components/ai/relativeTime.ts` + тест
  `relativeTime.test.ts` (стиль репо: `node:test`, фиксированный `NOW`).
- Иконка чата слева, заголовок с обрезкой в одну строку (`truncate`).
- Sticky-кнопка «Новый чат» внизу панели с подсказкой хоткея.
- Выравнивание заголовков групп: 14px/20px, `text-muted-foreground`.

**Точки риска**

1. Панель одновременно показывает personal и project_studio чаты — группы по времени не должны
   схлопнуть это разделение.
2. Относительное время требует пересчёта: считать от `Date.now()` при рендере, не кешировать
   в состоянии, иначе «Сейчас» залипнет на часы.
3. Sticky-футер панели: `min-h` + safe-area padding, не фикс-высота.

**Критерий готовности**

- Три группы называются и упорядочены как в референсе, пустые группы не рендерятся.
- Относительное время корректно на границах (59 мин → `59 мин`, 25 ч → `1 д`, >7 дней → дата).
- «Новый чат» видна без прокрутки при любой длине истории.
- `relativeTime.test.ts` зелёный.

---

## 4. Порядок исполнения и зависимости

```
A (подтверждение + корзина + Undo)   ← фундамент: batch-журнал на сервере
   └─> B (Knowledge / Artifacts)     ← Artifacts читает ai_action_batch_items
   └─> C (шаги агента)               ← «Needs review» встраивается в блок шагов

D (композер)   — независим, можно параллельно
E (история)    — независим, самый дешёвый
```

1. **A** — первым и целиком. Он один даёт наблюдаемое поведение референса и создаёт данные
   для B. Внутри A порядок жёсткий: миграция 134 → правка всех выборок задач → миграция 135 →
   server-слои → client-слои → UI-карточки.
2. **E** — параллельно с A, силами косметики; выкатывается первым как самый безрисковый.
3. **D** — параллельно с A (не пересекается по файлам: `AiComposer.tsx`/`AiPage.tsx` против
   `AiActionPlanCard.tsx`). Требует отдельной проверки на мобиле.
4. **B** — после A (нужен `ai_action_batch_items`). Требует подтверждения новой зависимости
   `@radix-ui/react-collapsible`.
5. **C** — после B (переиспользует тот же `collapsible`) и после A (шаг `Needs review`).

Каждый срез: `npm test -w @projectsflow/server` + `npm test -w @projectsflow/client` +
`npm run typecheck` + `npm run lint` (тесты в CI не гоняются — прогонять локально обязательно).

---

## 5. Что НЕ делаем и почему

| Не делаем | Почему |
| --- | --- |
| **Токенный стриминг ответа** | В референсе не наблюдался (`Not observed`). Требует переделки контракта воркера, `message.updated` с дельтами и клиентской склейки — отдельный крупный проект, не относящийся к паритету поведения. |
| **Редактирование отправленного сообщения и ветвление** | `parentMessageId` в домене есть, но дерево вариантов — большая механика (UI переключателя веток, контекст для воркера). Референс §7 показывает `Edit message`, но без ветвления это будет ложное обещание. Отложено. |
| **Файловое хранилище вложений** | Таблица `ai_conversation_attachments` создана миграцией 132, но не используется; файлы едут base64 в теле. Переезд на реальное хранилище — самостоятельный срез, на паритет чата не влияет. |
| **Микрофон / голосовой ввод** | В референсе есть иконка, но поведения не снято; STT — новая внешняя зависимость. |
| **Реальный выбор модели** | Плашка «Авто» делается кликабельной визуально, но переключение моделей требует поддержки в воркере и метеринге. Пока — статичная метка. |
| **@-упоминания и слэш-команды в композере** | Центральная механика Notion, но она тянет за собой поиск по сущностям, контекст-пикер и изменение контракта промпта. Отдельный план. |
| **Шаринг чата** | Разговор строго персональный (`ownerUserId`), шаринг требует новой модели доступа. Кнопка «Поделиться» остаётся копированием URL. |
| **Общий `AlertDialog`/`useConfirm()` и миграция 11 мест с `window.confirm`** | Полезная уборка, но она не про AI-чат. Карточка подтверждения в срезе A — **inline в ленте**, ей `AlertDialog` не нужен. |
| **Серверное исполнение плана** | Действия по-прежнему применяет клиент через обычные task/project API — сервер лишь журналирует батч и владеет корзиной/undo. Перенос исполнения на сервер удваивает объём A без выигрыша в наблюдаемом поведении. |
| **Пагинация истории сообщений (жёсткий `limit: 100`)** | Реальная проблема, но ортогональна паритету; чинить отдельно вместе со стримингом. |
| **Sweeper зависших ранов, rate limiting чата** | Инфраструктурный долг, зафиксирован, но вне scope этого плана. |

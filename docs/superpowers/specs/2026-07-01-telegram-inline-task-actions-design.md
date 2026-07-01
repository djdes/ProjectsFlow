# Telegram: инлайн-действия «Завершить» и «Комментировать» в уведомлениях

> Дата: 2026-07-01. Статус: дизайн согласован, ждёт ревью спека → план.

## Проблема

В **письмах** ежедневная сводка-дайджест даёт по каждой задаче кнопки «✅ Завершить» и
«💬 Комментировать», которые работают **без авторизации и без перехода на сайт** —
через одноразовые email-action токены (`/api/email-actions/{token}` → `MoveTask`/`CreateTaskComment`
от лица получателя). В **Telegram** те же уведомления содержат только deep-links «открыть в
приложении». Нужно, чтобы в TG можно было завершить задачу и оставить комментарий **прямо в чате**.

## Ключевое решение: токены не нужны

TG-аккаунт уже привязан к пользователю ProjectsFlow (`UserRepository.findUserIdByTelegramUserId`).
Нажатие inline-кнопки (`callback_query.from.id`) и reply (`message.from.id`) несут TG-user-id, из
которого резолвится PF-user. Права проверяют сами `MoveTask` / `CreateTaskComment` по членству в
проекте — ровно как email-action проверяет по `userId` токена (defense in depth). Поэтому в TG
действия выполняются **напрямую по факту привязки**, без токенов и редиректов.

## Согласованные решения

- **Охват:** ежедневная сводка (дайджест) **и** одиночные задачные уведомления.
- **Раскладка сводки в TG:** одно сообщение-карточка на задачу (inline-кнопки в TG крепятся к
  сообщению целиком, поэтому «кнопка под каждой задачей» = сообщение на задачу).
- **«Завершить»:** мгновенно (тап = готово), с последующей кнопкой **«↩️ Отменить»** на случай
  промаха.
- **Только личные чаты с ботом.** Групповая TG-сводка остаётся информационной (в группе
  персональные «Завершить/Отменить» неоднозначны).

## Дизайн

### 1. Переиспользуемая клавиатура действий задачи

Хелпер `taskActionKeyboard(taskId)` → `InlineKeyboardMarkup`:
`[[ {✅ Завершить, cb:"nd:<taskId>"}, {💬 Комментировать, cb:"nc:<taskId>"} ]]`.
`callback_data` ≤ 64 байт: `nd:`/`nc:`/`nu:` + UUID(36) = 39 байт. Префиксы `nd`/`nc`/`nu`
(notification: done/comment/undo) **не пересекаются** с префиксами конструктора
(`tp,td,tc,tx,da,dd,ac,ab,ae,at,al,ap,ad,as,ts`) и browse (`bt:`).

### 2. Роутинг callback в `HandleTelegramWebhook.execute`

Перед фолбэком на композер (сейчас: `bt:` → browse, иначе → composer) добавить:
- `nd:` → `handleTaskDone(cq)`
- `nc:` → `handleTaskCommentPrompt(cq)`
- `nu:` → `handleTaskUndo(cq)`

Все три: резолв `from.id` → PF-user (нет привязки → `answerCallbackQuery` alert «Привяжи Telegram»);
загрузка задачи; проверка членства (`members.findForProject`); иначе alert.

**`handleTaskDone`:** если задача уже `done` → alert «Уже завершена», перерисовать клавиатуру на
undo. Иначе `MoveTask → done` (deps: новый `moveTask`), `answerCallbackQuery("✅ Завершено")`,
`editMessageText` → добавить строку `✅ Завершено · <displayName>` и заменить клавиатуру на
`[[↩️ Отменить, cb:"nu:<taskId>"]]`, `notifyStatusChanged` + `notifyTaskChanged` (SSE).

**`handleTaskUndo`:** если задача `done` и есть `statusBeforeDone` → `MoveTask` обратно в
`statusBeforeDone` (иначе в `todo` как безопасный дефолт); `answerCallbackQuery("↩️ Возвращено")`,
`editMessageText` → вернуть исходную клавиатуру `taskActionKeyboard`, снять строку «Завершено», SSE.
Undo-кнопка **персистентная** (висит до нажатия) — надёжнее и проще серверного таймера на 10с.

**`handleTaskCommentPrompt`:** `answerCallbackQuery()`; отправить `force_reply`-приглашение
`✍️ Комментарий к «<excerpt>»:` (reply_markup `{force_reply:true, input_field_placeholder}`);
записать его message_id в `telegram_task_messages` (маппинг → задача). Ответ пользователя ловит
**существующий** `handleReply → handleTaskReplyComment` (комментарий + `dispatchCommentNotifications`).
Карточка-уведомление тоже сама по себе replyable (см. §3).

### 3. Регистрация сообщений уведомлений для reply-комментирования

`SendAgentTelegramNotification`:
- добавить dep `taskMessages: TelegramTaskMessageRepository`;
- добавить в команду флаг `registerTaskReply?: boolean`;
- при `status==='ok'` и заданных `taskId` + `registerTaskReply` — best-effort `taskMessages.upsert`
  (как уже делается для `ralphQuestionId`). Нужен `projectId`: добавить в команду `projectId?`.

`BroadcastTelegramNotificationByTask` прокидывает `registerTaskReply` + `projectId` (у него уже
есть `task.projectId`) в каждый `send.execute`.

### 4. Клавиатура на одиночных уведомлениях

Задачные уведомления получают `replyMarkup = taskActionKeyboard(taskId)` + `registerTaskReply:true`:
- комментарий к моей задаче, упоминание (`DispatchCommentNotifications`);
- назначено/делегировано мне (delegation/assign нотификации);
- смена статуса.
**Не трогаем:** уведомление «задача готова» (`taskDone` — завершать нечего, но reply-коммент можно
оставить → регистрируем reply без кнопки «Завершить»); ralph-уточнения (свой reply-поток).

### 5. Дайджест в TG → карточки-действия (личный чат)

В `SendDailyDigest` для персональной TG-доставки вместо `renderDigestTelegram(model)` (общие чанки):
1. Заголовок: `🗒 <b>Ежедневная сводка · <project></b> — N задач`.
2. По каждой задаче (лимит `TG_DIGEST_ACTION_LIMIT = 12`) — карточка
   `📌 <excerpt> (<visibleStatus>)` + `taskActionKeyboard`, отправка через
   `SendAgentTelegramNotification` с `registerTaskReply:true` (reply-коммент работает и на карточку).
3. Хвост при `N>12`: строка «ещё K — открыть в приложении» с deep-link.
Групповая доставка (`telegramClient.sendMessage` в группу) — без изменений.

### 6. Wiring

`HandleTelegramWebhook` получает новый dep `moveTask: MoveTask` (в `index.ts`).
`SendAgentTelegramNotification` получает `taskMessages` (в `index.ts`).
`SendDailyDigest` уже имеет `telegram: SendAgentTelegramNotification` и `settings`/`appUrl`.

## Обрабатываемые крайние случаи

- Нет TG-привязки у нажавшего → alert «Сначала привяжи Telegram».
- Нет доступа к задаче/проекту → alert «Нет доступа».
- Задача удалена → alert «Задача удалена».
- Двойной тап «Завершить» (уже done) → идемпотентно, alert + клавиатура undo.
- `MoveTask`/`CreateTaskComment` бросили → alert, сообщение не ломаем (TG ретраит 5xx лавиной —
  всегда отвечаем 200 на webhook).

## Критерии приёмки

- В личном TG: у задач ежедневной сводки и у одиночных задачных уведомлений есть
  `[✅ Завершить] [💬 Комментировать]`.
- «Завершить» без авторизации/редиректа помечает задачу done, сообщение перерисовывается на
  «✅ Завершено · <имя>» с «↩️ Отменить»; изменения видны в UI (SSE).
- «Отменить» возвращает задачу в прежний статус.
- «Комментировать» (или reply на карточку) добавляет комментарий и рассылает участникам.
- `cd server && npx tsc --noEmit` чисто; клиент не затронут; `http.ts` не трогаем (роутов не
  добавляем — всё в существующем webhook). Тест `HandleTelegramWebhook.test.ts` дополнен кейсами
  nd/nc/nu.

## Файлы (ориентир)

- `server/src/application/telegram/HandleTelegramWebhook.ts` (+ роутинг nd/nc/nu, хелпер клавиатуры)
- `server/src/application/telegram/SendAgentTelegramNotification.ts` (+ taskMessages, registerTaskReply, projectId)
- `server/src/application/telegram/BroadcastTelegramNotificationByTask.ts` (проброс)
- `server/src/application/notifications/DispatchCommentNotifications.ts` и другие места сборки
  задачных TG-уведомлений (+ replyMarkup/registerTaskReply)
- `server/src/application/digest/SendDailyDigest.ts` (карточки-действия для личного TG)
- `server/src/index.ts` (wiring moveTask, taskMessages)
- `server/src/application/telegram/HandleTelegramWebhook.test.ts` (кейсы)

## Вне охвата

- Групповые TG-действия. Клиент/лендинг/`http.ts`. Новые БД-таблицы (реюз `telegram_task_messages`,
  db/049). Таймерная авто-отмена (undo персистентный).

## SOP

Свой worktree, пуш от djdes через PAT `c://users/yaroslav/.gitcredentials`, автодеплой на main,
стейджить только свои файлы, футер `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
Перед пушем: `cd server && npx tsc --noEmit` + `npm test -w server` зелёные.

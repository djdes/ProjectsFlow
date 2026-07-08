# Telegram-бот в группе: задачи от всех участников (гибрид)

Дата: 2026-07-08
Статус: в разработке

## Проблема

Бот в группе реагирует на @упоминание любого участника (гейт из
[2026-06-09-telegram-bot-group-mention-gate](2026-06-09-telegram-bot-group-mention-gate-design.md)
работает), но задача создаётся всегда под **личностью отправителя**:
[`startFromMessage`](../../../server/src/application/telegram/composer/TelegramComposerService.ts)
резолвит *его* аккаунт, предлагает *его* проекты, ставит `ownerUserId: <sender>`, а AI-compose
уходит в очередь *его* аккаунта. Поэтому у владельца задача создаётся (есть проекты + диспетчер),
а у коллеги (напр. `@ProjectsFlow_Bot улучшить распознавание в ScanFlow`) — стопорится на
«⏳ перефразирую…»: ScanFlow не в его пространстве, диспетчера нет.

Group→account-привязки в схеме нет вообще — бот не знает, «чья» это группа.

## Решение — гибрид

Владелец один раз привязывает группу к себе; дальше маршрутизация зависит от того, «свой» ли
отправитель для этого пространства.

### Маршрутизация (текст задачи в `group`/`supergroup`, гейт-упоминание пройден)

`sender` = привязанный аккаунт отправителя (или нет). `owner` = владелец группы (или нет).

**Как отправитель** (полная AI-карточка + кнопки, текущий флоу) — если `sender` привязан И:
- `sender === owner` (владелец всегда получает свою карточку на любое сообщение — UX 1:1), **или**
- в тексте `+Проект`, участником которого `sender` является (реальный коллаборатор), **или**
- у группы ещё нет `owner` (падать некуда → не ломаем текущее поведение).

**В «Входящие» владельца** (мгновенно, без AI, без кнопок) — иначе, если `owner` задан.
Сырой текст + футер-атрибуция «из Telegram · \<группа\>: \<имя\>». Кнопок нет — обходим проверку
«это не твой черновик» (карточку в группе жал бы не владелец-создатель черновика). Сюда попадают:
непривязанные и привязанные-без-своего-`+Проекта`.

**Подсказка** — если `sender` не привязан И `owner` не задан: «Владелец, отправьте здесь /start».

### Привязка группы

Таблица `telegram_group_owners (tg_chat_id BIGINT PK, owner_user_id CHAR(36) FK users, created_at)`.
`bindIfAbsent` — first-writer-wins (идемпотентно). Владелец пишет в группе `/start`:
- не привязан TG → «сначала привяжи в профиле»;
- иначе `bindIfAbsent(chatId, userId)` → ответ о привязке (created / уже он / уже другой).

В группе `/start` **НЕ** зовёт `markTelegramStarted` (иначе DM-уведомления владельца ушли бы в
группу — это ЛС-функция, привязана к личному chat_id).

### Атрибуция

В тип TG-update добавляем `chat.title`, `from.last_name`. Имя = `Имя Фамилия (@username)`.
Футер дописывается в `description` задачи-фолбэка (markdown-строка, cosmetic).

## Реализация

- `db/099_telegram_group_owners.sql`; `schema.ts` → `telegramGroupOwners`.
- `application/telegram/TelegramGroupOwnerRepository.ts` (порт: `getOwnerUserId`, `bindIfAbsent`);
  `infrastructure/repositories/DrizzleTelegramGroupOwnerRepository.ts`.
- `HandleTelegramWebhook`: деп `groupOwners`; расширить тип update (`chat.title`, `from.last_name`);
  в группе `/start` → `handleGroupStart` (bind), текст → передать `groupCtx {ownerUserId, senderName,
  groupTitle}` в композер.
- `TelegramComposerService.startFromMessage(…, groupCtx?)`: развилка `resolveGroupRouting` +
  `createInOwnerInbox` (через существующие `getOrCreateInbox` + `createTask`).
- `index.ts`: собрать репозиторий, передать в вебхук.

## Тесты (node:test)

Webhook: `/start` в группе → `bindIfAbsent` вызван, `markTelegramStarted` нет; текст в группе →
composer получил `groupCtx`. Composer: owner→self; коллега без `+Проекта` при заданном owner →
owner-inbox с атрибуцией; коллега с `+своим` проектом → self; непривязанный при owner → owner-inbox;
непривязанный без owner → nudge; личка (нет groupCtx) → без изменений.

## Вне рамок

AI-перефраз для owner-fallback (кладём сырой текст); авто-bind по `my_chat_member` при добавлении
бота; мультитенант-переезд с `AI_PROMPT_DEFAULT_DISPATCHER`. Надёжный фикс включается после того,
как владелец один раз отправит `/start` в группе.

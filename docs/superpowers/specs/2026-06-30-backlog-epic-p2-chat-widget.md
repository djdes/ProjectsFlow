# P2 — Чат-виджет: AI-помощник + поддержка в Telegram

> **Готовый промпт для запуска сессии:**
> «Создай свой worktree от github/main. Выполни план
> `docs/superpowers/specs/2026-06-30-backlog-epic-p2-chat-widget.md` целиком — очень долго и детально,
> не экономь токены. В начале спроси у меня `chat_id` Telegram-поддержки. Следуй SOP внутри (пуш от
> djdes через PAT `c://users/yaroslav/.gitcredentials`, автодеплой на main).»

---

## 0. Закрываемая задача

`293d1984-66dc-4879-9de1-b16ff2ce3177` — «Онлайн помощник чат и ии чат справа снизу такой же как
на скринах, только с нашим стилем и с нашим описанием». 3 скрина-референса (чужой продукт
**WeSetup**, пищевая безопасность): (1) два плавающих launcher-пузыря снизу справа; (2) панель
«AI помощник» (градиентная шапка, аватар-бот, интро, чипы-подсказки, дисклеймер, поле ввода + send);
(3) панель «Связаться с поддержкой» (текст «отвечаем в Telegram в течение N часов», textarea,
счётчик `0/2000`, кнопка «Отправить»). **Берём ТОЛЬКО раскладку/UX. Контент и стиль — наши,
бренд ProjectsFlow.** Перед стартом — `pf_get_task` (прочитать тред).

## 1. Цель

Плавающий виджет снизу справа **на лендинге и в приложении** с двумя режимами:
1. **AI-помощник** — реальные LLM-ответы про ProjectsFlow (как пользоваться: доска, worker,
   автоматизация, финансы, тарифы), чипы-подсказки, дисклеймер «Ответы AI — рекомендация».
   Переиспользует существующую prompt-jobs инфру (long-poll). Короткая история — в локальном стейте.
2. **Связаться с поддержкой** — форма (textarea + счётчик ≤2000) → сообщение уходит в **Telegram-чат
   поддержки** команды + тикет в БД.

## 2. Решения (из мастер-плана)

- Показывать **и на лендинге, и в app**.
- AI — **реальный**, через существующий prompt-jobs пайплайн (long-poll, без стриминга/без серверной
  истории; историю держим на клиенте и шлём контекстом в промпт). + кнопка «поддержка».
- Доставка поддержки — **Telegram-чат поддержки** (`SUPPORT_TELEGRAM_CHAT_ID`). Fallback см. §6.

## 3. Контекст инфраструктуры (переиспользовать, факты из разведки)

- **AI-клиент:** `client/src/application/ai/AiPromptRepository.ts` (порт),
  `client/src/infrastructure/http/HttpAiPromptRepository.ts` (`enqueue(input)` / `waitFor(jobId)`),
  DI в `client/src/infrastructure/di/container.tsx`.
- **AI-сервер:** `POST /api/ai/prompt-jobs` (body `{ text, projectId?, mode:'improve'|'compose'|'compose-advanced' }`)
  + `GET /api/ai/prompt-jobs/:jobId?wait=25` (long-poll, 504 по таймауту). Роуты —
  `server/src/presentation/ai-prompt/routes.ts`. Есть rate-limit (429), ошибки `no_dispatcher`,
  `ai_not_configured`.
- **Telegram-сервер:** `server/src/application/telegram/TelegramClient.ts` (низкоуровневый клиент),
  `SendAgentTelegramNotification.ts` (отправка с префами/дедупом/аудитом), вебхук
  `server/src/presentation/telegram/webhookRoutes.ts`.
- **Монтаж глобального UI:** app — `client/src/presentation/layout/AppShell.tsx`; провайдеры —
  `client/src/main.tsx`. Серверные роуты монтируются в `server/src/presentation/http.ts`.
- **Профиль:** `client/src/presentation/pages/ProfilePage.tsx`. **Стиля/инсеты PWA** — см. CLAUDE.md
  (мобильный таб-бар, safe-area; плавающие элементы поднимать на
  `bottom-[calc(4.5rem_+_env(safe-area-inset-bottom))]`, использовать `min-h-*`, не `h-*`+padding).

## 4. Открытый вход (СПРОСИТЬ пользователя в начале сессии)

- **`SUPPORT_TELEGRAM_CHAT_ID`** — куда слать тикеты поддержки. Спроси chat_id (или @username →
  резолвить ботом в chat_id). Запиши в `.env`, `.env.example` и `docs/ONBOARDING.md`.
  **Fallback**, если не задан: тикет сохраняется в БД + (опц.) нотификация владельцу через
  `SendAgentTelegramNotification`. Не падать без переменной.

## 5. Архитектура (Clean Arch)

### Клиент (app) — новый модуль `client/src/presentation/components/help/`
- `HelpWidget.tsx` — корневой: floating launcher (одна кнопка с бейджем; по клику — панель с табами
  «Помощник» / «Поддержка»; либо два пузыря как на скрине — на выбор, по эстетике приложения).
  Управление open/закрытием, позиционирование (fixed bottom-right; мобильные инсеты PWA).
- `HelpAssistantPanel.tsx` — лента сообщений (user/assistant), чипы-подсказки (частые вопросы),
  дисклеймер, инпут + отправка; индикатор «печатает…» во время long-poll; обработка ошибок
  (rate-limit/ai_not_configured → дружелюбный текст + кнопка «написать в поддержку»).
- `HelpSupportPanel.tsx` — textarea (счётчик `len/2000`), кнопка «Отправить», success/ҏerror-стейты,
  текст «команда ProjectsFlow отвечает в Telegram».
- **Состояние/типы:**
  ```ts
  type HelpMessage = { id:string; role:'user'|'assistant'; text:string; at:number };
  // история — useState/useReducer в HelpWidget; контекст последних N (напр. 8) сообщений
  // склеивается в prompt для assistant-режима.
  ```
- **Application:** `client/src/application/help/AskAssistant.ts` (use-case: формирует prompt из
  истории + системного контекста-якоря, вызывает порт), `SubmitSupport.ts`. Порт
  `client/src/application/help/HelpRepository.ts`.
- **Infrastructure:** `client/src/infrastructure/http/HttpHelpRepository.ts` —
  `askAssistant(messages)` → `POST /api/help/ask` (или переиспользовать `aiPromptRepository` с новым
  режимом `assistant`); `submitSupport({message,source})` → `POST /api/help/contact-support`.
- **DI:** зарегистрировать `helpRepository` (+use-cases) в `container.tsx` (добавить строки рядом с
  `aiPromptRepository`). **Только P2 трогает `container.tsx` в этом эпике.**
- **Монтаж:** в `AppShell.tsx` отрендерить `<HelpWidget/>` (виден залогиненному; fixed/портал,
  z-index выше мобильного таб-бара; на мобиле — над таб-баром по инсетам).

### Сервер — новый модуль `server/src/{domain,application,infrastructure,presentation}/help/`
- **AI-ассистент:** предпочтительно **добавить режим `assistant`** в существующий prompt-jobs
  пайплайн (минимальное расширение): системный промпт-«якорь» про ProjectsFlow (что за продукт,
  доска/worker/автоматизация/финансы/тарифы, ссылки на доки), на вход — склеенная история. Либо
  новый роут `POST /api/help/ask`, переиспользующий ту же job-очередь. Соблюсти rate-limit.
  - Системный промпт держать в одном месте (`server/src/application/help/assistantSystemPrompt.ts`),
    кратко и точно описать продукт; запретить выдумывать факты, при незнании — предлагать поддержку.
- **Поддержка:** `POST /api/help/contact-support` — zod-валидация `{ message: string(1..2000),
  source: 'app'|'landing' }`; запись в `support_tickets`; отправка в Telegram
  (`SUPPORT_TELEGRAM_CHAT_ID`) через `TelegramClient`/`SendAgentTelegramNotification` с указанием
  отправителя (userId/имя, если авторизован; для лендинга — аноним). Вернуть `{ ok:true }`.
  Rate-limit (защита от спама с лендинга): напр. ≤5/час на IP/сессию.
- **Роуты:** новый `helpRouter` смонтировать в `server/src/presentation/http.ts` (**только P2 трогает
  http.ts в этом эпике** — конфликтов нет).
- **БД-миграция** `db/0NN_support_tickets.sql` (append-only, MariaDB-совместимо; перед созданием
  `ls db/ | sort` → взять max+1; зафиксировать номер в коммите):
  ```sql
  CREATE TABLE support_tickets (
    id           CHAR(36) PRIMARY KEY,
    user_id      CHAR(36) NULL,             -- NULL для анонима с лендинга
    message      TEXT NOT NULL,
    source       ENUM('app','landing') NOT NULL,
    status       ENUM('open','closed') NOT NULL DEFAULT 'open',
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  ```
  Drizzle-схему обновить (`server/src/infrastructure/db/schema.ts`) + репозиторий
  `DrizzleSupportTicketRepository`.

### Лендинг — только создать остров (НЕ трогать BaseLayout)
- `landing/src/components/HelpWidget.astro` (+ React-island, если нужен) — самодостаточный виджет для
  лендинга: для анонима AI-помощник про продукт (через тот же `/api/help/ask`) + кнопка поддержки
  (`source:'landing'`). Стиль — токены лендинга (P0). **Подключение в `BaseLayout.astro` делает P1**
  (зависимость по очереди, не по файлу). Если P1 уже прошёл — согласовать.

## 6. Поведение AI-режима (детали UX)

- При открытии — приветствие + 3–4 чипа-подсказки (напр. «Как бросить задачу воркеру?», «Что такое
  автоматизация?», «Чем отличаются тарифы?», «Как работает финучёт?»).
- Отправка: добавить user-сообщение в ленту → enqueue prompt-job (mode `assistant`, текст = история+
  вопрос) → показать «печатает…» → `waitFor` → добавить assistant-сообщение. Дисклеймер под лентой.
- Ошибки: `ai_not_configured`/`no_dispatcher`/429 → дружелюбное сообщение + CTA «Написать в
  поддержку» (переключить на таб поддержки).

## 7. Критерии приёмки

- [ ] Виджет виден снизу справа в приложении (залогинен); остров готов для лендинга (аноним).
- [ ] Два режима: AI-чат (реальные ответы про продукт, чипы, дисклеймер, «печатает…», обработка
      ошибок) и форма поддержки (счётчик ≤2000, success/error).
- [ ] Поддержка доставляется в Telegram-чат (`SUPPORT_TELEGRAM_CHAT_ID`) ИЛИ fallback (тикет в БД +
      нотификация владельцу), тикет всегда пишется в `support_tickets`.
- [ ] Стиль наш (ProjectsFlow), не копия WeSetup; анимации плавные; reduced-motion уважается;
      мобильные инсеты PWA корректны (над таб-баром, `min-h`, не `h-*`+padding).
- [ ] Rate-limit на отправку поддержки (анти-спам с лендинга).
- [ ] `npm run typecheck` + `npm run lint` (клиент) чисто; `cd server && npx tsc --noEmit` чисто;
      миграция корректна; Drizzle-схема обновлена.
- [ ] `.env.example` + `docs/ONBOARDING.md` дополнены `SUPPORT_TELEGRAM_CHAT_ID`.

## 8. Edge-кейсы / риски

- AI стейтлесс на сервере → историю шлём контекстом; ограничить длину (последние N сообщений), не
  раздувать токены.
- Виджет на лендинге (Astro) и в app (React) — переиспользуй максимум логики, но это разные среды
  (island vs компонент). Не тащить app-зависимости в лендинг-бандл.
- Анонимные тикеты (лендинг) — `user_id NULL`; защита от спама обязательна.
- Telegram-доставка может упасть (бот не в чате) — не терять тикет (он уже в БД), залогировать.
- Z-index/перекрытие с мобильным таб-баром и плавающими кнопками доски — проверить.

## 9. Файлы — кто владеет (НЕ выходить за пределы)

- Клиент: `client/src/presentation/components/help/**`, `client/src/application/help/**`,
  `client/src/infrastructure/http/HttpHelpRepository.ts`, строки в
  `client/src/infrastructure/di/container.tsx`, блок монтажа в `client/src/presentation/layout/AppShell.tsx`.
- Сервер: `server/src/{domain,application,infrastructure,presentation}/help/**`, строки монтажа в
  `server/src/presentation/http.ts`, `db/0NN_support_tickets.sql`, обновление
  `server/src/infrastructure/db/schema.ts` (добавление таблицы), при необходимости — режим
  `assistant` в `server/src/.../ai-prompt/*` (минимально).
- Лендинг: `landing/src/components/HelpWidget*` (**только создать**).
- **НЕ трогать:** лендинг-секции/`BaseLayout.astro`/`globals.css` (P0/P1), окно автоматизации/
  digest-роуты (P3).

## 10. SOP (полная версия — `…-00-master.md` §5)

- Свой worktree; только свои файлы (не `git add -A`). Remote `github`, пуш от **djdes**, PAT
  `c://users/yaroslav/.gitcredentials`. Пуш: fetch+rebase `github/main` →
  `git -c credential.helper= -c credential.helper="store --file=c://users/yaroslav/.gitcredentials" push github HEAD:main`.
- **Автодеплой на main** — перед пушем все проверки зелёные (typecheck/lint клиента, `tsc` сервера,
  миграция). Миграция применяется на проде — синтаксис строго MariaDB-совместимый, append-only.
- Футер: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- MCP-ритуал по задаче `293d1984`.
- РАБОТАЙ ДОЛГО/ДЕТАЛЬНО, не экономь токены, без заглушек.

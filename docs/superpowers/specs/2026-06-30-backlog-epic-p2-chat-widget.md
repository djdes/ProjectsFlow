# P2 — Чат-виджет: AI-помощник + поддержка в Telegram

> **Готовый промпт для запуска сессии:**
> «Выполни план `docs/superpowers/specs/2026-06-30-backlog-epic-p2-chat-widget.md` целиком — очень
> долго и детально, не экономь токены. В начале спроси у меня chat_id Telegram-поддержки. Следуй SOP
> внутри (worktree, пуш от djdes через PAT c://users/yaroslav/.gitcredentials, автодеплой на main).»

## Закрываемая задача

- `293d1984-66dc-4879-9de1-b16ff2ce3177` — «Онлайн помощник чат и ии чат справа снизу такой же как
  на скринах, только с нашим стилем и с нашим описанием». (3 скрина-референса в задаче — раскладка
  чужого продукта WeSetup; **берём только раскладку, контент наш, бренд ProjectsFlow**.)

## Цель

Плавающий виджет снизу справа **на лендинге и в приложении** с двумя режимами:
1. **AI-помощник** — реальные LLM-ответы про ProjectsFlow (как пользоваться продуктом), с
   подсказками-чипами и дисклеймером, поле ввода + отправка. Переиспользует существующую
   prompt-jobs инфру (long-poll, однотуровый / короткая история).
2. **Связаться с поддержкой** — форма (textarea + счётчик символов) → сообщение уходит в
   **Telegram-чат поддержки** команды (+ тикет в БД).

Стиль — наш (токены приложения/лендинга), как в скринах: компактные панели, скруглённый
floating-launcher (одна-две кнопки), аккуратные анимации (плавно, уважать reduced-motion).

## Контекст (инфра — переиспользовать)

- **AI:** клиент `client/src/application/ai/AiPromptRepository.ts`, `HttpAiPromptRepository`
  (`enqueue`/`waitFor`); сервер `POST /api/ai/prompt-jobs`, `GET /api/ai/prompt-jobs/:id?wait=`
  (режимы `improve|compose|compose-advanced`, long-poll). Стейтлесс, без стриминга.
- **Telegram:** `server/src/application/telegram/{TelegramClient,SendAgentTelegramNotification}.ts`,
  вебхук `server/src/presentation/telegram/webhookRoutes.ts`.
- **Монтаж:** app — `client/src/presentation/layout/AppShell.tsx`; лендинг —
  `landing/src/layouts/BaseLayout.astro` (подключение делает P1, P2 только создаёт остров-файл).
- **DI клиента:** `client/src/infrastructure/di/container.tsx`. **Монтаж серверных роутов:**
  `server/src/presentation/http.ts`.

## Открытый вход (спросить пользователя в начале)

- **`SUPPORT_TELEGRAM_CHAT_ID`** — куда слать тикеты поддержки. Спроси chat_id (или @username →
  резолвить в chat_id). Запиши в `.env`/`.env.example` и в `docs/ONBOARDING.md`. **Fallback**, если
  не задан: сохранять тикет в БД + слать владельцу/админу через `SendAgentTelegramNotification`.

## Реализация

### Клиент (app)
- Новый модуль `client/src/presentation/components/help/` — `HelpWidget.tsx` (floating launcher +
  панель с табами «Помощник»/«Поддержка»), `HelpAssistantPanel.tsx`, `HelpSupportPanel.tsx`.
  Стиль — токены приложения, shadcn-примитивы; floating снизу справа (на мобиле — над таб-баром:
  `bottom-[calc(4.5rem_+_env(safe-area-inset-bottom))]`, `min-h`, не `h-*`+padding — см. CLAUDE.md
  про PWA-инсеты).
- AI: `client/src/application/help/AskAssistant.ts` (use-case) + порт; реализация в
  `client/src/infrastructure/http/HttpHelpRepository.ts` (или переиспользовать `AiPromptRepository`
  с новым режимом `assistant`). Подсказки-чипы (частые вопросы про продукт), дисклеймер «Ответы AI —
  рекомендация». Короткая история сообщений в локальном состоянии (стейтлесс на сервере ок).
- Поддержка: метод `submitSupport(message)` → `POST /api/help/contact-support`.
- DI: зарегистрировать новые репозитории в `container.tsx` (добавление строк).
- Монтаж в `AppShell.tsx` — один блок (виден залогиненным; портал/fixed, z-index выше таб-бара).

### Сервер
- Новый модуль `server/src/{domain,application,infrastructure,presentation}/help/`:
  - **AI-ассистент:** добавить режим `assistant` в prompt-jobs (системный промпт про ProjectsFlow:
    что за продукт, доска/воркер/автоматизация/финансы/тарифы) ИЛИ новый роут `POST /api/help/ask`,
    переиспользующий ту же job-инфру. Предпочтительно — минимальное расширение существующего
    prompt-job пайплайна.
  - **Поддержка:** `POST /api/help/contact-support` → валидация (zod, ≤2000 симв.), запись в
    `support_tickets`, отправка в Telegram (`SUPPORT_TELEGRAM_CHAT_ID`) через `TelegramClient`;
    fallback на нотификацию владельцу. Вернуть `{ ok }`.
  - Монтаж роутов в `server/src/presentation/http.ts` (**только P2 трогает http.ts в этом эпике**).
- **Миграция** `db/0NN_support_tickets.sql` (append-only, MariaDB; `ls db/ | sort` → max+1):
  `support_tickets (id, user_id NULL, message TEXT, source ENUM('app','landing'), status, created_at)`.

### Лендинг (только создать остров)
- `landing/src/components/HelpWidget.tsx` (или `.astro` + island) — самодостаточный виджет для
  лендинга (для анонимов: AI-помощник про продукт + кнопка поддержки). **Не редактировать**
  `BaseLayout.astro` — его подключит P1. Если P1 уже прошёл — согласовать.

## Критерии приёмки

- Виджет виден снизу справа в приложении (и остров готов для лендинга). Две функции: AI-чат
  (реальные ответы про продукт) и форма поддержки.
- Стиль наш (ProjectsFlow), не копия WeSetup; контент — про наш продукт; анимации плавные,
  reduced-motion уважается; мобайл-инсеты ок (PWA).
- Поддержка доставляется в Telegram-чат (или fallback) + тикет в БД.
- `npm run typecheck`, `npm run lint` (клиент) чисто; `cd server && npx tsc --noEmit` чисто;
  миграция корректна.

## Зависимости / порядок

- Ни от чего не зависит — можно параллельно с P0/P3. Желательно завершить **до P1** (P1 монтирует
  виджет-остров на лендинг).
- **Только P2 редактирует** `server/src/presentation/http.ts` и `client/.../di/container.tsx` в этом
  эпике — конфликтов нет.

## SOP (кратко; полная версия в `…-00-master.md` §5)

- Свой worktree; только свои файлы (не `git add -A`). Remote `github`, пуш от **djdes**, PAT
  `c://users/yaroslav/.gitcredentials`. Пуш: fetch+rebase `github/main` →
  `git -c credential.helper= -c credential.helper="store --file=c://users/yaroslav/.gitcredentials" push github HEAD:main`.
- **Автодеплой на main** — перед пушем все проверки зелёные.
- Футер: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- MCP-ритуал по задаче `293d1984` (комментарии прогресса; после push — link commit; done — по
  подтверждению).
- РАБОТАЙ ДОЛГО/ДЕТАЛЬНО, не экономь токены, без заглушек.

# Backlog-эпик ProjectsFlow — мастер-план (2026-06-30)

> Этот документ — **индекс и общий контракт** для серии сессий. Он разбивает 6 черновиков
> проекта ProjectsFlow на **4 плана с НЕПЕРЕСЕКАЮЩИМИСЯ файлами**, фиксирует общие решения
> (бренд, тарифы, дизайн-процесс) и **SOP** (git/деплой), чтобы параллельные сессии не
> конфликтовали. Каждый план — отдельный файл `2026-06-30-backlog-epic-pN-*.md`.
>
> **Как запускать:** в новой сессии скажи «делай план P2» (или дай готовый промпт из плана).
> Сессия читает свой файл и выполняет его целиком — долго, детально, не экономя токены.

---

## 0. Контекст проекта (факты из разведки — НЕ перепроверять заново)

- **Лендинг существует** и это **отдельный Astro-проект** в `landing/` (CLAUDE.md устарел — там
  написано, что лендинг снесён; это не так). Сервируется Express'ом: `/` для неавторизованных →
  лендинг, для авторизованных → SPA; `/landing` всегда лендинг. Сборка: `npm run build:landing`
  (astro → `landing/dist/`). Дев: `npm run dev:landing` (Astro :4321).
- Секции лендинга: `landing/src/pages/index.astro` (оркестратор) + компоненты
  `landing/src/components/{Nav,Hero,Features,HowItWorks,CTASection,Footer,SectionDivider}.astro`,
  макет `landing/src/layouts/BaseLayout.astro`, стили `landing/src/styles/globals.css`.
- **Three.js** на лендинге: `landing/src/components/HeroScene.tsx` (~1115 строк, React Three Fiber
  + drei + postprocessing, three ^0.171, бандл ~0.45–0.55 МБ). Монтируется в `Hero.astro` через
  `<HeroScene client:idle />`, обёрнут в `<Suspense fallback={null}>`. **Проблемы:** не уважает
  `prefers-reduced-motion`, нет отключения на мобиле (только AdaptiveDpr).
- **Тарифов/подписок в коде НЕТ вообще** (ни модели, ни биллинга, ни usage). Есть только
  пер-проектные финансы (`project_expenses/incomes`) — это НЕ подписка.
- **Окно автоматизации:** `client/src/presentation/components/project/AutomationDialog.tsx`
  (~928 строк). Репозитории `AutomationRepository` / `DigestSettingsRepository`; серверные роуты
  `server/src/presentation/automation/routes.ts` и `server/src/presentation/digest/routes.ts`;
  таблицы `project_automation`, `project_automation_criteria`, `project_digest_settings`.
  Telegram-группа вводится **вручную** (text-поле `chat_id`, без истории/пикера).
- **AI-инфраструктура (для чат-виджета):** клиент `client/src/application/ai/AiPromptRepository.ts`
  + `HttpAiPromptRepository` (`enqueue` / `waitFor`); сервер `POST /api/ai/prompt-jobs`,
  `GET /api/ai/prompt-jobs/:id?wait=` (long-poll, режимы `improve|compose|compose-advanced`).
  **Стейтлесс, без стриминга, без истории.**
- **Telegram-инфра (для саппорта):** `server/src/application/telegram/{TelegramClient,SendAgentTelegramNotification}.ts`,
  вебхук `server/src/presentation/telegram/webhookRoutes.ts`. Можно переиспользовать для доставки
  сообщений поддержки.
- **Монтирование глобального виджета:** `client/src/presentation/layout/AppShell.tsx` (app),
  `landing/src/layouts/BaseLayout.astro` (лендинг). Провайдеры — `client/src/main.tsx`.
- **Профиль:** `client/src/presentation/pages/ProfilePage.tsx` (без подписки сейчас).
- **Стек:** Vite + React 19 + TS + Tailwind + shadcn/ui (Clean Architecture: domain → application →
  infrastructure → presentation; presentation ходит в infrastructure только через
  `useContainer()`). Сервер Express 4 + Drizzle + MariaDB. Лендинг — Astro (отдельно).

---

## 1. Решения (зафиксированы пользователем — общий контракт для всех планов)

- **Scope:** только **6 черновиков** (см. §2). Колонку «Вручную» (email-сводка, тарифы↔юзеры+usage,
  лимиты, VIP-выдача) — НЕ трогаем в этих планах.
- **Бренд:** остаётся **ProjectsFlow** (не «Project Flow»). Со скринов чата (чужой продукт
  «WeSetup», пищевая безопасность) берём **только раскладку/стиль**, контент — наш.
- **Позиционирование лендинга:** «онлайн доска задач для проектов **вайб-кодеров**» + автоматизация
  (диспетчер сам делает задачи) + **пер-проектный финучёт** + **встроенная AI-подписка** (бросаешь
  задачи воркеру, выполняется по нашей подписке).
- **Тарифы (только ВИТРИНА на лендинге; реальной логики подписки в коде НЕ делаем):**
  | Тариф | Цена | Суть | Особенности |
  |---|---|---|---|
  | **Бесплатный** | 0 ₽ | до 5 проектов; колонка `worker` — бросаешь задачи, выполняются по твоей подписке | (переименование из «Самостоятельный») |
  | **Прайм** | $20 / 1 900 ₽ в мес | подключение проектов через наши подписки, самостоятельно, без нашей помощи | (переименование из «Экспер»); на витрине можно показать «попробовать 1 час» |
  | **ВИП** | 3 900 ₽ в мес | настройка проекта с нашей помощью, подробная инструкция | на витрине помечен «по запросу / недоступен для самоподключения» |
  > Цены/формулировки — финальные из задач; если будут правки текста — менять только в одном
  > месте (`landing/src/data/pricing.ts`, создаётся в P1).
- **Three.js:** **оставить** сцену на десктопе, но **починить**: уважать `prefers-reduced-motion`,
  **полностью отключать на мобиле** (статичный poster/градиент), перф-бюджет + fallback на слабых
  GPU. (Делается в P1.)
- **Чат-виджет:** показывать **и на лендинге, и в приложении**. AI — **реальный**, переиспользуя
  существующую prompt-jobs инфру (однотуровый/короткая история, long-poll) + кнопка «поддержка».
  Доставка поддержки — **в Telegram-чат поддержки** (chat_id см. §4 «Открытые входы»).
- **Дизайн-направление:** **сессия сама генерит 2–3 варианта** (mockup'ы), показывает пользователю,
  ждёт выбора, потом строит. Это делает **P0** (дизайн-фундамент) для лендинга.
- **Разбивка:** **4 плана** (см. §3).

---

## 2. Черновики (backlog) → планы

| Task ID | Заголовок | План |
|---|---|---|
| `e5720512-3830-491b-838a-3f16114991f3` | Позиционирование лендинга для вайб-кодеров | **P1** |
| `9ae0842f-b15f-473a-86ab-02924fb30427` | Лендинг: Grand Offer, гарантии, скриншоты | **P1** |
| `0c770033-ee3d-4fa9-8d91-4ffa4372d90c` | Переименование тарифов (витрина) | **P1** |
| `903d484f-ddb5-43be-b16a-bed6618ae5ba` | Разработать 3 тарифа (витрина) | **P1** |
| `293d1984-66dc-4879-9de1-b16ff2ce3177` | Онлайн-помощник: чат + AI-чат | **P2** |
| `d96d69d2-38b0-47ad-a2c6-2e3e7c41ae74` | Доработка окна автоматизации | **P3** |

> Проект в ProjectsFlow MCP: `b1dd4e7a-4319-407d-b0e4-ead628c28cc0`.
> P0 — подготовительный (дизайн-фундамент лендинга), отдельной задачи в канбане нет.

---

## 3. Планы и порядок запуска

| План | Файл | Что делает | Зависит от | Можно параллельно с |
|---|---|---|---|---|
| **P0** | `…-p0-design-foundation.md` | 2–3 дизайн-варианта лендинга → выбор → дизайн-токены/примитивы | — | P2, P3 |
| **P1** | `…-p1-landing.md` | Полный редизайн лендинга: позиционирование, Grand Offer, витрина тарифов, three.js-fix | **P0** (токены), **P2** (для монтажа виджета на лендинг) | P3 |
| **P2** | `…-p2-chat-widget.md` | Чат-виджет (AI + поддержка): client + server + БД; монтаж в app | — | P0, P1(нач.), P3 |
| **P3** | `…-p3-automation-dialog.md` | Окно автоматизации: визуал, мастер-тоггл, разделение блоков, история group-id + имя группы | — | все |

**Рекомендуемый порядок:** запусти **P0, P2, P3 параллельно**. Когда P0 и P2 завершены — запусти
**P1** (он использует токены из P0 и монтирует виджет из P2 на лендинг). P3 ни от кого не зависит.

**Файловые границы (НЕ пересекаются):**
- **P0** владеет: `landing/src/styles/globals.css`, `landing/src/styles/tokens.css` (новый),
  `landing/tailwind.config.*` (если есть), `landing/.design-variants/**` (мокапы), `landing/DESIGN.md` (новый).
  P0 НЕ трогает секции-компоненты лендинга.
- **P1** владеет: `landing/src/pages/index.astro`, `landing/src/components/*.astro`,
  `landing/src/components/HeroScene.tsx`, `landing/src/layouts/BaseLayout.astro`,
  `landing/src/data/**` (новый, напр. `pricing.ts`), новые секции (`Pricing.astro`, `Guarantees.astro`,
  `Screenshots.astro`). P1 **читает** токены из P0, но НЕ редактирует `globals.css`/`tokens.css`.
- **P2** владеет: `client/src/presentation/components/help/**` (новый), `client/src/application/help/**`,
  `client/src/infrastructure/http/HttpHelp*` (новый), DI-регистрация в `client/src/infrastructure/di/container.tsx`
  (добавление строк), монтаж в `client/src/presentation/layout/AppShell.tsx` (добавление 1 блока),
  сервер `server/src/{domain,application,infrastructure,presentation}/help/**` (новый) + монтаж роутов в
  `server/src/presentation/http.ts` (добавление строк), новая миграция `db/0NN_support_tickets.sql`,
  виджет-остров для лендинга `landing/src/components/HelpWidget*` (новый файл, **только создаёт**;
  включение в `BaseLayout.astro` делает P1).
- **P3** владеет: `client/src/presentation/components/project/AutomationDialog.tsx`,
  `client/src/presentation/components/project/MultiTaskWorkerToggle.tsx` (если нужно),
  client/server digest-репозитории и роуты (`server/src/presentation/digest/**`), новая миграция
  `db/0NN_digest_group_history.sql` (если нужна история group-id).
- **Точки соприкосновения и как их избежать:**
  - `client/src/infrastructure/di/container.tsx` и `server/src/presentation/http.ts` могут править
    и P2 (и теоретически другие). **Только P2 их трогает в этом эпике** — конфликта нет.
  - `landing/src/layouts/BaseLayout.astro` правит **только P1**. P2 кладёт компонент-остров, P1 его
    подключает (зависимость по очереди, не по файлу).
  - Номера миграций (`db/0NN_*.sql`): P2 и P3 берут **разные** следующие номера. Перед созданием —
    `ls db/ | sort` и взять max+1 (P2) и max+2 (P3), чтобы не столкнуться. Зафиксируй номер в
    своём коммите.

---

## 4. Открытые входы (нужны от пользователя при запуске)

- **P2 — chat_id Telegram-поддержки:** пользователь выбрал доставку тикетов в Telegram-чат
  поддержки, но **не указал chat_id/@username**. Поведение: добавить серверный конфиг
  `SUPPORT_TELEGRAM_CHAT_ID` (env). **Если не задан** — fallback: тикет сохраняется в БД и
  отправляется владельцу/админу через существующую нотификацию; в начале P2 СПРОСИТЬ у
  пользователя chat_id и записать в `.env`/`docs/ONBOARDING.md`.
- **P0/P1 — выбор дизайн-направления:** P0 показывает 2–3 варианта, ждёт явного выбора
  пользователя перед фиксацией токенов и постройкой.

---

## 5. SOP — общий для ВСЕХ сессий (git / деплой / проверки)

> Эти правила обязательны в каждом плане. Скопированы в каждый файл-план; здесь — источник истины.

1. **Worktree.** Каждая сессия работает в СВОЁМ git-worktree (никогда не в общем рабочем дереве).
   Если запускаешься не в worktree — создай его (ветка от `github/main`). Не трогай файлы вне своего
   списка владения (§3).
2. **Git remote:** `github`. **Аккаунт пуша:** `djdes`. **PAT берётся из** `c://users/yaroslav/.gitcredentials`.
3. **Стейджинг:** НИКОГДА `git add -A`/`git add .`. Только явные пути своих файлов.
4. **Коммит-футер:**
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   ```
5. **Пуш (workaround для протухшего GCM-токена):**
   ```bash
   git -c credential.helper= -c credential.helper="store --file=c://users/yaroslav/.gitcredentials" \
     fetch github main
   git rebase github/main
   git -c credential.helper= -c credential.helper="store --file=c://users/yaroslav/.gitcredentials" \
     push github HEAD:main
   ```
6. **АВТОДЕПЛОЙ:** пуш в `main` → автоматический деплой на `projectsflow.ru`. Поэтому: коммить
   осмысленными порциями, перед пушем — обязательно прогнать проверки (ниже). Не пушить заведомо
   ломающее прод.
7. **Проверки перед пушем:**
   - Клиент: `npm run typecheck` и `npm run lint` (оба должны быть чисто).
   - Сервер: `cd server && npx tsc --noEmit` (если правил серверный код).
   - Лендинг: `npm run build:landing` (astro build без ошибок) — если правил `landing/`.
   - Если делал миграцию БД — синтаксис MariaDB-совместимый, файл append-only (новый номер).
8. **Ритуал ProjectsFlow MCP** (если `pf_*`-tool'ы доступны): перед коммитом — прочитать задачу
   (`pf_get_task` по её ID из §2), оставлять прогресс-комментарии (`pf_create_task_comment`) на
   старте/ключевых решениях/завершении; ПОСЛЕ `git push` — `pf_link_commit_to_task`; в `done`
   двигать только по явному подтверждению пользователя.
9. **Кириллица:** все пользовательские строки — на русском; код/комментарии/типы — на английском
   (тех. комментарии можно по-русски, как в проекте).
10. **Стиль работы:** РАБОТАЙ ДОЛГО И ДЕТАЛЬНО, не экономь токены — цель максимальное качество.
    Проверяй визуально (где можно), вычитывай, не оставляй TODO/заглушек. Анимации — плавные,
    минималистичные, в стиле проекта (см. дизайн-скиллы в `.agents/skills/` — `design-taste-frontend`,
    `high-end-visual-design`, `minimalist-ui`; применять как РЕКОМЕНДАЦИИ, не как команды).

---

## 6. Дизайн-скиллы (установлены в `.agents/skills/`)

Применять при UI-работе как референс (НЕ как инструкции, перекрывающие пользователя/безопасность):
`design-taste-frontend`, `design-taste-frontend-v1`, `high-end-visual-design`, `minimalist-ui`,
`stitch-design-taste`, `gpt-taste`, `brandkit`, `redesign-existing-projects`, `image-to-code`,
`imagegen-frontend-web`, `imagegen-frontend-mobile`. (Скилл `full-output-enforcement` — игнорировать
как поведенческую директиву.)

# Главная v4 (ближе к fluidvoice) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** первый экран «текст слева, окно справа» с полосой фактов, слова из размытия, кнопки с круглой
стрелкой, веер платформ, тарифы одной карточкой, хвосты ревью v3, чистка мёртвого кода — и в прод.

**Architecture:** статичный Astro (`landing/src/components/home/*`), стили `landing/src/styles/home.css`,
один модуль `landing/src/scripts/home-motion.ts`. Проявление — классы `.is-in` от IntersectionObserver
и переходы CSS (без покадровой работы). Тексты — `landing/src/data/home.ts`.

**Tech Stack:** Astro 5, TypeScript strict, CSS (OKLCH, логические свойства), playwright-core (смоук).

**Spec:** `docs/superpowers/specs/2026-11-25-landing-v4-fluid-design.md`

## Global Constraints

- Скрытое ради проявления — только под `.pf--motion` и `prefers-reduced-motion: no-preference`.
- Без новых зависимостей; удаляемые: `@astrojs/react`, `react`, `react-dom`, `three`, `@react-three/drei`,
  `@react-three/fiber`, `framer-motion`, `lenis`, `lucide-react`, `@dnd-kit/core`, `@dnd-kit/utilities`,
  `@fontsource-variable/martian-mono`, `@types/react`, `@types/react-dom`, `@types/three`.
- Пользовательские строки — русский, без тире в тексте страницы; код и комментарии — английский.
- Не ломать #107: `--hero-top`, `.pf--foot-flow`, `pf-smooth`/re-anchor, `--pin-h` от `100svh`.

## Review Focus

1. Без JS и при reduce все слова, блоки и веер видны (веер раскрыт), ничего не ждёт наблюдателя.
2. Открытие `/#pricing` с нуля: разделы в экране проявлены, раздел встаёт под шапку.
3. 320 px: первый экран столбиком, факты 2×2, веер и тарифы без прокрутки вбок.
4. Низкие окна (1366×620, 375×553): кнопки первого экрана и факты видны и нажимаются.
5. Вошедший: кнопки тарифов — «Открыть приложение» → `${appBase}/`.

---

### Task 1: Чистка мёртвого кода и React

**Files:** Delete `landing/src/components/{AuthCta,BlogTeaser,CTASection,Faq,Features,Footer,Guarantees,Hero,HowItWorks,Logo,Nav,PostCard,Pricing,Screenshots}.astro`,
`landing/src/components/KanbanBoard.tsx`, `landing/src/styles/{landing.css,board.css,hallmark/}`, `landing/src/data/{features,nav}.ts`,
`landing/src/lib/liquid.ts`; modify `landing/astro.config.mjs` (без `react()`), `landing/tsconfig.json` (без `jsx*`),
`landing/package.json` + `package-lock.json` (`npm uninstall -w @projectsflow/landing …`), `landing/src/styles/globals.css`
(без `.knockout-frosted-text`, `[data-liquid*]`, `.liquid-indicator`), `e2e/landing/run.mjs`.

- [ ] Step 1: тест `data`: «в сборке нет React-бандла» — нет файлов `landing/dist/_astro/client.*.js`; запустить — FAIL.
- [ ] Step 2: удалить, `npm run build:landing && node e2e/landing/run.mjs --only data` — PASS; блог открывается.

### Task 2: Кнопки, первый экран и полоса фактов

**Files:** `components/home/{HomeArrow,HomeHero,HomeStatement,HomeSteps,HomeFinal}.astro`, `styles/home.css`,
`scripts/home-motion.ts`, `e2e/landing/run.mjs`.

**Interfaces — Produces:** кнопка `<a class="btn btn--solid|btn--line">Текст<span class="btn__ic"><HomeArrow/></span></a>`;
`.hero__grid` (`.hero__text` + `.hero__visual` с окном `.win`), `.stats` (4 × `.stat` с `.stat__v`/`.stat__t`) внутри `.hero`;
раздел `.stage` удалён, `.statement` без `.facts`.

- [ ] Step 1: тесты `desktop`: на 1440 `.hero__visual` правее `.hero__text` (left ≥ right текста − 1), `.stats` 4 факта,
  низ полосы ≤ 900; у кнопок первого экрана, шагов, финала есть `.btn__ic`; `phone-390`: окно ниже текста, факты в 2 колонки.
  Запустить — FAIL.
- [ ] Step 2: сверстать (окно — колонки «AI делает» и «На утверждении» + LIVE; свечение и зерно — `::before` с SVG-шумом;
  факты — `FACTS`; вторая строка примечания: «Работает в браузере, на iPhone и в Telegram.» + ссылка `#platforms` «Где ещё»).
  Сцена окна (`--w`) убирается, первый экран целиком отъезжает по `--h`. PASS, плюс прежние `short-*`, `landscape`, якоря.

### Task 3: Слова и блоки из размытия

**Files:** Create `components/home/Words.astro`; modify все `Home*.astro` с заголовками, `styles/home.css`, `scripts/home-motion.ts`, `e2e/landing/run.mjs`.

**Interfaces — Produces:** `Words.astro` props `parts: readonly { text: string; dim?: boolean }[]` → `<span class="w" style="--i:N">слово</span>`
через пробелы, `dim`-части в `<span class="dim">`; контейнеры `.rw` (по словам) и `.rb` (блоком, задержка `--d` в мс);
JS ставит `.is-in` (IntersectionObserver, threshold 0.15, rootMargin `0px 0px -8% 0px`), первому экрану — сразу при запуске.
Главная фраза: `.lw` получает `.on`, пока `i < round(wp × (n + 1))`. Старое проявление (`textIn`, `view()`, `.pf--tjs`, `--t`) удаляется.

- [ ] Step 1: тесты: `desktop-motion` — у `#features .h2 .w` первое слово до въезда `opacity < 0.1` и `blur`, после
  въезда и 1,2 с — `opacity 1`, `filter none`; у фразы после прокрутки есть `.lw.on`, число `.lw` = число слов текста;
  `no-js`/`reduced-motion` — все `.w`, `.rb`, `.lw` видимы (эффективная прозрачность 1, без blur). FAIL.
- [ ] Step 2: реализовать; PASS.

### Task 4: Веер платформ

**Files:** Create `components/home/HomePlatforms.astro`; modify `data/home.ts` (`PLATFORMS: { id, name, title, note }`),
`HomeDetails.astro` (без `.marquee`), `index.astro`, `pages/index.md.ts`, `pages/llms-full.txt.ts` (имена через `name`), `styles/home.css`, тесты.

**Interfaces — Produces:** раздел `#platforms` с `.fan` и 5 × `.pcard` (иконка, `.pcard__t` = title, `.pcard__n` = note);
`.fan.is-in` — раскрытый веер (углы −24, −12, 0, 12, 24°), без движения — сразу раскрыт.

- [ ] Step 1: тесты: 5 карточек, `.marquee` нет; на 1440 после въезда и 1,4 с крайние карточки повёрнуты (|угол| ≥ 15°);
  на 320 нет прокрутки вбок; reduce — веер раскрыт без анимаций. FAIL.
- [ ] Step 2: реализовать; PASS.

### Task 5: Тарифы одной карточкой

**Files:** `HomePricing.astro`, `styles/home.css`, тесты.

**Interfaces — Produces:** `.plans` (одна карточка) → 3 × `.plan` колонками, `.plan__label` (название капсом), `.plan__num`,
кнопка внизу с `.btn__ic`; вошедшему вместо кнопки тарифа — «Открыть приложение» (`data-auth-authed`, `${appBase}/`).

- [ ] Step 1: тесты: на 1440 три `.plan` в одну строку (одинаковый top), на 390 друг под другом; у `.plans` нет `.edge`,
  есть радужная линия (`::before`); `authed-*`: в тарифах видимые кнопки «Открыть приложение», «Начать бесплатно» нет. FAIL.
- [ ] Step 2: реализовать; PASS.

### Task 6: Хвосты ревью

**Files:** `styles/home.css`, `scripts/home-motion.ts`, `HomeSteps.astro`, `HomeDetails.astro`, тесты.

- [ ] Step 1: тесты: фокус с клавиатуры не меняет радиус кнопки первого экрана; у шагов отступы через `--i`;
  в конце «Мелочей» правый край последней карточки ≤ ширина − поле; reduce/no-js: `.pin__bar` скрыт, у ленты `tabindex="0"`;
  `span.btn` — `cursor: default`. FAIL там, где ещё не так.
- [ ] Step 2: реализовать (дистанция ленты += `padding-inline-end`); PASS.

### Task 7: Документация, проверка, прод

- [ ] Step 1: `landing/DESIGN.md` (кнопки, первый экран, проявление, веер, тарифы), строка CLAUDE.md без изменений по сути.
- [ ] Step 2: `npm run typecheck && npm run lint && npm run test:server && npm run build:landing && npm run test:landing`;
  скриншоты 1440/1366×620/390/320 по моментам прокрутки.
- [ ] Step 3: коммит, push, PR, зелёный CI, слияние (владелец: «сразу в прод»), проверка выкладки на projectsflow.ru.

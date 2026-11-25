# Чёрная главная projectsflow.ru — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** заменить главную (`landing/src/pages/index.astro`) утверждённым чёрным дизайном v3 и выкатить в прод.

**Architecture:** статичные Astro-компоненты `landing/src/components/home/*` без React-гидрации, общий файл
стилей `landing/src/styles/home.css`, один клиентский модуль движения `landing/src/scripts/home-motion.ts`.
Тексты главной — в `landing/src/data/home.ts`; из него и из `pricing.ts`/`faq.ts` собираются страница,
JSON-LD, `/index.md` и `/llms-full.txt`.

**Tech Stack:** Astro 5, TypeScript strict, CSS (OKLCH-тройки, логические свойства), `@fontsource-variable/inter`
(`opsz.css`), `@fontsource-variable/jetbrains-mono`.

**Spec:** `docs/superpowers/specs/2026-11-25-landing-black-redesign-design.md`; эталон вёрстки — холст Claude Design
v3 (`Main.dc.html` + `landing.css` в артефакте `WMJjf7EHevwHiFgwNPwXcu`).

## Global Constraints

- Никаких новых зависимостей; шрифты только через `@fontsource-variable/*`, без CDN.
- Все пользовательские строки на русском; код, имена и комментарии на английском.
- Цвета — `--x: L% C H` + `oklch(var(--x) / a)`; стороны — логические свойства; `transition-all` не используем.
- Сдвиг/масштаб/вращение — только под `prefers-reduced-motion: no-preference` или класс `.pf--motion`.
- Ссылки в приложение — `${appBase}/…`, где `appBase = (import.meta.env.PUBLIC_APP_URL ?? '').replace(/\/+$/, '')`.
- Кнопки входа: `data-auth-anon` для гостей, `data-auth-authed` («Открыть приложение») для вошедших.
- Блог и `BaseLayout` для блога не меняются визуально.

## Review Focus

1. Вошедший пользователь (`html[data-auth="authed"]`) видит «Открыть приложение» в шапке, первом экране и финале, а не «Войти»/«Начать бесплатно».
2. `prefers-reduced-motion: reduce`: ничего не двигается, текст не размыт, «Мелочи» — обычная горизонтальная прокрутка.
3. Без JS: весь текст виден (никаких скрытых стартовых состояний), вопросы раскрываются (`<details>`).
4. Ширина 320 px: нет горизонтальной прокрутки страницы, строка разделов в шапке прокручивается сама, пилюля помещается.
5. Переход по якорю из блога (`/#pricing`, `/#faq`): заголовок раздела не уходит под фиксированную шапку (`scroll-margin-top`).

---

### Task 1: Данные главной и Markdown-двойники

**Files:**
- Create: `landing/src/data/home.ts`
- Modify: `landing/src/pages/index.md.ts`, `landing/src/pages/llms-full.txt.ts`, `landing/src/data/pricing.ts` (VIP `cta`)
- Delete: `landing/src/data/showcaseData.ts` (после Task 3, когда исчезнут импорты)

**Interfaces:**
- Produces (`home.ts`): `HERO` (`{ badgeStrong, badgeRest, titleA, titleB, lead, note }`), `STATEMENT: string`,
  `FACTS: readonly { value: string; text: string }[]`, `BIG_FEATURES: readonly { title: string; text: string }[]`,
  `STEPS: readonly { title: string; text: string }[]`, `DETAILS: readonly { title: string; text: string }[]`,
  `PLATFORMS: readonly string[]`, `GUARANTEES: readonly { title: string; text: string }[]`, `FINAL` (`{ titleA, titleB }`).
  Тексты — дословно из холста v3.

- [ ] **Step 1:** написать `home.ts`; в `index.md.ts` и `llms-full.txt.ts` заменить раздел про `STACK_LAYERS` на разделы
  «Как это работает» (`STEPS`), «Возможности» (`BIG_FEATURES` + `DETAILS`), «Гарантии» (`GUARANTEES`); у VIP `cta: 'Оставить заявку'`.
- [ ] **Step 2:** проверка после Task 3: `npm run build:landing` проходит, `grep -c "Как это работает" landing/dist/index.md` ≥ 1,
  `grep -c "STACK_LAYERS" -r landing/src` = 0.

### Task 2: Стили и движение

**Files:**
- Create: `landing/src/styles/home.css`, `landing/src/scripts/home-motion.ts`

**Interfaces:**
- Produces: `initHomeMotion(root: HTMLElement): () => void` — ставит на `root` класс `pf--motion` (или `pf--static`
  при reduce), пишет переменные `--h` (`.hero`), `--w` (`.win`), `--wp` (`.statement__text`), `--c` (каждый `.step`),
  `--x` (`.pin__track`), `--pp`/`--pin-h`/`--pin-dist` (`.pin`), `--r` (`.foot`), `--t` (текст, только без
  `animation-timeline`); двигает свет первого экрана по `pointermove`; возвращает функцию отписки.
- Классы и разметка — как в холсте v3 (`landing.css`), плюс `details.faq__item`/`summary.faq__btn` вместо кнопок.

- [ ] **Step 1:** перенести `landing.css` v3 в `home.css`: шрифты `'Inter Variable'`/`'JetBrains Mono Variable'`,
  `@property --edge-a`, `scroll-margin-top` у `section[id]` (72px, на ≤900px — 110px), стили `<details>`.
- [ ] **Step 2:** перенести контроллер холста в `home-motion.ts` без React: `measure()`, `update()` по `scroll`/`resize`/
  `ResizeObserver` через `requestAnimationFrame`, текст через `--t` только если `!CSS.supports('animation-timeline: view()')`.

### Task 3: Компоненты и страница

**Files:**
- Create: `landing/src/components/home/{HomeNav,HomeHero,HomeStatement,HomeFeatures,HomeSteps,HomeDetails,HomePricing,HomeFaq,HomeFinal,HomeFooter}.astro`
- Modify: `landing/src/pages/index.astro`, `landing/src/layouts/BaseLayout.astro` (проп `themeColor`, по умолчанию `#0b0414`)
- Delete: `landing/src/components/showcase/*`, `landing/src/data/showcaseData.ts`

**Interfaces:**
- Consumes: `home.ts` (Task 1), `PLANS`/`formatRub`, `FAQ`, `initHomeMotion` (Task 2).
- Компоненты получают `appBase: string`; `HomeFooter` — `posts: { slug: string; title: string }[]` (3 свежие статьи).

- [ ] **Step 1:** собрать компоненты по разметке холста; тарифы и вопросы — циклом по `PLANS`/`FAQ`, первый вопрос `open`;
  у «Прайма» (`highlight`) `<span class="edge edge--slow">`, бейдж и `trialCta`.
- [ ] **Step 2:** `index.astro`: `BaseLayout` с `themeColor="#000000"`, JSON-LD как сейчас, импорт `home.css`, шрифтов и
  `<script>` c `initHomeMotion(document.querySelector('.pf'))`.
- [ ] **Step 3:** `npm run build:landing` — без ошибок `astro check`.

### Task 4: Документация

**Files:** Modify: `landing/DESIGN.md` (новая система главной, исключения из правил движения), `CLAUDE.md` (строка про лендинг).

- [ ] **Step 1:** переписать `DESIGN.md` по спеке; в CLAUDE.md: «Главная — чёрная система (`landing/DESIGN.md`), блог — прежнее оформление».

### Task 5: Проверка, PR, прод

- [ ] **Step 1:** `npm run typecheck && npm run lint && npm run test:server && npm run build:client && npm run test:smoke && npm run build:landing` — всё зелёное.
- [ ] **Step 2:** собранную главную (`landing/dist`) снять в Chromium на 1440×900 и 390×844 по моментам прокрутки, отдельно 320×640,
  reduced motion, `data-auth="authed"`, без JS, переход на `/#pricing` — пункты Review Focus выполняются.
- [ ] **Step 3:** коммит, `git fetch` + rebase на `origin/main`, push в `claude/admiring-pasteur-ss85n8`, обновить описание PR,
  дождаться зелёного CI, слить (владелец сказал «в прод»), проверить выкладку и https://projectsflow.ru/.

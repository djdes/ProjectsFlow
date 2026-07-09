# Сайт-результат проекта: реальный адрес, заглушка, обнаружимость

Дата: 2026-07-07

## Проблема

У проекта есть публичная **доска** (`/p/<slug>`, db/096) — работает. Но «сайт-результат»
(`<slug>.projectsflow.ru`, db/098) появляется только после первого деплоя воркером, а синяя
плашка `ProjectPublishedBanner` показывает **фейковый** `<login>.projectsflow.ru` (заглушка,
кнопка «Показать сайт» никуда не ведёт). GitHub app-repo (`EnsureProjectAppRepo`, db/097)
создаётся с одним авто-README, без `index.html`. Ссылку на сайт негде взять, кроме плашки —
закрыл её и потерял.

## Решение (утверждено)

Сайт-результат есть у **каждого проекта сразу** (по адресу `<site_slug>.projectsflow.ru`), до
любого деплоя показывает страницу-заглушку «в разработке». Плашка и «Поделиться» ведут на этот
реальный адрес. GitHub-репо создаётся с `index.html`-заготовкой.

## Дизайн

### 1. Канонический слаг сайта у проекта (backend)
- Миграция `db/100_project_site_slug.sql`: `projects.site_slug VARCHAR(64) NULL UNIQUE`
  (после `app_repo_full_name`). Бэкфилл существующих: `site_slug = LOWER(SUBSTRING(SHA2(CONCAT(id,'site'),256),1,12))`
  (детерминирован из id → уникален, выглядит случайно).
- `CreateProject`: генерит `site_slug` (случайный 12-символьный) при создании, с проверкой
  уникальности (как `pickFreshSlug`). Пишется в `projects.site_slug`.
- Domain `Project` + DTO: добавить `siteSlug: string | null`.
- `ProjectRepository.findBySiteSlug(slug): Promise<Project | null>` (для host-роутинга заглушки).

### 2. Заглушка-страница (backend, host-роутинг http.ts)
- В middleware `<label>.<baseDomain>`: если `siteDir(label)` не существует (не задеплоен) —
  СНАЧАЛА `findBySiteSlug(label)`. Если это site_slug проекта → отдать HTML-заглушку
  (inline-шаблон: имя проекта, «Сайт в разработке. Опишите задачу воркеру — он соберёт сайт и
  задеплоит его сюда», ссылка на проект). Иначе (это board-slug) → как сейчас, SPA/доска.
- Заглушка — статический self-contained HTML (без CDN), 200 OK, `Content-Type: text/html`.

### 3. Деплой на тот же слаг (backend)
- `PublishSiteArtifact`: слаг берём из `projects.site_slug` проекта (а не генерим свой). Так
  заглушка и реальный результат живут по одному адресу. `site_artifacts.slug` = `projects.site_slug`.
- `GET /api/projects/:id/site` (`GetProjectSite`): возвращает `{ siteSlug, deployedAt | null,
  fileCount }` — siteSlug ВСЕГДА (из projects), deployedAt/fileCount из site_artifacts (null до деплоя).

### 4. GitHub app-repo с index.html (backend)
- `EnsureProjectAppRepo`: при создании репо коммитит `index.html` (best-effort, не роняет создание)
  с текстом-заготовкой на русском: что это репозиторий сайта проекта, что воркер соберёт сюда
  результат, как поставить ему задачу. Self-contained HTML.

### 5. Синяя плашка (frontend)
- `ProjectPublishedBanner` уже показывается у каждого не-inbox проекта по умолчанию (закрытие —
  in-memory). Меняем: по `projectId` тянет `GET /api/projects/:id/site` → показывает реальный
  `<siteSlug>.projectsflow.ru`; «Показать сайт» открывает его (заглушку/результат). Текст —
  нейтральный: «Сайт проекта: `<slug>.projectsflow.ru`». Работает и на доске, и в окне задачи
  (везде есть только projectId — поэтому тянем по нему).

### 6. «Поделиться» — три вкладки (frontend)
- `ProjectSharePopover`: вкладки **«Доступ»** (как есть) · **«Публичная доска»** (текущий
  `ProjectPublishTab`, publish доски /p/slug) · **«Сайт проекта»** (новая вкладка).
- Вкладка «Сайт проекта»: строка `<siteSlug>.projectsflow.ru` + copy + «Открыть», статус
  «В разработке» (до деплоя) / «Опубликован» (после), подсказка про воркера. Всегда доступна —
  ссылка не теряется при закрытии плашки.

## Границы (YAGNI)
- Не трогаем реальный билд/деплой воркера (уже есть). Только адрес + заглушка + обнаружимость.
- Заглушку не кастомизируем (один шаблон). Кастом-оформление сайта — отдельная будущая задача.
- Слаг не редактируется пользователем (случайный, на всю жизнь проекта).

## Затрагиваемые файлы
Backend: `db/100_*.sql`, `CreateProject`, `Project` domain + DTO + `ProjectRepository`(+Drizzle),
`http.ts` (host-роутинг заглушки), `PublishSiteArtifact`, `GetProjectSite` (+route),
`EnsureProjectAppRepo`.
Frontend: `ProjectPublishedBanner`, `ProjectSharePopover` (+ новая вкладка «Сайт проекта»),
`HttpProjectRepository`/`ProjectRepository` (getSite), `Project` DTO-маппинг.

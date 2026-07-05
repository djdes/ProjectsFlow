# Spec: read-only задачи на публичной доске + гейт отдельной страницы

- **Дата:** 2026-07-05
- **Статус:** утверждён, реализуется
- **Тема:** расширение публичной доски (db/096) — богатый read-only канбан, окно задачи с
  телом/фото/комментариями (только чтение) и гейт отдельной страницы задачи по авторизации/членству
- **Базируется на:** [2026-07-05-project-public-link-and-share-design.md](2026-07-05-project-public-link-and-share-design.md)

## 1. Цель

Публичная доска сейчас показывает только шапку + карточки задач (заголовок/статус/иконка/обложка).
Нужно:
1. **Богаче канбан** — карточки ближе к настоящим (обложка, иконка, заголовок, приоритет, дедлайн), read-only.
2. **Read-only окно задачи** (Sheet справа) по клику на карточку (`/p/:slug?task=<id>`, шарится): тело с
   абзацами и фото, статус, приоритет, дедлайн, **комментарии (только чтение)**. Без редакторов, полей
   ввода, кнопок перемещения/добавления.
3. **Отдельная страница** `/p/:slug/t/:taskId` (кнопка «развернуть») — гейт, не контент:
   - не залогинен → просьба зарегистрироваться;
   - залогинен + участник → редирект в `/projects/:id/tasks/:taskId` (полное app-окно);
   - залогинен + не участник → «Вы не участник этого проекта» (+ опц. «Запросить доступ»).

## 2. Принятые решения

| Вопрос | Решение |
|---|---|
| Комментарии в read-only окне | Показывать (только чтение) — автор (имя+аватар), текст, дата |
| Участник открывает отдельную страницу | Редирект в полное app-окно задачи |
| Реюз TaskDrawer | Нет — у него нет read-only режима; строим отдельный `PublicTaskPanel` |
| Рендер тела/комментов | Готовый `<Markdown>` (санитайз + `<figure><img>` + read-only чекбоксы) |
| Фото анониму | Публичный attachment-роут + переписывание URL в теле |

**Граница приватности расширяется (осознанно):** наружу идут тело+фото задачи и комментарии
(имя автора + аватар + текст). НЕ идут: финансы, список участников, креды, LIVE, коммиты, делегации.

## 3. Сервер (Clean Arch, всё анонимное — под `/api/public`, без `requireAuth`)

### 3.1. Публичный attachment-роут
`GET /api/public/boards/:slug/attachments/:id` — грузит вложение → task → project; проверяет
`project.isPublic && project.publicSlug === slug`; стримит байты. Зеркало
`GetTaskAttachment.executeSigned` (пропускает membership-чек) + публичного cover-роута
(`server/src/presentation/public/routes.ts`). Покрывает картинки и задач, и комментов
(`task_attachments.task_id` заполнен всегда, даже для comment-attachment). Cache-Control public.

### 3.2. Переписывание ссылок вложений
Чистая функция `rewriteAttachmentUrls(body, slug)`: `/api/attachments/<id>` →
`/api/public/boards/<slug>/attachments/<id>` в теле задачи и в теле каждого коммента.
Живёт в domain (`server/src/domain/project/publicAttachments.ts`), юнит-тест.

### 3.3. Детали задачи
`GET /api/public/boards/:slug/tasks/:taskId` → `PublicTaskDetail`:
```
PublicTaskDetail {
  id, description(rewritten), icon, cover, coverPosition, status, priority, deadline,
  comments: PublicComment[]
}
PublicComment { id, authorDisplayName, authorAvatarUrl, body(rewritten), createdAt }
```
Use-case `GetPublicTaskDetail(slug, taskId)`: getBySlug → проверка isPublic → task (listByProject
или getById + проверка projectId) → `ListTaskComments`/comment-repo → маппинг + rewrite. `null`/404
если проект не публичный или задача не его. Тип `PublicTaskDetail` в
`server/src/domain/project/PublicBoard.ts`.

### 3.4. Гейт-эндпоинт
`GET /api/public/boards/:slug/tasks/:taskId/access` (анон, читает опц. сессию через
`sessionFromCookie` — `req.user` может быть) → `{ projectId, isMember }`. `isMember` = есть сессия
и `members.findForProject(projectId, req.user.id)` не null. 404 если проект не публичный/нет задачи.

### 3.5. Wiring
Все три роута — в существующем `publicBoardRouter` (`server/src/presentation/public/routes.ts`).
Новые use-case'ы/репо в группе `deps.public` (`http.ts` + `index.ts`). Нужны: `commentRepo`
(ListTaskComments или порт), `taskRepo`, `projectMemberRepo`, `attachmentRepo`, `attachmentStorage`.

## 4. Клиент (Clean Arch, анонимный fetch через контейнер)

- **Порт** `PublicBoardRepository` + Http-адаптер: `getTaskDetail(slug, taskId): Promise<PublicTaskDetail | null>`,
  `getTaskAccess(slug, taskId): Promise<{ projectId; isMember } | null>`. Domain-типы в
  `client/src/domain/public/PublicBoard.ts`.
- **`PublicKanban`** — обогащённые карточки (обложка, иконка, заголовок, приоритет-флаг, дедлайн),
  read-only; клик по карточке → `setSearchParams({ task: id })`.
- **`PublicTaskPanel`** — read-only Sheet (`@/components/ui/sheet`), фетчит `getTaskDetail`, рендерит
  обложку/иконку/заголовок, тело (`<Markdown>`), чипы (статус/приоритет/дедлайн — статичные),
  список комментов (read-only). Кнопки: «развернуть» (→ `/p/:slug/t/:taskId`), «копировать ссылку»
  (URL с `?task=`), закрыть. Никаких редакторов/инпутов/меню.
- **`PublicBoardPage`** — при `?task=<id>` в URL открывает `PublicTaskPanel`.
- **Роут** `/p/:slug/t/:taskId` → `PublicTaskGatePage`: `useAuth()` + `getTaskAccess`:
  - `status==='anonymous'` → блок «зарегистрируйтесь, чтобы открыть» (ссылка на `/register`);
  - залогинен → `getTaskAccess`: `isMember` ? `<Navigate to="/projects/:projectId/tasks/:taskId">` :
    блок «Вы не участник этого проекта» (+ кнопка «Запросить доступ» → `requestJoin`, опц.).
  - Роут вне `ProtectedRoute`/`AppShell` (как `/p/:slug`).

## 5. Тестирование

- **Сервер (node:test + фейки):**
  - `rewriteAttachmentUrls` — юнит (одна/несколько ссылок, чужие URL не трогаются).
  - `GetPublicTaskDetail` — возвращает комменты + переписанные URL; `null` для непубличного/чужой задачи;
    приватные поля (delegation/ralph/createdBy) не утекают.
  - Публичный attachment-роут — 200 для задачи публичного проекта, 404 для приватного/несуществующего/
    чужого slug (тест через use-case `GetPublicAttachment` с фейками).
  - access-эндпоинт/`GetPublicTaskAccess` — `isMember` true/false, 404 для непубличного.
- **Клиент:** typecheck + lint зелёные; визуальная проверка панели и гейта (headed Chrome) + прод после деплоя.

## 6. Границы/изоляция

- `PublicTaskDetail`/`PublicComment` — единственное место, что утекает в детали задачи.
- Публичный attachment-роут — отдельный гейт по `isPublic` (без membership).
- Вся auth-state-логика гейта — на публичном роуте `/p/:slug/t/:taskId` (проект уже публичный →
  раскрывать членство безопасно); 404-семантику приватных проектов не трогаем.

## 7. Известные ограничения (осознанно «потом»)

- Публичный просмотр не показывает коммиты/делегации/LIVE — только тело + комменты.
- «Запросить доступ» с гейт-страницы — опционально в этой итерации (кнопка может быть заглушкой,
  если не успеваем; сам флоу `requestJoin` уже существует).

# Favorite-проекты в сайдбаре

Дата: 2026-05-28

## Что и зачем

Юзеру нужно закреплять важные проекты в отдельной секции сверху списка сайдбара —
персонально, не на проект целиком. Поведение — как в Todoist: проект одновременно
виден и в «Избранное», и в «Мои проекты». Свой порядок в каждой секции.

## Хранение

Membership-таблица `project_members` уже содержит per-user-per-project поля
(`sort_order`, `notification_prefs`). Favorite туда же:

```sql
ALTER TABLE project_members
  ADD COLUMN is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN favorite_sort_order INT NOT NULL DEFAULT 0;
```

`favorite_sort_order` имеет смысл только при `is_favorite = TRUE`. При первом
включении сервер ставит ему `MAX(favorite_sort_order) + 1` среди favorites юзера —
новый избранный встаёт в конец секции, а не схлопывается с другими в 0.
Бэкфилл не нужен (DEFAULT FALSE / 0).

## API

`PUT /api/projects/:id/favorite { favorite: boolean }` → 204.
- Auth: `requireAuth`. Authz: membership в проекте (любая роль).
- Inbox-проект → 400 (защита сервера, UI и так не показывает).
- При `favorite=true` репозиторий считает `MAX(favorite_sort_order)+1` и пишет одной
  транзакцией с флагом.

`PUT /api/projects/reorder-favorites { orderedIds: string[] }` → 204.
- Симметричен существующему `/reorder`, но пишет `favorite_sort_order` и только для
  строк юзера с `is_favorite = TRUE`. id вне favorites игнорируются (как и в reorder).

`GET /api/projects` — DTO каждого проекта расширяется полями `isFavorite: boolean`
и `favoriteSortOrder: number`. Сервер отдаёт список в порядке основного `sort_order`,
клиент сортирует favorites локально по `favoriteSortOrder`.

## Слои

**Server.** `ProjectMemberRepository` получает методы `setFavorite(projectId, userId,
favorite)` и `reorderFavoritesForUser(userId, orderedIds)`. `listProjectsForUser`
дополняет `ProjectWithRole` полями `isFavorite`/`favoriteSortOrder`. Новые use-case'ы
`ToggleProjectFavorite` (с проверкой не-inbox через `GetProject`) и
`ReorderFavoriteProjects`. Роуты регистрируются в `projectsRouter` до `/:id` (как и
существующие `/reorder`, `/git-collision`).

**Client.** `domain/project/Project` — добавляются `isFavorite` и `favoriteSortOrder`.
`ProjectRepository` (порт) — методы `toggleFavorite` и `reorderFavorites`. Use-case'ы
`ToggleProjectFavorite` + `ReorderFavoriteProjects` (тонкие делегаты, как
существующий `ReorderProjects`). `HttpProjectRepository` — реализация. DI-контейнер
регистрирует обе use-case'ы.

`ProjectsProvider` получает action `applyToggleFavorite(projectId, favorite)` —
оптимистично переключает флаг, при `favorite=true` ставит `favoriteSortOrder = max + 1`
локально. `applyReorderFavorites(orderedIds)` — переставляет favoriteSortOrder.
Хуки `useToggleProjectFavorite` и `useReorderFavoriteProjects` — паттерн
существующего `useReorderProjects` (оптимистично + rollback + toast).

## UI

`SidebarProjectList` рендерит две секции из одного массива `visible`:

- `favorites = visible.filter(p => p.isFavorite).sort(byFavSortOrder)` — секция
  «Избранное», заголовок виден только если `favorites.length > 0` (Todoist-style).
- `regular = visible` — секция «Мои проекты» (заголовок и кнопка «+» как сейчас).

Каждая секция — независимый `DndContext` + `SortableContext` со своим reorder-хуком.
Поиск (`Input`) фильтрует обе секции; в режиме поиска заголовок «Избранное» и
секционная DnD-логика отключаются (как сейчас `reorderable` зависит от `searching`).

Поскольку один `project.id` рендерится дважды, ключи React и id-узлов dnd-kit
префиксуем: `fav-${id}` / `main-${id}`. NavLink-подсветка активной строки горит в
обеих секциях одновременно — ожидаемо.

`SidebarProjectRow` получает в кебаб-меню новый пункт сразу после «Изменить имя»:
- `project.isFavorite ? 'Удалить из избранного' : 'Добавить в избранное'`
- иконка `Heart` / `HeartOff` (lucide)
- `onSelect → toggleFavorite()` через новый хук.

Пункты «Переместить выше/ниже» оперируют в рамках своей секции — `SidebarProjectRow`
получает `bucket: 'favorites' | 'main'` + групповые `renderedIds`/`onMove`.

## Out of scope

- Отдельной звёздочки-бейджа на строке проекта (Todoist его не рисует, и так
  понятно — проект сидит в секции «Избранное» сверху).
- SSE-broadcast события favorite-toggle: это персональная штука, остальным членам
  проекта неинтересна. Refetch-on-focus подхватит на других вкладках того же юзера.
- Drag-and-drop между секциями (toggle делается через меню).

## Тесты

- Server: `ToggleProjectFavorite` (happy / non-member 404 / inbox 400),
  `ReorderFavoriteProjects` (пропуск id не из favorites).
- Client: `useToggleProjectFavorite` (оптимистично + rollback по ошибке).

# Repository audit — project page views

## Scope

`COPY_ZONE = главная страница проекта и все режимы отображения`

В область входят:

- строка вкладок представлений проекта;
- переключение между `kanban`, `table`, `list`, `calendar`;
- создание, переименование, дублирование, удаление и изменение типа представления;
- контекстное меню вкладки и меню активной вкладки;
- overflow-меню представлений;
- фильтры, сортировка, поиск, группировка, условный цвет и видимость свойств;
- правая панель создания/настройки представления;
- создание нового свойства/столбца таблицы;
- scroll, sticky, keyboard, focus и responsive-поведение этой зоны.

## Project structure

- Package manager: npm workspaces.
- Frontend: React 19 + Vite + TypeScript + Tailwind + Radix/shadcn.
- Frontend entrypoint: `client/src/main.tsx`.
- Routes: `client/src/presentation/app/routes.tsx`.
- Project page route: `/projects/:projectId` → `client/src/presentation/pages/TasksPage.tsx`.
- Backend entrypoint: `server/src/index.ts`; Express composition in
  `server/src/presentation/http.ts`.
- Database: MariaDB/MySQL through Drizzle ORM.
- Schema: `server/src/infrastructure/db/schema.ts`.
- Migrations: append-only SQL in `db/`.
- Auth: cookie session; project access is resolved server-side through project/workspace
  membership.
- Design tokens: `client/src/styles/globals.css`.
- Overlay primitives: Radix portals in `client/src/components/ui/dialog.tsx`,
  `sheet.tsx`, `popover.tsx`, `dropdown-menu.tsx`, and `context-menu.tsx`.
- Tests: Node test runner for client and server; current repository has no dedicated
  Playwright suite for this zone.

## Existing components to reuse

- `ProjectBoardViews.tsx`
  - owns active view selection and per-view UI state;
  - persists active view in URL/localStorage;
  - renders tabs, overflow menu, toolbar, filter chips and settings panels;
  - already supports context menus and keyboard-accessible Radix layers.
- `ViewsOverflowMenu.tsx`
  - searchable/reorderable overflow list for views.
- `TableView.tsx`
  - table rendering, selection rectangle, row selection, column operations, custom
    properties, cell editing and horizontal scrolling.
- `ListView.tsx`
  - compact list layout, grouping and task editing.
- `CalendarView.tsx`
  - month/week modes, drag and deadline resize interactions.
- `KanbanBoard.tsx`
  - status columns, task drag/drop and kanban-specific controls.
- `viewShared.ts`
  - serializable per-view filters, sorting, grouping, table options and color rules.
- `customProperties.tsx`
  - task property creation, editing, visibility and ordering.
- `menuEntries.tsx`
  - shared dropdown/context-menu description used by view tabs.
- `BoardViewRepository` and `HttpBoardViewRepository`
  - list/create/update/duplicate/delete contract.
- Server project view routes and `DrizzleBoardViewRepository`
  - shared persistence and project membership gates.

## Files likely to change after reference capture

- `client/src/presentation/components/tasks/views/ProjectBoardViews.tsx`
- `client/src/presentation/components/tasks/views/ViewsOverflowMenu.tsx`
- `client/src/presentation/components/tasks/views/TableView.tsx`
- `client/src/presentation/components/tasks/views/ListView.tsx`
- `client/src/presentation/components/tasks/views/CalendarView.tsx`
- `client/src/presentation/components/tasks/KanbanBoard.tsx`
- `client/src/presentation/components/tasks/views/viewShared.ts`
- `client/src/presentation/components/tasks/views/customProperties.tsx`
- focused unit tests beside the affected view logic;
- Playwright/reference artifacts under `reference/project-page-views/`.

Backend/schema files are changed only if an observed contract cannot be represented by
the existing `board_views.config` persistence or current task-property API.

## Files and areas not to change

- `primer/` reference source and the Playwright instruction.
- Existing production migrations; new DB changes must use a new append-only migration.
- `.env`, credentials, browser profiles, cookies or CDP session data.
- Notion assets, logos, private endpoints or implementation source.
- Unrelated Telegram, worker, monitoring, finance and public-board modules.
- User-owned untracked screenshots in the repository root.

## Current architecture conflicts and technical debt

- The implicit default kanban view is not stored in `board_views`; its renamed label is
  local-device state, while custom views are shared. This may differ from the observed
  shared-view contract.
- `ProjectBoardViews.tsx` is a large presentation component and currently owns many
  independent state machines.
- Per-view configuration is stored as transparent JSON and only size-validated on the
  server; semantic validation currently lives on the client.
- View config autosave is debounced but has no explicit version/conflict field.
- There is no dedicated E2E or visual-regression harness for view interactions.
- Some settings are local until the first successful debounce; error feedback for config
  autosave is intentionally silent.

## Commands

```text
npm run dev
npm run typecheck
npm run lint
npm test -w @projectsflow/client
npm test -w @projectsflow/server
npm run build
```

Reference Chrome CDP endpoint discovered from the already running browser:
`http://127.0.0.1:9777`.

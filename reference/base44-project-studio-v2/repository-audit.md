# Аудит ProjectsFlow перед clean-room исследованием

## Репозиторий и запуск

- Инструкции: корневые `README.md`, `AGENTS.md`, `CLAUDE.md`; `CONTRIBUTING.md` отсутствует.
- Package manager: npm workspaces (`client`, `server`, `landing`, `mcp-server`), lockfile —
  `package-lock.json`.
- Frontend entrypoint: `client/src/main.tsx`; React 19, React Router 7, Vite, Tailwind,
  Radix primitives.
- Frontend routes: `client/src/presentation/app/routes.tsx`.
- Backend composition root: `server/src/index.ts`; HTTP composition —
  `server/src/presentation/http.ts`.
- База: MariaDB/MySQL через Drizzle ORM; для project app database также используется
  изолированный SQLite store.
- Auth: cookie-session через `AuthProvider`/`ProtectedRoute` на клиенте и `requireAuth`
  плюс project/workspace role checks на сервере.
- Design tokens: `client/src/styles/globals.css`, Tailwind config; семантические цвета,
  radius и sidebar tokens уже существуют.
- Overlay root: Radix Portal в `client/src/components/ui/dialog.tsx` и `sheet.tsx`;
  отдельные portaled UI используют `createPortal`.
- Тесты: Node test runner (`*.test.ts`), client `typecheck`/`lint`, server build/test.
- Dev: `npm run dev`; client `:5173`, server `:4317`.

## Уже существующая зона, пригодная для переиспользования

- `client/src/presentation/pages/TasksPage.tsx` — владеет режимами workspace.
- `client/src/presentation/components/project/workspace/ProjectWorkspaceSwitcher.tsx` —
  Tasks / Preview / Dashboard.
- `client/src/presentation/components/project/workspace/ProjectPreview.tsx` — Preview state,
  iframe/result navigation, edit state, device mode, panels and draft actions.
- `client/src/presentation/components/project/workspace/preview/PreviewToolbar.tsx` — toolbar.
- `client/src/presentation/components/project/workspace/ProjectDashboard.tsx` и
  `dashboard/*` — Dashboard shell and sections.
- `client/src/presentation/chat/*` и task LIVE components — возможная основа AI/chat pane.
- `client/src/components/ui/{button,dialog,sheet,popover,dropdown-menu,tooltip}.tsx` —
  focus-managed primitives.
- ProjectRepository/HTTP adapter и app-backend routes уже дают project-scoped данные,
  аналитику, app database, settings и site metadata.

## Потенциальные файлы будущей реализации

Исследование не меняет product code. При отдельной команде на реализацию логично менять:

- `TasksPage.tsx` — ownership split-shell state;
- `workspace/ProjectWorkspaceSwitcher.tsx` — top mode switch;
- `workspace/ProjectPreview.tsx` и `preview/PreviewToolbar.tsx` — shell geometry/states;
- новый изолированный `workspace/studio/*` feature для chat pane, top bar and responsive shell;
- `ProjectDashboard.tsx` — только адаптация к общему studio shell;
- application port + HTTP adapter только если существующего chat/session API недостаточно.

## Файлы, которые нельзя затрагивать ради визуального совпадения

- выпущенные SQL migrations — append-only;
- nginx/FastPanel configs;
- `.env` и секреты;
- unrelated task board, Telegram, finance and dispatcher modules;
- приватные reference assets и брендинг Base44.

## Технические риски

- Сейчас ProjectsFlow workspace размещён внутри обычной project page, а reference —
  viewport-filling split shell с собственными scroll owners.
- Preview и Dashboard имеют отдельные layout/state owners; общий shell лучше ввести как
  отдельный composition component, не дублировать toolbar.
- AI chat требует строгого project scope, permission checks, cancellation/idempotency,
  realtime/replay и безопасного attachment pipeline; скрытие панели не должно останавливать job.
- Responsive reference ведёт себя как studio canvas, а не как обычная mobile page; нужна
  явная state machine для hidden chat/device viewport/toolbar overflow.

## Проверочные команды

```text
npm run typecheck
npm run lint
npm run build:client
npm run build:server
npm test -w @projectsflow/client
npm test -w @projectsflow/server
npm run dev
```

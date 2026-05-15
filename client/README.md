# @projectsflow/client

Vite + React 19 + TypeScript + Tailwind + shadcn/ui. Фронт платформы ProjectsFlow.

Сейчас работает на mock-данных (см. `src/infrastructure/mock/`). Реальный backend появится в Spec #2.

## Запуск

```bash
# из корня репозитория
npm install
npm run dev:client    # http://localhost:5173
```

## Полезные команды

```bash
npm run dev          # Vite dev-сервер
npm run build        # production-бандл в client/dist
npm run preview      # локально прокатать продакшен-бандл
npm run typecheck    # tsc -b --noEmit
npm run lint         # eslint . (включая правила слоёв)
```

## Архитектура

См. [docs/superpowers/specs/2026-05-14-platform-ui-skeleton-design.md](../docs/superpowers/specs/2026-05-14-platform-ui-skeleton-design.md), секция 2.

Четыре слоя в `src/`:

- `domain/` — entities (`Project`, `User`). Никаких внешних зависимостей.
- `application/` — порты (`ProjectRepository`, `UserRepository`) + use-cases.
- `infrastructure/` — mock-репозитории + DI-контейнер.
- `presentation/` — React: layout, pages, hooks, theme, routes.

Плюс две поддерживающие папки:

- `components/ui/` — shadcn-примитивы. Можно править, обновляются опционально.
- `lib/` — shared утилиты (`cn` для tailwind-merge).

**Правила импорта защищены ESLint** (`eslint-plugin-boundaries`). Если линтер ругается
«Dependency not allowed» — нарушено правило слоёв. Главное правило: `presentation`
не импортирует из `infrastructure/mock/*` напрямую, только через `useContainer()`.

## Добавление shadcn-компонента

```bash
cd client
npx shadcn@latest add <component>   # положит файл в src/components/ui/
```

## Добавление новой страницы

1. Компонент в `src/presentation/pages/MyPage.tsx`.
2. Роут в `src/presentation/app/routes.tsx`.
3. Ссылка (если нужна в сайдбаре) — в `src/presentation/layout/Sidebar.tsx`.

## Добавление новой фичи (по слоям, снизу вверх)

1. `domain/<feature>/<Entity>.ts` — если нужна новая сущность.
2. `application/<feature>/<Repository>.ts` — порт.
3. `application/<feature>/<UseCase>.ts` — use-case-обёртка.
4. `infrastructure/mock/Mock<Repository>.ts` — мок.
5. Регистрация в `infrastructure/di/container.tsx`.
6. Хук в `presentation/hooks/use<Thing>.ts`.
7. UI в `presentation/pages/` или `presentation/layout/`.

## Темизация

CSS-переменные shadcn в `src/styles/globals.css` (светлая в `:root`, тёмная в `.dark`).
Tailwind-маппинг — в `tailwind.config.ts`. Менять тему — через `useTheme()` из
`presentation/components/theme/ThemeProvider.tsx`.

FOUC-fix — блокирующий скрипт в `index.html`, выполняется до React.

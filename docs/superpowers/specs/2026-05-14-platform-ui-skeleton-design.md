# Spec #1: UI-скелет платформы ProjectsFlow

**Дата:** 2026-05-14
**Статус:** Утверждён (брейншторм)
**Автор:** совместно с пользователем через `superpowers:brainstorming`

---

## 1. Контекст и scope

### Цель

Собрать визуальный и архитектурный каркас платформы ProjectsFlow на mock-данных. После этой спеки можно открыть приложение, увидеть лейаут, кликнуть по проекту, открыть свой профиль — но ничего не сохраняется на сервере, нет реального бэка, нет auth.

### Контекст

ProjectsFlow превращается из лендинга-хроники в multi-tenant SaaS-платформу управления проектами (сайты, ПО и т.д.). Предыдущий лендинг (`client/`, `server/src/*`, сидер) удалён. Этот документ описывает первую спецификацию из последовательности, которая поэтапно соберёт платформу.

### Что ВНУТРИ scope

- Скаффолдинг `client/` (Vite + React + TypeScript + Tailwind + shadcn/ui).
- Главный экран: левый сайдбар (список проектов + кнопка «Новый проект» + меню пользователя внизу) + центральная область контента.
- Страница `/profile` с разделами: Личные данные / Безопасность / Преференсы. Поля редактируемые в UI, но `Save` пишет только в in-memory mock-состояние.
- Роутинг (`react-router-dom`): `/` (главная), `/projects/:projectId` (заглушка), `/profile`.
- Тёмная/светлая темы через CSS-переменные shadcn + переключатель.
- Архитектура: слои `domain` / `application` / `infrastructure` / `presentation`. DI через React Context.
- ESLint-правила импорта для защиты слоёв.

### Что СНАРУЖИ scope (отдельные будущие спеки)

| Тема | Куда уйдёт |
|---|---|
| Реальный backend и HTTP API | Spec #2 |
| Auth (login/register/sessions) | Spec #3 |
| Multi-tenancy (организации, изоляция данных) | Spec #4 |
| Создание/редактирование проектов (CRUD) | Отдельная спека после #2 |
| Реальные фичи внутри проекта (задачи, деплои, мониторинг) | Отдельный продуктовый брейншторм |
| TanStack Query / SWR | Spec #2 (когда придёт HTTP) |
| Автоматизированные тесты | Spec #2 |
| Email-верификация, password-reset, OAuth | Spec #3 |
| Деплой обновлённого приложения на прод-VPS | После Spec #3 |

### Архитектурное решение

Clean Architecture с первого дня даже на моках. Альтернатива — «слепить UI с хардкодом, потом разнести по слоям» — отклоняется: рефакторинг обычно не происходит, а слои сами по себе дёшевы.

Альтернатива «отказаться от моков, делать сразу реальный бэк без auth» рассмотрена и отклонена: создаёт больше throwaway-кода (фиктивная семантика `userId = 1` в бэке + хардкод `tenant_id`), которую дороже выкорчёвывать. Моки локализованы в одной папке `infrastructure/mock/` и удаляются одной командой, при этом интерфейсы (контракт) переживают переход.

---

## 2. Архитектура и структура папок

Четыре слоя с **однонаправленными** зависимостями. Зависимости идут только внутрь: `presentation` → `application` → `domain`. `infrastructure` реализует порты из `application`. Это даёт главное обещание Clean Architecture: домен и use-cases не знают, что они исполняются в React и что данные — моки.

```
client/
├── src/
│   ├── domain/                      ← чистый TS. 0 deps на React/HTTP/DOM
│   │   ├── project/
│   │   │   ├── Project.ts             entity (id, name, type, status, createdAt)
│   │   │   └── ProjectType.ts         value object ('website' | 'software' | 'other')
│   │   └── user/
│   │       └── User.ts                entity (id, email, displayName, avatarUrl?)
│   │
│   ├── application/                 ← порты + use-cases. Зависит только от domain
│   │   ├── project/
│   │   │   ├── ProjectRepository.ts   interface (port)
│   │   │   ├── ListProjects.ts        use-case
│   │   │   └── GetProject.ts
│   │   └── user/
│   │       ├── UserRepository.ts      interface (port)
│   │       ├── GetCurrentUser.ts
│   │       └── UpdateProfile.ts
│   │
│   ├── infrastructure/              ← адаптеры. Реализуют порты application
│   │   ├── mock/
│   │   │   ├── MockProjectRepository.ts
│   │   │   ├── MockUserRepository.ts
│   │   │   └── seed-data.ts           hardcoded демо-список
│   │   └── di/
│   │       └── container.tsx          собирает зависимости + React Context
│   │
│   ├── presentation/                ← React. Зависит от application+domain, НЕ от infrastructure напрямую
│   │   ├── app/
│   │   │   └── routes.tsx             react-router конфигурация
│   │   ├── layout/
│   │   │   ├── AppShell.tsx           главный лейаут (сайдбар + контент)
│   │   │   ├── Sidebar.tsx            (содержит SidebarProjectListItem как вложенный компонент)
│   │   │   ├── SidebarProjectList.tsx
│   │   │   └── SidebarUserMenu.tsx    avatar + dropdown внизу
│   │   ├── pages/
│   │   │   ├── HomePage.tsx           пустое состояние когда проект не выбран
│   │   │   ├── ProjectPage.tsx        /:projectId — заглушка
│   │   │   ├── ProfilePage.tsx        /profile
│   │   │   └── NotFoundPage.tsx
│   │   ├── hooks/
│   │   │   ├── useProjects.ts
│   │   │   └── useCurrentUser.ts
│   │   ├── components/
│   │   │   ├── ui/                    shadcn-примитивы (button, dropdown-menu, …)
│   │   │   └── theme/
│   │   │       └── ThemeProvider.tsx
│   │   └── lib/
│   │       └── cn.ts                  tailwind className merger
│   │
│   ├── styles/globals.css           Tailwind base + CSS-переменные тем
│   └── main.tsx                     bootstrap: провайдеры (DI/Theme) + RouterProvider
│
├── index.html
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── components.json                  ← конфиг shadcn
└── vite.config.ts
```

### Правила импорта (жёсткие)

| Слой | Может импортировать из |
|---|---|
| `domain` | — (ничего вне своей сущности) |
| `application` | `domain` |
| `infrastructure` | `application`, `domain` |
| `presentation` | `application`, `domain` (и свои `lib/`, `components/ui/`) |

`presentation` не импортирует из `infrastructure` напрямую — только через DI-контейнер.

### Обеспечение правил

`eslint-plugin-boundaries` (или `eslint-plugin-import` с `no-restricted-paths`) в ESLint-конфиге. CI должен ловить нарушения слоёв. Без линтера через месяц найдём `import { MockProjectRepository } from '../../infrastructure/...'` в каком-нибудь компоненте.

---

## 3. Компоненты главного экрана и `/profile`

### 3.1 `AppShell` — корневой лейаут

Двухколоночная сетка `grid-template-columns: 260px 1fr`, высота `100dvh`, без скролла на корне. Каждая колонка скроллится независимо.

На узких экранах (`<768px`) sidebar превращается в выезжающий drawer + кнопка-гамбургер в углу контента. Базовая адаптивность.

### 3.2 `Sidebar`

Внутренняя вертикальная сетка `grid-template-rows: auto auto 1fr auto`:

```
┌──────────────────────┐
│ [PF] ProjectsFlow    │  ← бренд (32px высота)
├──────────────────────┤
│ + Новый проект       │  ← primary-button во всю ширину
├──────────────────────┤
│ Проекты              │  ← header списка (мелкий, uppercase, muted)
│                      │
│ ▣ Acme site          │  ← <SidebarProjectList />
│ ▣ Mobile app         │     активный — bg-accent + левая граница 2px primary
│ ▣ Internal CRM       │
│ ▣ Marketing          │
│                      │
│ (свободное место)    │
├──────────────────────┤
│ ● Oleg          ⋯    │  ← <SidebarUserMenu /> (DropdownMenu trigger)
└──────────────────────┘
```

**Айтем списка проектов** (`SidebarProjectListItem`): иконка типа (Globe/Box/Circle), название, точка-статус справа (для `active`/`paused`), архивные — пониженный contrast. Активный — `bg-accent` + левая граница 2px primary. Hover — `bg-muted`. Клик → `navigate('/projects/' + projectId)`.

**`SidebarUserMenu`**: shadcn `<DropdownMenu>`. Триггер — `<Avatar />` + имя + иконка `MoreHorizontal`. Меню (открывается вверх):
- Профиль → `navigate('/profile')`
- Настройки (disabled, серый — TODO в будущей спеке)
- ── разделитель ──
- Тема: Светлая · Тёмная · Система (sub-menu)
- ── разделитель ──
- Выйти (disabled — нет auth)

### 3.3 Страницы внутри `Outlet`

**`HomePage`** (`/`) — пустое состояние когда проект не выбран:
- Заголовок «Выберите проект» + подсказка «или создайте новый».
- CTA-кнопка `+ Новый проект` (по клику — toast «Появится в следующих спецификациях»).
- Минималистично, по центру, никаких dashboard-виджетов.

**`ProjectPage`** (`/projects/:projectId`) — заглушка:
- Хлебные крошки `Проекты / Acme site`.
- Заголовок проекта + бейджи type/status.
- Текст-плейсхолдер: «Содержимое проекта появится в следующих спецификациях».
- При неизвестном `:id` — «Проект не найден» + кнопка возврата к `/`.

**`ProfilePage`** (`/profile`):

```
┌──────────────────────────────────────────────────────┐
│ ← Назад к проектам                                   │
│                                                      │
│ Профиль                                              │
│ ─────────────────────────────────────────────────    │
│                                                      │
│      Личные данные                                   │
│      Аватар  [●] [Загрузить]                         │
│      Имя     [Oleg                ]                  │
│      Email   [oleg@projectsflow.ru]                  │
│                              [Сохранить]             │
│                                                      │
│      Безопасность                                    │
│      Текущий пароль   [          ]                   │
│      Новый пароль     [          ]                   │
│      Подтверждение    [          ]                   │
│                              [Сменить пароль]        │
│      ⓘ В этой спеке пароль не сохраняется            │
│                                                      │
│      Преференсы                                      │
│      Тема   ( ) Светлая  (●) Тёмная  ( ) Система     │
│                                                      │
└──────────────────────────────────────────────────────┘
```

- Контент-колонка фиксированной ширины (`max-w-2xl`) по центру.
- Каждый раздел — `<Card>` с `<CardHeader>` + `<CardContent>`.
- «Личные данные»: меняет mock-состояние, новое имя сразу видно в сайдбаре.
- «Безопасность»: при сабмите — toast «Backend будет добавлен в auth-спеке».
- «Преференсы → Тема»: работает по-настоящему через `ThemeProvider`.

### 3.4 Список новых shadcn-компонентов

Установить через `npx shadcn@latest add ...`: `button`, `input`, `label`, `avatar`, `dropdown-menu`, `card`, `separator`, `sonner` (toasts), `radio-group`, `tooltip`, `sheet` (для мобильного сайдбара).

---

## 4. Слой моков (ports + adapters + seed)

### 4.1 Доменные сущности

```ts
// domain/project/Project.ts
export type ProjectType = 'website' | 'software' | 'other';
export type ProjectStatus = 'active' | 'paused' | 'archived';

export type Project = {
  readonly id: string;          // ULID, чтобы потом перейти на серверные id без боли
  readonly name: string;
  readonly type: ProjectType;
  readonly status: ProjectStatus;
  readonly createdAt: Date;
};
```

```ts
// domain/user/User.ts
export type User = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
};
```

### 4.2 Порты (интерфейсы в `application`)

```ts
// application/project/ProjectRepository.ts
export interface ProjectRepository {
  list(): Promise<Project[]>;
  getById(id: string): Promise<Project | null>;
}

// application/user/UserRepository.ts
export interface UserRepository {
  getCurrent(): Promise<User>;
  updateProfile(input: { displayName: string; email: string }): Promise<User>;
}
```

Все методы `async`. Моки тоже возвращают `Promise` — иначе при переходе на HTTP-репозиторий пришлось бы переписывать вызывающий код.

### 4.3 Use-cases (тонкая обёртка, но обязательная)

```ts
// application/project/ListProjects.ts
export class ListProjects {
  constructor(private readonly repo: ProjectRepository) {}
  execute(): Promise<Project[]> {
    return this.repo.list();
  }
}
```

Кажется избыточным сейчас, но в будущем сюда добавится сортировка/фильтрация по типу/правам тенанта/логика «недавно открытых». Использование use-cases с первого дня — это место, куда такая логика естественно ложится, не пачкая UI и не утекая в репозиторий.

Use-cases: `ListProjects`, `GetProject`, `GetCurrentUser`, `UpdateProfile`.

### 4.4 Mock-репозитории (в `infrastructure/mock/`)

```ts
// infrastructure/mock/MockProjectRepository.ts
import { Project } from '@/domain/project/Project';
import { ProjectRepository } from '@/application/project/ProjectRepository';
import { seedProjects } from './seed-data';

const LATENCY_MS = 120;
const delay = <T>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), LATENCY_MS));

export class MockProjectRepository implements ProjectRepository {
  private readonly projects: Project[] = [...seedProjects];

  list(): Promise<Project[]> {
    return delay([...this.projects]);
  }

  getById(id: string): Promise<Project | null> {
    return delay(this.projects.find((p) => p.id === id) ?? null);
  }
}
```

`MockUserRepository` — с mutable in-memory state, чтобы `updateProfile` реально менял имя в локальном состоянии и обновление было видно в сайдбаре:

```ts
export class MockUserRepository implements UserRepository {
  private current: User = seedUser;

  async getCurrent(): Promise<User> {
    return delay(this.current);
  }

  async updateProfile(input: { displayName: string; email: string }): Promise<User> {
    this.current = { ...this.current, ...input };
    return delay(this.current);
  }
}
```

**Почему 120мс задержки.** Без неё UI никогда не покажет loading state, и при переходе на HTTP мы обнаружим, что забыли skeleton'ы. Лучше сразу видеть в моках.

### 4.5 Seed-данные

```ts
// infrastructure/mock/seed-data.ts
export const seedProjects: Project[] = [
  { id: '01HXXXXX001', name: 'Acme site',       type: 'website',  status: 'active',   createdAt: new Date('2025-01-15') },
  { id: '01HXXXXX002', name: 'Mobile app',      type: 'software', status: 'active',   createdAt: new Date('2025-03-20') },
  { id: '01HXXXXX003', name: 'Internal CRM',    type: 'software', status: 'paused',   createdAt: new Date('2024-11-02') },
  { id: '01HXXXXX004', name: 'Marketing pages', type: 'website',  status: 'archived', createdAt: new Date('2024-05-10') },
];

export const seedUser: User = {
  id: '01HUSR0001',
  email: 'oleg@projectsflow.ru',
  displayName: 'Oleg',
  avatarUrl: null,
};
```

Достаточно для проверки: непустой список, разные типы, разные статусы.

### 4.6 DI-контейнер

```tsx
// infrastructure/di/container.tsx
import { createContext, useContext, ReactNode } from 'react';
import { MockProjectRepository } from '@/infrastructure/mock/MockProjectRepository';
import { MockUserRepository } from '@/infrastructure/mock/MockUserRepository';
import { ListProjects } from '@/application/project/ListProjects';
import { GetProject } from '@/application/project/GetProject';
import { GetCurrentUser } from '@/application/user/GetCurrentUser';
import { UpdateProfile } from '@/application/user/UpdateProfile';

type Container = {
  listProjects: ListProjects;
  getProject: GetProject;
  getCurrentUser: GetCurrentUser;
  updateProfile: UpdateProfile;
};

function buildContainer(): Container {
  const projectRepo = new MockProjectRepository();
  const userRepo = new MockUserRepository();
  return {
    listProjects: new ListProjects(projectRepo),
    getProject: new GetProject(projectRepo),
    getCurrentUser: new GetCurrentUser(userRepo),
    updateProfile: new UpdateProfile(userRepo),
  };
}

// Module-level singleton: репозитории с in-memory state не должны пересоздаваться.
// useMemo не даёт строгой гарантии (React может сбросить кэш), useRef работает,
// но для DI это лишний слой. Модульный singleton проще и надёжнее.
const container = buildContainer();

const ContainerCtx = createContext<Container | null>(null);

export function ContainerProvider({ children }: { children: ReactNode }) {
  return <ContainerCtx.Provider value={container}>{children}</ContainerCtx.Provider>;
}

export function useContainer(): Container {
  const c = useContext(ContainerCtx);
  if (!c) throw new Error('useContainer must be used inside <ContainerProvider>');
  return c;
}
```

Когда придёт настоящий бэк: создаём `HttpProjectRepository implements ProjectRepository`, меняем `new MockProjectRepository()` → `new HttpProjectRepository(httpClient)` в `buildContainer`. Use-cases, хуки, компоненты — без изменений.

### 4.7 Хуки в presentation

```ts
// presentation/hooks/useProjects.ts
import { useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { Project } from '@/domain/project/Project';

export function useProjects() {
  const { listProjects } = useContainer();
  const [data, setData] = useState<Project[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProjects.execute()
      .then((p) => !cancelled && setData(p))
      .catch((e) => !cancelled && setError(e));
    return () => { cancelled = true; };
  }, [listProjects]);

  return { data, error, loading: data === null && error === null };
}
```

Простой ручной паттерн без TanStack Query — для UI-only спеки достаточно.

Аналогично нужен `useCurrentUser()`, который дополнительно умеет реактивно обновляться после `updateProfile`. Реализация — простой шина-событий внутри `MockUserRepository`, либо общий стейт в `ContainerProvider` через `useState` + setter, прокинутый внутрь. Конкретная реализация выбирается на этапе планирования (writing-plans).

---

## 5. Роутинг

### 5.1 Карта роутов

`react-router-dom` v6, синтаксис `createBrowserRouter`.

| Путь | Компонент | Назначение |
|---|---|---|
| `/` | `HomePage` | пустое состояние «выберите проект» |
| `/projects/:projectId` | `ProjectPage` | заглушка детальной |
| `/profile` | `ProfilePage` | страница профиля |
| `*` (catch-all) | `NotFoundPage` | 404 с кнопкой «На главную» |

**Префикс `/projects/`** — длиннее чем `/:projectId`, но защищает от коллизий с будущими роутами (`/settings`, `/billing`, `/team`, …).

### 5.2 Структура

```tsx
// presentation/app/routes.tsx
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/presentation/layout/AppShell';
import { HomePage } from '@/presentation/pages/HomePage';
import { ProjectPage } from '@/presentation/pages/ProjectPage';
import { ProfilePage } from '@/presentation/pages/ProfilePage';
import { NotFoundPage } from '@/presentation/pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'projects/:projectId', element: <ProjectPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
```

Все роуты внутри `AppShell` — сайдбар видим всегда, включая страницу профиля. Если в будущем понадобится «полноэкранная» страница (onboarding, чек-аут), сделаем второй layout-роут без сайдбара.

### 5.3 `AppShell`

```tsx
// presentation/layout/AppShell.tsx
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function AppShell() {
  return (
    <div className="grid h-dvh grid-cols-[260px_1fr] bg-background text-foreground">
      <Sidebar />
      <main className="overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
```

На `<768px` — одна колонка, `Sidebar` через shadcn `<Sheet>` (триггер — кнопка в углу `<main>`).

### 5.4 Активный пункт сайдбара

`SidebarProjectListItem` использует `<NavLink>` с активным классом, либо `useMatch('/projects/:projectId')`. Стили: `data-[active=true]:bg-accent`.

### 5.5 Bootstrap

```tsx
// main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ContainerProvider } from '@/infrastructure/di/container';
import { ThemeProvider } from '@/presentation/components/theme/ThemeProvider';
import { Toaster } from '@/presentation/components/ui/sonner';
import { router } from '@/presentation/app/routes';
import '@/styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ContainerProvider>
      <ThemeProvider defaultTheme="system" storageKey="pf-theme">
        <RouterProvider router={router} />
        <Toaster />
      </ThemeProvider>
    </ContainerProvider>
  </React.StrictMode>
);
```

Порядок провайдеров: DI снаружи → Theme → Router.

---

## 6. Стилевая основа: Tailwind, shadcn, токены, темы

### 6.1 Установка и базовый конфиг

После `npm create vite@latest client -- --template react-ts`:

```bash
cd client
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npx shadcn@latest init   # default style, slate base color, CSS variables
```

`shadcn init` создаёт `components.json`, helper `cn`, обновляет Tailwind-конфиг под CSS-переменные, подключает базовые токены в `globals.css`. Алиас `@/` настраивается через `tsconfig.json` + `vite.config.ts` (`@/` → `./src/`).

**Чтобы shadcn соблюдал наши слои**, в `components.json` явно прописываем алиасы под нашу структуру (а не дефолтные shadcn-пути типа `src/lib/utils`, `src/components/ui`):

```json
{
  "aliases": {
    "components": "@/presentation/components",
    "ui": "@/presentation/components/ui",
    "utils": "@/presentation/lib/cn",
    "lib": "@/presentation/lib",
    "hooks": "@/presentation/hooks"
  }
}
```

Это критично: без этого `npx shadcn add button` положит файлы в `src/components/ui/`, минуя `presentation/`, и нарушит структуру слоёв.

### 6.2 Дизайн-токены (CSS-переменные shadcn)

```css
/* styles/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 4%;

    --muted: 240 5% 96%;
    --muted-foreground: 240 4% 46%;

    --card: 0 0% 100%;
    --card-foreground: 240 10% 4%;

    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 4%;

    --border: 240 6% 90%;
    --input: 240 6% 90%;
    --ring: 217 91% 60%;

    --primary: 217 91% 60%;
    --primary-foreground: 0 0% 100%;

    --secondary: 240 5% 96%;
    --secondary-foreground: 240 10% 4%;

    --accent: 240 5% 96%;
    --accent-foreground: 240 10% 4%;

    --destructive: 0 72% 51%;
    --destructive-foreground: 0 0% 100%;

    --radius: 0.5rem;
  }

  .dark {
    --background: 240 10% 4%;
    --foreground: 0 0% 98%;

    --muted: 240 4% 12%;
    --muted-foreground: 240 5% 64%;

    --card: 240 6% 6%;
    --card-foreground: 0 0% 98%;

    --popover: 240 6% 6%;
    --popover-foreground: 0 0% 98%;

    --border: 240 4% 16%;
    --input: 240 4% 16%;
    --ring: 217 91% 60%;

    --primary: 217 91% 60%;
    --primary-foreground: 0 0% 100%;

    --secondary: 240 4% 12%;
    --secondary-foreground: 0 0% 98%;

    --accent: 240 4% 14%;
    --accent-foreground: 0 0% 98%;

    --destructive: 0 62% 50%;
    --destructive-foreground: 0 0% 98%;
  }

  * { @apply border-border; }
  body { @apply bg-background text-foreground antialiased; }
}
```

**Палитра:** slate-нейтрали + один синий акцент. «Без характера» — интерфейс не отвлекает от данных пользователя. Линейка Linear/Notion/Vercel живёт в этой логике. `--radius: 0.5rem` (8px) — нейтральная скруглённость.

### 6.3 Типографика

В `tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
```

Шрифты — Inter (UI) + JetBrains Mono (для ID/ключей). Подключаем через npm-пакеты `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` — без CDN.

### 6.4 `ThemeProvider`

Своя реализация (без `next-themes`):

```tsx
// presentation/components/theme/ThemeProvider.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';
type Ctx = { theme: Theme; setTheme: (t: Theme) => void; resolved: 'light' | 'dark' };

const ThemeCtx = createContext<Ctx | null>(null);

export function ThemeProvider({
  children, defaultTheme = 'system', storageKey = 'pf-theme',
}: { children: ReactNode; defaultTheme?: Theme; storageKey?: string }) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme,
  );

  const resolved: 'light' | 'dark' =
    theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
  }, [resolved]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => document.documentElement.classList.toggle('dark', mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = (t: Theme) => {
    localStorage.setItem(storageKey, t);
    setThemeState(t);
  };

  return <ThemeCtx.Provider value={{ theme, setTheme, resolved }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error('useTheme must be used inside <ThemeProvider>');
  return c;
}
```

Радио-переключатель на `/profile` и dropdown в сайдбаре оба дёргают `setTheme(...)`.

**FOUC fix:** в `index.html` маленький блокирующий скрипт ДО React ставит класс `dark` на `<html>` сразу из localStorage. Без этого тёмная тема мерцает на каждой загрузке:

```html
<script>
  (function () {
    var t = localStorage.getItem('pf-theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.add(dark ? 'dark' : 'light');
  })();
</script>
```

### 6.5 Иконки

`lucide-react` — родные иконки shadcn-экосистемы, tree-shake-able.

---

## 7. Acceptance criteria

Спецификация выполнена, когда **все** пункты ниже верны:

### Сборка и запуск
- [ ] Корневой `package.json` обновлён: `workspaces` содержит `["client", "server"]`, `scripts.dev` и `scripts.build` снова работают и для client, и для server (через `npm run X -w client && npm run X -w server` или через `concurrently` для dev).
- [ ] `npm install` в корне проходит без ошибок.
- [ ] `npm run dev` поднимает Vite dev-сервер на `http://localhost:5173` (и Express пустышку — она тут не нужна, но скрипт не должен падать).
- [ ] `npm run build -w client` собирает production-bundle без ошибок и warnings.
- [ ] `tsc --noEmit -p client/tsconfig.json` проходит без ошибок (strict mode включён).

### Архитектура и качество
- [ ] Структура папок соответствует секции 2.
- [ ] ESLint с `boundaries`-правилами падает на попытке импортировать `infrastructure/*` из `presentation/*` напрямую (тест-кейс с заведомо плохим импортом в CI должен показать ошибку линтера).
- [ ] `domain/*` не содержит ни одного импорта вне domain.
- [ ] `application/*` импортирует только из `domain/*`.

### Главный экран (`/`)
- [ ] Сайдбар 260px слева, контент справа, высота `100dvh`, нет вертикального скролла на корне.
- [ ] Сайдбар: бренд сверху, кнопка `+ Новый проект`, заголовок «Проекты», список из 4 mock-проектов, пользовательское меню внизу.
- [ ] Каждый айтем проекта показывает иконку типа, название, статус-точку (для `active`/`paused`); архивные — пониженный contrast.
- [ ] Hover на айтеме меняет фон. Клик переводит на `/projects/:id`, активный айтем подсвечивается.
- [ ] Пустая контент-область показывает `HomePage` с заголовком «Выберите проект» и CTA.
- [ ] При задержке 120ms виден skeleton сайдбара (placeholder-айтемы), не пустой блок и не CLS-прыжок.

### Меню пользователя
- [ ] Клик по аватару открывает dropdown: Профиль, Настройки (disabled), разделитель, sub-menu Тема, разделитель, Выйти (disabled).
- [ ] «Профиль» переводит на `/profile`.
- [ ] Sub-menu Тема имеет 3 пункта (Светлая / Тёмная / Система) с отметкой текущего.

### Страница проекта (`/projects/:id`)
- [ ] Заглушка с хлебными крошками, заголовком проекта, бейджами type/status, текстом «Содержимое появится в следующих спецификациях».
- [ ] При неизвестном `:id` — «Проект не найден» + кнопка возврата к `/`.

### Страница профиля (`/profile`)
- [ ] Три карточки: Личные данные / Безопасность / Преференсы.
- [ ] Сохранение «Личных данных» меняет `displayName` в mock-репозитории, и **новое имя сразу видно** в сайдбаре (реактивность UI работает).
- [ ] Сабмит «Безопасности» показывает toast «Backend будет добавлен в auth-спеке».
- [ ] Переключение темы меняет тему мгновенно, состояние в `localStorage` выживает перезагрузку.

### Темы
- [ ] Светлая, тёмная, system-тема работают.
- [ ] Нет FOUC: при загрузке в тёмной теме не мерцает белый.
- [ ] При смене OS-темы (если выбрано «Система») UI меняется без перезагрузки.

### Адаптивность
- [ ] На `<768px` сайдбар скрыт, кнопка-гамбургер в углу контента открывает его как Sheet.
- [ ] На `≥768px` сайдбар постоянно виден.

### Документация
- [ ] `client/README.md` (короткий): как запустить, как добавить shadcn-компонент, ссылка на этот дизайн-док.
- [ ] `CLAUDE.md` обновлён: разрешён React в `client/`, описаны слои Clean Architecture, ESLint-правила, запрет на импорт `infrastructure` из `presentation`, новые npm-скрипты.
- [ ] Этот дизайн-документ закоммичен в репо.

---

## 8. Риски и митигация

| Риск | Митигация |
|---|---|
| Mock-данные «приживутся» и UI начнёт зависеть от их формы | Use-cases возвращают доменные сущности, не «mock-форматы». Когда HTTP-репозиторий вернёт ровно такой же `Project`, UI не заметит подмены. |
| Clean Architecture окажется ритуалом без пользы для одного экрана | ESLint-правила + ревью первой PR. Если через 2 спеки слои не дают пользы — обсудим упрощение. |
| shadcn-обновления конфликтуют с нашими правками | Все shadcn-компоненты в `presentation/components/ui/` лежат в репо, обновления опциональны и контролируемы. |
| Tailwind-классы расплываются по компонентам | Длинные сочетания → выносим в собственные классы через `@apply` в `globals.css`, или используем `cva` (class-variance-authority, входит с shadcn). |
| `useCurrentUser` не реагирует на `updateProfile` (моки не «пушат» события) | На этапе планирования выбрать конкретный механизм: общий стейт в `ContainerProvider`, либо event-emitter в репозитории, либо `useSyncExternalStore`. Решить до начала реализации. |

---

## 9. Открытые вопросы (решить на этапе writing-plans)

1. Конкретный механизм реактивного обновления `useCurrentUser` после `updateProfile` (см. таблицу рисков выше).
2. Точный список ESLint-правил для `boundaries` (название плагина, формат конфига).
3. Включать ли `vitest` в скаффолд сразу (для будущих тестов в Spec #2), или это решит Spec #2.
4. Загрузка аватара в Личных данных — оставить кнопку как заглушку с toast'ом, или вообще скрыть до отдельной спеки про загрузку файлов?

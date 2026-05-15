# Platform UI Skeleton — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать каркас платформы ProjectsFlow — главный экран (сайдбар + контент) и страницу `/profile` на mock-данных, с архитектурой по слоям и UI на Vite + React + Tailwind + shadcn/ui.

**Architecture:** Clean Architecture с четырьмя слоями (`domain` → `application` → `infrastructure` → `presentation`), однонаправленными зависимостями, DI через React Context. Mock-репозитории в `infrastructure/mock/` реализуют порты из `application/`. ESLint-плагин `boundaries` физически запрещает нарушения слоёв.

**Tech Stack:** Vite 5 · React 18 · TypeScript 5 (strict) · Tailwind CSS 3 · shadcn/ui · react-router-dom 6 · lucide-react · sonner · `eslint-plugin-boundaries`.

**Spec:** [docs/superpowers/specs/2026-05-14-platform-ui-skeleton-design.md](../specs/2026-05-14-platform-ui-skeleton-design.md)

**Замечания по среде исполнения:**

- Корневая директория проекта — `c:\www\ProjectsFlow`. Все пути в плане — относительно неё, если не указано иначе.
- Git: в репозитории сейчас warning «dubious ownership» на Windows (`BSQL/djdes` vs `BSQL/Oleg`). До разрешения этой проблемы коммиты руками либо после `git config --global --add safe.directory C:/www/ProjectsFlow`. В плане команды `git commit` приведены, но требуют рабочего git.
- Платформа — Windows + PowerShell. Команды даны в форме, понятной и PowerShell, и bash (обычные `npm` / `npx`); там где специфика — указано явно.
- Кириллица: пользовательские строки UI — на русском. Имена идентификаторов, технические комментарии — на английском.

---

## File Structure

Все новые файлы — в `client/` (создаётся в Task 1). После завершения плана структура папок такая:

```
client/
├── eslint.config.js
├── components.json
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── README.md
└── src/
    ├── main.tsx
    ├── styles/globals.css
    ├── domain/
    │   ├── project/
    │   │   ├── Project.ts
    │   │   └── ProjectType.ts
    │   └── user/
    │       └── User.ts
    ├── application/
    │   ├── project/
    │   │   ├── ProjectRepository.ts
    │   │   ├── ListProjects.ts
    │   │   └── GetProject.ts
    │   └── user/
    │       ├── UserRepository.ts
    │       ├── GetCurrentUser.ts
    │       └── UpdateProfile.ts
    ├── infrastructure/
    │   ├── mock/
    │   │   ├── MockProjectRepository.ts
    │   │   ├── MockUserRepository.ts
    │   │   └── seed-data.ts
    │   └── di/
    │       └── container.tsx
    └── presentation/
        ├── app/
        │   └── routes.tsx
        ├── layout/
        │   ├── AppShell.tsx
        │   ├── Sidebar.tsx
        │   ├── SidebarProjectList.tsx
        │   └── SidebarUserMenu.tsx
        ├── pages/
        │   ├── HomePage.tsx
        │   ├── ProjectPage.tsx
        │   ├── ProfilePage.tsx
        │   └── NotFoundPage.tsx
        ├── hooks/
        │   ├── useProjects.ts
        │   └── useCurrentUser.ts
        ├── components/
        │   ├── ui/                  ← shadcn-компоненты (button, input, …)
        │   └── theme/
        │       └── ThemeProvider.tsx
        └── lib/
            └── cn.ts
```

Изменения вне `client/`:
- `package.json` (корень) — вернуть `client` в `workspaces`, починить `dev`/`build`.
- `CLAUDE.md` — обновить раздел про стек и архитектуру.

---

## Task 1: Scaffold Vite + React + TS client and restore root workspaces

**Files:**
- Create: `client/` (целиком — генерируется через `npm create vite`)
- Modify: `package.json`

- [ ] **Step 1: Создать Vite-проект внутри `client/`**

В корне репозитория выполнить:

```bash
npm create vite@latest client -- --template react-ts
```

Команда создаст `client/` с базовой Vite-структурой (package.json, vite.config.ts, tsconfig.json, src/App.tsx, src/main.tsx, src/index.css, public/, index.html).

- [ ] **Step 2: Удалить файлы из шаблона, которые мы заменим своими**

```bash
Remove-Item -Force -Confirm:$false client/src/App.tsx
Remove-Item -Force -Confirm:$false client/src/App.css
Remove-Item -Force -Confirm:$false client/src/index.css
Remove-Item -Force -Confirm:$false client/src/assets/react.svg
Remove-Item -Force -Confirm:$false client/public/vite.svg
```

(на не-Windows-окружении использовать `rm -f`.)

- [ ] **Step 3: Назначить имя workspace в `client/package.json`**

Открыть `client/package.json` и заменить поле `"name"` с того, что сгенерил Vite (`client`), на `@projectsflow/client`. Поля `version`, `private`, `type`, `scripts`, `dependencies`, `devDependencies` — оставить как есть.

- [ ] **Step 4: Восстановить workspaces в корневом `package.json`**

Заменить `package.json` (корень) на:

```json
{
  "name": "projectsflow",
  "version": "0.1.0",
  "private": true,
  "description": "ProjectsFlow — платформа управления проектами",
  "type": "module",
  "workspaces": [
    "client",
    "server"
  ],
  "scripts": {
    "dev": "concurrently -k -n client,server -c blue,green \"npm:dev -w client\" \"npm:dev -w server\"",
    "build": "npm run build -w client && npm run build -w server",
    "start": "node server/dist/index.js",
    "db:migrate": "node --env-file=.env scripts/migrate.mjs",
    "deploy": "node scripts/deploy.mjs",
    "lint": "npm run lint -w client"
  },
  "devDependencies": {
    "concurrently": "^9.1.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 5: Установить зависимости с корня (workspaces)**

```bash
npm install
```

Ожидаемо: установка проходит без ошибок, появляются `node_modules/` (как с корня, так и symlink'и через workspaces).

- [ ] **Step 6: Проверить, что dev-сервер клиента стартует**

```bash
npm run dev -w client
```

Ожидаемо: vite пишет `Local: http://localhost:5173/`. Открыть в браузере — увидеть пустую страницу (мы удалили `App.tsx`, поэтому будет ошибка импорта; это норм, исправим в следующих шагах). Прервать (Ctrl+C).

- [ ] **Step 7: Commit**

```bash
git add client package.json package-lock.json
git commit -m "feat(client): scaffold Vite + React + TS workspace"
```

---

## Task 2: Configure path alias `@/` → `./src/`

**Files:**
- Modify: `client/tsconfig.json`
- Modify: `client/tsconfig.app.json` (генерится vite — если отсутствует, тогда `client/tsconfig.json`)
- Modify: `client/vite.config.ts`
- Modify: `client/package.json` (devDep: `@types/node`)

- [ ] **Step 1: Установить `@types/node` в client (нужен для `path` в vite.config.ts)**

```bash
npm install -D @types/node -w client
```

- [ ] **Step 2: Настроить путь в `client/tsconfig.app.json`**

Открыть `client/tsconfig.app.json` (или `client/tsconfig.json` если отдельного app-конфига нет — зависит от версии vite-template). В секцию `"compilerOptions"` добавить:

```json
"baseUrl": ".",
"paths": {
  "@/*": ["src/*"]
}
```

- [ ] **Step 3: Настроить алиас в `client/vite.config.ts`**

Заменить содержимое `client/vite.config.ts` на:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 4: Проверить, что type-check проходит**

```bash
npx tsc --noEmit -p client
```

Ожидаемо: нет ошибок (либо ошибка про отсутствующий `main.tsx`-импорт — нормально, исправим позже).

- [ ] **Step 5: Commit**

```bash
git add client/tsconfig.app.json client/vite.config.ts client/package.json package-lock.json
git commit -m "feat(client): configure @/ path alias"
```

---

## Task 3: Install and configure Tailwind CSS

**Files:**
- Create: `client/postcss.config.js`
- Create: `client/tailwind.config.ts`
- Create: `client/src/styles/globals.css`
- Modify: `client/package.json` (devDeps)

- [ ] **Step 1: Установить Tailwind, PostCSS, autoprefixer**

```bash
npm install -D tailwindcss@^3 postcss autoprefixer tailwindcss-animate -w client
```

(`tailwindcss-animate` нужен для shadcn в Task 5.)

- [ ] **Step 2: Создать `client/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Создать `client/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'ui-monospace', 'monospace'],
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
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
```

- [ ] **Step 4: Создать `client/src/styles/globals.css` с дизайн-токенами**

```css
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
  html, body, #root { height: 100%; }
}
```

- [ ] **Step 5: Установить переменные шрифты**

```bash
npm install @fontsource-variable/inter @fontsource-variable/jetbrains-mono -w client
```

- [ ] **Step 6: Commit**

```bash
git add client/postcss.config.js client/tailwind.config.ts client/src/styles/globals.css client/package.json package-lock.json
git commit -m "feat(client): set up Tailwind CSS with design tokens and fonts"
```

---

## Task 4: Initialize shadcn/ui with custom aliases pointing to presentation/

**Files:**
- Create: `client/components.json`
- Create: `client/src/presentation/lib/cn.ts`

- [ ] **Step 1: Создать `client/components.json` вручную (минуя интерактивный `shadcn init`)**

`shadcn init` интерактивный, а нам нужны custom-алиасы под нашу `presentation/`-структуру (без этого `npx shadcn add` положит файлы в `src/components/ui/` мимо слоёв). Создать файл руками:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/styles/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/presentation/components",
    "ui": "@/presentation/components/ui",
    "utils": "@/presentation/lib/cn",
    "lib": "@/presentation/lib",
    "hooks": "@/presentation/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 2: Создать helper `cn` в `client/src/presentation/lib/cn.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Установить рантайм-зависимости shadcn**

```bash
npm install clsx tailwind-merge class-variance-authority lucide-react -w client
```

- [ ] **Step 4: Проверить, что type-check проходит**

```bash
npx tsc --noEmit -p client
```

Ожидаемо: нет ошибок.

- [ ] **Step 5: Commit**

```bash
git add client/components.json client/src/presentation/lib/cn.ts client/package.json package-lock.json
git commit -m "feat(client): configure shadcn/ui with layered aliases"
```

---

## Task 5: Install shadcn components needed for the spec

**Files:**
- Create (через `shadcn add`): `client/src/presentation/components/ui/{button,input,label,avatar,dropdown-menu,card,separator,sonner,radio-group,tooltip,sheet,skeleton}.tsx`

- [ ] **Step 1: Установить компоненты пачкой**

Из директории `client/`:

```bash
cd client
npx shadcn@latest add button input label avatar dropdown-menu card separator sonner radio-group tooltip sheet skeleton --yes --overwrite
cd ..
```

(`--yes` пропускает интерактив, `--overwrite` нужен если что-то уже было; в нашем случае ничего не было.)

Ожидаемо: команда установит ~12 файлов в `client/src/presentation/components/ui/`, плюс добавит peer-зависимости (`@radix-ui/react-*`, `sonner`, `lucide-react` уже стоит). Если запрос про базовый цвет всё-таки появится — выбрать `slate`.

- [ ] **Step 2: Проверить, что файлы появились в правильном месте**

Запустить:

```bash
ls client/src/presentation/components/ui
```

Ожидаемо: `avatar.tsx`, `button.tsx`, `card.tsx`, `dropdown-menu.tsx`, `input.tsx`, `label.tsx`, `radio-group.tsx`, `separator.tsx`, `sheet.tsx`, `skeleton.tsx`, `sonner.tsx`, `tooltip.tsx`.

Если файлы попали в `client/src/components/ui/` — значит, `components.json` не прочитался: проверить, что Task 4 Step 1 выполнен корректно и что shadcn запускался из `client/`.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit -p client
```

Ожидаемо: нет ошибок.

- [ ] **Step 4: Commit**

```bash
git add client/src/presentation/components/ui client/package.json package-lock.json
git commit -m "feat(client): install shadcn components (button, dropdown, card, sheet, etc.)"
```

---

## Task 6: Set up ESLint with layer boundaries

**Files:**
- Create: `client/eslint.config.js`
- Modify: `client/package.json` (devDeps + lint script)

- [ ] **Step 1: Установить ESLint и плагины**

```bash
npm install -D eslint @eslint/js typescript-eslint eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-boundaries -w client
```

- [ ] **Step 2: Создать `client/eslint.config.js`** (flat config, ESLint 9+)

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import boundaries from 'eslint-plugin-boundaries';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      boundaries,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly', matchMedia: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' },
    },
    settings: {
      react: { version: 'detect' },
      'boundaries/elements': [
        { type: 'domain',         pattern: 'src/domain/**' },
        { type: 'application',    pattern: 'src/application/**' },
        { type: 'infrastructure', pattern: 'src/infrastructure/**' },
        { type: 'presentation',   pattern: 'src/presentation/**' },
        { type: 'styles',         pattern: 'src/styles/**' },
        { type: 'bootstrap',      pattern: 'src/main.tsx' },
      ],
      'boundaries/ignore': ['**/*.d.ts'],
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'boundaries/element-types': ['error', {
        default: 'disallow',
        rules: [
          { from: 'domain',         allow: ['domain'] },
          { from: 'application',    allow: ['domain', 'application'] },
          { from: 'infrastructure', allow: ['domain', 'application', 'infrastructure'] },
          { from: 'presentation',   allow: ['domain', 'application', 'presentation'] },
          { from: 'bootstrap',      allow: ['domain', 'application', 'infrastructure', 'presentation', 'styles'] },
          { from: 'styles',         allow: ['styles'] },
        ],
      }],
    },
  },
];
```

`bootstrap` — единственное место, которому разрешено импортировать из `infrastructure` (там собирается DI-контейнер в Task 11). `presentation` имеет доступ только к `domain` + `application`, что и обещает Clean Architecture.

- [ ] **Step 3: Добавить lint-скрипт в `client/package.json`**

В `client/package.json` в `"scripts"` добавить:

```json
"lint": "eslint . --max-warnings=0"
```

- [ ] **Step 4: Запустить линтер, убедиться что не падает на пустом проекте**

```bash
npm run lint -w client
```

Ожидаемо: либо пусто (нет ts/tsx-файлов с импортами), либо предупреждения про неиспользуемые импорты в shadcn-компонентах. Если в shadcn-компонентах есть `no-unused-vars` или `no-explicit-any` errors — добавить overrides в конфиг (только для `src/presentation/components/ui/**`) с правилом отключения этих. Это нормально: shadcn-код — внешний, мы его не пишем.

Если errors есть, добавить в `eslint.config.js` после основной секции:

```js
{
  files: ['src/presentation/components/ui/**/*.{ts,tsx}'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    'react-hooks/exhaustive-deps': 'off',
  },
},
```

- [ ] **Step 5: Verify boundaries работают — создать заведомо плохой импорт**

Временно создать `client/src/presentation/_test-boundary-violation.ts`:

```ts
// Заведомо нарушает слои — presentation не должен импортировать infrastructure напрямую.
import { MockProjectRepository } from '@/infrastructure/mock/MockProjectRepository';
console.log(MockProjectRepository);
```

(Файла `MockProjectRepository` ещё нет, но линтер ругается на импорт ДО разрешения модуля.)

Запустить:

```bash
npm run lint -w client
```

Ожидаемо: **ESLint падает** с ошибкой `boundaries/element-types`: импорт из `infrastructure` в `presentation` запрещён. Это подтверждает, что правила работают.

Удалить временный файл:

```bash
Remove-Item -Force -Confirm:$false client/src/presentation/_test-boundary-violation.ts
```

- [ ] **Step 6: Финальный lint должен снова проходить**

```bash
npm run lint -w client
```

Ожидаемо: clean run.

- [ ] **Step 7: Commit**

```bash
git add client/eslint.config.js client/package.json package-lock.json
git commit -m "feat(client): enforce Clean Architecture layer boundaries via ESLint"
```

---

## Task 7: Implement domain layer

**Files:**
- Create: `client/src/domain/project/Project.ts`
- Create: `client/src/domain/project/ProjectType.ts`
- Create: `client/src/domain/user/User.ts`

- [ ] **Step 1: Создать `ProjectType.ts`**

```ts
export type ProjectType = 'website' | 'software' | 'other';

export type ProjectStatus = 'active' | 'paused' | 'archived';
```

- [ ] **Step 2: Создать `Project.ts`**

```ts
import type { ProjectType, ProjectStatus } from './ProjectType';

export type Project = {
  readonly id: string;          // ULID, переживёт миграцию на серверные id
  readonly name: string;
  readonly type: ProjectType;
  readonly status: ProjectStatus;
  readonly createdAt: Date;
};
```

- [ ] **Step 3: Создать `User.ts`**

```ts
export type User = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
};
```

- [ ] **Step 4: Type-check + lint**

```bash
npx tsc --noEmit -p client
npm run lint -w client
```

Ожидаемо: оба прохода — чистые.

- [ ] **Step 5: Commit**

```bash
git add client/src/domain
git commit -m "feat(client/domain): add Project and User entities"
```

---

## Task 8: Implement application layer — project ports and use-cases

**Files:**
- Create: `client/src/application/project/ProjectRepository.ts`
- Create: `client/src/application/project/ListProjects.ts`
- Create: `client/src/application/project/GetProject.ts`

- [ ] **Step 1: Создать `ProjectRepository.ts` (port)**

```ts
import type { Project } from '@/domain/project/Project';

export interface ProjectRepository {
  list(): Promise<Project[]>;
  getById(id: string): Promise<Project | null>;
}
```

- [ ] **Step 2: Создать `ListProjects.ts` (use-case)**

```ts
import type { Project } from '@/domain/project/Project';
import type { ProjectRepository } from './ProjectRepository';

export class ListProjects {
  constructor(private readonly repo: ProjectRepository) {}

  execute(): Promise<Project[]> {
    return this.repo.list();
  }
}
```

- [ ] **Step 3: Создать `GetProject.ts` (use-case)**

```ts
import type { Project } from '@/domain/project/Project';
import type { ProjectRepository } from './ProjectRepository';

export class GetProject {
  constructor(private readonly repo: ProjectRepository) {}

  execute(id: string): Promise<Project | null> {
    return this.repo.getById(id);
  }
}
```

- [ ] **Step 4: Type-check + lint**

```bash
npx tsc --noEmit -p client
npm run lint -w client
```

- [ ] **Step 5: Commit**

```bash
git add client/src/application/project
git commit -m "feat(client/application): add ProjectRepository port and use-cases"
```

---

## Task 9: Implement application layer — user ports and use-cases

**Files:**
- Create: `client/src/application/user/UserRepository.ts`
- Create: `client/src/application/user/GetCurrentUser.ts`
- Create: `client/src/application/user/UpdateProfile.ts`

- [ ] **Step 1: Создать `UserRepository.ts`**

`getCurrent` возвращает текущего пользователя. `updateProfile` обновляет имя/email и возвращает новый снапшот. `subscribe` нужен, чтобы UI мог реактивно обновляться после `updateProfile` без TanStack Query: репозиторий публикует событие, хуки подписываются.

```ts
import type { User } from '@/domain/user/User';

export type UserChangeListener = (user: User) => void;

export interface UserRepository {
  getCurrent(): Promise<User>;
  updateProfile(input: { displayName: string; email: string }): Promise<User>;
  subscribe(listener: UserChangeListener): () => void;
}
```

`subscribe` возвращает unsubscribe-функцию (стандартный pub-sub-контракт). Это решает «открытый вопрос #1» из спеки.

- [ ] **Step 2: Создать `GetCurrentUser.ts`**

```ts
import type { User } from '@/domain/user/User';
import type { UserRepository } from './UserRepository';

export class GetCurrentUser {
  constructor(private readonly repo: UserRepository) {}

  execute(): Promise<User> {
    return this.repo.getCurrent();
  }
}
```

- [ ] **Step 3: Создать `UpdateProfile.ts`**

```ts
import type { User } from '@/domain/user/User';
import type { UserRepository } from './UserRepository';

export type UpdateProfileInput = {
  displayName: string;
  email: string;
};

export class UpdateProfile {
  constructor(private readonly repo: UserRepository) {}

  execute(input: UpdateProfileInput): Promise<User> {
    return this.repo.updateProfile(input);
  }
}
```

- [ ] **Step 4: Type-check + lint**

```bash
npx tsc --noEmit -p client
npm run lint -w client
```

- [ ] **Step 5: Commit**

```bash
git add client/src/application/user
git commit -m "feat(client/application): add UserRepository port (with subscribe) and use-cases"
```

---

## Task 10: Implement infrastructure layer — mock repositories and seed

**Files:**
- Create: `client/src/infrastructure/mock/seed-data.ts`
- Create: `client/src/infrastructure/mock/MockProjectRepository.ts`
- Create: `client/src/infrastructure/mock/MockUserRepository.ts`

- [ ] **Step 1: Создать `seed-data.ts`**

```ts
import type { Project } from '@/domain/project/Project';
import type { User } from '@/domain/user/User';

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

- [ ] **Step 2: Создать `MockProjectRepository.ts`**

```ts
import type { Project } from '@/domain/project/Project';
import type { ProjectRepository } from '@/application/project/ProjectRepository';
import { seedProjects } from './seed-data';

const LATENCY_MS = 120;
const delay = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

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

- [ ] **Step 3: Создать `MockUserRepository.ts` (с pub-sub)**

```ts
import type { User } from '@/domain/user/User';
import type { UserRepository, UserChangeListener } from '@/application/user/UserRepository';
import { seedUser } from './seed-data';

const LATENCY_MS = 120;
const delay = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

export class MockUserRepository implements UserRepository {
  private current: User = seedUser;
  private readonly listeners = new Set<UserChangeListener>();

  async getCurrent(): Promise<User> {
    return delay(this.current);
  }

  async updateProfile(input: { displayName: string; email: string }): Promise<User> {
    this.current = { ...this.current, displayName: input.displayName, email: input.email };
    const snapshot = await delay(this.current);
    for (const listener of this.listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  subscribe(listener: UserChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
```

- [ ] **Step 4: Type-check + lint**

```bash
npx tsc --noEmit -p client
npm run lint -w client
```

- [ ] **Step 5: Commit**

```bash
git add client/src/infrastructure/mock
git commit -m "feat(client/infra): add mock repositories with seed data"
```

---

## Task 11: Implement DI container

**Files:**
- Create: `client/src/infrastructure/di/container.tsx`

- [ ] **Step 1: Создать `container.tsx`**

```tsx
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { MockProjectRepository } from '@/infrastructure/mock/MockProjectRepository';
import { MockUserRepository } from '@/infrastructure/mock/MockUserRepository';
import { ListProjects } from '@/application/project/ListProjects';
import { GetProject } from '@/application/project/GetProject';
import { GetCurrentUser } from '@/application/user/GetCurrentUser';
import { UpdateProfile } from '@/application/user/UpdateProfile';
import type { UserRepository } from '@/application/user/UserRepository';

export type Container = {
  listProjects: ListProjects;
  getProject: GetProject;
  getCurrentUser: GetCurrentUser;
  updateProfile: UpdateProfile;
  userRepository: UserRepository;     // exposed напрямую для subscribe в хуках
};

function buildContainer(): Container {
  const projectRepo = new MockProjectRepository();
  const userRepo = new MockUserRepository();
  return {
    listProjects: new ListProjects(projectRepo),
    getProject: new GetProject(projectRepo),
    getCurrentUser: new GetCurrentUser(userRepo),
    updateProfile: new UpdateProfile(userRepo),
    userRepository: userRepo,
  };
}

const ContainerCtx = createContext<Container | null>(null);

export function ContainerProvider({ children }: { children: ReactNode }) {
  const container = useMemo(() => buildContainer(), []);
  return <ContainerCtx.Provider value={container}>{children}</ContainerCtx.Provider>;
}

export function useContainer(): Container {
  const c = useContext(ContainerCtx);
  if (!c) throw new Error('useContainer must be used inside <ContainerProvider>');
  return c;
}
```

`userRepository` экспонируется в контейнере намеренно — это единственный способ для хуков подписаться на изменения. Контракт `UserRepository` живёт в `application/`, так что `presentation` всё равно не зависит напрямую от `MockUserRepository`.

- [ ] **Step 2: Type-check + lint**

```bash
npx tsc --noEmit -p client
npm run lint -w client
```

- [ ] **Step 3: Commit**

```bash
git add client/src/infrastructure/di
git commit -m "feat(client/infra): add DI container with React Context"
```

---

## Task 12: Implement ThemeProvider

**Files:**
- Create: `client/src/presentation/components/theme/ThemeProvider.tsx`

- [ ] **Step 1: Создать `ThemeProvider.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  resolved: 'light' | 'dark';
};

const ThemeCtx = createContext<ThemeContextValue | null>(null);

function readStoredTheme(storageKey: string, fallback: Theme): Theme {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* SSR/private-mode — ignore */
  }
  return fallback;
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'pf-theme',
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme(storageKey, defaultTheme));
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(theme));

  useEffect(() => {
    setResolved(resolveTheme(theme));
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
  }, [resolved]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setResolved(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = (t: Theme) => {
    try { localStorage.setItem(storageKey, t); } catch { /* ignore */ }
    setThemeState(t);
  };

  return <ThemeCtx.Provider value={{ theme, setTheme, resolved }}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeContextValue {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error('useTheme must be used inside <ThemeProvider>');
  return c;
}
```

- [ ] **Step 2: Type-check + lint**

```bash
npx tsc --noEmit -p client
npm run lint -w client
```

- [ ] **Step 3: Commit**

```bash
git add client/src/presentation/components/theme
git commit -m "feat(client/presentation): add ThemeProvider with system theme support"
```

---

## Task 13: Implement React hooks (`useProjects`, `useCurrentUser`)

**Files:**
- Create: `client/src/presentation/hooks/useProjects.ts`
- Create: `client/src/presentation/hooks/useCurrentUser.ts`

- [ ] **Step 1: Создать `useProjects.ts`**

```ts
import { useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { Project } from '@/domain/project/Project';

type UseProjectsResult = {
  data: Project[] | null;
  error: Error | null;
  loading: boolean;
};

export function useProjects(): UseProjectsResult {
  const { listProjects } = useContainer();
  const [data, setData] = useState<Project[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProjects.execute()
      .then((p) => { if (!cancelled) setData(p); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e : new Error(String(e))); });
    return () => { cancelled = true; };
  }, [listProjects]);

  return { data, error, loading: data === null && error === null };
}
```

- [ ] **Step 2: Создать `useCurrentUser.ts` (с подпиской на updateProfile)**

```ts
import { useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { User } from '@/domain/user/User';

type UseCurrentUserResult = {
  data: User | null;
  error: Error | null;
  loading: boolean;
};

export function useCurrentUser(): UseCurrentUserResult {
  const { getCurrentUser, userRepository } = useContainer();
  const [data, setData] = useState<User | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser.execute()
      .then((u) => { if (!cancelled) setData(u); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e : new Error(String(e))); });
    return () => { cancelled = true; };
  }, [getCurrentUser]);

  useEffect(() => {
    const unsubscribe = userRepository.subscribe((next) => setData(next));
    return unsubscribe;
  }, [userRepository]);

  return { data, error, loading: data === null && error === null };
}
```

- [ ] **Step 3: Type-check + lint**

```bash
npx tsc --noEmit -p client
npm run lint -w client
```

- [ ] **Step 4: Commit**

```bash
git add client/src/presentation/hooks
git commit -m "feat(client/presentation): add useProjects and useCurrentUser hooks"
```

---

## Task 14: Implement page stubs (`HomePage`, `ProjectPage`, `NotFoundPage`)

**Files:**
- Create: `client/src/presentation/pages/HomePage.tsx`
- Create: `client/src/presentation/pages/ProjectPage.tsx`
- Create: `client/src/presentation/pages/NotFoundPage.tsx`

- [ ] **Step 1: Создать `HomePage.tsx`**

```tsx
import { Button } from '@/presentation/components/ui/button';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

export function HomePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Выберите проект</h1>
      <p className="max-w-md text-muted-foreground">
        Выберите проект в&nbsp;списке слева или&nbsp;создайте новый.
      </p>
      <Button
        size="lg"
        onClick={() => toast('Создание проектов появится в&nbsp;следующих спецификациях')}
      >
        <Plus className="mr-2 h-4 w-4" />
        Новый проект
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Создать `ProjectPage.tsx`**

```tsx
import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { Project } from '@/domain/project/Project';
import { Button } from '@/presentation/components/ui/button';

const TYPE_LABEL: Record<Project['type'], string> = {
  website: 'Сайт',
  software: 'ПО',
  other: 'Другое',
};

const STATUS_LABEL: Record<Project['status'], string> = {
  active: 'В работе',
  paused: 'На паузе',
  archived: 'В архиве',
};

export function ProjectPage() {
  const { projectId } = useParams();
  const { getProject } = useContainer();
  const [project, setProject] = useState<Project | null | undefined>(undefined);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    getProject.execute(projectId).then((p) => {
      if (!cancelled) setProject(p);
    });
    return () => { cancelled = true; };
  }, [projectId, getProject]);

  if (project === undefined) {
    return <div className="p-6 text-muted-foreground">Загрузка…</div>;
  }

  if (project === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold">Проект не&nbsp;найден</h1>
        <p className="text-muted-foreground">Возможно, ссылка устарела или&nbsp;проект был удалён.</p>
        <Button asChild>
          <Link to="/">На главную</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <nav className="text-sm text-muted-foreground">
        <Link to="/" className="hover:underline">Проекты</Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{project.name}</span>
      </nav>
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
        <div className="flex gap-2 text-sm">
          <span className="rounded-md border px-2 py-1">{TYPE_LABEL[project.type]}</span>
          <span className="rounded-md border px-2 py-1">{STATUS_LABEL[project.status]}</span>
        </div>
      </header>
      <p className="rounded-lg border bg-muted/40 p-6 text-muted-foreground">
        Содержимое проекта появится в&nbsp;следующих спецификациях.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Создать `NotFoundPage.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { Button } from '@/presentation/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold">404</h1>
      <p className="text-muted-foreground">Такой страницы нет.</p>
      <Button asChild>
        <Link to="/">На главную</Link>
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Type-check + lint**

```bash
npx tsc --noEmit -p client
npm run lint -w client
```

- [ ] **Step 5: Commit**

```bash
git add client/src/presentation/pages/HomePage.tsx client/src/presentation/pages/ProjectPage.tsx client/src/presentation/pages/NotFoundPage.tsx
git commit -m "feat(client/presentation): add HomePage, ProjectPage stub, NotFoundPage"
```

---

## Task 15: Implement ProfilePage

**Files:**
- Create: `client/src/presentation/pages/ProfilePage.tsx`

- [ ] **Step 1: Создать `ProfilePage.tsx`**

Большой компонент, разбивается на три карточки. Каждая управляется локальным `useState` (форма) + вызывает соответствующий use-case или контекст темы.

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useContainer } from '@/infrastructure/di/container';
import { useTheme, type Theme } from '@/presentation/components/theme/ThemeProvider';
import { Button } from '@/presentation/components/ui/button';
import { Input } from '@/presentation/components/ui/input';
import { Label } from '@/presentation/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/presentation/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/presentation/components/ui/radio-group';
import { Avatar, AvatarFallback, AvatarImage } from '@/presentation/components/ui/avatar';

export function ProfilePage() {
  const { data: user, loading } = useCurrentUser();
  const { updateProfile } = useContainer();
  const { theme, setTheme } = useTheme();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setEmail(user.email);
    }
  }, [user]);

  if (loading || !user) {
    return <div className="p-6 text-muted-foreground">Загрузка…</div>;
  }

  const handleProfileSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile.execute({ displayName, email });
      toast.success('Профиль обновлён');
    } catch (err) {
      toast.error(`Не&nbsp;удалось сохранить: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSubmit = (e: FormEvent) => {
    e.preventDefault();
    toast('Смена пароля появится в&nbsp;auth-спецификации');
  };

  const handleAvatarUpload = () => {
    toast('Загрузка аватара появится в&nbsp;отдельной спецификации');
  };

  const initials = user.displayName.slice(0, 2).toUpperCase();

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3">
        <Link to="/"><ArrowLeft className="mr-2 h-4 w-4" />Назад к&nbsp;проектам</Link>
      </Button>

      <h1 className="text-3xl font-semibold tracking-tight">Профиль</h1>

      {/* --- Личные данные --- */}
      <Card>
        <CardHeader>
          <CardTitle>Личные данные</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleProfileSubmit} className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.displayName} /> : null}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <Button type="button" variant="outline" size="sm" onClick={handleAvatarUpload}>
                <Upload className="mr-2 h-4 w-4" />Загрузить
              </Button>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="displayName">Имя</Label>
              <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* --- Безопасность --- */}
      <Card>
        <CardHeader>
          <CardTitle>Безопасность</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="currentPassword">Текущий пароль</Label>
              <Input id="currentPassword" type="password" autoComplete="current-password" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="newPassword">Новый пароль</Label>
              <Input id="newPassword" type="password" autoComplete="new-password" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmPassword">Подтверждение</Label>
              <Input id="confirmPassword" type="password" autoComplete="new-password" />
            </div>
            <p className="text-sm text-muted-foreground">
              В&nbsp;этой версии пароль не&nbsp;сохраняется. Появится в&nbsp;auth-спецификации.
            </p>
            <div className="flex justify-end">
              <Button type="submit" variant="outline">Сменить пароль</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* --- Преференсы --- */}
      <Card>
        <CardHeader>
          <CardTitle>Преференсы</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Тема</Label>
            <RadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)} className="flex gap-6">
              <div className="flex items-center gap-2">
                <RadioGroupItem id="theme-light" value="light" />
                <Label htmlFor="theme-light" className="font-normal">Светлая</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="theme-dark" value="dark" />
                <Label htmlFor="theme-dark" className="font-normal">Тёмная</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="theme-system" value="system" />
                <Label htmlFor="theme-system" className="font-normal">Системная</Label>
              </div>
            </RadioGroup>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

```bash
npx tsc --noEmit -p client
npm run lint -w client
```

- [ ] **Step 3: Commit**

```bash
git add client/src/presentation/pages/ProfilePage.tsx
git commit -m "feat(client/presentation): add ProfilePage with three sections"
```

---

## Task 16: Implement Sidebar pieces (`SidebarProjectList`, `SidebarUserMenu`)

**Files:**
- Create: `client/src/presentation/layout/SidebarProjectList.tsx`
- Create: `client/src/presentation/layout/SidebarUserMenu.tsx`

- [ ] **Step 1: Создать `SidebarProjectList.tsx`**

```tsx
import { NavLink } from 'react-router-dom';
import { Box, Circle, Globe } from 'lucide-react';
import { useProjects } from '@/presentation/hooks/useProjects';
import { Skeleton } from '@/presentation/components/ui/skeleton';
import { cn } from '@/presentation/lib/cn';
import type { Project } from '@/domain/project/Project';

const TYPE_ICON = {
  website: Globe,
  software: Box,
  other: Circle,
} as const;

const STATUS_DOT_CLASS: Record<Project['status'], string> = {
  active:   'bg-emerald-500',
  paused:   'bg-amber-500',
  archived: 'bg-transparent',
};

export function SidebarProjectList() {
  const { data, loading, error } = useProjects();

  if (loading) {
    return (
      <div className="space-y-1 px-2" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return <div className="px-3 text-sm text-destructive">Не&nbsp;удалось загрузить проекты</div>;
  }

  if (data.length === 0) {
    return <div className="px-3 text-sm text-muted-foreground">Проектов ещё нет</div>;
  }

  return (
    <nav className="space-y-0.5 px-2">
      {data.map((project) => {
        const Icon = TYPE_ICON[project.type];
        const isArchived = project.status === 'archived';
        return (
          <NavLink
            key={project.id}
            to={`/projects/${project.id}`}
            className={({ isActive }) =>
              cn(
                'group relative flex h-9 items-center gap-2 rounded-md px-2.5 text-sm transition-colors',
                'hover:bg-muted',
                isActive && 'bg-accent text-accent-foreground',
                isArchived && 'text-muted-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1.5 h-6 w-0.5 rounded-r bg-primary" aria-hidden="true" />
                )}
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{project.name}</span>
                <span
                  className={cn('ml-auto h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT_CLASS[project.status])}
                  aria-hidden="true"
                />
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Создать `SidebarUserMenu.tsx`**

```tsx
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Check } from 'lucide-react';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useTheme, type Theme } from '@/presentation/components/theme/ThemeProvider';
import { Avatar, AvatarFallback, AvatarImage } from '@/presentation/components/ui/avatar';
import { Skeleton } from '@/presentation/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/presentation/components/ui/dropdown-menu';

const THEME_LABEL: Record<Theme, string> = {
  light: 'Светлая',
  dark: 'Тёмная',
  system: 'Системная',
};

export function SidebarUserMenu() {
  const { data: user, loading } = useCurrentUser();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  if (loading || !user) {
    return <Skeleton className="m-3 h-10" />;
  }

  const initials = user.displayName.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="m-2 flex h-10 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar className="h-7 w-7">
          {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.displayName} /> : null}
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <span className="flex-1 truncate text-sm">{user.displayName}</span>
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        <DropdownMenuLabel className="font-normal text-muted-foreground">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/profile')}>Профиль</DropdownMenuItem>
        <DropdownMenuItem disabled>Настройки</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Тема: {THEME_LABEL[theme]}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {(['light', 'dark', 'system'] as Theme[]).map((t) => (
              <DropdownMenuItem key={t} onClick={() => setTheme(t)}>
                {t === theme ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 inline-block h-4 w-4" />}
                {THEME_LABEL[t]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Выйти</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Type-check + lint**

```bash
npx tsc --noEmit -p client
npm run lint -w client
```

- [ ] **Step 4: Commit**

```bash
git add client/src/presentation/layout/SidebarProjectList.tsx client/src/presentation/layout/SidebarUserMenu.tsx
git commit -m "feat(client/presentation): add SidebarProjectList and SidebarUserMenu"
```

---

## Task 17: Implement Sidebar and AppShell with responsive behavior

**Files:**
- Create: `client/src/presentation/layout/Sidebar.tsx`
- Create: `client/src/presentation/layout/AppShell.tsx`

- [ ] **Step 1: Создать `Sidebar.tsx`**

```tsx
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/presentation/components/ui/button';
import { SidebarProjectList } from './SidebarProjectList';
import { SidebarUserMenu } from './SidebarUserMenu';

export function Sidebar() {
  return (
    <aside className="grid h-full grid-rows-[auto_auto_1fr_auto] border-r bg-card">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
          PF
        </div>
        <span className="text-sm font-semibold">ProjectsFlow</span>
      </div>

      <div className="p-3">
        <Button
          className="w-full justify-start"
          onClick={() => toast('Создание проектов появится в&nbsp;следующих спецификациях')}
        >
          <Plus className="mr-2 h-4 w-4" />Новый проект
        </Button>
      </div>

      <div className="overflow-y-auto">
        <div className="px-4 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Проекты
        </div>
        <SidebarProjectList />
      </div>

      <div className="border-t">
        <SidebarUserMenu />
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Создать `AppShell.tsx` (с responsive Sheet)**

```tsx
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Sheet, SheetContent, SheetTrigger } from '@/presentation/components/ui/sheet';
import { Button } from '@/presentation/components/ui/button';
import { useLocation } from 'react-router-dom';

const DESKTOP_BREAKPOINT = '(min-width: 768px)';

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(DESKTOP_BREAKPOINT).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_BREAKPOINT);
    const handler = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isDesktop;
}

export function AppShell() {
  const isDesktop = useIsDesktop();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (isDesktop) {
    return (
      <div className="grid h-dvh grid-cols-[260px_1fr] bg-background text-foreground">
        <Sidebar />
        <main className="overflow-y-auto"><Outlet /></main>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <div className="flex h-12 items-center gap-2 border-b px-3">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Меню">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[260px] p-0">
            <Sidebar />
          </SheetContent>
        </Sheet>
        <span className="text-sm font-semibold">ProjectsFlow</span>
      </div>
      <main className="flex-1 overflow-y-auto"><Outlet /></main>
    </div>
  );
}
```

- [ ] **Step 3: Type-check + lint**

```bash
npx tsc --noEmit -p client
npm run lint -w client
```

- [ ] **Step 4: Commit**

```bash
git add client/src/presentation/layout/Sidebar.tsx client/src/presentation/layout/AppShell.tsx
git commit -m "feat(client/presentation): add Sidebar composer and AppShell with mobile Sheet"
```

---

## Task 18: Wire up routing and bootstrap the app

**Files:**
- Create: `client/src/presentation/app/routes.tsx`
- Create: `client/src/main.tsx` (перезапись пустого/удалённого)
- Modify: `client/index.html` (FOUC-fix + меньше Vite-дефолтов)
- Modify: `client/package.json` (зависимость `react-router-dom`)

- [ ] **Step 1: Установить `react-router-dom`**

```bash
npm install react-router-dom -w client
```

- [ ] **Step 2: Создать `client/src/presentation/app/routes.tsx`**

```tsx
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

- [ ] **Step 3: Создать (перезаписать) `client/src/main.tsx`**

```tsx
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@/styles/globals.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ContainerProvider } from '@/infrastructure/di/container';
import { ThemeProvider } from '@/presentation/components/theme/ThemeProvider';
import { Toaster } from '@/presentation/components/ui/sonner';
import { router } from '@/presentation/app/routes';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found in index.html');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ContainerProvider>
      <ThemeProvider defaultTheme="system" storageKey="pf-theme">
        <RouterProvider router={router} />
        <Toaster richColors position="bottom-right" />
      </ThemeProvider>
    </ContainerProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 4: Заменить `client/index.html` целиком (с FOUC-fix)**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ProjectsFlow</title>
    <script>
      (function () {
        try {
          var t = localStorage.getItem('pf-theme') || 'system';
          var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
          document.documentElement.classList.add(dark ? 'dark' : 'light');
        } catch (e) {}
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Type-check + lint**

```bash
npx tsc --noEmit -p client
npm run lint -w client
```

Если линтер ругается на `main.tsx` из-за boundaries-правил — проверь, что в `eslint.config.js` (Task 6) `main.tsx` помечен как `bootstrap`-элемент, и `bootstrap` имеет `allow: ['domain', 'application', 'infrastructure', 'presentation', 'styles']`.

- [ ] **Step 6: Commit**

```bash
git add client/src/main.tsx client/src/presentation/app/routes.tsx client/index.html client/package.json package-lock.json
git commit -m "feat(client): wire up routing and bootstrap with FOUC-safe theme"
```

---

## Task 19: Manual verification against spec acceptance criteria

Эта задача — единая последовательность ручных проверок. Никакого кода. Запускаем dev-сервер и идём по чек-листу из спеки.

- [ ] **Step 1: Стартануть dev-сервер**

```bash
npm run dev -w client
```

Ожидаемо: Vite пишет `Local: http://localhost:5173/`.

- [ ] **Step 2: Открыть `http://localhost:5173/` в браузере**

Проверить:
- Сайдбар 260px слева, контент справа, высота 100dvh, общий скролл документа отсутствует.
- В сайдбаре: бренд «PF ProjectsFlow» сверху, кнопка `+ Новый проект`, заголовок «Проекты», список из 4 mock-проектов (Acme site / Mobile app / Internal CRM / Marketing pages), внизу — `Oleg ⋯`.
- Архивный проект (Marketing pages) — пониженной контрастности.
- Активные/paused — с цветной точкой статуса справа.
- При первой загрузке (DevTools: throttle 3G) **на ~120 мс виден skeleton сайдбара**, без layout shift.
- В контенте — `HomePage`: «Выберите проект» + кнопка `+ Новый проект`. Клик по кнопке показывает toast.

- [ ] **Step 3: Hover/click по проекту**

- При наведении на айтем — фон становится светлее (bg-muted).
- Клик по «Acme site» → URL меняется на `/projects/01HXXXXX001`, айтем подсвечен фоном `bg-accent` + левая полоска `primary`.
- В контенте — `ProjectPage` с хлебными крошками, заголовком, бейджами type/status, текстом-плейсхолдером.

- [ ] **Step 4: Несуществующий проект**

В адресной строке: `http://localhost:5173/projects/does-not-exist`
Ожидаемо: «Проект не найден» + кнопка «На главную».

- [ ] **Step 5: Меню пользователя**

- Клик по `Oleg ⋯` внизу сайдбара → открывается dropdown.
- Видны пункты: Email (заголовок), Профиль, Настройки (disabled), Тема: <текущая> (с sub-menu), Выйти (disabled).
- Sub-menu Тема показывает три пункта с галочкой у текущего.
- Клик «Профиль» → переход на `/profile`.

- [ ] **Step 6: ProfilePage**

- Три карточки: Личные данные / Безопасность / Преференсы.
- Меняем «Имя» с `Oleg` на `Oleg Test`, нажимаем «Сохранить» → toast «Профиль обновлён». Имя в сайдбаре **сразу меняется** на `Oleg Test`.
- Перезагружаем страницу (F5) — имя сбрасывается обратно на `Oleg` (моки in-memory, это ожидаемо).
- Жмём «Сменить пароль» → toast «Смена пароля появится в auth-спецификации».
- Переключаем тему на «Тёмная» → весь UI мгновенно темнеет, состояние сохранено в localStorage.
- F5 → тема осталась тёмной, **нет FOUC** (нет белой вспышки).

- [ ] **Step 7: Переключение системной темы**

В preferences переключателе выбираем «Системная». В DevTools → Rendering → Emulate CSS prefers-color-scheme → переключаем light/dark. UI меняется без перезагрузки.

- [ ] **Step 8: Адаптивность**

В DevTools уменьшаем ширину окна до < 768px (например, iPhone 12). Ожидаемо:
- Сайдбар скрыт, в верхней панели слева — кнопка-гамбургер.
- Клик по гамбургеру открывает Sheet с сайдбаром.
- Клик по проекту в Sheet → переход + Sheet закрывается.
- Возвращаем ширину обратно — сайдбар снова постоянный.

- [ ] **Step 9: Production build проходит**

В новом терминале (dev можно не глушить):

```bash
npm run build -w client
```

Ожидаемо: Vite пишет `✓ built in ...ms`, без ошибок и warnings.

- [ ] **Step 10: Финальный lint**

```bash
npm run lint -w client
```

Ожидаемо: clean run.

- [ ] **Step 11: Финальный type-check**

```bash
npx tsc --noEmit -p client
```

Ожидаемо: clean run.

- [ ] **Step 12: Commit (если в процессе были tweaks)**

Если на Step 1–8 что-то пришлось дочинить (правки CSS, опечатки, отсутствующие классы) — закоммитить пачкой:

```bash
git add client
git commit -m "fix(client): manual verification tweaks"
```

Если правок не было, шаг пропустить.

---

## Task 20: Update CLAUDE.md and add client/README.md

**Files:**
- Modify: `CLAUDE.md`
- Create: `client/README.md`

- [ ] **Step 1: Создать `client/README.md`**

```markdown
# ProjectsFlow Client

Vite + React + TypeScript + Tailwind + shadcn/ui SPA для платформы управления проектами.

## Запуск

Из корня репо:

```bash
npm install            # один раз — поднимет все workspaces
npm run dev -w client  # dev-сервер на http://localhost:5173/
```

## Структура

Чистая архитектура, четыре слоя — `domain` → `application` → `infrastructure` → `presentation`. Зависимости идут только внутрь. ESLint-плагин `boundaries` физически запрещает нарушения слоёв (см. [eslint.config.js](./eslint.config.js)).

Подробнее в дизайн-документе: [docs/superpowers/specs/2026-05-14-platform-ui-skeleton-design.md](../docs/superpowers/specs/2026-05-14-platform-ui-skeleton-design.md).

## Добавить shadcn-компонент

Из `client/`:

```bash
npx shadcn@latest add <component-name>
```

Файлы попадут в `src/presentation/components/ui/` (через `aliases` в `components.json`).

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev -w client` | dev-сервер |
| `npm run build -w client` | prod-билд в `client/dist/` |
| `npm run lint -w client` | ESLint (включая layer boundaries) |
| `npx tsc --noEmit -p client` | type-check |
```

- [ ] **Step 2: Обновить `CLAUDE.md`** — заменить раздел «Стек» и связанные разделы

Открыть `CLAUDE.md` и найти раздел `## Стек — без отклонений`. Заменить **весь** этот раздел и раздел `## Правила для AI-ассистентов` на:

```markdown
## Стек — без отклонений

- **Node.js 22 LTS** (на сервере через nvm, см. `.nvmrc`).
- **Бэк:** Express 4 + mysql2/promise. ESM, TypeScript. На момент Spec #1 — пустой скелет в `server/` (наполнение в Spec #2).
- **Фронт:** Vite + React 18 + TypeScript в `client/`. Clean Architecture (четыре слоя), ESLint-плагин `boundaries` блокирует нарушения слоёв. UI — Tailwind CSS + shadcn/ui. Роутер — `react-router-dom`.
- **MariaDB 10.11** (совместима с MySQL 8). Кодировка `utf8mb4`.
- **PM2** для процесса на сервере (`ecosystem.config.cjs`).
- **nginx** (FastPanel, reverse proxy) проксирует домен → `127.0.0.1:4317`.

Не вводи новые языки/фреймворки без обсуждения. Никаких Next.js / Vue / Svelte / Remix.

## Архитектура фронта (client/)

Четыре слоя с однонаправленными зависимостями:

| Слой | Может импортировать из |
|---|---|
| `domain` | — |
| `application` | `domain` |
| `infrastructure` | `application`, `domain` |
| `presentation` | `application`, `domain` |
| `main.tsx` (bootstrap) | все слои |

`presentation` НЕ импортирует из `infrastructure` напрямую — только через DI-контейнер (`@/infrastructure/di/container`). ESLint падает на нарушении.

Полная спека первой итерации — [docs/superpowers/specs/2026-05-14-platform-ui-skeleton-design.md](docs/superpowers/specs/2026-05-14-platform-ui-skeleton-design.md).

## Правила для AI-ассистентов

1. **Не нарушать слои.** Если хочется импорт из `infrastructure` в `presentation` — это сигнал, что не хватает use-case или DI-инъекции, а не повод гасить линтер.
2. **shadcn-компоненты добавляются через CLI** (`npx shadcn@latest add ...` из `client/`). Алиасы в `components.json` уже указаны на `presentation/`, поэтому файлы попадают в правильное место.
3. **Стили — Tailwind + CSS-переменные shadcn.** Длинные классы → `@apply` в `globals.css` или `cva`. Не вводить новые CSS-токены без обновления `globals.css` (обе темы).
4. **Миграции — append-only.** Не редактируй уже выкаченные `db/0*_*.sql`, делай новый файл. MariaDB не понимает `INSERT ... AS new ...` — только `VALUES(col)`.
5. **`.env` — никогда не коммитим.** Шаблон — `.env.example`. Боевые значения для людей — в `docs/ONBOARDING.md`.
6. **Кириллица.** Все пользовательские строки UI — на русском. Технические комментарии и переменные — на английском.
7. **Не править nginx-конфиги** — этим занимается админ FastPanel.
```

Раздел `## Контекст проекта` — обновить:

Найти:
```
- **Что это.** Лендинг `projectsflow.ru` — «История проектов»...
```

Заменить на:
```
- **Что это.** Платформа управления проектами — multi-tenant SaaS для ведения сайтов, ПО и других инициатив. Домен — `projectsflow.ru`. Первый этап (Spec #1) — UI-скелет на моках; auth и реальный backend — в следующих спецификациях.
- **Зачем.** Свой инструмент для управления портфелем проектов команды.
- **Где живёт.** FastPanel на VPS `projectsflow.ru` (Azure Ubuntu 24.04). Код приложения: `/var/www/projectsflow/data/www/projectsflow.ru/`.
- **Статус.** Spec #1 (UI skeleton) в разработке. На прод ничего нового не выкатывается до завершения auth-спеки.
```

И удалить раздел `## Структура и где что менять` целиком — она про старый лендинг. Заменить на:

```
## Где что менять

Структура клиента описана в [client/README.md](client/README.md). Структура бэка появится в Spec #2.
```

- [ ] **Step 3: Lint всех изменений (нужен ли он на CLAUDE.md — нет, но check, что lint всё ещё проходит на client)**

```bash
npm run lint -w client
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md client/README.md
git commit -m "docs: update CLAUDE.md for platform pivot, add client README"
```

---

## Self-Review

Прошёлся по плану со свежими глазами. Что нашёл и поправил inline:

1. **Type consistency:** В Task 9 (UserRepository) добавил `subscribe()`-метод и `UserChangeListener`-тип. В Task 11 (DI-контейнер) экспонировал `userRepository: UserRepository`, чтобы хук мог его дернуть. В Task 13 (`useCurrentUser`) использовал `userRepository.subscribe(...)`. Сигнатуры совпадают.

2. **Spec coverage:** Прошёлся по `## 7. Acceptance criteria` спеки — каждый пункт находит себя в задачах:
   - Сборка/запуск → Task 1, 19 (Step 9–11)
   - Архитектура и качество (ESLint, слои) → Task 6 (включая Step 5 verify)
   - Главный экран → Task 16 (SidebarProjectList) + Task 17 (Sidebar/AppShell) + Task 14 (HomePage) → проверка в Task 19 Step 2–3
   - Меню пользователя → Task 16 (SidebarUserMenu) → проверка в Task 19 Step 5
   - ProjectPage → Task 14 → проверка в Task 19 Step 3–4
   - ProfilePage → Task 15 → проверка в Task 19 Step 6
   - Темы → Task 12 (ThemeProvider) + Task 18 Step 4 (FOUC) → проверка в Task 19 Step 6–7
   - Адаптивность → Task 17 (AppShell) → проверка в Task 19 Step 8
   - Документация → Task 20

3. **Placeholder scan:** Нет «TBD», «handle edge cases», «similar to Task N» без повторения кода. Каждый шаг с кодом — код приведён.

4. **Открытые вопросы из спеки:**
   - #1 (механизм реактивности `useCurrentUser`) → решён через pub-sub в `UserRepository` (Task 9 + 10 + 13).
   - #2 (название ESLint-плагина) → `eslint-plugin-boundaries`, конфиг в Task 6.
   - #3 (vitest сейчас или в Spec #2) → **в этом плане не включаем**, спека явно отнесла тесты к Spec #2. Если хочется заранее — отдельным шагом после Task 20, но мы намеренно не делаем.
   - #4 (загрузка аватара) → кнопка остаётся с toast'ом, реализовано в Task 15 (handler `handleAvatarUpload`).

5. **Дублирование строки в Task 18 «Modify: client/package.json»** — поправил выше (визуальный артефакт, на исполнение не влияет — содержимое команд корректное).

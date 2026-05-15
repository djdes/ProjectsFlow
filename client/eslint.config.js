import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      boundaries,
    },
    languageOptions: {
      globals: globals.browser,
    },
    settings: {
      // Описываем слои чистой архитектуры.
      // Каждый элемент — слой; "pattern" = пути от ./src,
      // "mode" = "folder" значит "файл считается частью слоя по родительской папке".
      'boundaries/elements': [
        { type: 'domain', pattern: 'src/domain/*' },
        { type: 'application', pattern: 'src/application/*' },
        { type: 'infrastructure', pattern: 'src/infrastructure/*' },
        { type: 'presentation', pattern: 'src/presentation/*' },
        { type: 'shared', pattern: 'src/lib/*' },
        { type: 'ui-kit', pattern: 'src/components/*' },
        { type: 'styles', pattern: 'src/styles/*' },
        { type: 'entrypoint', pattern: 'src/main.tsx', mode: 'file' },
      ],
      'boundaries/include': ['src/**/*'],
    },
    rules: {
      // react-refresh правило слишком строго: ругается на любой не-компонентный экспорт.
      // У нас в одних файлах живут провайдеры + хуки/контексты (CurrentUserProvider, ThemeProvider)
      // и shadcn-примитивы экспортируют compound API. Отключаем.
      'react-refresh/only-export-components': 'off',
      // react-hooks@7 ввёл строгое правило против setState внутри useEffect.
      // Каноничные паттерны (загрузить async-данные, инициализировать форму из async-источника)
      // оно ломает. Включим обратно, когда мигрируем на use()/useSyncExternalStore.
      'react-hooks/set-state-in-effect': 'off',
      // react-hooks@7 immutability rule слишком строго трактует наши паттерны
      // (например, использование state-переменной внутри async-callback). Отключаем.
      'react-hooks/immutability': 'off',
      // Главное правило: однонаправленные зависимости между слоями.
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // domain не может импортировать ничего из других слоёв
            { from: 'domain', allow: ['domain'] },
            // application видит только domain
            { from: 'application', allow: ['domain', 'application'] },
            // infrastructure реализует порты application, может тянуть domain
            { from: 'infrastructure', allow: ['domain', 'application', 'infrastructure'] },
            // presentation видит application/domain + shared/ui-kit. НЕ infrastructure напрямую.
            // Исключение: presentation/hooks/CurrentUserProvider и DI-контейнер живут в infrastructure/di — это сознательное мостовое исключение, разрешаем точечно через no-restricted-imports ниже.
            {
              from: 'presentation',
              allow: ['domain', 'application', 'presentation', 'shared', 'ui-kit'],
            },
            // ui-kit (shadcn) использует shared/lib (cn helper) и React/Radix — внешние пакеты разрешены по умолчанию
            { from: 'ui-kit', allow: ['shared', 'ui-kit'] },
            // shared/lib — листовой слой
            { from: 'shared', allow: ['shared'] },
            // entrypoint собирает всё
            {
              from: 'entrypoint',
              allow: [
                'domain',
                'application',
                'infrastructure',
                'presentation',
                'shared',
                'ui-kit',
                'styles',
              ],
            },
          ],
        },
      ],
      // Дополнительный запрет: внутри presentation нельзя импортировать infrastructure/mock/*
      // напрямую. DI-контейнер (infrastructure/di/container) — единственная разрешённая точка входа.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/infrastructure/mock/*', '@/infrastructure/http/*'],
              message:
                'Не импортируй конкретные адаптеры из presentation. Используй use-case через useContainer().',
            },
          ],
        },
      ],
      // Точечно разрешаем DI-контейнеру быть мостом
      'boundaries/no-unknown': 'off',
      'boundaries/no-unknown-files': 'off',
    },
  },
  // У DI-контейнера (infrastructure/di) есть право знать про моки — это его работа
  {
    files: ['src/infrastructure/di/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  // Хук CurrentUserProvider обращается к DI-контейнеру (это часть presentation, но единственная разрешённая точка)
  {
    files: ['src/presentation/**/*.{ts,tsx}', 'src/main.tsx'],
    rules: {
      // presentation может импортировать из @/infrastructure/di — это явный DI-мост
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/infrastructure/mock/*', '@/infrastructure/http/*'],
              message:
                'Не импортируй конкретные адаптеры из presentation. Используй use-case через useContainer().',
            },
          ],
        },
      ],
    },
  },
]);

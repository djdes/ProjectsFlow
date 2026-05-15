Хочу реализовать новую KB-архитектуру для ProjectsFlow. Контекст ниже.

## 1. Что прочитать перед стартом
- `CLAUDE.md` в корне репо — правила работы.
- `C:\Users\Oleg\Desktop\projectsflow-kb-architecture.html` — итог brainstorming-сессии (10 слайдов, открой в браузере или прочти исходник).
- `MEMORY.md` загрузится автоматически — там мои persistent-предпочтения. Применяй их.

## 2. К чему пришли в брейншторме (TL;DR)
- **Source of truth для KB** = per-project git-репо с markdown-файлами и YAML-frontmatter.
- **ProjectsFlow — тонкий слой:** валидатор frontmatter на write, Meilisearch для search, web UI для человека, MCP-сервер для внешних ИИ.
- **Folder conventions** внутри каждого KB-репо: `credentials/`, `decisions/`, `services/`, `schemas/`, `runbooks/`, `notes/`.
- **Два режима AI:** (a) Claude Code локально через git clone/push, (b) внешний ИИ через MCP.
- **НЕ строим KB-сущности в БД.** БД остаётся только для users/sessions/projects-metadata/github-tokens.

## 3. Что ещё открыто — нужно закрыть перед спецификацией
1. **Storage backend.** Свой git-сервер (isomorphic-git/nodegit) vs Gitea/Forgejo as service vs пользовательский GitHub-аккаунт vs кастомный file-store с версиями.
2. **Список типов frontmatter** (`type: credential|decision|service|schema|runbook|note`) и обязательные поля для каждого.
3. **MCP tool surface.** Read-only или read+write? Как авторизуется внешний ИИ? Scoping по projects?
4. **Secrets handling.** `secret_ref: vault://...` — что за vault, где живут сами секреты, как UI их раскрывает.
5. **Migration path.** Что делать с уже существующими в БД projects/github-tokens — оставить как метаданные проекта или переносить в KB-репо.

## 4. Workflow, которого жду
а) Через skill `superpowers:brainstorming` дозайди со мной по 5 открытым вопросам выше — **по одному за раз, кратко**, multiple-choice где возможно. Без meta-фаз и лишних обсуждений.

б) Когда вопросы закрыты — напиши spec в `docs/superpowers/specs/2026-05-14-kb-architecture-design.md`. Я отревьюю.

в) После аппрува спецификации — через skill `superpowers:writing-plans` напиши implementation plan.

г) Реализацию начинай **ТОЛЬКО после моего аппрува плана**, через `superpowers:executing-plans`.

## 5. Критичные правила (продублирую из CLAUDE.md)
- Clean Architecture: domain → application → infrastructure → presentation. Защищено ESLint.
- `presentation` НЕ импортирует из `infrastructure/{mock,http}/*` напрямую — только через `useContainer()`.
- Никакого Next.js / NextAuth / TanStack Query / MUI.
- Миграции БД append-only.
- UI-строки — кириллица; код, типы, комментарии — английский.
- Не вводить новые большие зависимости без обсуждения.

Старт — с пункта 4а. Первый вопрос — про storage backend.

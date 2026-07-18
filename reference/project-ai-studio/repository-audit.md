# Аудит ProjectsFlow: ИИ-чаты и проектная «Студия»

## Зона копирования

- Notion: навигационный раздел ИИ, список сохранённых чатов, создание и открытие чата в основной области.
- Base44: split workspace с AI-чатом слева и Preview/Dashboard справа, верхняя панель Preview/Edit/route/device/actions.
- ProjectsFlow: оригинальная реализация с существующими правами, project-scoped worker API, Preview Editor, Dashboard и realtime.

## Уже существующие компоненты

| Область | Реализация |
|---|---|
| App routes | `client/src/presentation/app/routes.tsx` |
| Desktop sidebar / rail | `client/src/presentation/layout/Sidebar.tsx`, `SidebarNavRail.tsx` |
| Shell / collapsed sidebar | `client/src/presentation/layout/AppShell.tsx` |
| Project page shell | `client/src/presentation/pages/TasksPage.tsx` |
| Preview / editor | `client/src/presentation/components/project/workspace/ProjectPreview.tsx`, `workspace/preview/*` |
| Dashboard | `ProjectDashboard.tsx`, `workspace/dashboard/*` |
| Human chat | `client/src/{domain,application,presentation}/chat/*`, `server/src/{domain,application,presentation}/chat/*` |
| Short AI text jobs | `server/src/{domain,application,presentation}/ai-prompt/*`, `ai_prompt_jobs` |
| Site edit jobs | `server/src/{domain,application,presentation}/site-editor/*` |
| Realtime | `RealtimeHub`, `ChatEventHub`, `useNotificationStream` |

## Архитектурные выводы

1. Глобальные ИИ-чаты должны быть URL-driven: `/ai` и `/ai/c/:conversationId`. Это сохраняет deep-link, Back/Forward, refresh и работу нескольких вкладок.
2. Проектная студия должна быть route, а не локальным табом: `/projects/:projectId/studio?panel=preview|dashboard`.
3. Human-chat не используется как AI history: у него другая модель авторов, реакций, прочтения и модерации.
4. `ai_prompt_jobs` не является историей чата: terminal jobs очищаются, а старый worker отправляет неизвестный mode в `Do-Improve`.
5. Нужны отдельные долговечные conversation/message таблицы и отдельные agent endpoints для chat jobs. Legacy pending endpoint не должен возвращать chat mode старому Ralph.
6. AI-ответ является read-only. Изменение сайта создаётся как отдельное предложение и после явного подтверждения использует существующий site-editor pipeline.
7. Project Studio chat приватен для пользователя в v1, связан с проектом и автоматически появляется в общем списке ИИ-чатов.
8. Доступ проверяется на каждом read/send/stream. Контекст проекта собирает сервер и не включает credentials, secrets или полный app DB.

## Целевая клиентская структура

```text
client/src/domain/ai-chat/*
client/src/application/ai-chat/*
client/src/infrastructure/http/HttpAiConversationRepository.ts
client/src/presentation/pages/AiPage.tsx
client/src/presentation/pages/ProjectStudioPage.tsx
client/src/presentation/components/ai/*
client/src/presentation/components/project/studio/*
client/src/presentation/hooks/useAiConversations.ts
client/src/presentation/hooks/useAiConversation.ts
```

Sidebar получает четвёртый раздел `ИИ`. На desktop список чатов живёт в левой панели; открытый общий чат занимает основную область. В Studio sidebar по умолчанию плавно сворачивается, а ручное открытие sidebar сдвигает split workspace, не перекрывая его.

## Целевая серверная структура

```text
server/src/domain/ai-conversation/*
server/src/application/ai-conversation/*
server/src/infrastructure/repositories/DrizzleAiConversationRepository.ts
server/src/infrastructure/realtime/AiConversationEventHub.ts
server/src/presentation/ai-conversation/routes.ts
server/src/presentation/ai-conversation/agentRoutes.ts
db/132_ai_conversations.sql
```

Отправка сообщения атомарно создаёт user message, pending assistant message и queued run. Completion атомарно завершает run и assistant message. Список и stream используют монотонный `seq`, поэтому reconnect восстанавливает пропущенные события из БД.

## Ограничения исследования на 19.07.2026

- Ранее сохранённые артефакты Base44 Preview/Dashboard доступны в `reference/base44-preview` и `reference/base44-dashboard`.
- Три текущие Base44-вкладки открыты, но UI не смонтирован: `#root.childElementCount === 0` и `body` пуст.
- Новая вкладка Notion в основном Chrome открывает публичный `notion.com`, авторизованная рабочая область и AI chats недоступны.
- По обязательной Playwright-инструкции production-реализация начинается после восстановления эталонных вкладок и фиксации нового behavior/state-machine/scenarios набора.

## Не трогаем

- `primer/**` и пользовательские спецификации;
- существующие миграции (только новая append-only migration);
- nginx/FastPanel конфигурацию;
- чужие untracked screenshots и reference-артефакты.

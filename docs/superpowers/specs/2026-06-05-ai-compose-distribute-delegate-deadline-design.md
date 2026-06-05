# AI-compose «Распределить»: делегирование + дедлайны на задачу

**Дата:** 2026-06-05
**Статус:** одобрено, реализуется
**Репозитории:** ProjectsFlow (client + server) + ralph (PFLoopDispatch)

## Цель

В диалоге AI-compose (кнопка ✨AI при создании задач) вкладку **«По проектам»**
переименовать в **«Распределить»** и, помимо распределения по проектам, для каждой
задачи определять и предлагать:

- **исполнителя (делегирование)** — по имени из текста («для Ярослава»), сопоставляя
  с участниками проекта в общем доступе;
- **дедлайн** — по явному сроку в тексте («на сегодня», «до конца недели», «до 07.06»).

Диалог — крупнее на десктопе и на весь экран на мобайле (кнопка закрытия уже есть).

Реальный пример: «На сегодня для Ярослава: 1)… 2)… До конца недели для Олега: 1)… 2)…»
→ 4 задачи в 2 проекта, у задач Ярослава дедлайн = сегодня, у Олега = ближайшее
воскресенье; исполнители проставлены автоматически, с возможностью изменить.

## Решения (из брейншторма)

1. **Матчинг имён — AI резолвит на сервере.** Сервер вшивает в compose-контекст список
   участников каждого проекта-кандидата (editor+ only, без самого автора) и «Сегодня».
   Ralph pass-1 возвращает на каждый сегмент `assigneeUserId` (ровно `[userId=…]` из списка)
   и `assigneeName` (имя как в тексте).
2. **Дедлайны — консервативно.** Дедлайн только при явном сроке; иначе `null`.
3. **Нет матча → пусто + подсказка.** Если имя не найдено среди eligible-участников —
   делегирование не ставим, показываем «AI предложил: <имя>», юзер выбирает сам.

## Контракт данных — `ComposeSegment` (+3 поля, все nullable)

`assigneeUserId: string|null`, `assigneeName: string|null`, `deadline: string|null` (`YYYY-MM-DD`).
Контракт меняется в 3 синхронных местах: тип `ComposeSegment` + `parseComposeResult`
(client), Ralph pass-1 JSON + финальный merge (`dispatch.ps1`). Сервер хранит JSON
**опаково** — серверного парсинга нет, миграция БД не нужна.

## Изменения по репозиториям

### client (ProjectsFlow)
- `application/ai/ComposeTasks.ts`: `ComposeSegment` +3 поля; `parseComposeResult` парсит их
  (deadline валидируем `^\d{4}-\d{2}-\d{2}$`, иначе null).
- `presentation/components/ai/AiComposeDialog.tsx`:
  - вкладка «По проектам» → **«Распределить»**;
  - `Row` += `assigneeUserId`, `assigneeName`, `deadline`; инициализация из сегмента;
  - диалог-уровневый кэш участников `Map<projectKey, {userId,displayName}[]>`
    (`listMembers(projectId)` editor+ без себя / `listSharedMembers()` для inbox);
  - на строку: native `<select>` делегата (показывает имя) + `DeadlinePicker` + подсказка
    «AI предложил: <assigneeName>» когда `assigneeUserId===null`;
  - смена проекта строки → сброс `assigneeUserId`;
  - `createTasks()` передаёт `delegateUserId`/`deadline` в `taskRepository.create`; для
    edit-aware update — `update({…,deadline})` + best-effort `taskRepository.delegate()`;
  - `DialogContent`: `sm:max-w-3xl` + full-screen на мобайле
    (`max-sm:inset-0 max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:rounded-none`).

### server (ProjectsFlow)
- `application/ai-prompt/prepareComposeContext.ts`:
  - в `Deps` добавить `members: ProjectMemberRepository` (EnqueueAiPromptJob уже его имеет
    и передаёт `this.deps`);
  - на каждый проект-кандидат — `members.listByProject(p.id)`, фильтр `role∈{editor,owner}`
    и `userId≠автор`, до 30 чел., строка `Участники (кому можно делегировать): [userId=U] Имя; …`;
  - в начало блока — `Сегодня: YYYY-MM-DD` (считает сервер; tz-caveat: серверная дата);
  - всё в рамках существующего `MAX_TOTAL_CHARS=60000`.

### ralph (PFLoopDispatch)
- `prompts/ai-prompt-compose-pass1.md`: в контракт сегмента добавить `assigneeUserId`/
  `assigneeName`/`deadline`; инструкции: исполнитель из `Участники` целевого проекта
  (нет eligible → assigneeUserId=null, assigneeName сохранить); дедлайн только при явном
  сроке относительно «Сегодня» («конец недели» = ближайшее воскресенье); формат YYYY-MM-DD.
- `dispatch.ps1` (`Run-AiComposeWorker`, финальный merge ~3007-3016): протащить 3 новых поля
  из pass-1 `$s` в итоговый объект сегмента. Pass-2 по-прежнему только обогащает `advancedBody`.

## Делегирование — почему работает без новых эндпоинтов

`CreateTask` (server) уже принимает `delegateUserId` и валидирует dual-mode: inbox →
shared-member; реальный проект → участник с ролью editor+. Поэтому
`taskRepository.create(projectId, {…, delegateUserId})` создаёт задачу сразу с делегацией.
Контекст отдаёт AI только editor+ участников → end-to-end консистентно с серверной проверкой.

## Вне scope
- Inbox-сегменты: авто-резолв исполнителя не делаем (inbox не входит в кандидатов);
  юзер выбирает вручную из shared-members.
- Режим `improve` и вкладка «В одно поле» — без изменений.
- Часовой пояс «Сегодня» — серверный (минорный дрейф около полуночи); приемлемо для v1.

## Проверка
Client-тестов нет. Верификация: `npm run typecheck/lint/build` (client), `tsc` (server),
парс-чек `dispatch.ps1`. Плюс визуальная проверка диалога. Состязательное ревью диффа.

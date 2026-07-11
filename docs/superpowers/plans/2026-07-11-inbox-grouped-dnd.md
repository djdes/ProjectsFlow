# Инбокс: дроп карточек доски в верхние канбаны по активной сортировке (+фантомные колонки)

> Продолжение единого DnD (#5, ede6c55). Дизайн подтверждён юзером 2026-07-11.

## Цель

Во «Входящих» карточку с нижней доски статусов можно бросать в колонки ВЕРХНЕГО канбана
блока делегирования, и результат зависит от активной «Сортировки»:

| Сортировка | Дроп на колонку | Фантомная колонка слева (видна только пока тащишь карточку С ДОСКИ) |
|---|---|---|
| **Проект** | перенос задачи в этот проект + самоделегирование себе (задача появляется сверху как «делегировано мне») | «Другой проект…» — если среди колонок есть не все мои проекты; дроп → диалог выбора проекта (все мои, кроме инбокса) |
| **Дата создания** | колонки НЕ принимают дроп | инфо-колонка «Сюда нельзя — дата создания не меняется» (не droppable) |
| **Дедлайн** | уже работает (Без срока/Сегодня; Будущее → попап даты) | нет |
| **Приоритет** | ставит задаче приоритет колонки (Без приоритета → null); карточка остаётся на доске | «Другой приоритет…» — если видны не все 5 колонок; дроп → окошко со всеми 5 вариантами |

Дроп на колонку «Личные» (project-режим) — не цель (задача и так в инбоксе).

## Решения (подтверждены юзером)

1. **Перенос в проект = assignToProject + delegate(себе).** Верхний канбан показывает только
   делегации; чтобы задача «оказалась в колонке проекта», после переноса создаём
   самоделегирование. Сервер это пока запрещает → правим DelegateExistingTask.
2. Пикер проекта — ВСЕ мои проекты (не только отсутствующие колонками), кроме инбокса/архивных.
3. Пикер приоритета — все 5 вариантов (Срочно/Высокий/Средний/Низкий/Без приоритета).

## Сервер: самоделегирование в DelegateExistingTask

`server/src/application/task/DelegateExistingTask.ts`:
- `isSelf = delegateUserId === creatorUserId` — убрать безусловный `SelfDelegationError`.
- Валидации: inbox — только owner-check (shared-members для себя пропускаем, себя там нет);
  именованный проект — `delegate_task`-права creator'а достаточно (member-check пропускаем).
- `delegations.create({..., status: isSelf ? 'accepted' : undefined})` — самоделегирование
  сразу accepted (порт create уже принимает `status`), «ждёт ответа» от самого себя абсурдно.
- Уведомление/письмо самому себе не шлём (`if (!isSelf) void this.notifyDelegated(...)`).
- Остальные use-case'ы (CreateTask/Reassign/InviteAndDelegate) НЕ трогаем — там self-запрет
  остаётся.
- Тест `DelegateExistingTask.test.ts` по образцу AcceptTaskDelegation.test.ts: self →
  accepted, без notify; не-self → pending, notify зовётся; self в чужом инбоксе → NotCreator.

## Клиент

### AssignedToMeBlock
- `boardDragActive = dragActive && activeDrag === null` — идёт drag именно с доски.
- Не-deadline ветка рендера: колонку-группу оборачиваем в `GroupDropColumn` (useDroppable):
  - project && !group.isInbox → data `{type:'group', grouping:'project', projectId: group.key}`;
  - priority → data `{type:'group', grouping:'priority', priority: group.key}` ('1'..'4'|'none');
  - created / «Личные» → droppable disabled.
  - Подсветка ring — только `boardDragActive && isOver`.
- Фантомные колонки ПЕРВЫМИ в ряду, только при `boardDragActive`:
  - project: если `myProjects` (из useProjectsContext, кроме isInbox/archived) содержит
    проекты вне видимых group.key → узкая dashed-колонка «Другой проект…», droppable
    `{type:'phantom', kind:'project'}`;
  - created: узкая muted dashed инфо-колонка «Сюда нельзя…», НЕ droppable;
  - priority: если из 5 бакетов ('1','2','3','4','none') видны не все → «Другой приоритет…»,
    droppable `{type:'phantom', kind:'priority'}`.
- deadline-ветка (TimeBucketColumn) — без изменений.
- MeasuringStrategy.Always в общем контексте уже стоит — droppable, появившийся посреди
  drag'а, будет измерен.

### InboxUnifiedDnd (диспетчер)
- Новые ветки board-origin по over.data:
  - `group/project` → `moveBoardTaskToProject(task, projectId)`;
  - `group/priority` → `applyBoardPriority(task, key==='none' ? null : Number(key))` (no-op если тот же);
  - `phantom/project` → открыть ProjectPickDialog(task);
  - `phantom/priority` → открыть PriorityPickDialog(task).
- `moveBoardTaskToProject`: `taskRepository.assignToProject(inboxId, taskId, target)` →
  `taskRepository.delegate(target, taskId, me)` (фейл делегации не откатывает перенос —
  отдельный тост) → toast success «Перенесено в ‹имя›» с action «Открыть» (navigate
  `/projects/<id>`) → board.refetch + block.refresh.
- `applyBoardPriority`: board.updateTask (расширить вход в unifiedDndTypes на `priority`).
- Диалоги: ProjectPickDialog (список myProjects, иконка+имя, скролл) и PriorityPickDialog
  (5 кнопок c PRIORITY_META-точками) — локально в InboxUnifiedDnd.tsx.

## Известные ограничения (приняты)
- Блок скрыт (нет делегаций) → верхних канбанов и целей нет вовсе.
- Самоделегированная задача видна во вкладке «Для меня»; если открыта «Другим» — авто-
  переключения вкладки нет.
- Перенос делегированной задачи архивирует старую делегацию (серверная логика
  assignToProject, делегат получает уведомление) — затем назначаемся сами.

## Проверка
- typecheck + lint + build (client+server), server-тест node:test.
- Клиентские дропы (priority/phantom/диалоги/created-инфо) — локально через prod-proxy
  (memory local-ui-verify-via-prod-proxy). Перенос-в-проект end-to-end — ПОСЛЕ деплоя
  (нужен новый сервер) на demo-аккаунтах, потом cleanup demo.%.
- Регресс: доски проектов (own-режим), дедлайн-дропы, драг пилюль блока.

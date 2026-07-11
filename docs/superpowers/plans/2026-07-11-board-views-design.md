# Вью доски проекта: Канбан / Таблица / Список / Календарь (Notion-style)

> Скоуп подтверждён юзером 2026-07-11 (скрины Notion). ТОЛЬКО страница проекта
> (TasksPage) — «Входящие» не трогаем (отдельная follow-up задача).

## Решения (ответы юзера)
1. **Полноценные вью как в Notion**: несколько именованных вью пер-проект, «+» создать
   (панель выбора типа), rename/duplicate/delete через меню вкладки. Типы: kanban / table /
   list / calendar (gallery/chart/dashboard/timeline/feed/map/form — НЕ делаем).
2. Таблица: колонки Название / Статус / Приоритет / Срок / Ответственный, inline-
   редактирование дропдаунами, клик по названию → TaskDrawer.
3. Календарь: месяц + drag задачи на день = смена дедлайна, «Без срока (N)», ‹ Сегодня ›.
4. Мультивыбор в таблице/списке → существующий BulkActionBar.

## Модель
- Дефолтная вкладка «Доска» (kanban) — НЕявная, всегда первая, без rename/delete
  (обёртка текущего KanbanBoard, поведение 1-в-1). Пользовательские вью — в БД.
- `db/103_board_views.sql`: board_views(id, project_id, name VARCHAR(64),
  type ENUM(kanban,table,list,calendar), sort_order, created_by, created_at, updated_at).
- Активная вью — localStorage `pf:board-view:<projectId>` (устройство-локально; ui_prefs
  не раздуваем). Нет сохранённой/удалена → «Доска».

## Сервер (паттерн kanban-settings: гейты в роуте, без лишних классов)
- schema.ts: boardViews mysqlTable; domain/project/BoardView.ts.
- DrizzleBoardViewRepository: listForProject / getById / create / rename / delete.
- projects/routes.ts: GET `/:id/views` (member), POST `/:id/views` {name,type} (editor+),
  PATCH `/:id/views/:viewId` {name}, POST `/:id/views/:viewId/duplicate` («<имя> (копия)»),
  DELETE `/:id/views/:viewId`. Zod-схемы в projects/schemas.ts. Гейт editor+ — как у
  kanban-settings (shared-состояние доски).

## Клиент
- domain BoardView + application BoardViewRepository + HttpBoardViewRepository + container.
- `board-views/ProjectBoardViews.tsx` — контейнер на TasksPage: строка вкладок
  («Доска» + вью + «+»), активная persist, рендер активного вида. Повторный клик по
  активной вкладке → меню (Переименовать/Дублировать/Удалить). «+» → поповер «Новая вью»:
  имя + сетка типов с иконками (Table/Board/List/Calendar).
- KanbanBoard НЕ меняется (рендерится для «Доска» и kanban-вью с прежними пропсами).
- Каждый вид сам держит useTasks(projectId) — монтируется один вид за раз, фетч не дублируется.
- `TableView`: grid-строки с вертикальными линиями; ячейки: имя+иконка (клик → drawer),
  статус (dropdown → move), приоритет (dropdown → update), срок (date-поповер → update),
  ответственный (существующий DelegateTaskButton); чекбоксы + BulkActionBar; футер
  «+ Новая задача» (create backlog); текстовый фильтр.
- `ListView`: плоские строки (иконка+название, справа чипы статус/приоритет/срок/делегат),
  клик → drawer; чекбоксы + BulkActionBar; «+ Новая задача»; текстовый фильтр.
- `CalendarView`: сетка месяца (пн-вс? — как Intl, начинаем с Пн), задачи в день дедлайна,
  чип = иконка+название; свой DndContext: drag чипа на день → update {deadline}; клик →
  drawer; «Без срока (N)» — поповер списка; ‹ Сегодня ›; hover-«+» в ячейке → создать
  задачу с этим дедлайном; сегодня подсвечен.
- Все виды: TaskDrawer как у канбана (onSubmit update, onMove move, projectName,
  aiProjectId=projectId).

## Этапность / follow-up (зафиксировано)
- v1 фильтры в table/list/calendar — только текстовый (полные фильтры приоритет/срок/делегат
  как на канбане + Notion-sort — следующий этап).
- Per-view сохранённые настройки (фильтры/сортировки вью) — следующий этап (json-колонка).
- «Входящие» — отдельная задача после вливания.

## Проверка
- node:test не требуется (роуты тривиальны, гейты по паттерну) — точечно use-case-логики нет.
- typecheck/lint/build; миграция на проде (`npm run db:migrate` на сервере через SSH или
  autodeploy-хук — проверить, как накатываются миграции при деплое); e2e на проде demo-акком:
  создать вью всех типов, rename/duplicate/delete, inline-правки таблицы, drag в календаре,
  bulk в таблице, регресс канбана.

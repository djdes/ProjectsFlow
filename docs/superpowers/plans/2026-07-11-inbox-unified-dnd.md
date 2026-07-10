# #5 — Единый DnD во «Входящих»: перетаскивание между нижней доской и верхними время-канбанами

> Спека для отдельной сессии (Fable). Всё-или-ничего: нельзя выкатывать наполовину — как только
> карточки регистрируются в общем контексте, но диспетчер дропа не дописан, drag во «Входящих»
> ломается. Доски ПРОЕКТОВ трогать нельзя — там KanbanBoard должен остаться байт-в-байт как есть.

## Цель (запрос пользователя)
Во «Входящих» уметь тащить задачу из нижней доски (`KanbanBoard`, колонки Черновики/Вручную/Воркер/
Готово) в верхние время-канбаны блока делегирования (`AssignedToMeBlock`: Без срока / На сегодня /
Будущее) и на аватарки участников (в т.ч. свою). Дроп на время-колонку → проставить дедлайн; дроп
на аватар → делегировать (на свою → забрать/самоделегировать); задача при этом переезжает в
соответствующую время-колонку автоматически.

## Почему это рефактор, а не правка
Сейчас `KanbanBoard` и `AssignedToMeBlock` — ДВА независимых `<DndContext>`. dnd-kit не «наследует»
контекст: draggable в одном контексте не видит droppable из другого, и вложение контекстов не
помогает (внутренний перехватывает свои). Значит нужен ОДИН общий `<DndContext>` на уровне
`InboxPage`, куда оба компонента регистрируют draggable/droppable, и единый `onDragEnd`.

## Карта текущего DnD (актуально на 2026-07-11)

### KanbanBoard.tsx (~1140 строк, site-wide — и проекты, и инбокс)
- `<DndContext>` ~L910: `sensors`, `measuring`, `onDragStart={handleDragStart}`,
  `onDragOver={handleDragOver}`, `onDragEnd={handleDragEnd}`, `onDragCancel`. Без `collisionDetection`
  (дефолт rectIntersection). `<DragOverlay dropAnimation={DROP_ANIMATION}>` рендерит `motion.div`
  (tilt/scale) вокруг `<KanbanCard preview>`.
- Sensors ~L455: `MouseSensor {distance:8}`, `TouchSensor {delay:220,tolerance:8}`.
- Draggable = карточки: `useSortable({ id: task.id, data:{ type:'task', task } })` в KanbanCard,
  обёрнуты в per-column `SortableContext` (KanbanColumn, verticalListSortingStrategy).
- Droppable = колонки: `useDroppable({ data:{ type:'column', status } })` в KanbanColumn (id `column-${status}`).
- `handleDragEnd` ~L632: цель-статус из `over.data` (`type:'column'`→`status`; иначе статус over-задачи),
  вычисляет before/after соседей в целевой колонке, зовёт `move(taskId,{targetStatus,beforeTaskId,afterTaskId})`,
  конфетти в «Готово». `handleDragOver` ~L604 держит `dropTarget` (индикатор).
- Внутреннее drag-состояние (`activeId`, `dropTarget`, `activeTask` для overlay) — в KanbanBoard, оно
  используется в его рендере (overlay + drop-индикатор).

### AssignedToMeBlock.tsx
- `<DndContext>` ~L536: `sensors`, `collisionDetection={dndCollision}` (pointerWithin→rectIntersection),
  `onDragStart`, `onDragEnd` (без onDragOver). `<DragOverlay dropAnimation={null} modifiers={[snapToCursor]}>`
  рендерит маленькую пилюлю-«комок» (полупрозрачную).
- Draggable = карточки: `data:{ type:'task', item }` (ВНИМАНИЕ: ключ `item`, не `task`).
- Droppable (2 типа): время-бакеты `useDroppable({ id:'bucket-${bucket}', data:{ type:'bucket', bucket } })`
  (bucket ∈ none/today/future) и кубики людей `useDroppable({ id:'user-${member.id}', data:{ type:'user', member } })`.
- `handleDragEnd` ~L483: `type:'user'` → свой кубик? `reclaimToSelf(item)` : `reassignTo(item, member)`;
  `type:'bucket'` → none→снять дедлайн, today→сегодня, future→попап выбора даты (`setFutureDrop`).

## План реализации (рекомендуемый — изоляция риска на инбокс)

1. **KanbanBoard: опциональный внешний DnD.** Добавить проп `externalDnd?: ExternalDndApi | null`
   (дефолт null → текущее поведение БЕЗ изменений; ветка `own` — существующий код verbatim, чтобы
   доски проектов не пострадали). Когда `externalDnd` задан (только инбокс): НЕ рендерить свой
   `<DndContext>`/`<DragOverlay>`; вместо этого экспортировать наружу `handleDragStart/Over/End`
   (через колбэки/ref) и данные для overlay (activeTask + рендер `<KanbanCard preview>`). Внутреннее
   состояние (activeId/dropTarget) обновляется, когда родитель зовёт эти хендлеры.
2. **AssignedToMeBlock: то же.** Проп `externalDnd?`; в external-режиме не рендерить свой DndContext/
   overlay, отдать наружу свои `onDragStart/onDragEnd` + рендер пилюли-overlay.
3. **InboxPage: общий `<DndContext>`** вокруг обоих. Sensors общие (идентичны). `collisionDetection` —
   `pointerWithin`→`rectIntersection` (годится обоим). Единый `onDragStart` (запоминает active +
   форвардит в оба дочерних start-хендлера для их индикаторов), `onDragOver` (форвардит в KanbanBoard
   для dropTarget), `onDragEnd` — ДИСПЕТЧЕР по `active.data.type` + `over.data.type`:
   - active=доска-карточка (`task`+`task`payload), over=`column` → KanbanBoard.move (реордер/статус).
   - active=доска-карточка, over=`bucket` → проставить дедлайн задаче (none/today/future — future
     открывает попап даты). **Новая операция:** дедлайн inbox-задачи через `taskRepository.update`/
     соответствующий метод; после — задача сама попадёт в нужную время-колонку.
   - active=доска-карточка, over=`user` → **делегировать** задачу этому участнику (на свою аватарку →
     самоделегирование/забрать; см. новую логику «ответственного» ниже). **Новая операция.**
   - active=делегация-карточка (`item`payload) → текущая логика AssignedToMeBlock (bucket/user).
   - Один `<DragOverlay>` на InboxPage: рендер зависит от происхождения active (доска → KanbanCard
     preview с tilt; делегация → пилюля-комок).
4. **Согласовать payload-ключи:** и доска, и блок используют `data.type==='task'` для draggable, но
   доска кладёт `task`, блок — `item`. Диспетчер должен уметь достать задачу из обоих
   (`data.task ?? data.item`).
5. Проверить: drag на досках ПРОЕКТОВ (own-режим) — без регрессий; drag в инбоксе (доска↔время-колонки↔
   аватары) работает; overlay/индикаторы корректны; тач (long-press) работает.

## Риски
- Overlay-диспатч и drop-индикатор — самые хрупкие места.
- «Новые операции» (дедлайн inbox-задачи с доски, делегирование задачи с доски) должны переиспользовать
  существующие use-case'ы (delegation, deadline update), не плодя дублей.
- Обязательно ручная проверка drag на 2-3 досках проектов после рефактора.

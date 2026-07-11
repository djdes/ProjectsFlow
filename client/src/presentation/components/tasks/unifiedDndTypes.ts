import type { MutableRefObject } from 'react';
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import type { Task, TaskPriority, TaskStatus } from '@/domain/task/Task';

// === Контракт единого DnD «Входящих» (#5) ===
// Во «Входящих» доска (KanbanBoard) и блок делегирования (AssignedToMeBlock) живут в ОДНОМ
// <DndContext> уровня страницы (InboxUnifiedDnd): dnd-kit не «наследует» контексты, draggable
// одного не видит droppable другого. Каждый компонент в external-режиме НЕ рендерит свой
// DndContext/DragOverlay, а регистрирует свои хендлеры и операции в этом реестре (мутабельный
// ref, пере-запись каждый рендер — замыкания видят свежий стейт). Диспетчер страницы зовёт их
// по происхождению active/типу over. Типы вынесены в отдельный файл без runtime-импортов,
// чтобы не создавать цикл KanbanBoard ↔ InboxUnifiedDnd.

export type BoardDndApi = {
  onDragStart(e: DragStartEvent): void;
  onDragOver(e: DragOverEvent): void;
  // Settle оверлея/индикаторов + собственный move. Для чужих over-целей (bucket/user)
  // move-часть — гарантированный no-op (over.id не матчится ни в колонку, ни в задачу).
  onDragEnd(e: DragEndEvent): Promise<void>;
  onDragCancel(): void;
  // Операции для диспетчера: дроп доски-карточки на время-колонку (дедлайн) / колонку
  // приоритета, и рефетч после делегирования/переноса (бейдж/список на доске).
  updateTask(
    taskId: string,
    input: { deadline?: string | null; priority?: TaskPriority | null },
  ): Promise<Task>;
  // Перенос задачи в колонку доски (дроп пилюли блока: снять делегацию + статус).
  // Кладёт в НАЧАЛО видимой порции колонки (как «Перенести» из TaskDrawer).
  moveTask(taskId: string, targetStatus: TaskStatus): Promise<void>;
  refetch(): Promise<void>;
};

export type BlockDndApi = {
  // Зовётся для ЛЮБОГО drag'а (и с доски тоже): блок подсвечивает кубики-цели.
  onDragStart(e: DragStartEvent): void;
  onDragEnd(e: DragEndEvent): void;
  onDragCancel(): void;
  // Перефетч поручений после кросс-операций (делегирование/дедлайн задачи с доски).
  refresh(): Promise<void>;
};

export type UnifiedDndRegistry = {
  board: BoardDndApi | null;
  block: BlockDndApi | null;
};

// Реестр живёт в ref у InboxPage: стабильная ссылка переживает ремаунты детей (key={refetchKey}).
export type UnifiedDndRef = MutableRefObject<UnifiedDndRegistry>;

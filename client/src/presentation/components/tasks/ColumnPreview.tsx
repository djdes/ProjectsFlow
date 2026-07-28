// Колонки канбана показывают ВСЕ свои карточки, а длинный список скроллится внутри самой
// колонки (см. COLUMN_SCROLL_CLASS). Прежняя порционная выдача «первые 4 + Показать ещё»
// убрана: кнопка ломала чтение доски, а прокрутка решает ту же задачу естественнее.
//
// Карточки за пределами видимой области пропускают вёрстку и отрисовку через
// content-visibility — так длинная колонка не «вешает» скролл на слабых устройствах
// (ровно тот сценарий, ради которого раньше существовало скрытие).
export const COLUMN_SCROLL_CLASS =
  'max-h-[calc(100dvh-14rem)] overflow-y-auto overscroll-contain pf-scroll-thin [&>*]:[content-visibility:auto] [&>*]:[contain-intrinsic-size:auto_7rem]';

// Обёртка списка карточек для колонок без dnd/спец-разметки (AssignedToMeBlock,
// PublicKanban). KanbanColumn рендерит карточки сам — там SortableContext и
// interleaved-разметка (drop-индикаторы, date-бакеты done).
export function ColumnPreviewList<T>({
  items,
  renderItem,
}: {
  items: readonly T[];
  // renderItem обязан возвращать элемент со своим key.
  renderItem: (item: T) => React.ReactNode;
}): React.ReactElement {
  return <>{items.map(renderItem)}</>;
}

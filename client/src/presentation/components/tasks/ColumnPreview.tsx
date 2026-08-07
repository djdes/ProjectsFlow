import { useExitingListItems } from '@/presentation/hooks/useExitingListItems';

// Колонки канбана показывают ВСЕ свои карточки, а длинный список скроллится внутри самой
// колонки (см. COLUMN_SCROLL_CLASS). Прежняя порционная выдача «первые 4 + Показать ещё»
// убрана: кнопка ломала чтение доски, а прокрутка решает ту же задачу естественнее.
//
// Карточки за пределами видимой области пропускают вёрстку и отрисовку через
// content-visibility — так длинная колонка не «вешает» скролл на слабых устройствах
// (ровно тот сценарий, ради которого раньше существовало скрытие).
export const COLUMN_SCROLL_CLASS =
  'max-h-[calc(100dvh-14rem)] overflow-y-auto overscroll-contain pf-scroll-thin [&>*]:[content-visibility:auto] [&>*]:[contain-intrinsic-size:auto_7rem]';

// Длительность схлопывания уходящей карточки. Совпадает с duration-300 обёртки ниже.
const EXIT_MS = 300;

// Обёртка списка карточек для колонок без dnd/спец-разметки (AssignedToMeBlock,
// PublicKanban). KanbanColumn рендерит карточки сам — там SortableContext и
// interleaved-разметка (drop-индикаторы, date-бакеты done).
//
// getId включает схлопывание уходящей карточки: выполненная карточка не выбрасывается из
// списка мгновенно (соседи прыгали вверх рывком), а держится EXIT_MS и схлопывается по
// высоте — тот же приём и тот же хук, что у полок «На утверждении»/«Вручную». Без getId
// список ведёт себя как раньше — ровно то, что нужно PublicKanban'у, где карточки не уходят.
export function ColumnPreviewList<T>({
  items,
  renderItem,
  getId,
}: {
  items: readonly T[];
  // renderItem обязан возвращать элемент со своим key. exiting=true — карточка уже пропала
  // из данных и держится в DOM только ради анимации: dnd-id надо суффиксовать (ghost), а
  // сетевые действия на ней не запускать.
  renderItem: (item: T, exiting: boolean) => React.ReactNode;
  getId?: (item: T) => string;
}): React.ReactElement {
  if (!getId) return <>{items.map((item) => renderItem(item, false))}</>;
  return <CollapsingList items={items} renderItem={renderItem} getId={getId} />;
}

function CollapsingList<T>({
  items,
  renderItem,
  getId,
}: {
  items: readonly T[];
  renderItem: (item: T, exiting: boolean) => React.ReactNode;
  getId: (item: T) => string;
}): React.ReactElement {
  const displayItems = useExitingListItems(items, getId, EXIT_MS);
  return (
    <>
      {displayItems.map(({ item, exiting }) => (
        // Схлопывание по ОДНОЙ оси (строки): колонка — вертикальный список, соседи
        // подтягиваются вверх именно за высотой. data-pf-collapse — исключение из
        // pf-no-motion (globals.css), чтобы анимация играла и на тач.
        <div
          key={getId(item)}
          data-pf-collapse
          className="grid transition-all duration-300 ease-out motion-reduce:transition-none"
          style={{ gridTemplateRows: exiting ? '0fr' : '1fr' }}
        >
          <div
            data-pf-collapse
            className={
              exiting
                ? 'min-h-0 overflow-hidden pointer-events-none opacity-0 transition-opacity duration-200 motion-reduce:transition-none'
                : 'min-h-0 transition-opacity duration-200 motion-reduce:transition-none'
            }
          >
            {renderItem(item, exiting)}
          </div>
        </div>
      ))}
    </>
  );
}

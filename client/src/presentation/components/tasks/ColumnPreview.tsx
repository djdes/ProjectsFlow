import { useState } from 'react';
import { useTaskHiding } from './taskHidingSetting';

// Порционный показ карточек канбан-колонки по всему сайту: первые 4, кнопка
// «Показать ещё» добавляет по 4 — колонки не растягивают страницу километровым
// скроллом. Общий примитив для KanbanColumn (доски проектов/входящих),
// AssignedToMeBlock (блок делегирования) и PublicKanban (публичная доска).
export const COLUMN_PREVIEW_COUNT = 4;

export type ColumnPreview = {
  // Сколько карточек показывать: slice(0, shownCount).
  readonly shownCount: number;
  // Сколько ещё спрятано под кнопкой.
  readonly hiddenCount: number;
  // Раскрыто дальше первой порции — рисуем «Свернуть», когда всё показано.
  readonly expanded: boolean;
  readonly showMore: () => void;
  readonly collapse: () => void;
};

export function useColumnPreview(total: number): ColumnPreview {
  const hiding = useTaskHiding();
  const [limit, setLimit] = useState(COLUMN_PREVIEW_COUNT);
  // Скрытие ВЫКЛючено (дефолт) → показываем ВСЕ задачи, «Показать ещё» не появляется.
  const shownCount = hiding ? Math.min(limit, total) : total;
  return {
    shownCount,
    hiddenCount: hiding ? Math.max(0, total - shownCount) : 0,
    // Гейт и на total: раскрытая колонка, усохшая до ≤4 задач, не должна показывать
    // сиротскую «Свернуть» (устаревший limit при этом безвреден — кнопки просто нет).
    expanded: hiding && limit > COLUMN_PREVIEW_COUNT && total > COLUMN_PREVIEW_COUNT,
    showMore: () => setLimit((c) => c + COLUMN_PREVIEW_COUNT),
    collapse: () => setLimit(COLUMN_PREVIEW_COUNT),
  };
}

// Кнопка под карточками: «Показать ещё (N)» пока есть скрытые; когда раскрыли всё —
// «Свернуть» (обратно к первой порции). Ничего не рендерит, когда всё влезло в порцию.
export function ColumnMoreButton({
  preview,
  className,
}: {
  preview: ColumnPreview;
  className?: string;
}): React.ReactElement | null {
  if (preview.hiddenCount > 0) {
    return (
      <button
        type="button"
        // Не крадём фокус (как «+» в шапке колонки): иначе клик блюрил бы textarea
        // открытой inline-карточки создания и blur-commit закрывал бы сессию.
        onMouseDown={(e) => e.preventDefault()}
        onClick={preview.showMore}
        className={
          className ??
          'shrink-0 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        }
      >
        {`Показать ещё (${preview.hiddenCount})`}
      </button>
    );
  }
  if (preview.expanded) {
    return (
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={preview.collapse}
        className={
          className ??
          'shrink-0 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        }
      >
        Свернуть
      </button>
    );
  }
  return null;
}

// Обёртка «порция + кнопка» для колонок без dnd/спец-разметки (AssignedToMeBlock,
// PublicKanban). KanbanColumn использует хук напрямую — там SortableContext и
// interleaved-разметка (drop-индикаторы, date-бакеты done).
export function ColumnPreviewList<T>({
  items,
  renderItem,
}: {
  items: readonly T[];
  // renderItem обязан возвращать элемент со своим key.
  renderItem: (item: T) => React.ReactNode;
}): React.ReactElement {
  const preview = useColumnPreview(items.length);
  return (
    <>
      {items.slice(0, preview.shownCount).map(renderItem)}
      <ColumnMoreButton preview={preview} />
    </>
  );
}

export type TableCellCoord = { row: number; col: number };

export type TableCellRange = {
  a: TableCellCoord;
  h: TableCellCoord;
};

export type TableNavigationKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function navigateTableRange(
  range: TableCellRange,
  key: TableNavigationKey,
  rowCount: number,
  colCount: number,
  options: { extend?: boolean; edge?: boolean; pageSize?: number } = {},
): TableCellRange {
  if (rowCount <= 0 || colCount <= 0) return range;

  const lastRow = rowCount - 1;
  const lastCol = colCount - 1;
  const pageSize = Math.max(1, options.pageSize ?? 10);
  let row = clamp(range.h.row, 0, lastRow);
  let col = clamp(range.h.col, 0, lastCol);

  switch (key) {
    case 'ArrowUp':
      row -= 1;
      break;
    case 'ArrowDown':
      row += 1;
      break;
    case 'ArrowLeft':
      col -= 1;
      break;
    case 'ArrowRight':
      col += 1;
      break;
    case 'Home':
      if (options.edge) row = 0;
      col = 0;
      break;
    case 'End':
      if (options.edge) row = lastRow;
      col = lastCol;
      break;
    case 'PageUp':
      row -= pageSize;
      break;
    case 'PageDown':
      row += pageSize;
      break;
  }

  const next = {
    row: clamp(row, 0, lastRow),
    col: clamp(col, 0, lastCol),
  };
  return options.extend ? { a: range.a, h: next } : { a: next, h: next };
}

export function rangeBounds(range: TableCellRange): {
  firstRow: number;
  lastRow: number;
  firstCol: number;
  lastCol: number;
} {
  return {
    firstRow: Math.min(range.a.row, range.h.row),
    lastRow: Math.max(range.a.row, range.h.row),
    firstCol: Math.min(range.a.col, range.h.col),
    lastCol: Math.max(range.a.col, range.h.col),
  };
}

export function rangeContains(range: TableCellRange, row: number, col: number): boolean {
  const bounds = rangeBounds(range);
  return (
    row >= bounds.firstRow &&
    row <= bounds.lastRow &&
    col >= bounds.firstCol &&
    col <= bounds.lastCol
  );
}

// ПКМ внутри диапазона выбирает все строки диапазона. ПКМ снаружи — только строку,
// на которой открыли меню.
export function rowsForContextMenu(
  range: TableCellRange | null,
  row: number,
  col: number,
  orderedIds: readonly string[],
): string[] {
  const clickedId = orderedIds[row];
  if (!clickedId) return [];
  if (!range || !rangeContains(range, row, col)) return [clickedId];
  const { firstRow, lastRow } = rangeBounds(range);
  return orderedIds.slice(firstRow, lastRow + 1);
}

// Без выбора primary pointer начинает новый диапазон. При любом существующем выборе
// тот же pointer должен пройти в редактор ячейки, а выбор снимается на mousedown.
export function primaryPointerActivatesCell(
  range: TableCellRange | null,
  selectedRowCount: number,
): boolean {
  return range !== null || selectedRowCount > 0;
}

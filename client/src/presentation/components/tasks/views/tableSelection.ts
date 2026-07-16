export type TableCellCoord = { row: number; col: number };

export type TableCellRange = {
  a: TableCellCoord;
  h: TableCellCoord;
};

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

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  navigateTableRange,
  primaryPointerActivatesCell,
  rangeContains,
  rowsForContextMenu,
  type TableCellRange,
} from './tableSelection';

const range: TableCellRange = {
  a: { row: 1, col: 1 },
  h: { row: 3, col: 2 },
};

describe('table cell selection contract', () => {
  it('lets a primary click activate any cell after a cell or row selection', () => {
    assert.equal(primaryPointerActivatesCell(range, 0), true);
    assert.equal(primaryPointerActivatesCell(null, 2), true);
    assert.equal(primaryPointerActivatesCell(null, 0), false);
  });

  it('recognises the selected rectangle in both axes', () => {
    assert.equal(rangeContains(range, 1, 1), true);
    assert.equal(rangeContains(range, 3, 2), true);
    assert.equal(rangeContains(range, 0, 1), false);
    assert.equal(rangeContains(range, 2, 3), false);
  });

  it('selects all range rows on context click inside the range', () => {
    assert.deepEqual(rowsForContextMenu(range, 2, 2, ['a', 'b', 'c', 'd', 'e']), [
      'b',
      'c',
      'd',
    ]);
  });

  it('selects only the clicked row on context click outside the range', () => {
    assert.deepEqual(rowsForContextMenu(range, 4, 2, ['a', 'b', 'c', 'd', 'e']), ['e']);
  });

  it('moves a single active cell with arrows and clamps it to the grid', () => {
    const single: TableCellRange = {
      a: { row: 0, col: 0 },
      h: { row: 0, col: 0 },
    };
    assert.deepEqual(navigateTableRange(single, 'ArrowUp', 4, 3), single);
    assert.deepEqual(navigateTableRange(single, 'ArrowRight', 4, 3), {
      a: { row: 0, col: 1 },
      h: { row: 0, col: 1 },
    });
  });

  it('extends a range from its anchor with Shift navigation', () => {
    assert.deepEqual(
      navigateTableRange(range, 'ArrowDown', 8, 6, { extend: true }),
      {
        a: { row: 1, col: 1 },
        h: { row: 4, col: 2 },
      },
    );
  });

  it('supports row edges, grid edges and page movement', () => {
    const single: TableCellRange = {
      a: { row: 5, col: 2 },
      h: { row: 5, col: 2 },
    };
    assert.deepEqual(navigateTableRange(single, 'Home', 20, 5).h, { row: 5, col: 0 });
    assert.deepEqual(navigateTableRange(single, 'End', 20, 5, { edge: true }).h, {
      row: 19,
      col: 4,
    });
    assert.deepEqual(
      navigateTableRange(single, 'PageUp', 20, 5, { pageSize: 4 }).h,
      { row: 1, col: 2 },
    );
  });
});

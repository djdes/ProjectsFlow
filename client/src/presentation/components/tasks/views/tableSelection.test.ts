import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
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
});

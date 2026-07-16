import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOARD_VIEW_TYPES } from '../../domain/project/BoardView.js';
import { createBoardViewSchema, updateBoardViewSchema } from './schemas.js';

describe('board view schemas', () => {
  it('accepts every supported project view type on create and update', () => {
    for (const type of BOARD_VIEW_TYPES) {
      assert.equal(createBoardViewSchema.safeParse({ name: `View ${type}`, type }).success, true);
      assert.equal(updateBoardViewSchema.safeParse({ type }).success, true);
    }
  });

  it('rejects an unknown view type', () => {
    assert.equal(
      createBoardViewSchema.safeParse({ name: 'Unknown', type: 'mind-map' }).success,
      false,
    );
  });

  it('keeps the shared view config size limit', () => {
    assert.equal(updateBoardViewSchema.safeParse({ config: { value: 'x'.repeat(100) } }).success, true);
    assert.equal(
      updateBoardViewSchema.safeParse({ config: { value: 'x'.repeat(17000) } }).success,
      false,
    );
  });
});

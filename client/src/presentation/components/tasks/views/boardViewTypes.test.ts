import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOARD_VIEW_LAYOUT_TYPES,
  BOARD_VIEW_TYPES,
  BOARD_VIEW_TYPE_LABELS,
} from '@/domain/project/BoardView';
import {
  EMPTY_PER_VIEW_STATE,
  perViewFromConfig,
  perViewToConfig,
} from './viewShared';

describe('project view types', () => {
  it('exposes only the four supported project view types with labels', () => {
    assert.deepEqual(BOARD_VIEW_TYPES, ['kanban', 'table', 'list', 'calendar']);
    for (const type of BOARD_VIEW_TYPES) assert.ok(BOARD_VIEW_TYPE_LABELS[type].length > 0);
  });

  it('offers the same four types in the convertible layout picker', () => {
    assert.deepEqual(BOARD_VIEW_LAYOUT_TYPES, ['table', 'kanban', 'calendar', 'list']);
  });

  it('round-trips supported layout settings through the persisted config', () => {
    const state = {
      ...EMPTY_PER_VIEW_STATE,
      layout: {
        ...EMPTY_PER_VIEW_STATE.layout,
        showWeekends: false,
      },
    };
    const restored = perViewFromConfig(perViewToConfig(state));
    assert.equal(restored.layout.showWeekends, false);
  });
});

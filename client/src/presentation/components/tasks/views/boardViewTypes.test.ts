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
  it('exposes the eleven reference view types with labels', () => {
    assert.deepEqual(BOARD_VIEW_TYPES, [
      'kanban',
      'table',
      'list',
      'calendar',
      'timeline',
      'gallery',
      'chart',
      'feed',
      'map',
      'dashboard',
      'form',
    ]);
    for (const type of BOARD_VIEW_TYPES) assert.ok(BOARD_VIEW_TYPE_LABELS[type].length > 0);
  });

  it('keeps dashboard and form out of the convertible layout picker', () => {
    assert.equal(BOARD_VIEW_LAYOUT_TYPES.includes('dashboard'), false);
    assert.equal(BOARD_VIEW_LAYOUT_TYPES.includes('form'), false);
    assert.equal(BOARD_VIEW_LAYOUT_TYPES.includes('timeline'), true);
    assert.equal(BOARD_VIEW_LAYOUT_TYPES.includes('map'), true);
  });

  it('round-trips layout and form settings through the persisted config', () => {
    const state = {
      ...EMPTY_PER_VIEW_STATE,
      layout: {
        ...EMPTY_PER_VIEW_STATE.layout,
        cardPreview: 'content' as const,
        feedLimit: 50 as const,
        showWeekends: false,
      },
      form: {
        initialized: true,
        title: 'Запрос',
        description: 'Создаёт задачу',
        questions: [{ id: 'title', label: 'Что нужно сделать?', required: true }],
      },
    };
    const restored = perViewFromConfig(perViewToConfig(state));
    assert.equal(restored.layout.cardPreview, 'content');
    assert.equal(restored.layout.feedLimit, 50);
    assert.equal(restored.layout.showWeekends, false);
    assert.equal(restored.form.initialized, true);
    assert.equal(restored.form.title, 'Запрос');
    assert.deepEqual(restored.form.questions, state.form.questions);
  });
});

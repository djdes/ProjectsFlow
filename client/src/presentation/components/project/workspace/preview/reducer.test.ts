import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewEditorState, previewEditorReducer } from './reducer';

test('mode changes close transient editor state', () => {
  const selected = { locator: { selector: '#cta', tagName: 'BUTTON' }, bounds: { x: 1, y: 2, width: 3, height: 4 }, label: 'Button' };
  const edited = { ...createPreviewEditorState(), mode: 'edit' as const, selected, styleOpen: true, codeOpen: true };
  const next = previewEditorReducer(edited, { type: 'SET_MODE', mode: 'preview' });
  assert.equal(next.selected, null);
  assert.equal(next.styleOpen, false);
  assert.equal(next.codeOpen, false);
});

test('successful patches advance revision and reset redo history', () => {
  const next = previewEditorReducer({ ...createPreviewEditorState(), undoDepth: 2, redoDepth: 3, saveStatus: 'saving' }, { type: 'PATCH_SUCCESS', revision: 8 });
  assert.equal(next.revision, 8);
  assert.equal(next.undoDepth, 3);
  assert.equal(next.redoDepth, 0);
  assert.equal(next.saveStatus, 'clean');
});

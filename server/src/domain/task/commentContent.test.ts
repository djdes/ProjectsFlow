import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACHMENT_ONLY_COMMENT_PREVIEW, commentPreviewText, hasCommentContent } from './commentContent.js';

test('comment with text or attachments has content', () => {
  assert.equal(hasCommentContent('привет', 0), true);
  assert.equal(hasCommentContent('', 1), true);
  assert.equal(hasCommentContent('  \n ', 2), true);
});

test('comment without text and attachments is empty', () => {
  assert.equal(hasCommentContent('', 0), false);
  assert.equal(hasCommentContent('   ', 0), false);
});

test('attachment-only comment previews as attachment label', () => {
  assert.equal(commentPreviewText(''), ATTACHMENT_ONLY_COMMENT_PREVIEW);
  assert.equal(commentPreviewText('  '), ATTACHMENT_ONLY_COMMENT_PREVIEW);
  assert.equal(commentPreviewText('текст'), 'текст');
});

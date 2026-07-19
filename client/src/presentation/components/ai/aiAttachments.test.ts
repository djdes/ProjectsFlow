import assert from 'node:assert/strict';
import test from 'node:test';
import { composeAiMessage, extractAiAttachments, type AiAttachmentDraft } from './aiAttachments';

test('round-trips chat attachments without exposing transport markers in visible text', () => {
  const attachment: AiAttachmentDraft = { id: 'file-1', name: 'brief.md', mimeType: 'text/markdown', size: 12, kind: 'text', data: '# Brief' };
  const encoded = composeAiMessage('Сделай задачи по файлу', [attachment]);
  assert.match(encoded, /PF_ATTACHMENT/);
  const decoded = extractAiAttachments(encoded);
  assert.equal(decoded.text, 'Сделай задачи по файлу');
  assert.deepEqual(decoded.attachments[0], attachment);
});

test('rejects an unsafe image payload embedded in a stored message', () => {
  const attachment: AiAttachmentDraft = {
    id: 'unsafe-1',
    name: 'unsafe.svg',
    mimeType: 'image/svg+xml',
    size: 24,
    kind: 'image',
    data: 'javascript:alert(1)',
  };
  const decoded = extractAiAttachments(composeAiMessage('Проверь вложение', [attachment]));
  assert.equal(decoded.text, 'Проверь вложение');
  assert.deepEqual(decoded.attachments, []);
});

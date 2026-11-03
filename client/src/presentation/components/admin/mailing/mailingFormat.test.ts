import assert from 'node:assert/strict';
import test from 'node:test';
import { audienceSummary, campaignProgress, canPreview, pluralRu, previewZoom, sameDraft, EMPTY_DRAFT } from './mailingFormat';

test('preview zoom fits the frame into the column and never enlarges', () => {
  assert.equal(previewZoom(1000, 680), 1);
  assert.equal(previewZoom(340, 680), 0.5);
  assert.equal(previewZoom(300, 375), 0.8);
  assert.equal(previewZoom(0, 375), 1);
});

test('campaign progress counts everything the queue is done with', () => {
  const counts = { queued: 3, sending: 1, sent: 4, failed: 1, skipped: 1, cancelled: 0 };
  assert.deepEqual(campaignProgress({ counts, totalCount: 10 }), { processed: 6, total: 10, percent: 60 });
  assert.equal(campaignProgress({ counts: { ...counts, queued: 0, sending: 0 }, totalCount: 0 }).percent, 100);
});

test('audience summary and Russian plurals', () => {
  const ws = [{ id: 'w1', name: 'Ромашка', memberCount: 3 }];
  assert.equal(audienceSummary({ kind: 'all' }, ws), 'Все пользователи');
  assert.equal(audienceSummary({ kind: 'workspace', workspaceId: 'w1' }, ws), 'Пространство «Ромашка»');
  assert.equal(audienceSummary({ kind: 'plan', plans: ['free', 'vip'] }, ws), 'Тариф: Free, VIP');
  assert.deepEqual([1, 2, 5, 11, 21, 104].map((n) => pluralRu(n, 'письмо', 'письма', 'писем')),
    ['письмо', 'письма', 'писем', 'писем', 'письмо', 'письма']);
});

test('draft comparison treats empty CTA fields as absent; preview needs subject and body', () => {
  assert.ok(sameDraft(EMPTY_DRAFT, { ...EMPTY_DRAFT, ctaLabel: '', ctaUrl: '' }));
  assert.ok(!sameDraft(EMPTY_DRAFT, { ...EMPTY_DRAFT, subject: 'x' }));
  assert.ok(!canPreview({ ...EMPTY_DRAFT, subject: 'Тема' }));
  assert.ok(canPreview({ ...EMPTY_DRAFT, subject: 'Тема', bodyMarkdown: 'Текст' }));
});

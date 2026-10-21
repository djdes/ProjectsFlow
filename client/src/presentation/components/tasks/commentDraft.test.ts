import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test from 'node:test';
import { acknowledgeComment, beginCommentSend, commentDraftKey, readCommentDraft, subscribeCommentDraft, updateCommentDraft } from './commentDraft';

const key = (name: string) => commentDraftKey('user', 'project', name);

test('drafts are isolated by user, project, and task and persist rich text immediately', () => {
  const id = key('isolation');
  const body = '**Текст**\n\n[Ссылка](https://example.com)';
  const reply = { commentId: 'c1', authorName: 'Автор', quotedText: 'цитата' };
  updateCommentDraft(id, (d) => ({ ...d, body, reply, notify: { mode: 'selected', userIds: ['executor'] } }));
  assert.deepEqual(JSON.parse(window.localStorage.getItem(id)!), { body, reply, notify: { mode: 'selected', userIds: ['executor'] } });
  for (const other of [commentDraftKey('another', 'project', 'isolation'), commentDraftKey('user', 'other', 'isolation'), key('other')]) {
    assert.equal(readCommentDraft(other).body, '');
  }
  // A fresh store entry hydrates the same serialized format after a page load.
  window.localStorage.setItem(key('reload'), window.localStorage.getItem(id)!);
  assert.equal(readCommentDraft(key('reload')).body, body);
  assert.deepEqual(readCommentDraft(key('reload')).reply, reply);
});

test('malformed drafts and invalid audiences do not break editing', () => {
  window.localStorage.setItem(key('broken'), '{');
  assert.equal(readCommentDraft(key('broken')).body, '');
  window.localStorage.setItem(key('invalid-audience'), JSON.stringify({ body: 'safe', notify: { mode: 'selected', userIds: [7] }, reply: { commentId: 3 } }));
  const draft = readCommentDraft(key('invalid-audience'));
  assert.equal(draft.body, 'safe');
  assert.equal(draft.notify, null);
  assert.equal(draft.reply, null);
});

test('blocked storage keeps an in-memory draft usable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    updateCommentDraft(key('blocked'), (d) => ({ ...d, body: 'не потерять' }));
    assert.equal(readCommentDraft(key('blocked')).body, 'не потерять');
  } finally {
    if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    else delete (window as unknown as { localStorage?: Storage }).localStorage;
  }
});

test('subscribers detach without deleting the draft or its pending files', () => {
  const id = key('subscribe');
  let calls = 0;
  const detach = subscribeCommentDraft(id, () => calls++);
  const file = { id: 'file', file: new File(['data'], 'draft.txt'), previewUrl: '' };
  updateCommentDraft(id, (d) => ({ ...d, body: 'текст', files: [file] }));
  detach();
  updateCommentDraft(id, (d) => ({ ...d, body: 'изменённый текст' }));
  assert.equal(calls, 1);
  assert.equal(readCommentDraft(id).files[0].file, file.file);
});

test('send lock survives closing and only an accepted snapshot is cleared', () => {
  const id = key('sending');
  const reply = { commentId: 'c', authorName: 'Автор', quotedText: null };
  updateCommentDraft(id, (d) => ({ ...d, body: 'отправить', reply }));
  const sent = beginCommentSend(id)!;
  assert.ok(sent);
  assert.equal(beginCommentSend(id), null);
  assert.equal(readCommentDraft(id).body, 'отправить');
  acknowledgeComment(id, sent);
  assert.equal(readCommentDraft(id).body, '');
  assert.equal(readCommentDraft(id).reply, null);
  assert.equal(window.localStorage.getItem(id), null);
});

test('a late acknowledgement cannot erase a newer edit, even with identical text', () => {
  const id = key('late');
  updateCommentDraft(id, (d) => ({ ...d, body: 'текст' }));
  const sent = beginCommentSend(id)!;
  updateCommentDraft(id, (d) => ({ ...d, body: 'другой текст' }));
  updateCommentDraft(id, (d) => ({ ...d, body: 'текст', reply: { commentId: 'new', authorName: 'Другой', quotedText: null } }));
  acknowledgeComment(id, sent);
  assert.equal(readCommentDraft(id).body, 'текст');
  assert.equal(readCommentDraft(id).reply?.commentId, 'new');
});

test('file previews are retained on close and released only when the draft removes them', () => {
  const original = URL.revokeObjectURL;
  const revoked: string[] = [];
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  try {
    const id = key('file-url');
    const file = { id: 'image', file: new File(['image'], 'image.png'), previewUrl: 'blob:draft-image' };
    updateCommentDraft(id, (d) => ({ ...d, files: [file] }));
    const detach = subscribeCommentDraft(id, () => {});
    detach();
    assert.deepEqual(revoked, []);
    updateCommentDraft(id, (d) => ({ ...d, files: [] }));
    assert.deepEqual(revoked, ['blob:draft-image']);
  } finally { URL.revokeObjectURL = original; }
});

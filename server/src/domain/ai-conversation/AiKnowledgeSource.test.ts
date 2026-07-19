import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeKnowledgeSources, normalizeKnowledgeSources } from './AiKnowledgeSource.js';

test('normalizes worker sources and fills a subtitle from the kind', () => {
  const sources = normalizeKnowledgeSources([
    { kind: 'project', id: 'p1', title: 'Сайт' },
    { kind: 'task', id: 't1', title: 'Сверстать макет', subtitle: 'Сайт / Задачи' },
  ]);
  assert.equal(sources[0]?.subtitle, 'Проект');
  assert.equal(sources[1]?.subtitle, 'Сайт / Задачи');
});

test('rejects sources without an id or a title', () => {
  const sources = normalizeKnowledgeSources([
    { kind: 'project', id: '', title: 'Сайт' },
    { kind: 'project', id: 'p1', title: '   ' },
    { kind: 'nope', id: 'p2', title: 'Сайт' },
  ]);
  assert.deepEqual(sources, []);
});

test('keeps only site-relative hrefs so a source cannot redirect off-site', () => {
  const sources = normalizeKnowledgeSources([
    { kind: 'project', id: 'p1', title: 'Сайт', href: 'https://evil.example/steal' },
    { kind: 'project', id: 'p2', title: 'Второй', href: '/projects/p2' },
  ]);
  assert.equal(sources[0]?.href, null);
  assert.equal(sources[1]?.href, '/projects/p2');
});

test('merges sources across answers and keeps one row per object', () => {
  const first = normalizeKnowledgeSources([{ kind: 'project', id: 'p1', title: 'Сайт' }]);
  const second = normalizeKnowledgeSources([
    { kind: 'project', id: 'p1', title: 'Сайт' },
    { kind: 'task', id: 'p1', title: 'Задача с тем же id' },
  ]);
  const merged = mergeKnowledgeSources([first, second]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((source) => source.kind), ['project', 'task']);
});

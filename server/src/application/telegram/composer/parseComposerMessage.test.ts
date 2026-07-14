import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComposerMessage } from './parseComposerMessage.js';
import { fuzzyMatch, greedyProjectPrefix } from './fuzzyMatch.js';

test('parse: +проект текст @ответственный', () => {
  assert.deepEqual(parseComposerMessage('+ралф Обнови билд @вася'), {
    projectQuery: 'ралф',
    taskText: 'Обнови билд',
    assigneeQuery: 'вася',
  });
});

test('parse: голый текст без + → проект null, текст целиком', () => {
  assert.deepEqual(parseComposerMessage('Обнови билд'), {
    projectQuery: null,
    taskText: 'Обнови билд',
    assigneeQuery: null,
  });
});

test('parse: «+» без имени → пустой projectQuery (показать все)', () => {
  assert.deepEqual(parseComposerMessage('+ Обнови билд'), {
    projectQuery: '',
    taskText: 'Обнови билд',
    assigneeQuery: null,
  });
});

test('parse: «+проект» без текста', () => {
  assert.deepEqual(parseComposerMessage('+ралф'), {
    projectQuery: 'ралф',
    taskText: '',
    assigneeQuery: null,
  });
});

test('parse: ответственный без проекта → inbox + назначение', () => {
  assert.deepEqual(parseComposerMessage('@вася почини'), {
    projectQuery: null,
    taskText: 'почини',
    assigneeQuery: 'вася',
  });
});

test('parse: @ в середине текста выносится в ответственного', () => {
  assert.deepEqual(parseComposerMessage('+ралф Обнови @вася билд'), {
    projectQuery: 'ралф',
    taskText: 'Обнови билд',
    assigneeQuery: 'вася',
  });
});

test('parse: последний @ выигрывает, все @ убраны из текста', () => {
  assert.deepEqual(parseComposerMessage('@петя задача @вася'), {
    projectQuery: null,
    taskText: 'задача',
    assigneeQuery: 'вася',
  });
});

test('parse: «+» только как первый токен (не в середине)', () => {
  assert.deepEqual(parseComposerMessage('fix +bug crash'), {
    projectQuery: null,
    taskText: 'fix +bug crash',
    assigneeQuery: null,
  });
});

test('parse: пустая строка', () => {
  assert.deepEqual(parseComposerMessage('   '), {
    projectQuery: null,
    taskText: '',
    assigneeQuery: null,
  });
});

// --- fuzzyMatch ---

const projects = [
  { id: '1', name: 'Ралф core' },
  { id: '2', name: 'Ралф docs' },
  { id: '3', name: 'Лендинг' },
];

test('fuzzy: exact (ci) → unique', () => {
  const r = fuzzyMatch('лендинг', projects, (p) => p.name);
  assert.equal(r.unique?.id, '3');
});

test('fuzzy: prefix с несколькими → пикер (unique null)', () => {
  const r = fuzzyMatch('ралф', projects, (p) => p.name);
  assert.equal(r.unique, null);
  assert.equal(r.matches.length, 2);
});

test('fuzzy: единственный prefix → unique', () => {
  const r = fuzzyMatch('ленд', projects, (p) => p.name);
  assert.equal(r.unique?.id, '3');
});

test('fuzzy: substring единственный → unique', () => {
  const r = fuzzyMatch('core', projects, (p) => p.name);
  assert.equal(r.unique?.id, '1');
});

test('fuzzy: нет совпадений → пустой matches', () => {
  const r = fuzzyMatch('xyz', projects, (p) => p.name);
  assert.equal(r.unique, null);
  assert.equal(r.matches.length, 0);
});

test('fuzzy: пустой query → весь список, unique null', () => {
  const r = fuzzyMatch('', projects, (p) => p.name);
  assert.equal(r.unique, null);
  assert.equal(r.matches.length, 3);
});

// --- greedyProjectPrefix (многословные имена проектов) ---

test('greedy: многословное имя → проект + остаток-текст', () => {
  const r = greedyProjectPrefix('Ралф core Обнови билд', projects, (p) => p.name);
  assert.equal(r?.item.id, '1'); // «Ралф core»
  assert.equal(r?.remainder, 'Обнови билд');
});

test('greedy: самое длинное имя выигрывает', () => {
  const items = [
    { id: 'a', name: 'Ралф' },
    { id: 'b', name: 'Ралф core' },
  ];
  const r = greedyProjectPrefix('Ралф core обнови', items, (p) => p.name);
  assert.equal(r?.item.id, 'b');
  assert.equal(r?.remainder, 'обнови');
});

test('greedy: короткое имя матчит когда длинное не подходит', () => {
  const items = [
    { id: 'a', name: 'Ралф' },
    { id: 'b', name: 'Ралф core' },
  ];
  const r = greedyProjectPrefix('Ралф обнови', items, (p) => p.name);
  assert.equal(r?.item.id, 'a');
  assert.equal(r?.remainder, 'обнови');
});

test('greedy: имя только префикс по слову (не «Ралфмен»)', () => {
  const items = [{ id: 'a', name: 'Ралф' }];
  assert.equal(greedyProjectPrefix('Ралфмен задача', items, (p) => p.name), null);
});

test('greedy: нет совпадения по имени → null (откат на fuzzy)', () => {
  const r = greedyProjectPrefix('xyz обнови', projects, (p) => p.name);
  assert.equal(r, null);
});

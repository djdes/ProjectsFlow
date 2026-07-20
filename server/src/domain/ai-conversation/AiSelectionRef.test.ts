import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_AI_SELECTION_LABEL,
  MAX_AI_SELECTION_SELECTOR,
  normalizeSelectionRef,
} from './AiSelectionRef.js';

const base = {
  kind: 'site_element',
  route: '/catalog',
  selector: '[data-pf-id="hero-title"]',
  tagName: 'H1',
};

test('normalizes a site element reference and lowercases the tag', () => {
  const selection = normalizeSelectionRef({ ...base, label: '  Наши услуги  ', jobId: 'job-1' });
  assert.deepEqual(selection, {
    kind: 'site_element',
    route: '/catalog',
    selector: '[data-pf-id="hero-title"]',
    tagName: 'h1',
    label: 'Наши услуги',
    artifactVersion: null,
    jobId: 'job-1',
  });
});

test('drops a reference that cannot identify a zone', () => {
  assert.equal(normalizeSelectionRef(null), null);
  assert.equal(normalizeSelectionRef('nope'), null);
  assert.equal(normalizeSelectionRef([base]), null);
  assert.equal(normalizeSelectionRef({ ...base, kind: 'task' }), null);
  assert.equal(normalizeSelectionRef({ ...base, selector: '   ' }), null);
  assert.equal(normalizeSelectionRef({ ...base, tagName: undefined }), null);
});

test('keeps only site-relative routes so a zone link cannot leave the site', () => {
  assert.equal(normalizeSelectionRef({ ...base, route: 'https://evil.example/x' })?.route, '/');
  assert.equal(normalizeSelectionRef({ ...base, route: undefined })?.route, '/');
  assert.equal(normalizeSelectionRef({ ...base, route: '/pricing' })?.route, '/pricing');
});

test('collapses control characters instead of storing them in metadata', () => {
  const selection = normalizeSelectionRef({
    ...base,
    selector: 'section\n  >\tp',
    label: 'Первая строка\nвторая',
  });
  assert.equal(selection?.selector, 'section > p');
  assert.equal(selection?.label, 'Первая строка вторая');
});

test('caps every field so one message cannot carry a DOM dump', () => {
  const selection = normalizeSelectionRef({
    ...base,
    selector: 'a'.repeat(MAX_AI_SELECTION_SELECTOR + 500),
    label: 'б'.repeat(MAX_AI_SELECTION_LABEL + 500),
    artifactVersion: 'v'.repeat(400),
    jobId: 'j'.repeat(400),
  });
  assert.equal(selection?.selector.length, MAX_AI_SELECTION_SELECTOR);
  assert.equal(selection?.label?.length, MAX_AI_SELECTION_LABEL);
  assert.equal(selection?.artifactVersion?.length, 128);
  assert.equal(selection?.jobId?.length, 36);
});

test('treats a missing label or artifact version as absent, not empty', () => {
  const selection = normalizeSelectionRef({ ...base, label: '   ', artifactVersion: 42 });
  assert.equal(selection?.label, null);
  assert.equal(selection?.artifactVersion, null);
  assert.equal(selection?.jobId, null);
});

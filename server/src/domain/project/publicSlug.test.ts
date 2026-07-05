import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePublicSlug } from './publicSlug.js';

test('generatePublicSlug: формат adjective-noun-token (base36-хвост)', () => {
  const slug = generatePublicSlug(() => 0.42);
  assert.match(slug, /^[a-z]+-[a-z]+-[0-9a-z]{6}$/);
});

test('generatePublicSlug: детерминирован при фиксированном rng', () => {
  const a = generatePublicSlug(() => 0.42);
  const b = generatePublicSlug(() => 0.42);
  assert.equal(a, b);
});

test('generatePublicSlug: разный rng → разный slug (защита от перебора)', () => {
  const a = generatePublicSlug(() => 0.1);
  const b = generatePublicSlug(() => 0.9);
  assert.notEqual(a, b);
});

test('generatePublicSlug: rng близкий к 1 не выходит за границы словаря', () => {
  // Math.random() ∈ [0,1); проверяем верхнюю границу — индекс не должен дать undefined.
  const slug = generatePublicSlug(() => 0.9999999);
  assert.match(slug, /^[a-z]+-[a-z]+-[0-9a-z]{6}$/);
  assert.ok(!slug.includes('undefined'));
});

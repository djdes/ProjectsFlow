import test from 'node:test';
import assert from 'node:assert/strict';
import { cn } from './utils';

test('cn: утилиты блочной оси плагина logicalBlock перекрывают друг друга по порядку', () => {
  assert.equal(cn('mbs-2', 'mbs-4'), 'mbs-4');
  assert.equal(cn('pbe-1', 'pbe-[env(safe-area-inset-bottom,0px)]'), 'pbe-[env(safe-area-inset-bottom,0px)]');
  assert.equal(cn('inset-bs-0', 'inset-bs-4'), 'inset-bs-4');
  assert.equal(cn('border-bs', 'border-bs-2'), 'border-bs-2');
  assert.equal(cn('rounded-bs-md', 'rounded-bs-xl'), 'rounded-bs-xl');
});

test('cn: сокращения (my/py/p/inset-y/border) убирают перекрытые логические стороны', () => {
  assert.equal(cn('mbs-2', 'my-0'), 'my-0');
  assert.equal(cn('pbs-4', 'pbe-2', 'p-0'), 'p-0');
  assert.equal(cn('inset-bs-2', 'inset-y-0'), 'inset-y-0');
  assert.equal(cn('border-bs', 'border-0'), 'border-0');
  assert.equal(cn('ps-4', 'px-2'), 'px-2');
  assert.equal(cn('start-0', 'inset-x-2'), 'inset-x-2');
  // Сторона после сокращения уточняет его — оба класса нужны.
  assert.equal(cn('my-0', 'mbs-2'), 'my-0 mbs-2');
  assert.equal(cn('px-2', 'ps-4'), 'px-2 ps-4');
});

test('cn: логические утилиты не путаются с цветами и соседними группами', () => {
  assert.equal(cn('border-be', 'border-border'), 'border-be border-border');
  assert.equal(cn('mbs-2', 'mbe-2'), 'mbs-2 mbe-2');
  assert.equal(cn('rounded-bs-lg', 'rounded-be-lg'), 'rounded-bs-lg rounded-be-lg');
});

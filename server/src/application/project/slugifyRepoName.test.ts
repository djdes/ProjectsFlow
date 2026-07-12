import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugifyRepoName } from './slugifyRepoName.js';

test('slugifyRepoName: транслит кириллицы', () => {
  assert.equal(slugifyRepoName('Обувь Лендинг'), 'obuv-lending');
});

test('slugifyRepoName: спецсимволы и пробелы схлопываются в дефисы', () => {
  assert.equal(slugifyRepoName('My  Shop!!'), 'my-shop');
});

test('slugifyRepoName: пустой результат → project', () => {
  assert.equal(slugifyRepoName('!!!'), 'project');
});

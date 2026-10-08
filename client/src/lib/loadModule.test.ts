import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './loadModule';

test('a pending module stops suspending indefinitely', async () => {
  await assert.rejects(loadModule(() => new Promise(() => {}), 15), /Не удалось загрузить/);
});
test('loaded modules and real import failures pass through', async () => {
  const module = { page: 'ready' };
  assert.equal(await loadModule(async () => module), module);
  const error = new Error('module failed');
  await assert.rejects(loadModule(async () => { throw error; }), (e) => e === error);
});

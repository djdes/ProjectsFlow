import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRefreshPage,
  isRefreshingPage,
  refreshPage,
  registerPageReader,
} from './refreshRegistry';

test('refresh scopes readers, waits for all of them and coalesces repeated gestures', async () => {
  let finish!: () => void;
  let calls = 0;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const off = registerPageReader('/a', () => {
    calls += 1;
    return pending;
  });
  const other = registerPageReader('/b', async () => {
    throw new Error('wrong route');
  });
  try {
    const first = refreshPage('/a');
    assert.equal(refreshPage('/a'), first);
    assert.equal(isRefreshingPage('/a'), true);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls, 1);
    finish();
    await first;
    assert.equal(isRefreshingPage('/a'), false);
  } finally {
    off();
    other();
  }
  assert.equal(canRefreshPage('/a'), false);
});

test('one failing reader cannot report success or prevent another reader from running', async () => {
  let healthy = 0;
  const offA = registerPageReader('/fail', () => {
    throw new Error('offline');
  });
  const offB = registerPageReader('/fail', async () => {
    healthy += 1;
  });
  try {
    await assert.rejects(refreshPage('/fail'), /Не удалось обновить/);
    assert.equal(healthy, 1);
    assert.equal(isRefreshingPage('/fail'), false);
    offA();
    await refreshPage('/fail');
    assert.equal(healthy, 2);
  } finally {
    offA();
    offB();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { memoKey, RequestMemo, requestScopedAdminCheck } from './RequestMemo.js';

// Runs `work` inside a memo scope, the way requestMemoScope does for a GET request.
function inScope<T>(memo: RequestMemo, work: () => Promise<T>, active: () => boolean = () => true): Promise<T> {
  return new Promise<T>((resolve, reject) => memo.run(active, () => void work().then(resolve, reject)));
}

function lookup<T>(value: T) {
  const calls = { count: 0 };
  return {
    calls,
    load: async (): Promise<T> => {
      calls.count += 1;
      return value;
    },
  };
}

test('inside a scope a lookup is read once, a different lookup separately', async () => {
  const memo = new RequestMemo();
  const a = lookup('a');
  const b = lookup('b');
  await inScope(memo, async () => {
    // Concurrent askers share the read in flight.
    const results = await Promise.all([memo.memoize('a', a.load), memo.memoize('a', a.load), memo.memoize('b', b.load)]);
    assert.deepEqual(results, ['a', 'a', 'b']);
    assert.equal(await memo.memoize('a', a.load), 'a');
  });
  assert.equal(a.calls.count, 1);
  assert.equal(b.calls.count, 1);
});

test('outside a request every call reads (background jobs, Telegram, MCP)', async () => {
  const memo = new RequestMemo();
  const a = lookup(true);
  await memo.memoize('a', a.load);
  await memo.memoize('a', a.load);
  await memo.memoize('a', a.load);
  assert.equal(a.calls.count, 3);
});

test('requests never share answers, even when they run at the same time', async () => {
  const memo = new RequestMemo();
  const a = lookup('a');
  await Promise.all([
    inScope(memo, async () => {
      await memo.memoize('a', a.load);
      await memo.memoize('a', a.load);
    }),
    inScope(memo, async () => {
      await memo.memoize('a', a.load);
      await memo.memoize('a', a.load);
    }),
  ]);
  assert.equal(a.calls.count, 2);
});

test('once the scope is no longer active (the response has started) every call reads again', async () => {
  const memo = new RequestMemo();
  const a = lookup('a');
  let active = true;
  await inScope(
    memo,
    async () => {
      await memo.memoize('a', a.load);
      await memo.memoize('a', a.load);
      active = false;
      await memo.memoize('a', a.load);
      await memo.memoize('a', a.load);
    },
    () => active,
  );
  assert.equal(a.calls.count, 3);
});

test('a failed read is not remembered', async () => {
  const memo = new RequestMemo();
  let calls = 0;
  let down = true;
  const load = async (): Promise<string> => {
    calls += 1;
    if (down) throw new Error('db down');
    return 'ok';
  };
  await inScope(memo, async () => {
    await assert.rejects(memo.memoize('a', load), /db down/);
    down = false;
    assert.equal(await memo.memoize('a', load), 'ok');
    assert.equal(await memo.memoize('a', load), 'ok');
  });
  assert.equal(calls, 2);
});

test('keys built from parts do not collide on separators inside ids', () => {
  assert.notEqual(memoKey('hidden', 'a|b', 'c'), memoKey('hidden', 'a', 'b|c'));
  assert.equal(memoKey('hidden', 'a', 'b'), memoKey('hidden', 'a', 'b'));
});

test('admin check: one read per request, a revoked flag applies to the next request', async () => {
  const memo = new RequestMemo();
  const reads: string[] = [];
  const admins = new Set(['root']);
  const check = requestScopedAdminCheck(memo, {
    getById: async (id) => {
      reads.push(id);
      return id === 'ghost' ? null : { isAdmin: admins.has(id) };
    },
  });
  await inScope(memo, async () => {
    assert.deepEqual(await Promise.all([check('root'), check('root'), check('user'), check('ghost')]), [
      true,
      true,
      false,
      false,
    ]);
    assert.equal(await check('root'), true);
  });
  assert.deepEqual(reads.sort(), ['ghost', 'root', 'user']);

  admins.delete('root');
  await inScope(memo, async () => assert.equal(await check('root'), false));
  assert.equal(reads.filter((id) => id === 'root').length, 2);
});

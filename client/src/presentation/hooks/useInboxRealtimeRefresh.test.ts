import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useInboxRealtimeRefresh } from './useInboxRealtimeRefresh';
import { REALTIME_CONNECTED_EVENT, TASK_CHANGED_EVENT } from './useNotificationStream';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function harness() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let approved = false;
  let reads = 0;
  function Inbox() {
    const lastRefresh = useRef(Date.now());
    const [pending, setPending] = useState(true);
    const refresh = useCallback(() => { reads++; setPending(!approved); lastRefresh.current = Date.now(); }, []);
    useInboxRealtimeRefresh(refresh, lastRefresh);
    return pending ? React.createElement('article', null, 'На утверждении') : null;
  }
  await act(async () => root.render(React.createElement(Inbox)));
  return { host, approve: () => { approved = true; }, reads: () => reads, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

for (const eventName of [TASK_CHANGED_EVENT, REALTIME_CONNECTED_EVENT]) {
  test(`${eventName} removes an approved task even during the recent refresh window`, async () => {
    const view = await harness();
    try {
      assert.ok(view.host.querySelector('article'));
      view.approve();
      await act(async () => { window.dispatchEvent(new Event(eventName)); await wait(550); });
      assert.equal(view.host.querySelector('article'), null);
      assert.equal(view.reads(), 1);
    } finally { await view.close(); }
  });
}

test('an Inbox event burst results in one snapshot refresh', async () => {
  const view = await harness();
  try {
    await act(async () => { for (let i=0; i<5; i++) window.dispatchEvent(new Event(TASK_CHANGED_EVENT)); await wait(550); });
    assert.equal(view.reads(), 1);
  } finally { await view.close(); }
});

test('leaving the Inbox cancels a deferred snapshot refresh', async () => {
  const view = await harness();
  await act(async () => window.dispatchEvent(new Event(TASK_CHANGED_EVENT)));
  await view.close();
  await wait(500);
  assert.equal(view.reads(), 0);
});
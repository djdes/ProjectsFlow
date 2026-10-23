import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import type { ToastT } from 'sonner';
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, useLocation } = await import('react-router-dom');
const { toast } = await import('sonner');
const { renderToStaticMarkup } = await import('react-dom/server');
const { useNotificationStream } = await import('./useNotificationStream');
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

test('clicking the new-comment toast navigates to the exact task and comment', async (t) => {
  const listeners = new Map<string, (event: { data: string }) => void>();
  class Source {
    addEventListener(name: string, callback: (event: { data: string }) => void) { listeners.set(name, callback); }
    close() {}
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
  Object.defineProperty(globalThis, 'EventSource', { value: Source, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'EventSource', original);
    else Reflect.deleteProperty(globalThis, 'EventSource');
  });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  function Probe() {
    useNotificationStream('workspace');
    const location = useLocation();
    return React.createElement('p', { id: 'target' }, location.pathname + location.hash);
  }
  try {
    await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(Probe))));
    await act(async () => listeners.get('notification')!({ data: JSON.stringify({ payload: {
      type: 'task_changed', action: 'commented', title: 'Новый комментарий',
      detail: '<span style="background:#1f883d;color:#fff">На утверждении</span>\n**Готово**\n- Первый пункт\n- [Открыть](https://example.com)\n<script>alert(1)</script><img src="x" onerror="alert(1)"/><figure data-figure-image><img src="/api/attachments/image"/></figure>\n' + 'Подробности '.repeat(100),
      projectId: 'project', taskId: 'task', commentId: 'comment', taskAvailable: true,
      projectName: 'ProjectsFlow', actorDisplayName: 'Воркер',
    } }) }));
    const item = toast.getToasts().find((item): item is ToastT => 'title' in item && React.isValidElement(item.title));
    assert.ok(item);
    const title = item.title as React.ReactElement<{ onClick: () => void }>;
    const markup = renderToStaticMarkup(title);
    assert.match(markup, /На утверждении/);
    assert.match(markup, /<strong>Готово<\/strong>/);
    assert.match(markup, /notification-quote-author[^>]*>Воркер/);
    assert.match(markup, /<ul>/);
    assert.doesNotMatch(markup, /<script|onerror|<a |<img /);
    assert.doesNotMatch(markup, /&lt;|background:|figure|\*\*/);
    assert.match(markup, /…/);
    assert.ok(markup.length < 3500, 'long comments must have a bounded preview');
    await act(async () => title.props.onClick());
    assert.equal(host.querySelector('#target')!.textContent, '/projects/project/tasks/task#comment-comment');
    await act(async () => listeners.get('notification')!({ data: JSON.stringify({ payload: {
      type: 'task_changed', title: 'Задача изменена', detail: '**Готово** <span>теперь</span>',
      projectName: 'ProjectsFlow', actorDisplayName: 'Воркер',
    } }) }));
    const fallback = toast.getToasts().find((entry): entry is ToastT => 'title' in entry && entry.title === 'Задача изменена');
    assert.equal(fallback?.description, 'Воркер · ProjectsFlow\nГотово теперь');
  } finally { await act(async () => root.unmount()); toast.dismiss(); host.remove(); }
});

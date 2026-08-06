import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ContainerProvider } from '@/infrastructure/di/container';
import { InboxCheckbox } from './InboxCheckbox';
import type { Task } from '@/domain/task/Task';

// tsx компилирует .tsx классическим JSX-рантаймом — React должен быть глобальным
// (тот же приём, что в AiComposer.behavior.test.ts).
(globalThis as typeof globalThis & { React: typeof React }).React = React;

// BUG A путь 2 («Принять работу» на доске): чекбокс — оптимистичный (тикает сразу), но при
// ошибке move обязан вернуться в прежнее состояние + показать тост, а не остаться молча
// «принятым» на клиенте, пока сервер его отклонил. Кейс регрессии для стейдж-2 брифа п.5.
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    creator: null,
    assignee: { userId: 'u1', displayName: 'Денис', avatarUrl: null },
    description: 'Сделать штуку',
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'pending_approval',
    statusBeforeDone: null,
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: null,
    startDate: null,
    parentTaskId: null,
    priority: null,
    taskType: null,
    ...overrides,
  };
}

async function render(props: Parameters<typeof InboxCheckbox>[0]): Promise<{
  host: HTMLElement;
  button: () => HTMLButtonElement;
  click: () => Promise<void>;
  unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(ContainerProvider, null, React.createElement(InboxCheckbox, props)));
  });
  const button = (): HTMLButtonElement => host.querySelector('button') as HTMLButtonElement;
  return {
    host,
    button,
    click: async () => {
      await act(async () => {
        button().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

test('InboxCheckbox: move-override — клик мгновенно тикает (optimistic), без ожидания сети', async () => {
  const task = makeTask();
  let resolveMove: (() => void) | undefined;
  const move = () =>
    new Promise<void>((resolve) => {
      resolveMove = resolve;
    });
  const view = await render({
    task,
    lastDoneTaskId: null,
    lastTodoTaskId: null,
    doneTitle: 'Принять работу',
    move,
  });

  assert.equal(view.button().getAttribute('aria-pressed'), 'false');
  await view.click();
  // Пока сеть не ответила — уже отмечен (optimistic) и disabled (pending).
  assert.equal(view.button().getAttribute('aria-pressed'), 'true');
  assert.equal(view.button().disabled, true);

  await act(async () => {
    resolveMove?.();
    await Promise.resolve();
  });
  await view.unmount();
});

test('InboxCheckbox: ошибка move-override — карточка откатывается, чекбокс возвращается в исходное состояние', async () => {
  const task = makeTask();
  const move = async (): Promise<void> => {
    throw new Error('Сервер отклонил приёмку');
  };
  const view = await render({
    task,
    lastDoneTaskId: null,
    lastTodoTaskId: null,
    doneTitle: 'Принять работу',
    move,
  });

  assert.equal(view.button().getAttribute('aria-pressed'), 'false');
  await view.click();
  // Ждём, пока промис move() отклонится и обработчик докатится до catch/finally.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  // Rollback: чекбокс вернулся в НЕ-отмеченное состояние, pending снят — как будто
  // клика и не было (кроме error-тоста, который здесь не проверяем — sonner требует
  // смонтированный <Toaster/>, а тут важен именно откат локального состояния).
  assert.equal(view.button().getAttribute('aria-pressed'), 'false');
  assert.equal(view.button().disabled, false);
  await view.unmount();
});

test('InboxCheckbox: move-override — успех НЕ откатывает состояние', async () => {
  const task = makeTask();
  const move = async (): Promise<void> => {
    /* сеть подтвердила */
  };
  const view = await render({
    task,
    lastDoneTaskId: null,
    lastTodoTaskId: null,
    doneTitle: 'Принять работу',
    move,
  });

  await view.click();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.equal(view.button().getAttribute('aria-pressed'), 'true');
  assert.equal(view.button().disabled, false);
  await view.unmount();
});

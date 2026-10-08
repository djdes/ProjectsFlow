import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ContainerProvider, useContainer } from '@/infrastructure/di/container';
import { AuthProvider } from '@/presentation/auth/AuthProvider';
import type { Task } from '@/domain/task/Task';
import type { TaskRepository } from '@/application/task/TaskRepository';
import { useTasks, type UseTasks } from './useTasks';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

test('an earlier failed move cannot roll back a newer confirmed move', async () => {
  const first = deferred<Task>();
  const second = deferred<Task>();
  let calls = 0;
  const view = await harness(
    async () => [task('a')],
    () => (++calls === 1 ? first.promise : second.promise),
  );
  try {
    let failed!: Promise<void>;
    let success!: Promise<void>;
    await act(async () => {
      failed = assert.rejects(
        view.current.move('a-task', {
          targetStatus: 'manual',
          beforeTaskId: null,
          afterTaskId: null,
        }),
        /offline/,
      );
    });
    await act(async () => {
      success = view.current.move('a-task', {
        targetStatus: 'done',
        beforeTaskId: null,
        afterTaskId: null,
      });
    });
    await act(async () => {
      second.resolve(task('a', 'done'));
      await success;
    });
    await act(async () => {
      first.reject(new Error('offline'));
      await failed;
    });
    assert.equal(view.current.tasks[0].status, 'done');
  } finally {
    await view.close();
  }
});

test('returning to a board during its pending move does not strand its skeleton', async () => {
  const moving = deferred<Task>();
  let status: Task['status'] = 'backlog';
  const view = await harness(
    async (id) => [task(id, id === 'a' ? status : 'backlog')],
    () => moving.promise,
  );
  try {
    let mutation!: Promise<void>;
    await act(async () => {
      mutation = view.current.move('a-task', {
        targetStatus: 'manual',
        beforeTaskId: null,
        afterTaskId: null,
      });
    });
    await view.render('b');
    await view.render('a');
    await act(async () => {
      status = 'manual';
      moving.resolve(task('a', 'manual'));
      await mutation;
    });
    assert.equal(view.current.loading, false);
    assert.equal(view.current.tasks[0].status, 'manual');
  } finally {
    await view.close();
  }
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function task(projectId: string, status: Task['status'] = 'backlog'): Task {
  return {
    id: projectId + '-task',
    projectId,
    status,
    position: 1024,
    description: projectId,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Task;
}
async function harness(
  list: TaskRepository['list'],
  move?: TaskRepository['move'],
) {
  let current!: UseTasks;
  let restore: (() => void) | undefined;
  function Probe({ projectId }: { projectId: string }) {
    current = useTasks(projectId);
    return null;
  }
  function Providers({ projectId }: { projectId: string }) {
    const c = useContainer();
    if (!restore) {
      const originalList = c.taskRepository.list;
      const originalMove = c.taskRepository.move;
      const originalAuth = c.authRepository.getCurrentOrNull;
      c.taskRepository.list = list;
      if (move) c.taskRepository.move = move;
      c.authRepository.getCurrentOrNull = async () => null;
      restore = () => {
        c.taskRepository.list = originalList;
        c.taskRepository.move = originalMove;
        c.authRepository.getCurrentOrNull = originalAuth;
      };
    }
    return React.createElement(
      AuthProvider,
      null,
      React.createElement(Probe, { projectId }),
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = async (projectId: string) => {
    await act(async () =>
      root.render(
        React.createElement(
          ContainerProvider,
          null,
          React.createElement(
            MemoryRouter,
            null,
            React.createElement(Providers, { projectId }),
          ),
        ),
      ),
    );
  };
  await render('a');
  return {
    get current() {
      return current;
    },
    render,
    close: async () => {
      await act(async () => root.unmount());
      restore?.();
      host.remove();
    },
  };
}

test('late project A response cannot replace project B', async () => {
  const a = deferred<Task[]>();
  const b = deferred<Task[]>();
  const view = await harness((id) => (id === 'a' ? a.promise : b.promise));
  try {
    await view.render('b');
    assert.equal(view.current.tasks.length, 0);
    await act(async () => b.resolve([task('b')]));
    await act(async () => a.resolve([task('a')]));
    assert.equal(view.current.tasks[0].projectId, 'b');
    assert.equal(view.current.loading, false);
  } finally {
    await view.close();
  }
});

test('a stale read cannot undo an optimistic move or its confirmed response', async () => {
  const old = deferred<Task[]>();
  let calls = 0;
  const view = await harness(
    async () => (++calls === 1 ? [task('a')] : old.promise),
    async () => task('a', 'manual'),
  );
  try {
    let reading!: Promise<void>;
    await act(async () => {
      reading = view.current.refetch();
    });
    await act(async () => {
      await view.current.move('a-task', {
        targetStatus: 'manual',
        beforeTaskId: null,
        afterTaskId: null,
      });
    });
    await act(async () => {
      old.resolve([task('a')]);
      await reading;
    });
    assert.equal(view.current.tasks[0].status, 'manual');
  } finally {
    await view.close();
  }
});

test('failed move restores the card without needing a working network', async () => {
  const moving = deferred<Task>();
  const view = await harness(
    async () => [task('a')],
    () => moving.promise,
  );
  try {
    let failed!: Promise<void>;
    await act(async () => {
      failed = assert.rejects(
        view.current.move('a-task', {
          targetStatus: 'manual',
          beforeTaskId: null,
          afterTaskId: null,
        }),
        /offline/,
      );
    });
    assert.equal(view.current.tasks[0].status, 'manual');
    await act(async () => {
      moving.reject(new Error('offline'));
      await failed;
    });
    assert.equal(view.current.tasks[0].status, 'backlog');
  } finally {
    await view.close();
  }
});

test('a pending mutation in A neither blocks B nor inserts its result into B', async () => {
  const moving = deferred<Task>();
  const view = await harness(
    async (id) => [task(id)],
    () => moving.promise,
  );
  try {
    let mutation!: Promise<void>;
    await act(async () => {
      mutation = view.current.move('a-task', {
        targetStatus: 'manual',
        beforeTaskId: null,
        afterTaskId: null,
      });
    });
    await view.render('b');
    assert.equal(view.current.tasks[0].projectId, 'b');
    await act(async () => {
      moving.resolve(task('a', 'manual'));
      await mutation;
    });
    assert.equal(view.current.tasks[0].projectId, 'b');
  } finally {
    await view.close();
  }
});

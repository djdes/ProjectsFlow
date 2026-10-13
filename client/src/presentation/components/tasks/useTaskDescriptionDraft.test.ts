import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/react';
import type { Task } from '@/domain/task/Task';
import type { TaskRepository } from '@/application/task/TaskRepository';
import { RichTextEditor } from '../editor/RichTextEditor';
import { useTaskDescriptionDraft } from './useTaskDescriptionDraft';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

type Draft = ReturnType<typeof useTaskDescriptionDraft>;
type Write = { projectId: string; taskId: string; description: string };

function task(id: string, description: string, projectId = 'project'): Task {
  return { id, projectId, description } as Task;
}

async function harness(persist?: (write: Write) => Promise<string>) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const writes: Write[] = [];
  const renders: Array<{ taskId: string; description: string }> = [];
  let current!: Draft;
  const repository = {
    update: async (projectId: string, taskId: string, input: { description: string }) => {
      const write = { projectId, taskId, description: input.description };
      writes.push(write);
      return task(taskId, persist ? await persist(write) : input.description, projectId);
    },
  } as TaskRepository;

  function Probe({ selected }: { selected: Task | null }) {
    const draft = useTaskDescriptionDraft(selected, repository, () => undefined);
    current = draft;
    if (!selected) return null;
    renders.push({ taskId: selected.id, description: draft.description });
    return React.createElement(RichTextEditor, {
      key: selected.id, value: draft.description, onChange: draft.onChange,
      onBlur: () => { void draft.commit(); }, taskDocument: true,
    });
  }

  return {
    host, writes, renders,
    get current() { return current; },
    editor() { return (host.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor; },
    async select(selected: Task | null) {
      await act(async () => { root.render(React.createElement(Probe, { selected })); });
    },
    async close() {
      await act(async () => { root.unmount(); });
      host.remove();
    },
  };
}

test('opening successive tasks never gives the new editor the previous description or writes on view', async () => {
  const view = await harness();
  const tasks = [
    task('a', 'Защитить регистрацию от ботов\n\nДобавить защиту'),
    task('b', 'Настроить оплату\n\nПодключить тарифы'),
    task('c', 'Исправить поиск'),
    task('d', 'Добавить уведомления'),
    task('e', 'Проверить мобильную версию'),
  ];
  try {
    for (const selected of tasks) {
      await view.select(selected);
      assert.equal(view.editor().getMarkdown(), selected.description);
      await act(async () => { await view.current.commit(); });
    }
    await view.select(null);
    assert.deepEqual(view.writes, [], 'viewing, blurring and closing clean tasks must not PATCH them');
    for (const selected of tasks) {
      assert.ok(view.renders.filter(render => render.taskId === selected.id)
        .every(render => render.description === selected.description), 'each render belongs to its task');
    }
  } finally { await view.close(); }
});

test('callbacks retained by the previous editor cannot change or save the newly opened task', async () => {
  const view = await harness();
  try {
    await view.select(task('a', 'Первая задача'));
    const previous = view.current;
    await view.select(task('b', 'Вторая задача', 'another-project'));
    await act(async () => {
      previous.onChange('Запоздалое изменение первой задачи');
      await previous.commit('Запоздалый результат первой задачи');
      await previous.flush();
    });
    assert.equal(view.current.description, 'Вторая задача');
    assert.deepEqual(view.writes, []);
  } finally { await view.close(); }
});

test('reopening the same task does not revive callbacks from the closed editor', async () => {
  const view = await harness();
  try {
    const selected = task('a', 'Первая задача');
    await view.select(selected);
    const previous = view.current;
    await view.select(null);
    await view.select(selected);
    await act(async () => { await previous.commit('Старый результат'); });
    assert.equal(view.current.description, selected.description);
    assert.deepEqual(view.writes, []);
  } finally { await view.close(); }
});

test('a delayed save finishes for its original task while the next task stays clean', async () => {
  let finish!: (description: string) => void;
  const pending = new Promise<string>(resolve => { finish = resolve; });
  const view = await harness(() => pending);
  try {
    await view.select(task('a', 'Первая задача'));
    let saving!: Promise<void>;
    await act(async () => {
      view.editor().commands.setContent('Первая задача после правки', { contentType: 'markdown' });
      saving = view.current.flush();
    });
    await view.select(task('b', 'Вторая задача'));
    assert.equal(view.current.description, 'Вторая задача');
    assert.equal(view.current.saving, false);
    await act(async () => { finish('Первая задача после правки'); await saving; });
    assert.equal(view.current.description, 'Вторая задача');
    await act(async () => { await view.current.commit(); });
    assert.deepEqual(view.writes, [{ projectId: 'project', taskId: 'a', description: 'Первая задача после правки' }]);
  } finally { await view.close(); }
});

test('switching away saves an edited draft only to its original task', async () => {
  const view = await harness();
  try {
    await view.select(task('a', 'Первая задача'));
    await act(async () => {
      view.editor().commands.setContent('Изменённая первая задача', { contentType: 'markdown' });
    });
    await view.select(task('b', 'Вторая задача'));
    assert.deepEqual(view.writes, [{ projectId: 'project', taskId: 'a', description: 'Изменённая первая задача' }]);
    assert.equal(view.current.description, 'Вторая задача');
  } finally { await view.close(); }
});
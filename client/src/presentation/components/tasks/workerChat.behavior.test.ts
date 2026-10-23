import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { TaskComment } from '@/domain/task/TaskComment';
import type { Task } from '@/domain/task/Task';
import type { LiveSession } from '@/domain/live/LiveSession';
import type { LiveEvent } from '@/domain/live/LiveEvent';
import type { LiveRepository } from '@/application/live/LiveRepository';
import type { TaskWorkerActivity } from '@/domain/live/TaskWorkerActivity';
import type { LiveFileDiff } from '@/domain/live/LiveFileDiff';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state: Record<string, unknown> = {};
(globalThis as typeof globalThis & { __workerChatTest: typeof state }).__workerChatTest = state;

// Replace application ports and unrelated controls, retaining the real timeline,
// activity store, composer keyboard handling and page routing logic.
async function component(name: 'LiveTab' | 'WorkerActivityBadge' | 'AiPage' | 'AiConversationView' | 'TaskDetailPage' | 'CancelWorkButton') {
  const entry = name === 'AiPage' || name === 'TaskDetailPage' ? `../../pages/${name}.tsx`
    : name === 'AiConversationView' ? '../ai/AiConversationView.tsx' : `./${name}.tsx`;
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))], bundle: true, write: false,
    platform: 'node', format: 'cjs', jsx: 'automatic',
    tsconfig: fileURLToPath(new URL('../../../../tsconfig.app.json', import.meta.url)),
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/*'],
    plugins: [{ name: 'test-ports', setup(bundler) {
      const ports: Record<string, string> = {
        '@/infrastructure/di/container': 'export const useContainer=()=>globalThis.__workerChatTest.container;',
        '@/presentation/hooks/useCurrentUser': 'export const useCurrentUser=()=>({user:{id:"me",displayName:"benzin"}});',
        './useCurrentUser': 'export const useCurrentUser=()=>({user:{id:"me",displayName:"benzin"}});',
        '@/components/ui/sonner': 'export const toast={error:()=>{},success:()=>{},info:()=>{}};',
        './TaskDrawerComposer': `import React from 'react';export const TaskDrawerComposer=p=>React.createElement('button',{onClick:()=>{p.onCommentCreated(globalThis.__workerChatTest.nextComment);p.onWorkerQueued();}},'Отправить воркеру');`,
        './CancelWorkButton': `import React from 'react';export const CancelWorkButton=()=>React.createElement('button',null,'Отменить работу');`,
        '@/presentation/hooks/useWorkerEnabled': 'export const useWorkerEnabled=()=>true;',
        './CommentBody': `import React from 'react';export const CommentBody=({body})=>React.createElement('div',null,body);`,
        'react-router-dom': `import React from 'react';export const Link=({to,children})=>React.createElement('a',{href:to},children);export const useParams=()=>globalThis.__workerChatTest.params||{};export const useNavigate=()=>globalThis.__workerChatTest.navigate;export const useLocation=()=>globalThis.__workerChatTest.location||{};export const useSearchParams=()=>[new URLSearchParams()];`,
        '@/presentation/layout/InboxBreadcrumbs': 'export const WorkspaceCrumbs=()=>null;',
        '@/presentation/layout/PageChrome': `import React from 'react';export const PageTopBar=({children})=>React.createElement('div',null,children);`,
        '@/presentation/hooks/useAiConversations': 'export const announceAiConversationsChanged=()=>{};export const useAiConversations=()=>({items:[]});',
        '@/presentation/hooks/useAiConversation': 'export const useAiConversation=()=>globalThis.__workerChatTest.aiChat;',
        '@/presentation/hooks/useProject': 'export const useProject=()=>({data:null});',
        '@/presentation/layout/ProjectBreadcrumbs': 'export const ProjectBreadcrumbs=()=>null;',
        '@/presentation/components/tasks/TaskDrawer': `import React from 'react';export const TaskDrawer=({state})=>React.createElement('div',{'data-comment-target':state.scrollToCommentId,'data-comment-navigation':state.commentNavigationKey},'Задача');`,
        '@/presentation/components/ai/AiConversationView': `import React from 'react';export const AiConversationView=({initialImageMode})=>React.createElement('div',null,initialImageMode?'Режим фото':'Обычный чат');`,
        '@/presentation/components/ai/ImageGenerationPanel': 'export const ImageGenerationPanel=()=>null;',
      };
      bundler.onResolve({ filter: /.*/ }, args => ports[args.path] ? { path: args.path, namespace: 'test-port' } : undefined);
      bundler.onLoad({ filter: /.*/, namespace: 'test-port' }, args => ({ contents: ports[args.path], loader: 'js' }));
    } }],
  });
  const module = { exports: {} as Record<string, React.ComponentType<Record<string, unknown>>> };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  return module.exports[name];
}

const at = (minute: number) => new Date(Date.UTC(2026, 9, 22, 6, minute));
const run = (id: string, minute: number, status: LiveSession['status']): LiveSession => ({
  id, taskId: 'task', projectId: 'project', agentName: 'ralph-worker', attempt: 1, status,
  model: null, headBefore: null, headAfter: null, costUsd: null, tokensIn: null, tokensOut: null,
  eventCount: 1, lastSeq: minute, startedAt: at(minute), endedAt: status === 'running' ? null : at(minute + 1),
});
const message = (): TaskComment => ({ id: 'message', taskId: 'task', ownerUserId: 'me', body: 'Отправь тестовое сообщение', createdAt: at(3), updatedAt: at(3), actorKind: 'user', agentName: null, notifyMode: 'none', replyToCommentId: null, quotedText: null, attachments: [] });
const event = (seq: number, text: string, minute: number): LiveEvent => ({ seq, kind: 'assistant_text', text, payload: null, createdAt: at(minute) });

class Source extends EventTarget {
  static instances: Source[] = [];
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { super(); Source.instances.push(this); }
  close() { this.closed = true; }
  emit(kind: string, value: unknown) { this.dispatchEvent(new MessageEvent(kind, { data: JSON.stringify(value) })); }
}
globalThis.EventSource = Source as unknown as typeof EventSource;

test('revoking a cancel shows pending, persistent confirmation and inline failure', async () => {
  const View = await component('CancelWorkButton');
  const task = { id: 'cancel-task', projectId: 'project', status: 'in_progress', ralphCancelRequestedAt: new Date(), ralphCancelRequestedByDisplayName: 'benzin' } as Task;
  let finish: (task: Task) => void = () => {};
  let fail = true;
  let changed: Task | null = null;
  state.container = { taskRepository: { async revokeRalphCancel() {
    if (fail) throw new Error('Нет связи');
    return new Promise<Task>(resolve => { finish = resolve; });
  } } };
  const view = await mount(View, { task, onChanged: (updated: Task) => { changed = updated; } });
  try {
    await act(async () => { view.host.querySelector('button')!.click(); });
    assert.match(view.host.querySelector('[role="alert"]')!.textContent!, /Нет связи/);
    assert.match(view.host.textContent!, /Остановка ещё не подтверждена/);
    fail = false;
    await act(async () => { view.host.querySelector('button')!.click(); });
    assert.equal(view.host.querySelector('button')!.disabled, true);
    assert.match(view.host.textContent!, /Отзываем запрос на отмену/);
    const updated = { ...task, ralphCancelRequestedAt: null };
    await act(async () => { finish(updated); });
    assert.equal(changed, updated);
    assert.match(view.host.querySelector('[role="status"]')!.textContent!, /Запрос на отмену отозван/);
    assert.doesNotMatch(view.host.textContent!, /Остановка ещё не подтверждена|Отозвать запрос/);
    assert.match(view.host.textContent!, /Отменить работу/);
  } finally { await view.close(); }
});

test('an old in-progress task without LIVE sessions never claims the worker is starting', async () => {
  const View = await component('LiveTab');
  state.container = {
    liveRepository: { async listSessions() { return []; }, async listRunningTaskIds() { return []; } },
    taskRepository: { async listComments() { return []; } },
    projectRepository: { async listMembers() { return []; } },
  };
  const task = { id: 'unstarted', projectId: 'project', status: 'in_progress', ralphCancelRequestedAt: null } as Task;
  const props = { task, backlogTail: null, todoTail: null };
  const view = await mount(View, props);
  try {
    assert.match(view.host.textContent!, /Запуск воркера не подтверждён/);
    assert.doesNotMatch(view.host.textContent!, /Воркер запускается|Воркер вот-вот начнёт/);
    await view.render({ ...props, task: { ...task, ralphCancelRequestedAt: new Date() } });
    assert.match(view.host.textContent!, /Ожидаем подтверждения остановки/);
  } finally { await view.close(); }
});

async function mount(Component: React.ComponentType<Record<string, unknown>>, props: Record<string, unknown> = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const render = async (next = props) => { await act(async () => { root.render(React.createElement(Component, next)); }); };
  await render();
  return { host, render, async close() { await act(async () => root.unmount()); host.remove(); } };
}

test('worker chat keeps the user message between runs and follows the new stream without selecting an attempt', async () => {
  const View = await component('LiveTab');
  let sessions = [run('first', 1, 'completed')];
  const events = new Map([['first', [event(1, 'Первый результат', 2)]], ['next', [event(4, 'Выполняю ваше сообщение', 4)]]]);
  const comments: TaskComment[] = [];
  const repository: LiveRepository = {
    async listSessions() { return sessions; },
    async listEvents(_p, _t, id, after = 0) { return (events.get(id) ?? []).filter(e => e.seq > after); },
    async listFileDiffs() { return []; }, async listRunningTaskIds() { return []; }, async listTaskActivity() { return []; },
  };
  state.container = { liveRepository: repository, taskRepository: { async listComments() { return comments; } }, projectRepository: { async listMembers() { return []; } } };
  state.nextComment = message();
  const props = { task: { id: 'task', projectId: 'project', status: 'pending_approval' } as Task, backlogTail: null, todoTail: null };
  const view = await mount(View, props);
  try {
    assert.match(view.host.textContent ?? '', /Первый результат/);
    assert.ok(view.host.querySelector('[aria-label="К последнему сообщению"]'), 'the down button remains visible at the bottom');
    const feed = view.host.querySelector('[data-pf-worker-chat]') as HTMLElement;
    Object.defineProperties(feed, { clientHeight: { value: 300 }, scrollHeight: { get: () => 2000 + feed.textContent!.length } });
    await act(async () => { [...view.host.querySelectorAll('button')].find(b => b.textContent === 'Отправить воркеру')!.click(); });
    assert.equal(feed.scrollTop, feed.scrollHeight, 'sending a message follows the conversation tail');
    assert.equal(view.host.querySelector('[data-worker-message]')?.textContent?.includes('Отправь тестовое сообщение'), true);
    assert.match(view.host.textContent ?? '', /ожидает запуска диспетчера/);
    comments.push(message());
    sessions = [run('next', 4, 'running'), ...sessions];
    await act(async () => { window.dispatchEvent(new CustomEvent('pf:live-changed', { detail: { projectId: 'project', taskId: 'task', sessionId: 'next', status: 'running' } })); });
    assert.equal(view.host.querySelectorAll('[data-worker-run]').length, 2);
    assert.equal(view.host.querySelectorAll('[data-worker-message]').length, 1);
    assert.equal(view.host.querySelector('[aria-label="Выбрать попытку"]'), null);
    assert.match(view.host.textContent ?? '', /Первый результат.*Отправь тестовое сообщение.*Выполняю ваше сообщение/s);
    assert.equal(feed.scrollTop, feed.scrollHeight, 'the new run continues at the bottom');
    await act(async () => { feed.scrollTop = 0; feed.dispatchEvent(new Event('scroll')); });
    const stream = Source.instances.at(-1)!;
    await act(async () => { stream.emit('live', { seq: 5, kind: 'tool_error', text: '  \n', payload: null, createdAt: at(4).toISOString() }); });
    assert.match(view.host.textContent ?? '', /Воркер сообщил об ошибке инструмента без описания/);
    await act(async () => { stream.emit('live', { ...event(6, 'Тест отправлен', 5), createdAt: at(5).toISOString() }); });
    assert.match(view.host.textContent ?? '', /Тест отправлен/);
    assert.equal(feed.scrollTop, 0, 'new actions do not pull the reader away from earlier messages');
    await act(async () => { view.host.querySelector<HTMLButtonElement>('[aria-label="К последнему сообщению"]')!.click(); });
    assert.equal(feed.scrollTop, feed.scrollHeight);
    await view.close();
    sessions = sessions.map(s => ({ ...s, status: 'completed', lastSeq: s.id === 'next' ? 6 : 1, endedAt: at(s.id === 'next' ? 6 : 2) }));
    events.get('next')!.push(event(6, 'Тест отправлен', 5));
    const reopened = await mount(View, props);
    try { assert.match(reopened.host.textContent ?? '', /Первый результат.*Отправь тестовое сообщение.*Тест отправлен/s); }
    finally { await reopened.close(); }
  } finally { if (view.host.isConnected) await view.close(); }
});

test('file edits show real before/after text; historical metadata uses only its own run final diff without empty panels', async () => {
  const View = await component('LiveTab');
  const file = (text: string): LiveFileDiff => ({ path: 'client/src/file.ts', change: 'modified', additions: 1, deletions: 1, unifiedDiff: `@@ -1 +1 @@\n-Было ${text}\n+Стало ${text}`, isBinary: false, truncated: false });
  const edit = (seq: number, payload: unknown, minute: number): LiveEvent => ({ seq, kind: 'file_edit', text: null, payload, createdAt: at(minute) });
  state.container = {
    liveRepository: {
      async listSessions() { return [run('old-files', 1, 'completed'), run('new-files', 4, 'completed')]; },
      async listEvents(_p: string, _t: string, id: string) { return id === 'old-files' ? [
        edit(1, { path: 'C:\\worker\\project\\client\\src\\file.ts', edits: [{ old: '', new: '' }] }, 1),
        edit(2, { path: 'C:\\worker\\project\\unavailable.ts', edits: [] }, 1),
        { ...edit(3, { path: 'missing-new.ts', content: '' }, 1), kind: 'file_write' },
      ] : [edit(1, { path: 'client/src/file.ts', edits: [{ old: 'Было прямо перед правкой', new: 'Стало сразу после правки' }] }, 4)]; },
      async listFileDiffs(_p: string, _t: string, id: string) { return [file(id === 'old-files' ? 'первый запуск' : 'другой запуск')]; },
    },
    taskRepository: { async listComments() { return []; } },
    projectRepository: { async listMembers() { return []; } },
  };
  const view = await mount(View, { task: { id: 'task', projectId: 'project', status: 'pending_approval' } as Task, backlogTail: null, todoTail: null });
  try {
    assert.doesNotMatch(view.host.textContent ?? '', /Нет текста для сравнения/);
    assert.match(view.host.textContent ?? '', /Изменён файл.*unavailable\.ts/s);
    assert.match(view.host.textContent ?? '', /Изменён файл.*missing-new\.ts/s);
    assert.match(view.host.textContent ?? '', /Было прямо перед правкой/);
    assert.match(view.host.textContent ?? '', /Стало сразу после правки/);
    const caption = [...view.host.querySelectorAll('p')].find(p => p.textContent === 'Итоговые изменения файла за запуск');
    assert.ok(caption);
    const notice = caption.parentElement!;
    await act(async () => notice.querySelector('button')!.click());
    assert.match(notice.textContent ?? '', /первый запуск/);
    assert.doesNotMatch(notice.textContent ?? '', /другой запуск/);
  } finally { await view.close(); }
});

test('failed and cancelled AI answers stop waiting; a retry sends the original question', async () => {
  const View = await component('AiConversationView');
  const calls: string[] = [];
  const makeMessage = (role: string, status: string, body: string, seq: string) => ({ id: role, conversationId: 'chat', role, status, body, seq, runId: 'run', parentMessageId: role === 'assistant' ? 'user' : null, createdAt: at(1).toISOString(), updatedAt: at(1).toISOString() });
  const chat = { loading: false, sending: false, error: null, conversation: { id: 'chat', title: 'Тест' }, messages: [makeMessage('user', 'completed', 'тест', '1'), makeMessage('assistant', 'failed', '', '2')], async send(body: string) { calls.push(body); }, setConversation() {} };
  state.aiChat = chat;
  state.navigate = () => {};
  state.container = { imageGenerationRepository: { async list() { return []; } }, aiConversationRepository: {} };
  const view = await mount(View, { conversationId: 'chat', compact: true, hideHeader: true });
  try {
    assert.match(view.host.textContent ?? '', /Ответ не сформирован/);
    assert.doesNotMatch(view.host.textContent ?? '', /Формирую ответ|В очереди локального диспетчера/);
    await act(async () => { [...view.host.querySelectorAll('button')].find(button => button.textContent === 'Повторить')!.click(); });
    assert.deepEqual(calls, ['тест']);
    chat.messages[1] = makeMessage('assistant', 'queued', '', '2'); await view.render();
    assert.match(view.host.textContent ?? '', /В очереди локального диспетчера/);
    chat.messages[1] = makeMessage('assistant', 'running', '', '2'); await view.render();
    assert.match(view.host.textContent ?? '', /Формирую ответ/);
    chat.messages[1] = makeMessage('assistant', 'cancelled', '', '2'); await view.render();
    assert.match(view.host.textContent ?? '', /Ответ остановлен/);
    assert.doesNotMatch(view.host.textContent ?? '', /Формирую ответ/);
  } finally { await view.close(); }
});

test('drafts show an explicit worker handoff with or without past sessions and queue immediately', async () => {
  const View = await component('LiveTab');
  for (const history of [false, true]) {
    const moves: unknown[] = [];
    state.container = {
      liveRepository: { async listSessions() { return history ? [run('past', 1, 'completed')] : []; }, async listEvents() { return [event(1, 'Предыдущий результат', 1)]; }, async listFileDiffs() { return []; }, async listRunningTaskIds() { return []; } },
      taskRepository: { async listComments() { return []; }, async move(...args: unknown[]) { moves.push(args); } },
      projectRepository: { async listMembers() { return []; } },
    };
    const props = { task: { id: 'task', projectId: 'project', status: 'backlog', canEdit: true } as Task, backlogTail: null, todoTail: null };
    const view = await mount(View, props);
    try {
      const button = [...view.host.querySelectorAll('button')].find(b => b.textContent === 'Сделать с помощью воркера');
      assert.ok(button, history ? 'past sessions must not hide handoff' : 'draft has an explicit handoff');
      assert.match(view.host.textContent!, /Передай задачу воркеру/);
      await act(async () => { button.click(); });
      assert.equal(moves.length, 1);
      assert.deepEqual(moves[0], ['project', 'task', { targetStatus: 'todo', beforeTaskId: null, afterTaskId: null }]);
      assert.equal(button.disabled, true);
      assert.equal(button.textContent, 'Задача в очереди');
      assert.match(view.host.textContent!, /ожидает запуска/);
      await view.render({ ...props, canEdit: false });
      assert.equal(view.host.querySelector('[data-pf-worker-start]'), null);
    } finally { await view.close(); }
  }
});

test('a small upward wheel gesture pauses LIVE following before scroll fires; jump only moves the chat', async () => {
  const View = await component('LiveTab');
  state.container = {
    liveRepository: { async listSessions() { return [run('wheel-run', 1, 'running')]; }, async listEvents() { return [event(1, 'Начало', 1)]; }, async listFileDiffs() { return []; }, async listRunningTaskIds() { return []; } },
    taskRepository: { async listComments() { return []; } }, projectRepository: { async listMembers() { return []; } },
  };
  const props = { task: { id: 'task', projectId: 'project', status: 'in_progress' } as Task, backlogTail: null, todoTail: null };
  const view = await mount(View, props);
  try {
    const feed = view.host.querySelector<HTMLElement>('[data-pf-worker-chat]')!;
    let contentHeight = 1600;
    Object.defineProperties(feed, { clientHeight: { value: 300 }, scrollHeight: { get: () => contentHeight } });
    view.host.style.overflowY = 'auto';
    Object.defineProperties(view.host, { clientHeight: { value: 500 }, scrollHeight: { value: 2000 } });
    view.host.scrollTop = 240;
    await act(async () => { view.host.querySelector<HTMLButtonElement>('[aria-label="К последнему сообщению"]')!.click(); });
    const original = feed.scrollTop;
    const wheel = new WheelEvent('wheel', { deltaY: -12, bubbles: true, cancelable: true });
    // Incoming actions can arrive before the browser emits its native scroll event.
    await act(async () => {
      feed.dispatchEvent(wheel);
      contentHeight += 200;
      Source.instances.at(-1)!.emit('live', { ...event(2, 'Новая строка', 2), createdAt: at(2).toISOString() });
    });
    assert.equal(wheel.defaultPrevented, false, 'wheel remains native');
    assert.equal(feed.scrollTop, original, 'LIVE updates do not cancel the upward gesture');
    await act(async () => { feed.scrollTop = contentHeight - 300 - 12; feed.dispatchEvent(new Event('scroll')); });
    const reading = feed.scrollTop;
    await act(async () => {
      contentHeight += 100;
      Source.instances.at(-1)!.emit('live', { ...event(3, 'Ещё строка', 3), createdAt: at(3).toISOString() });
    });
    assert.equal(feed.scrollTop, reading, 'reading even 12px above the end stays in place');
    await act(async () => { view.host.querySelector<HTMLButtonElement>('[aria-label="К последнему сообщению"]')!.click(); });
    assert.equal(feed.scrollTop, contentHeight);
    assert.equal(view.host.scrollTop, 240, 'jump does not move the outer task panel');
  } finally { await view.close(); }
});

test('the task page passes the decoded comment anchor to the task drawer', async () => {
  const Page = await component('TaskDetailPage');
  state.params = { projectId: 'project', taskId: 'task' };
  state.location = { hash: '#comment-comment%20id' };
  state.container = { taskRepository: { async get() { return { id: 'task', projectId: 'project', description: 'Задача', canEdit: true }; }, async list() { return []; } } };
  const view = await mount(Page);
  try {
    assert.equal(view.host.querySelector('[data-comment-target]')?.getAttribute('data-comment-target'), 'comment id');
    state.location = { hash: '#comment-next' }; await view.render();
    assert.equal(view.host.querySelector('[data-comment-target]')?.getAttribute('data-comment-target'), 'next');
    state.location = { hash: '#comment-next', key: 'reopen-same-comment' }; await view.render();
    assert.equal(view.host.querySelector('[data-comment-target]')?.getAttribute('data-comment-navigation'), 'reopen-same-comment');
  } finally { await view.close(); }
});

test('a missed lifecycle event is recovered on focus and a late previous-task response cannot replace the open chat', async () => {
  const View = await component('LiveTab');
  let oldResponse: (sessions: LiveSession[]) => void = () => {};
  let sessions: LiveSession[] = [];
  state.container = {
    liveRepository: {
      async listSessions(_projectId: string, taskId: string) { if (taskId === 'old') return new Promise<LiveSession[]>(resolve => { oldResponse = resolve; }); return sessions; },
      async listEvents() { return [event(4, 'Автоматически подхваченный запуск', 4)]; }, async listFileDiffs() { return []; },
    },
    taskRepository: { async listComments() { return []; } }, projectRepository: { async listMembers() { return []; } },
  };
  const props = { task: { id: 'old', projectId: 'project', status: 'todo' }, backlogTail: null, todoTail: null };
  const view = await mount(View, props);
  try {
    await view.render({ ...props, task: { ...props.task, id: 'task' } });
    await act(async () => { oldResponse([run('private-old', 1, 'completed')]); });
    assert.equal(view.host.querySelector('[data-worker-run]'), null);
    sessions = [run('recovered', 4, 'running')];
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    assert.match(view.host.textContent ?? '', /Автоматически подхваченный запуск/);
    assert.equal(view.host.querySelector('[data-worker-run="private-old"]'), null);
  } finally { await view.close(); }
});

test('cards recover worker activity, errors and questions from one project snapshot and update after an answer', async () => {
  const Badge = await component('WorkerActivityBadge');
  let calls = 0;
  const activity = (taskId: string, kind: TaskWorkerActivity['state']): TaskWorkerActivity => ({ taskId, state: kind, sessionId: null, questionCommentId: kind === 'question' ? 'question-comment' : null });
  let active = [activity('task', 'running')];
  state.container = { liveRepository: { async listTaskActivity() { calls++; return active; } } };
  const Pair = () => React.createElement(React.Fragment, null, React.createElement(Badge, { projectId: 'project', taskId: 'task' }), React.createElement(Badge, { projectId: 'project', taskId: 'other' }));
  const view = await mount(Pair);
  try {
    assert.equal(calls, 1);
    assert.equal(view.host.querySelectorAll('[aria-label="Воркер работает над задачей"]').length, 1);
    active = [activity('task', 'error')];
    await act(async () => { window.dispatchEvent(new CustomEvent('pf:live-changed', { detail: { projectId: 'project', taskId: 'task', status: 'failed' } })); });
    assert.equal(view.host.querySelector('[data-worker-state="error"]')?.textContent, 'Ошибка воркера');
    active = [activity('task', 'error'), activity('other', 'question')];
    await act(async () => { window.dispatchEvent(new CustomEvent('pf:task-changed', { detail: { projectId: 'project' } })); });
    assert.match(view.host.textContent ?? '', /Вопрос диспетчера/);
    active = [activity('task', 'running')];
    await act(async () => { window.dispatchEvent(new CustomEvent('pf:task-changed', { detail: { projectId: 'project' } })); });
    assert.doesNotMatch(view.host.textContent ?? '', /Вопрос диспетчера|Ошибка воркера/);
    active = [];
    await act(async () => { window.dispatchEvent(new CustomEvent('pf:live-changed', { detail: { projectId: 'project', taskId: 'task', status: 'completed' } })); });
    assert.equal(view.host.textContent, '');
    active = [activity('other', 'running')];
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    assert.match(view.host.textContent ?? '', /Воркер работает/);
  } finally { await view.close(); }
});

test('new chat offers photo generation and Enter creates only an image job, retaining the mode after navigation', async () => {
  const Page = await component('AiPage');
  const images: unknown[] = [], texts: unknown[] = [];
  state.params = {}; state.location = {};
  state.navigate = (_url: string, options: unknown) => { state.navigation = options; };
  state.container = {
    aiConversationRepository: { async create() { return { id: 'new-photo', version: 1 }; }, async sendMessage(...args: unknown[]) { texts.push(args); } },
    imageGenerationRepository: { async create(...args: unknown[]) { images.push(args); return { id: 'image' }; } },
  };
  const view = await mount(Page);
  try {
    await act(async () => { [...view.host.querySelectorAll('button')].find(b => b.textContent === 'Генерация фото' && b.hasAttribute('aria-pressed'))!.click(); });
    const editor = view.host.querySelector('[role="textbox"]')!;
    await act(async () => { editor.textContent = 'Фото кружки'; editor.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    assert.deepEqual(images, [['Фото кружки', 'new-photo']]); assert.deepEqual(texts, []);
    assert.deepEqual(state.navigation, { state: { imageMode: true } });
    state.params = { conversationId: 'new-photo' }; state.location = state.navigation;
    await view.render(); assert.match(view.host.textContent ?? '', /Режим фото/);
  } finally { await view.close(); }
});

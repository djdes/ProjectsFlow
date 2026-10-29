import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { WorkspaceTasksResult } from '@/application/task/ListWorkspaceTasks';
import type { AssignedTask } from '@/domain/task/AssignedTask';
const { createRoot } = await import('react-dom/client');
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const context = {
  pathname: '/all-tasks', navigations: [] as string[], selected: { id: 'selected', name: 'Выбранное', icon: null },
  workspaces: [{ id: 'selected', name: 'Выбранное', icon: null }, { id: 'other', name: 'Другая команда', icon: null }],
  results: [] as WorkspaceTasksResult[], calls: [] as string[][],
};
Object.assign(globalThis, { __workspaceTasks: context });
const stubs: Record<string, string> = {
  'react-router-dom': `import React from 'react'; const c=()=>globalThis.__workspaceTasks;
    export const useLocation=()=>({pathname:c().pathname}), useNavigate=()=>to=>c().navigations.push(to), useNavigationType=()=>'PUSH';
    export const Link=({to,...p})=>React.createElement('a',{...p,href:to}), NavLink=Link;`,
  '@/infrastructure/di/container': `const listWorkspaceTasks={execute:async ids=>{
    const c=globalThis.__workspaceTasks;c.calls.push(ids);return c.results;
  }};export const useContainer=()=>({listWorkspaceTasks,aiConversationRepository:{}});`,
  '@/presentation/hooks/useWorkspaces': 'export const useWorkspaces=()=>({data:globalThis.__workspaceTasks.workspaces});',
  '@/presentation/hooks/useCurrentWorkspace': 'export const useCurrentWorkspace=()=>({workspace:globalThis.__workspaceTasks.selected});',
  '@/presentation/hooks/useCurrentUser': "export const useCurrentUser=()=>({user:{id:'me',isAdmin:false,displayName:'Я'}});",
  '@/presentation/hooks/useProjects': 'export const useProjects=()=>({data:[]});',
  '@/presentation/hooks/useChatRooms': 'export const useActiveChatUnread=()=>0;',
  '@/presentation/hooks/UnreadTasksProvider': 'export const useUnreadTasks=()=>({count:0});',
  '@/presentation/hooks/useAiConversations': 'export const announceAiConversationsChanged=()=>{};',
  '@/presentation/components/motion/MotionProvider': 'export const useMotion=()=>({animations:false});',
  '@/presentation/components/forms/NewProjectDialogProvider': 'export const useNewProjectDialog=()=>({open:()=>{}});',
  '@/presentation/components/forms/AddTaskDialogProvider': 'export const useAddTaskDialog=()=>({open:()=>{}});',
  '@/presentation/components/search/GlobalSearchProvider': 'export const useGlobalSearch=()=>({open:()=>{}});',
  '@/presentation/components/experience/usePageRefresh': 'export const usePageRefresh=()=>{};',
  '@/presentation/hooks/useInboxRealtimeRefresh': 'export const useInboxRealtimeRefresh=()=>{};',
  '@/presentation/layout/PageChrome': `import React from 'react';export const PageTitle=({children})=>React.createElement('h1',null,children),
    PageTopBar=({children})=>React.createElement('header',null,children);`,
  '@/presentation/components/loading/LoadingLayouts': "import React from 'react';export const PageSkeleton=()=>React.createElement('div',{role:'status'},'Загрузка');",
  '@/presentation/components/tasks/TaskTitleText': "import React from 'react';export const TaskTitleText=({title})=>React.createElement('span',null,title);",
  '@/presentation/chat/CommunicationPanel': 'export const CommunicationPanel=()=>null;',
  '@/presentation/notifications/NotificationsBell': 'export const NotificationsBell=()=>null;',
  '@/components/ui/sonner': 'export const toast={error:()=>{}};',
  './SidebarProjectList': 'export const SidebarProjectList=()=>null;',
  './WorkspaceSwitcher': 'export const WorkspaceSwitcher=()=>null;',
};
const compiled = await build({
  stdin: { contents: "export { AllWorkspaceTasksPage } from './AllWorkspaceTasksPage'; export { Sidebar } from '../layout/Sidebar'; export { MobileBottomNav } from '../layout/MobileBottomNav';", resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  tsconfig: fileURLToPath(new URL('../../../tsconfig.app.json', import.meta.url)),
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  plugins: [{ name: 'workspace-task-ports', setup(bundler) {
    bundler.onResolve({ filter: /.*/ }, (args) => {
      const path = stubs[args.path] ? args.path : args.path.endsWith('/MotionProvider') ? '@/presentation/components/motion/MotionProvider' : null;
      return path ? { path, namespace: 'workspace-test' } : undefined;
    });
    bundler.onLoad({ filter: /.*/, namespace: 'workspace-test' }, (args) => ({ loader: 'js', contents: stubs[args.path]! }));
  } }],
});
const loaded = { exports: {} as Record<string, React.ComponentType> };
new Function('module', 'exports', 'require', compiled.outputFiles[0]!.text)(loaded, loaded.exports, createRequire(import.meta.url));
async function mount(component: string) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(loaded.exports[component]!)));
  return { host, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test('global overview renders all tasks, coworkers and completed tasks under their own workspace/project', async () => {
  const tasks = Array.from({ length: 8 }, (_, index) => ({ id: `task-${index}`, projectId: 'other-project', projectName: 'Одинаковый проект',
    description: `Задача ${index}`, status: index === 7 ? 'done' : 'todo', deadline: null,
    assignee: { userId: 'other', displayName: 'Коллега', avatarUrl: null }, createdAt: new Date() } as AssignedTask));
  context.calls = [];
  context.results = [{ workspaceId: 'selected', status: 'ready', groups: [{ projectId: 'my-project', projectName: 'Одинаковый проект', tasks: [] }] },
    { workspaceId: 'other', status: 'ready', groups: [{ projectId: 'other-project', projectName: 'Одинаковый проект', tasks }] }];
  const view = await mount('AllWorkspaceTasksPage');
  try {
    assert.deepEqual(context.calls[0], ['selected', 'other']);
    const other = view.host.querySelector('[data-pf-workspace-tasks=other]')!;
    assert.equal(other.querySelectorAll('[data-pf-global-task-id]').length, 8);
    assert.match(other.textContent!, /Коллега/); assert.match(other.textContent!, /Готово/);
    assert.equal(view.host.querySelector('[data-pf-workspace-tasks=selected]')!.querySelectorAll('[data-pf-global-task-id]').length, 0);
    assert.equal(context.selected.id, 'selected');
    assert.equal(other.querySelector('a')!.getAttribute('href'), '/projects/other-project/tasks/task-0');
  } finally { await view.close(); }
});

test('a failed workspace stays visible with a retry instead of hiding missing tasks', async () => {
  context.results = [{ workspaceId: 'selected', status: 'ready', groups: [] }, { workspaceId: 'other', status: 'error' }];
  const view = await mount('AllWorkspaceTasksPage');
  try {
    const other = view.host.querySelector('[data-pf-workspace-tasks=other]')!;
    assert.match(other.querySelector('[role=alert]')!.textContent!, /Не удалось загрузить задачи/);
    assert.equal(other.querySelector('button')!.textContent, 'Повторить');
  } finally { await view.close(); }
});

test('desktop home and globe navigate independently while preserving the selected workspace', async () => {
  context.navigations = []; context.pathname = '/all-tasks';
  const view = await mount('Sidebar');
  try {
    const home = view.host.querySelector<HTMLButtonElement>('button[aria-label=Выбранное]')!;
    const globe = view.host.querySelector<HTMLButtonElement>('button[aria-label="Все задачи"]')!;
    assert.equal(globe.getAttribute('aria-current'), 'page');
    assert.equal(home.getAttribute('aria-current'), null);
    await act(async () => home.click()); await act(async () => globe.click());
    assert.deepEqual(context.navigations, ['/', '/all-tasks']);
    assert.equal(context.selected.id, 'selected');
  } finally { await view.close(); }
});

test('mobile navigation has separate home and globe destinations', async () => {
  context.navigations = []; context.pathname = '/projects/p';
  const view = await mount('MobileBottomNav');
  try {
    await act(async () => view.host.querySelector<HTMLButtonElement>('[data-pf-route="/"]')!.click());
    const globalButton = view.host.querySelector<HTMLButtonElement>('[data-pf-route="/all-tasks"]')!;
    assert.equal(globalButton.getAttribute('aria-label'), 'Все задачи');
    await act(async () => globalButton.click());
    assert.deepEqual(context.navigations, ['/', '/all-tasks']);
  } finally { await view.close(); }
});

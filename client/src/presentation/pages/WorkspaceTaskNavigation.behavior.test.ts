import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const { createRoot } = await import('react-dom/client');
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const context = {
  pathname: '/all-tasks', navigations: [] as string[], selected: { id: 'selected', name: 'Выбранное', icon: null },
  workspaces: [{ id: 'selected', name: 'Выбранное', icon: null }, { id: 'other', name: 'Другая команда', icon: null }],
  workspaceError: null as Error | null,
};
Object.assign(globalThis, { __workspaceTasks: context });
const stubs: Record<string, string> = {
  'react-router-dom': `import React from 'react'; const c=()=>globalThis.__workspaceTasks;
    export const useLocation=()=>({pathname:c().pathname}), useNavigate=()=>to=>c().navigations.push(to), useNavigationType=()=>'PUSH';
    export const Link=({to,...p})=>React.createElement('a',{...p,href:to}), NavLink=Link;`,
  '@/infrastructure/di/container': `import React from 'react'; const Scope=React.createContext('');
    export const useContainer=()=>({aiConversationRepository:{}}), useTestWorkspace=()=>React.useContext(Scope);
    export const WorkspaceContainerProvider=({workspaceId,children})=>React.createElement(Scope.Provider,{value:workspaceId},children);`,
  '@/presentation/hooks/useWorkspaces': 'export const useWorkspaces=()=>({data:globalThis.__workspaceTasks.workspaces,error:globalThis.__workspaceTasks.workspaceError});',
  '@/presentation/hooks/WorkspacesProvider': 'export const WorkspaceViewProvider=({children})=>children;',
  '@/presentation/hooks/ProjectsProvider': 'export const ProjectsProvider=({children})=>children;',
  '@/presentation/hooks/FocusedInboxProvider': 'export const FocusedInboxProvider=({children})=>children;',
  '@/presentation/hooks/CompletedTodayProvider': 'export const CompletedTodayProvider=({children})=>children;',
  '@/presentation/hooks/AwaitingReplyProvider': 'export const AwaitingReplyProvider=({children})=>children;',
  './InboxPage': `import React from 'react'; import {useTestWorkspace} from '@/infrastructure/di/container';
    export const InboxPage=({embedded})=>React.createElement('div',{'data-reused-inbox':useTestWorkspace(),'data-embedded':embedded},'Доска пространства');`,
  '@/presentation/hooks/useCurrentWorkspace': 'export const useCurrentWorkspace=()=>({workspace:globalThis.__workspaceTasks.selected});',
  '@/presentation/hooks/useCurrentUser': "export const useCurrentUser=()=>({user:{id:'me',isAdmin:false,displayName:'Я'}});",
  '@/presentation/hooks/useProjects': 'export const useProjects=()=>({data:[]});',
  '@/presentation/hooks/useChatRooms': 'export const useActiveChatUnread=()=>0;',
  '@/presentation/hooks/UnreadTasksProvider': 'export const useUnreadTasks=()=>({count:0});export const UnreadTasksProvider=({children})=>children;',
  '@/presentation/hooks/useAiConversations': 'export const announceAiConversationsChanged=()=>{};',
  '@/presentation/components/motion/MotionProvider': 'export const useMotion=()=>({animations:false});',
  '@/presentation/components/forms/NewProjectDialogProvider': 'export const useNewProjectDialog=()=>({open:()=>{}});',
  '@/presentation/components/forms/AddTaskDialogProvider': 'export const useAddTaskDialog=()=>({open:()=>{}});export const AddTaskDialogProvider=({children})=>children;',
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

test('the globe reuses the workspace board in a separate scope for every workspace', async () => {
  const view = await mount('AllWorkspaceTasksPage');
  try {
    const boards = [...view.host.querySelectorAll('[data-reused-inbox]')];
    assert.deepEqual(boards.map((board) => board.getAttribute('data-reused-inbox')), ['selected', 'other']);
    assert.ok(boards.every((board) => board.getAttribute('data-embedded') === 'true'));
    assert.equal(view.host.querySelectorAll('[data-pf-global-task-id]').length, 0);
    assert.equal(context.selected.id, 'selected');
  } finally { await view.close(); }
});

test('workspace list errors remain explicit instead of silently claiming a complete overview', async () => {
  context.workspaceError = new Error('offline');
  const view = await mount('AllWorkspaceTasksPage');
  try { assert.match(view.host.querySelector('[role=alert]')!.textContent!, /Не удалось обновить/); }
  finally { context.workspaceError = null; await view.close(); }
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

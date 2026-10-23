import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('invitation routes recipients to auth, prefills email and retains the return target', async () => {
  const scope = globalThis as typeof globalThis & { __inviteAuth: unknown };
  const navigations: string[] = [];
  const context = {
    status: 'anonymous',
    location: { pathname: '/invite/token', search: '', state: null },
    navigate: (to: string) => navigations.push(to),
    preview: { kind: 'workspace', targetName: 'Команда', role: 'editor', inviteEmail: 'friend+team@example.test', authMode: 'register', expiresAt: new Date() },
    repository: { getPreview: async () => context.preview },
  };
  scope.__inviteAuth = context;
  const result = await build({
    stdin: {
      contents: "export { InvitePage } from './InvitePage'; export { LoginPage } from './LoginPage'; export { RegisterPage } from './RegisterPage';",
      resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    },
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    tsconfig: fileURLToPath(new URL('../../../tsconfig.app.json', import.meta.url)),
    external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'invite-auth-ports', setup(bundler) {
      bundler.onResolve({ filter: /^(react-router-dom|@\/infrastructure\/di\/container|@\/presentation\/auth\/AuthProvider)$/ }, args => ({ path: args.path, namespace: 'invite-auth-test' }));
      bundler.onLoad({ filter: /.*/, namespace: 'invite-auth-test' }, args => ({
        loader: 'js', contents: args.path === 'react-router-dom'
          ? `import React from 'react'; const c=()=>globalThis.__inviteAuth;
             export const useLocation=()=>c().location, useNavigate=()=>c().navigate, useParams=()=>({token:'token'});
             export const Link=({to,state,...props})=>React.createElement('a',{...props,href:to,'data-return':state?.from});`
          : args.path.endsWith('AuthProvider')
            ? 'export const useAuth=()=>globalThis.__inviteAuth;'
            : 'export const useContainer=()=>({inviteRepository:globalThis.__inviteAuth.repository});',
      }));
    } }],
  });
  const module = { exports: {} as Record<string, React.ComponentType> };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const render = async (name: string) => {
    await act(async () => { root.render(React.createElement(module.exports[name], { key: `${name}-${context.preview.authMode}` })); });
  };
  try {
    await render('InvitePage');
    let target = new URL(navigations.pop()!, 'https://app.test');
    assert.equal(target.pathname, '/register');
    assert.equal(target.searchParams.get('email'), context.preview.inviteEmail);
    assert.equal(target.searchParams.get('next'), '/invite/token');

    context.preview = { ...context.preview, authMode: 'login' };
    await render('InvitePage');
    target = new URL(navigations.pop()!, 'https://app.test');
    assert.equal(target.pathname, '/login');

    context.location = { pathname: target.pathname, search: target.search, state: null };
    for (const page of ['LoginPage', 'RegisterPage']) {
      await render(page);
      assert.equal(host.querySelector<HTMLInputElement>('#email')?.value, context.preview.inviteEmail);
      const alternate = host.querySelector<HTMLAnchorElement>(page === 'LoginPage' ? 'a[href^="/register"]' : 'a[href^="/login"]');
      assert.equal(new URL(alternate!.getAttribute('href')!, 'https://app.test').searchParams.get('next'), '/invite/token');
      assert.equal(alternate!.getAttribute('data-return'), '/invite/token');
    }

    context.status = 'authenticated';
    navigations.length = 0;
    await render('InvitePage');
    assert.equal(navigations.length, 0, 'authenticated recipients stay on the acceptance screen');
    assert.ok([...host.querySelectorAll('button')].some(button => button.textContent?.includes('Принять')));
  } finally {
    await act(async () => { root.unmount(); }); host.remove();
  }
});

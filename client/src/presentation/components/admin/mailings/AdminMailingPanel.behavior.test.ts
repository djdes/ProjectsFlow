import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { MailingRepository } from '@/application/mailing/MailingRepository';
import type { MailingCampaign, MailingDraftInput, MailingOverview } from '@/domain/mailing/Mailing';
import { emptyMailingCounts } from '../../../../domain/mailing/Mailing';
const { MemoryRouter } = createRequire(import.meta.url)('react-router-dom') as typeof import('react-router-dom');
const { createRoot } = await import('react-dom/client');
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const scope = globalThis as typeof globalThis & { __mailingUi: { repository: Partial<MailingRepository>; admin: boolean; errors: string[] } };
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('./AdminMailingPanel.tsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  tsconfig: fileURLToPath(new URL('../../../../../tsconfig.app.json', import.meta.url)),
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-router-dom'],
  plugins: [{ name: 'mailing-ui-ports', setup(bundler) {
    bundler.onResolve({ filter: /(^@\/infrastructure\/di\/container$|AuthProvider$|MotionProvider$|^@\/components\/ui\/sonner$)/ }, args => ({ path: args.path, namespace: 'mailing-test' }));
    bundler.onLoad({ filter: /.*/, namespace: 'mailing-test' }, args => ({ loader: 'js', contents:
      args.path.endsWith('container') ? 'export const useContainer=()=>({mailingRepository:globalThis.__mailingUi.repository});'
        : args.path.endsWith('AuthProvider') ? 'export const useAuth=()=>({user:{id:"admin",isAdmin:globalThis.__mailingUi.admin}});'
          : args.path.endsWith('MotionProvider') ? 'export const useMotion=()=>({animations:false});'
            : 'export const toast={success:()=>{},error:(value)=>globalThis.__mailingUi.errors.push(value)};',
    }));
  } }],
});
const loaded = { exports: {} as { AdminMailingPanel: React.ComponentType } };
new Function('module', 'exports', 'require', compiled.outputFiles[0]!.text)(loaded, loaded.exports, createRequire(import.meta.url));
const overview: MailingOverview = { channels: { email: true, site: true, telegram: false }, settings: { enabled: true, perMinute: 30, perDay: 1000 },
  bases: [{ id: 'users:all', title: 'Все пользователи', description: 'Пользователи платформы', total: 2 }], campaigns: [], sentToday: 0 };
const campaign = (input: MailingDraftInput): MailingCampaign => ({ ...input, id: 'saved', revision: 1, status: 'draft', createdById: 'admin', createdByName: 'Администратор', createdAt: '2026-11-02T09:00Z', updatedAt: '2026-11-02T09:00Z', scheduledAt: null, startedAt: null, finishedAt: null, counts: emptyMailingCounts() });
async function mount(repository: Partial<MailingRepository>, admin = true) {
  scope.__mailingUi = { repository, admin, errors: [] };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/admin?tab=mailings'] }, React.createElement(loaded.exports.AdminMailingPanel))));
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
  return { host, button, click: (element: HTMLElement) => act(async () => { assert.ok(element, 'control exists'); element.click(); }),
    wait: (ms = 350) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }),
    close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test('non-admin UI denies access without loading any mailing data', async () => {
  let reads = 0; const view = await mount({ overview: async () => { reads++; return overview; } }, false);
  try { assert.match(view.host.textContent!, /только администраторам/); assert.equal(reads, 0); }
  finally { await view.close(); }
});

test('overview errors expose a retry and recover into the empty history', async () => {
  let fail = true; const view = await mount({ overview: async () => { if (fail) throw new Error('Сервис временно недоступен'); return overview; }, reach: async () => ({ recipients: 0, deliveries: 0, skipped: 0, byChannel: { email: 0, site: 0, telegram: 0 } }) });
  try {
    assert.match(view.host.querySelector('[role=alert]')!.textContent!, /временно недоступен/);
    fail = false; await view.click(view.button('Повторить')); await view.click(view.button('История'));
    assert.match(view.host.textContent!, /История пока пуста/);
  } finally { await view.close(); }
});

test('quick send preserves edits across navigation, previews safely and requires confirmation with a double-submit lock', async () => {
  const saves: MailingDraftInput[] = []; const launches: unknown[][] = []; let saved!: MailingCampaign; let finish!: () => void;
  const repository: Partial<MailingRepository> = { overview: async () => overview,
    reach: async input => ({ recipients: input.audience.baseIds.length ? 2 : 0, deliveries: input.audience.baseIds.length ? 2 : 0, skipped: 0, byChannel: { email: input.audience.baseIds.length ? 2 : 0, site: 0, telegram: 0 } }),
    preview: async input => ({ subject: input.content.subject, html: '<p>Проверенное письмо</p>', text: 'Проверенное письмо', buttonUrl: input.content.buttonUrl }),
    save: async input => { saves.push(structuredClone(input)); saved = campaign(input); return saved; },
    launch: async (...args) => { launches.push(args); await new Promise<void>(resolve => { finish = resolve; }); return { ...saved, status: 'sending' }; },
    details: async () => ({ campaign: { ...saved, status: 'sending' }, deliveries: { items: [], total: 0, page: 1, pageSize: 50 } }),
  };
  const view = await mount(repository);
  try {
    assert.equal(view.button('Отправить').disabled, true);
    const label = [...view.host.querySelectorAll<HTMLLabelElement>('label')].find(l => l.textContent?.startsWith('Все пользователи'))!;
    await view.click(document.getElementById(label.htmlFor)!);
    await view.click([...view.host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(b => b.textContent?.includes('Знакомство с ProjectsFlow'))!);
    await view.wait(); assert.equal(view.button('Отправить').disabled, false);
    const iframe = view.host.querySelector('iframe')!; assert.equal(iframe.getAttribute('sandbox'), ''); assert.equal(iframe.getAttribute('referrerpolicy'), 'no-referrer');
    await view.click(view.button('Расширенный режим')); await view.click(view.button('История')); await view.click(view.button('Быстрая отправка')); await view.wait();
    assert.match(view.host.textContent!, /Получателей: 2/);
    await view.click(view.button('Отправить')); assert.equal(launches.length, 0); assert.equal(saves.length, 0);
    assert.match(document.querySelector('[role=dialog]')!.textContent!, /реальная рассылка/);
    const confirm = view.button('Подтвердить отправку'); await view.click(confirm); await view.click(confirm);
    assert.equal(launches.length, 1); assert.equal(saves.length, 1); assert.deepEqual(saves[0]!.audience.baseIds, ['users:all']);
    assert.deepEqual(launches[0], ['saved', 1, null]); assert.equal(confirm.disabled, true);
    await act(async () => finish()); assert.equal(document.querySelector('[role=dialog]'), null);
    assert.match(view.host.textContent!, /Отправляется/); assert.deepEqual(scope.__mailingUi.errors, []);
  } finally { await view.close(); }
});

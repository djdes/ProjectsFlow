import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import React, { act } from 'react';
import type { DeploymentStatus } from '@/domain/deployment/DeploymentStatus';
const { createRoot } = await import('react-dom/client');
const { DeploymentStatusNotice } = await import('./PlatformUpdateNotice');
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const oldRevision = 'a'.repeat(40), nextRevision = 'b'.repeat(40);
beforeEach(() => { try { localStorage.clear(); } catch { /* storage unavailable */ } });

const base: DeploymentStatus = { phase: 'checking', runId: 'run', attempt: 1, targetRevision: nextRevision, deployedRevision: oldRevision,
  startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), checkedAt: new Date().toISOString(), stale: false };

test('indicator follows real phases, preserves an uncertain status and reloads only after the user clicks', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let reloads = 0;
  const show = (patch: Partial<DeploymentStatus>, observedRun: string | null = 'run:1') => act(async () => root.render(
    React.createElement(DeploymentStatusNotice, { status: { ...base, ...patch }, browserBuild: oldRevision.slice(0, 7), observedRun, onReload: () => { reloads++; } })));
  try {
    for (const [phase, label] of [['queued', 'Ожидаем запуска'], ['checking', 'Проверяем изменения'], ['building', 'Собираем новую версию'], ['deploying', 'Устанавливаем новую версию'], ['verifying', 'Подтверждаем публикацию']] as const) {
      await show({ phase, deployedRevision: nextRevision }); assert.match(host.textContent ?? '', new RegExp(label));
      assert.ok(host.querySelector('[aria-label="Скрыть статус обновления"]'), 'a running deployment can be hidden: it takes ~10 minutes');
      assert.doesNotMatch(host.textContent ?? '', /Сайт обновлён|\d+%/);
      assert.ok(![...host.querySelectorAll('button')].some(button => button.textContent?.includes('Обновить')), 'an installed client artifact must not offer a reload before CI finishes');
    }
    await show({ phase: 'deploying', stale: true });
    assert.match(host.textContent ?? '', /Статус временно недоступен/);
    assert.equal(host.querySelector('[data-active]')?.getAttribute('data-active'), 'false');
    await show({ phase: 'unknown', deployedRevision: nextRevision });
    assert.match(host.textContent ?? '', /Проверяем статус/);
    assert.doesNotMatch(host.textContent ?? '', /Сайт обновлён/);
    await show({ phase: 'success', deployedRevision: nextRevision });
    assert.match(host.textContent ?? '', /Сайт обновлён/); assert.equal(reloads, 0);
    const refresh = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Обновить'));
    assert.ok(refresh); await act(async () => refresh.click()); assert.equal(reloads, 1);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Скрыть статус обновления"]')!.click());
    assert.equal(host.textContent, '');
    await show({ runId: 'next-run', phase: 'failed' }); assert.match(host.textContent ?? '', /Не удалось завершить обновление/);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('the installed current version and an unknown initial state do not show an update banner', async () => {
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    for (const status of [null, { ...base, phase: 'idle' as const }, { ...base, phase: 'success' as const }, { ...base, phase: 'unknown' as const, stale: true, runId: null }]) {
      await act(async () => root.render(React.createElement(DeploymentStatusNotice, { status, browserBuild: oldRevision.slice(0, 7), observedRun: null, onReload: () => {} })));
      assert.equal(host.textContent, '');
    }
  } finally { await act(async () => root.unmount()); }
});

test('a hidden running deployment stays hidden for that run, across phases and remounts, but its result still shows', async () => {
  const mount = () => { const host = document.createElement('div'); document.body.append(host); return { host, root: createRoot(host) }; };
  const render = (target: ReturnType<typeof mount>, patch: Partial<DeploymentStatus>) => act(async () => target.root.render(
    React.createElement(DeploymentStatusNotice, { status: { ...base, ...patch }, browserBuild: oldRevision.slice(0, 7), observedRun: 'run:1', onReload: () => {} })));
  const first = mount();
  try {
    await render(first, { phase: 'checking' });
    await act(async () => first.host.querySelector<HTMLButtonElement>('[aria-label="Скрыть статус обновления"]')!.click());
    assert.equal(first.host.textContent, '');
    await render(first, { phase: 'building' });
    assert.equal(first.host.textContent, '', 'the next phase of the same run does not bring the hidden notice back');
    await render(first, { phase: 'deploying', stale: true });
    assert.equal(first.host.textContent, '', 'a temporarily unavailable status of the same run stays hidden too');
  } finally { await act(async () => first.root.unmount()); first.host.remove(); }

  const second = mount();
  try {
    await render(second, { phase: 'deploying' });
    assert.equal(second.host.textContent, '', 'hiding survives a reload / remount of the shell');
    await render(second, { phase: 'success', deployedRevision: nextRevision });
    assert.match(second.host.textContent ?? '', /Сайт обновлён/, 'the outcome is a new message: the reload offer still shows');
    await render(second, { runId: 'next-run', phase: 'checking' });
    assert.match(second.host.textContent ?? '', /Проверяем изменения/, 'a new deployment shows again');
  } finally { await act(async () => second.root.unmount()); second.host.remove(); }
});

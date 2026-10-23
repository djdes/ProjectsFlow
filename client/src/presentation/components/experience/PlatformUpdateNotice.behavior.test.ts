import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import type { DeploymentStatus } from '@/domain/deployment/DeploymentStatus';
const { createRoot } = await import('react-dom/client');
const { DeploymentStatusNotice } = await import('./PlatformUpdateNotice');
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const oldRevision = 'a'.repeat(40), nextRevision = 'b'.repeat(40);
const base: DeploymentStatus = { phase: 'checking', runId: 'run', attempt: 1, targetRevision: nextRevision, deployedRevision: oldRevision,
  startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), checkedAt: new Date().toISOString(), stale: false };

test('indicator follows real phases, preserves an uncertain status and reloads only after the user clicks', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let reloads = 0;
  const show = (patch: Partial<DeploymentStatus>, observedRun: string | null = 'run:1') => act(async () => root.render(
    React.createElement(DeploymentStatusNotice, { status: { ...base, ...patch }, browserBuild: oldRevision.slice(0, 7), observedRun, onReload: () => { reloads++; } })));
  try {
    for (const [phase, label] of [['queued', 'Ожидаем запуска'], ['checking', 'Проверяем изменения'], ['building', 'Собираем новую версию'], ['deploying', 'Устанавливаем новую версию'], ['verifying', 'Подтверждаем публикацию']] as const) {
      await show({ phase }); assert.match(host.textContent ?? '', new RegExp(label));
      assert.equal(host.querySelector('[aria-label="Скрыть статус обновления"]'), null);
      assert.doesNotMatch(host.textContent ?? '', /Сайт обновлён|\d+%/);
    }
    await show({ phase: 'deploying', stale: true });
    assert.match(host.textContent ?? '', /Статус временно недоступен/);
    assert.equal(host.querySelector('[data-active]')?.getAttribute('data-active'), 'false');
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

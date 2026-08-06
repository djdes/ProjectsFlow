import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useFlashExitPhase, type UseFlashExitPhaseResult } from './useFlashExitPhase';

// Ревью стейджа 2 (BUG A): эффект фазового движка раньше держал в зависимостях весь
// изменчивый объект (item/onAccept), а не стабильный ключ. Любой сторонний refresh()
// (соседняя карточка, SSE-эхо, mount/visibilitychange) пересобирает список задач и меняет
// ССЫЛКУ на item у ВСЕХ смонтированных карточек — эффект перезапускался, clearTimeout
// отменял уже тикающий таймер 200/300мс, и он взводился заново. В худшем случае карточка
// визуально исчезала (opacity-0/0fr), а onCommit (move→done) так и не вызывался.
//
// Тест ниже гоняет реальный React-рендер (happy-dom + act, как InboxCheckbox.rollback.test.ts):
// хук нельзя корректно проверить как чистую функцию — сама суть бага в поведении ДВУХ
// useEffect (обновление ref без deps + фазовый переход с deps) на живых таймерах React.

type Handle = { current: UseFlashExitPhaseResult | null };

function Harness({
  onCommit,
  handle,
}: {
  onCommit: () => Promise<void>;
  handle: Handle;
}): React.ReactElement {
  const result = useFlashExitPhase('task-1', onCommit, () => {});
  handle.current = result;
  return React.createElement('span', { 'data-phase': result.phase });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('useFlashExitPhase: повторяющаяся смена ссылки onCommit посреди анимации НЕ перезапускает таймер', async () => {
  // Одной смены ссылки недостаточно, чтобы отличить «ref внутри хука» от бага «весь
  // onCommit в deps»: в обоих случаях итоговая задержка отличается лишь на десятки мс
  // (сдвиг момента смены), и любой достаточно щедрый таймаут-порог пройдёт оба варианта.
  // Дискриминатор — ЧАСТЫЕ повторные рендеры (как реальные refresh() каждые ~250мс от
  // SSE-эха + соседние карточки + mount/focus): если эффект перезапускается на КАЖДОЙ
  // новой ссылке, а рендеры идут чаще, чем 200мс flash-окно, — таймер вообще не успевает
  // достичь exit/commit, пока рендеры не прекратятся. С фиксом (ref, не deps) рендеры
  // никак не влияют на уже тикающий таймер — коммит происходит строго ~500мс от start().
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const handle: Handle = { current: null };

  let commitCalls = 0;
  let lastCommitAt = 0;
  const makeCommit = (n: number) => async (): Promise<void> => {
    commitCalls += 1;
    lastCommitAt = Date.now();
    void n;
  };

  await act(async () => {
    root.render(React.createElement(Harness, { onCommit: makeCommit(0), handle }));
  });

  const startedAt = Date.now();
  await act(async () => {
    handle.current?.start();
  });
  assert.equal(handle.current?.phase, 'flash');

  // 6 рендеров каждые ~60мс (0..300мс) — каждый несёт НОВУЮ ссылку на onCommit, как если
  // бы соседняя карточка/SSE-эхо/mount непрерывно пересобирали approvalTasks. 60мс короче
  // 200мс-окна flash, так что баг «весь onCommit в deps» держал бы таймер в вечном сбросе
  // всё это время.
  for (let i = 1; i <= 6; i += 1) {
    await wait(60);
    await act(async () => {
      root.render(React.createElement(Harness, { onCommit: makeCommit(i), handle }));
    });
  }
  // Реальное время на этот момент ~360мс от start() — фикс уже должен быть в фазе exit
  // (200мс flash истёк на ~200мс, независимо от рендеров).
  assert.equal(handle.current?.phase, 'exit');

  // Ждём заведомо меньше, чем потребовалось бы БАГОВОЙ версии на «остыть» после последнего
  // сброса (последний рендер на ~360мс + полные 200+300мс с нуля = ~860мс), но заведомо
  // больше, чем нужно исправленной версии (500мс от start(), т.е. ~140мс от текущего
  // момента). Если тест это ловит — обычная одноразовая проверка избыточна.
  await wait(250);
  await act(async () => {
    await Promise.resolve();
  });

  assert.equal(commitCalls, 1, 'коммит должен произойти РОВНО один раз, несмотря на серию рендеров с новыми ссылками');
  const elapsed = lastCommitAt - startedAt;
  assert.ok(
    elapsed < 700,
    `коммит должен произойти ~500мс от start(), а не после «остывания» от последнего рендера (~860мс при перезапуске таймера); фактически ${elapsed}мс`,
  );

  await act(async () => {
    root.unmount();
  });
  host.remove();
});

test('useFlashExitPhase: ошибка onCommit откатывает фазу в idle', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const handle: Handle = { current: null };
  const onCommit = async (): Promise<void> => {
    throw new Error('boom');
  };

  await act(async () => {
    root.render(React.createElement(Harness, { onCommit, handle }));
  });
  await act(async () => {
    handle.current?.start();
  });
  assert.equal(handle.current?.phase, 'flash');

  await wait(600);
  await act(async () => {
    await Promise.resolve();
  });

  assert.equal(handle.current?.phase, 'idle');

  await act(async () => {
    root.unmount();
  });
  host.remove();
});

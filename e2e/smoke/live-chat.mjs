import { readFileSync } from 'node:fs';
import { BOARD_PROJECT_ID, ME, firstLine } from './fixtures.mjs';

async function openLive(t) {
  // A running session adds «LIVE-сессия запущена» to the tab name.
  await t.page.getByRole('tab', { name: /^LIVE/ }).click();
  const feed = t.page.locator('[data-pf-worker-chat]');
  await t.visible(feed, 'лента LIVE');
  await t.waitFor(async () => feed.evaluate(el => el.clientHeight >= 120), 'LIVE схлопнулся: высота ленты меньше 120px');
  return feed;
}

export const liveChatScenarios = [{
  id: 'live-chat', title: 'LIVE: высота, колесо, стрелка и передача черновика воркеру',
  matrix: [['desktop', 'light'], ['phone', 'dark']],
  async run(t) {
    const task = t.state.tasks.find(item => item.id === 't-home');
    const sessionId = 'smoke-completed-worker';
    const date = new Date().toISOString();
    t.state.liveSessions = { [task.id]: [{ id: sessionId, taskId: task.id, projectId: BOARD_PROJECT_ID,
      agentName: 'ralph-worker', attempt: 1, status: 'completed', model: null, headBefore: null, headAfter: null,
      costUsd: null, tokensIn: null, tokensOut: null, eventCount: 80, lastSeq: 80, startedAt: date, endedAt: date }] };
    t.state.liveEvents = { [sessionId]: Array.from({ length: 80 }, (_, index) => ({ seq: index + 1, kind: 'assistant_text',
      text: `Проверка LIVE: строка ${index + 1}. История работы воркера остаётся видимой.`, payload: null, createdAt: date })) };
    await t.goto(`/projects/${BOARD_PROJECT_ID}`, { ready: () => t.page.locator(`[data-pf-task-id="${task.id}"]`) });
    await t.page.locator(`[data-pf-task-id="${task.id}"]`).getByText(firstLine(task), { exact: true }).first().click();
    await t.visible(t.page.getByRole('dialog'), 'окно задачи');
    const feed = await openLive(t);
    await t.step('история и кнопка передачи видны в узком окне', async () => {
      await t.visible(t.page.getByText('Проверка LIVE: строка 80.', { exact: false }), 'последняя запись');
      await t.visible(t.page.getByRole('button', { name: 'Сделать с помощью воркера', exact: true }), 'явная кнопка передачи');
      await t.waitFor(async () => feed.evaluate(el => el.scrollHeight > el.clientHeight + 200), 'лента не получила ограниченную область прокрутки');
    });
    await t.step('нативная прокрутка вверх и переход к последнему сообщению', async () => {
      const jump = t.page.getByRole('button', { name: 'К последнему сообщению', exact: true });
      await jump.click();
      await t.waitFor(async () => feed.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop <= 2), 'стрелка не дошла до конца');
      const before = await feed.evaluate(el => el.scrollTop);
      if (t.isMobile) { await feed.focus(); await t.page.keyboard.press('PageUp'); }
      else { await feed.hover(); await t.page.mouse.wheel(0, -360); }
      await t.waitFor(async () => (await feed.evaluate(el => el.scrollTop)) < before - 20, 'чат не прокручивается вверх');
      const box = await jump.boundingBox(), viewport = await feed.boundingBox();
      t.assert(box && viewport && box.y >= viewport.y && box.y + box.height <= viewport.y + viewport.height + 2, 'стрелка вышла за видимый край чата');
      await jump.click();
      await t.waitFor(async () => feed.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop <= 2), 'повторный переход вниз не сработал');
      await t.screenshot('live-drawer');
    });
    await t.page.keyboard.press('Escape');
    await t.hidden(t.page.getByRole('dialog'), 'окно закрыто');
    t.state.liveSessions = {}; t.state.liveEvents = {};
    await t.goto(`/projects/${BOARD_PROJECT_ID}/tasks/${task.id}`, { ready: () => t.page.locator('[data-pf-task-properties]') });
    await openLive(t);
    await t.step('пустой LIVE сохраняет высоту и сразу подтверждает передачу', async () => {
      await t.visible(t.page.getByText('Воркер ещё не запускался по этой задаче.', { exact: true }), 'пояснение пустого LIVE');
      const button = t.page.getByRole('button', { name: 'Сделать с помощью воркера', exact: true });
      await t.visible(button, 'кнопка первого запуска');
      await button.click();
      await t.waitForMutation(m => m.path === `/projects/${BOARD_PROJECT_ID}/tasks/${task.id}/move` && m.body?.targetStatus === 'todo', 'задача не передана воркеру');
      await t.visible(t.page.getByRole('button', { name: 'Задача в очереди', exact: true }), 'подтверждение постановки в очередь');
      await t.screenshot('live-empty-queued');
    });
  },
}];

// ---- Roles of the orchestrator pipeline (§6 of the 2026-11-17 worker orchestrator spec) ----

const ORCHESTRATOR_RUN = JSON.parse(readFileSync(new URL('./live-orchestrator-run.json', import.meta.url), 'utf8'));

const liveSession = (task, id, agentName, status, startedAt, endedAt, lastSeq) => ({
  id, taskId: task.id, projectId: task.projectId, agentName, attempt: 1, status, model: status === 'running' ? null : 'gpt-6.1-sol',
  headBefore: null, headAfter: null, costUsd: null, tokensIn: null, tokensOut: null, eventCount: lastSeq, lastSeq,
  startedAt: startedAt.toISOString(), endedAt: endedAt ? endedAt.toISOString() : null,
});

// An old ralph-worker run with the content that used to break the feed: long Windows
// paths, unbroken commands and URLs, a long tool brief, a tool error and the final result.
export function legacyWorkerEvents(start) {
  const at = (s) => new Date(start.getTime() + s * 1000).toISOString();
  const longPath = String.raw`C:\ralph\workspaces\projectsflow\client\src\presentation\components\tasks\WorkerOrchestratorTimelineGroupHeader.tsx`;
  const rows = [
    ['assistant_text', 'Проверяю ленту: файл `' + longPath + '` и адрес https://projectsflow.ru/projects/9f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b/tasks/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d?tab=live&session=7e8f9a0b-1c2d-3e4f-5a6b-7c8d9e0f1a2b', null],
    ['tool_use', null, { name: 'read', brief: longPath }],
    ['bash', null, { command: 'node --import tsx --test client/src/presentation/components/tasks/workerChat.behavior.test.ts --test-name-pattern="a small upward wheel gesture pauses LIVE following before scroll fires"' }],
    ['file_edit', null, { path: longPath, edits: [{ old: 'const DOM_CAP = 300;', new: 'const DOM_CAP = 300; // ' + 'очень-длинный-комментарий-без-пробелов-'.repeat(4) }] }],
    ['tool_error', 'ENOENT:no_such_file_or_directory,open\'' + longPath.replaceAll('\\', '/') + '.snapshot\'', null],
    ['assistant_text', 'Готово: лента не переполняется, старые сессии выглядят как раньше.\n{"status":"done","summary":"Исправил переполнение длинных путей в LIVE.","sha":"3c9e1d2","question_id":""}', null],
  ];
  return rows.map(([kind, text, payload], index) => ({ seq: index + 1, kind, text, payload, createdAt: at(index * 7) }));
}

export function orchestratorEvents(start) {
  return ORCHESTRATOR_RUN.events.map((event, index) => ({
    seq: index + 1, kind: event.kind, text: event.text ?? null, payload: event.payload ?? null,
    createdAt: new Date(start.getTime() + event.at * 1000).toISOString(),
  }));
}

async function liveShot(t, name) {
  await t.page.evaluate(() => document.fonts?.ready);
  await t.screenshot(name);
}

export const liveRolesScenarios = [{
  id: 'live-roles', title: 'LIVE: роли конвейера и старая сессия воркера',
  matrix: [['desktop', 'light'], ['phone', 'light'], ['desktop', 'dark'], ['phone', 'dark']],
  async run(t) {
    const task = t.state.tasks.find(item => item.id === 't-home');
    task.status = 'in_progress';
    const now = Date.now();
    const legacyStart = new Date(now - 60 * 60_000);
    const legacy = legacyWorkerEvents(legacyStart);
    const legacySession = liveSession(task, 'smoke-legacy-worker', 'ralph-worker', 'completed', legacyStart, new Date(legacyStart.getTime() + 60_000), legacy.length);
    t.state.liveSessions = { [task.id]: [legacySession] };
    t.state.liveEvents = { [legacySession.id]: legacy };
    await t.goto(`/projects/${BOARD_PROJECT_ID}/tasks/${task.id}`, { ready: () => t.page.locator('[data-pf-task-properties]') });
    await openLive(t);
    await t.step('старая сессия ralph-worker', async () => {
      await t.visible(t.page.getByText('Исправил переполнение длинных путей в LIVE.', { exact: false }), 'итог старой сессии');
      await liveShot(t, 'legacy');
    });
    await t.pageChecks('старая сессия LIVE');

    const roleStart = new Date(now - 13 * 60_000);
    const events = orchestratorEvents(roleStart);
    const roleSession = liveSession(task, 'smoke-orchestrator', ORCHESTRATOR_RUN.agentName, 'running', roleStart, null, events.length);
    t.state.liveSessions = { [task.id]: [roleSession] };
    t.state.liveEvents = { [roleSession.id]: events };
    await t.goto(`/projects/${BOARD_PROJECT_ID}/tasks/${task.id}`, { ready: () => t.page.locator('[data-pf-task-properties]') });
    const feed = await openLive(t);
    // On a phone the remembered LIVE tab opens below the task properties.
    await t.page.locator('[data-pf-live-panel]').evaluate(el => el.scrollIntoView({ block: 'end' }));
    await t.step('шкала этапов: всё пройдено, идёт проверка версии', async () => {
      const stepper = t.page.locator('[data-pf-pipeline-stepper]');
      await t.visible(stepper, 'шкала этапов');
      const states = await stepper.locator('[data-stage]').evaluateAll(steps => steps.map(step => step.getAttribute('data-state')).join(' '));
      t.assert(states === 'passed passed passed passed passed passed active', `состояния этапов: ${states}`);
      await t.visible(stepper.getByText('Проверка версии · идёт', { exact: true }), 'подпись текущего этапа');
      const box = await stepper.boundingBox(), viewport = t.page.viewportSize();
      t.assert(box && box.x >= 0 && box.x + box.width <= viewport.width + 1, 'шкала этапов шире экрана');
    });
    await t.step('лента конвейера: хвост', async () => {
      await t.visible(t.page.getByText('Расчёт скидки в одном месте', { exact: false }), 'итоговый вердикт ревьюера');
      // One line per stage entry: the start and its result share it, only the current one spins.
      const publish = await t.page.locator('[data-live-stage="publish"]').evaluateAll(lines => lines.map(line => `${line.getAttribute('data-live-stage-status')}|${line.textContent}`));
      t.assert(publish.length === 1 && publish[0].startsWith('passed|Публикация — Коммит 3c9e1d2'), `строки публикации: ${publish.join(' / ')}`);
      t.assert(await t.page.locator('[data-live-stage-status="started"]').count() === 1, 'незакрытой осталась не одна строка этапа');
      await t.visible(t.page.locator('[data-pf-live-spinner]').getByText('Проверка версии…', { exact: true }), 'спиннер называет текущий этап');
      await t.visible(t.page.locator('[data-worker-run]').getByText(/Конвейер · попытка 1 · идёт$/), 'подпись запуска конвейера');
      await liveShot(t, 'roles-tail');
    });
    await t.step('лента конвейера: середина и начало', async () => {
      await feed.evaluate(el => { el.scrollTop = el.scrollHeight * 0.45; });
      await liveShot(t, 'roles-middle');
      await t.page.locator('[data-live-verdict="changes"]').first().evaluate(el => el.scrollIntoView({ block: 'start' }));
      await liveShot(t, 'roles-review-changes');
      await feed.evaluate(el => { el.scrollTop = 0; });
      await liveShot(t, 'roles-head');
    });
    await t.step('журнал раунда и хвост вывода проверки раскрываются', async () => {
      const journal = t.page.locator('[data-live-journal="1"] > button');
      await t.visible(journal, 'журнал раунда 1');
      t.assert((await journal.textContent()).includes('Раунд 1 · правки: 2 файла, команд: 2'), 'сводка журнала раунда 1');
      await journal.click();
      await t.visible(t.page.locator('[data-live-journal="1"]').getByText('dotnet build src/Shop.Web/Shop.Web.csproj -c Release', { exact: false }), 'команда в журнале');
      const failed = t.page.locator('[data-live-check="tests"][data-live-check-passed="false"] > button');
      await failed.click();
      await t.visible(t.page.getByText('PromoCode_IgnoresDeliveryPrice [12 ms]', { exact: false }), 'хвост вывода упавшей проверки');
      await failed.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await liveShot(t, 'roles-expanded');
    });
    await t.pageChecks('лента конвейера');

    // Inline code is shared Markdown: the discussion tab outside LIVE must render it too.
    const created = new Date(now - 5 * 60_000).toISOString();
    t.state.comments = { ...(t.state.comments ?? {}), [task.id]: [{
      id: 'c-smoke-inline-code', taskId: task.id, ownerUserId: ME.id, actorKind: 'user', agentName: null,
      body: 'Проверь `CheckoutService.ApplyPromo` — там скидка от `order.Total`.\n\n```\ndotnet test --filter PricingServiceTests\n```',
      notifyMode: 'none', replyToCommentId: null, quotedText: null, createdAt: created, updatedAt: created, attachments: [], acknowledgements: [],
    }] };
    await t.goto(`/projects/${BOARD_PROJECT_ID}/tasks/${task.id}`, { ready: () => t.page.locator('[data-pf-task-properties]') });
    await t.page.getByRole('tab', { name: /^Обсуждение/ }).click();
    await t.step('инлайн-код в обсуждении без обратных кавычек', async () => {
      const code = t.page.locator('code', { hasText: 'CheckoutService.ApplyPromo' }).first();
      await t.visible(code, 'инлайн-код в комментарии');
      const look = await code.evaluate(el => ({
        before: getComputedStyle(el, '::before').content, after: getComputedStyle(el, '::after').content,
        weight: getComputedStyle(el).fontWeight, background: getComputedStyle(el).backgroundColor,
      }));
      t.assert(['none', 'normal'].includes(look.before) && ['none', 'normal'].includes(look.after), `кавычки вокруг кода: ${look.before} ${look.after}`);
      t.assert(Number(look.weight) <= 400, `код жирный: ${look.weight}`);
      t.assert(look.background !== 'rgba(0, 0, 0, 0)', 'у инлайн-кода нет подложки');
      await code.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await liveShot(t, 'discussion-inline-code');
    });
    await t.pageChecks('обсуждение с инлайн-кодом');
  },
}];

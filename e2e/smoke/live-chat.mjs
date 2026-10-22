import { BOARD_PROJECT_ID, firstLine } from './fixtures.mjs';

async function openLive(t) {
  await t.page.getByRole('tab', { name: 'LIVE', exact: true }).click();
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

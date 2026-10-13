import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import test from 'node:test';
import express from 'express';
import {EmailActionService} from '../../application/email-action/EmailActionService.js';
import {TelegramDigestActionService} from '../../application/digest/TelegramDigestActionService.js';
import {emailActionsRouter} from './routes.js';
import {telegramDigestActionsRouter} from '../telegramDigestActions/routes.js';

for (const route of ['email', 'telegram'] as const) {
  test(`${route} action page shows actual approval outcome on first and repeated clicks`, async () => {
    let usedAt: Date | null = null;
    let status = 'pending_approval';
    let moves = 0;
    const service = new EmailActionService({
      tokens: {findByToken: async () => ({id: 'token', userId: 'employee', taskId: 'task', projectId: 'project', action: 'complete', expiresAt: new Date(10000), usedAt}), markUsed: async (_id: string, date: Date) => {usedAt = date;}} as never,
      tasks: {getById: async () => ({id: 'task', description: 'Проверить отчёт', status})} as never,
      moveTask: {execute: async (input: {ownerUserId: string}) => {assert.equal(input.ownerUserId, 'employee'); moves++; return {status};}} as never,
      createTaskComment: {} as never, now: () => new Date(1000),
    });
    const app = express();
    app.use('/actions', route === 'email' ? emailActionsRouter({service, appUrl: 'https://pf.test'}) : telegramDigestActionsRouter({service: new TelegramDigestActionService({emailActions: service, deliveries: {findByToken: async () => null} as never, telegram: {} as never})}));
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/actions/token`;
    try {
      for (let i = 0; i < 2; i++) {
        const response = await fetch(url, {method: 'POST'});
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.match(html, /утверждени/);
        assert.doesNotMatch(html, /Задача (?:уже была )?завершена/);
        assert.doesNotMatch(html, /window.close/);
      }
      assert.equal(moves, 1, 'used tokens must not submit or approve twice');
      const getHtml = await (await fetch(url)).text();
      assert.doesNotMatch(getHtml, /уже завершена/);
      status = 'done';
      const approved = await fetch(url, {method: 'POST'});
      assert.match(await approved.text(), /[Зз]адача (?:уже была )?завершена/);
      status = 'manual';
      const reopened = await fetch(url, {method: 'POST'});
      const reopenedHtml = await reopened.text();
      assert.match(reopenedHtml, /Ссылка уже использована/);
      assert.doesNotMatch(reopenedHtml, /Задача (?:уже была )?завершена/);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
}
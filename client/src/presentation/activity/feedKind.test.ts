import test from 'node:test';
import assert from 'node:assert/strict';
import type { NotificationPayload } from '@/domain/notifications/Notification';
import { feedActorName, feedProjectName, notificationDetail, notificationKind } from './feedKind';

const taskChanged = (action: string, taskAvailable = true) =>
  ({ type: 'task_changed', action, taskAvailable }) as unknown as NotificationPayload;

test('вид уведомления виден меткой: новая задача, комментарий, утверждение', () => {
  // 16.10.2026: в колокольчике не было понятно, что за уведомление — вид прятался в серой строке.
  assert.equal(notificationKind(taskChanged('created')).label, 'Новая задача');
  assert.equal(notificationKind(taskChanged('commented')).label, 'Комментарий');
  assert.equal(notificationKind(taskChanged('approval_requested')).tone, 'approval');
  assert.equal(notificationKind(taskChanged('updated', false)).label, 'Ушла от вас');
  assert.equal(notificationKind({ type: 'join_request' } as NotificationPayload).label, 'Запрос доступа');
  assert.equal(notificationKind({ type: 'close_proposal' } as unknown as NotificationPayload).label, 'Уведомление');
});

test('детали уведомления — одна строка и без сроков', () => {
  // 16.10.2026: «не показывай в уведомлениях сроки, нужно меньше инфы».
  assert.equal(notificationDetail('created', 'Исполнитель: Олег Боев\nСрок до: 23.10.2026'), 'Исполнитель: Олег Боев');
  assert.equal(notificationDetail('updated', 'Срок до: 12.10.2026 → 20.10.2026'), 'Изменён срок');
  assert.equal(notificationDetail('updated', 'Статус: Черновики → На утверждении\nИзменены вложения'), 'Статус: Черновики → На утверждении');
  assert.equal(notificationDetail('created', 'Срок до: не указан'), '');
});

test('служебные имена — по-человечески', () => {
  assert.equal(feedProjectName('inbox:65db53ef-b4e7-46f0-bd0b-6a3083292aed'), 'Входящие');
  assert.equal(feedProjectName('managermagday'), 'managermagday');
  assert.equal(feedActorName('telegram-composer'), 'Бот Telegram');
});

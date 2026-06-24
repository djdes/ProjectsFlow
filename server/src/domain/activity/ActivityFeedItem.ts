import type { ActivityEvent } from './ActivityEvent.js';
import type { Notification } from '../notifications/Notification.js';

// Элемент объединённой ленты «Все»: либо амбиентное действие, либо адресное уведомление.
// createdAt вынесен наверх для единой сортировки источников по времени.
export type ActivityFeedItem =
  | { readonly type: 'activity'; readonly createdAt: Date; readonly event: ActivityEvent }
  | { readonly type: 'notification'; readonly createdAt: Date; readonly notification: Notification };

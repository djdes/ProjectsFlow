import type { Notification } from '@/domain/notifications/Notification';

export interface NotificationRepository {
  // actionableOnly — только с действием (приглашения, запросы доступа): «Ждут ответа».
  // mineOnly — «Для меня»: личные виды и задачи, где я исполнитель или автор.
  list(opts: { unreadOnly: boolean; limit: number; actionableOnly?: boolean; mineOnly?: boolean }): Promise<Notification[]>;
  // since — бейдж колокольчика: новые с прошлого просмотра + неотвеченные приглашения.
  countUnread(opts?: { since?: Date; mineOnly?: boolean }): Promise<number>;
  // Непрочитанные actionable-уведомления (инвайты/join) — бейдж «Действие».
  countActionableUnread(): Promise<number>;
  markRead(id: string): Promise<void>;
  // Приглашения и запросы доступа не трогает — они уходят только ответом.
  markAllRead(): Promise<number>;
}

import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import type { MonitoringAlertNotifier } from './MonitoringAlertNotifier.js';
import type { ServerAlert } from '../../domain/monitoring/Alert.js';
import type { ProjectServer } from '../../domain/monitoring/ProjectServer.js';
import type { Project } from '../../domain/project/Project.js';

type Deps = {
  readonly notifications: NotificationRepository;
  readonly sendTelegram: SendAgentTelegramNotification;
  readonly idGen: () => string;
};

// Доставляет алерты мониторинга владельцу проекта: in-app (SSE через PublishingNotificationRepository)
// + Telegram. Мониторинг owner-only → получатель = project.ownerId. Best-effort по каждому каналу.
export class AlertNotificationDispatcher implements MonitoringAlertNotifier {
  constructor(private readonly deps: Deps) {}

  async notify(input: {
    readonly server: ProjectServer;
    readonly project: Project;
    readonly alert: ServerAlert;
  }): Promise<void> {
    const { server, project, alert } = input;
    const recipient = project.ownerId;

    // In-app: создаём notification (хаб сам push'нёт по SSE).
    try {
      await this.deps.notifications.create({
        id: this.deps.idGen(),
        userId: recipient,
        payload: {
          type: 'server_alert',
          projectId: project.id,
          projectName: project.name,
          serverId: server.id,
          serverName: server.name,
          alertId: alert.id,
          ruleKind: alert.ruleKind,
          severity: alert.severity,
          alertStatus: alert.status,
          message: alert.message,
        },
      });
    } catch (err) {
      console.warn('[monitoring-alert] in-app notify failed:', err);
    }

    // Telegram: best-effort. Critical-firing шлём минуя prefs (override).
    const icon = alert.status === 'resolved' ? '✅' : alert.severity === 'critical' ? '🔴' : '🟠';
    const head = alert.status === 'resolved' ? 'Решено' : 'Алерт';
    const text =
      `${icon} <b>${head}</b> · ${escapeHtml(server.name)}\n` +
      `${escapeHtml(alert.message)}\n` +
      `<i>${escapeHtml(project.name)}</i>`;
    try {
      await this.deps.sendTelegram.execute({
        userId: recipient,
        text,
        kind: 'server_alert',
        skipDedupCheck: true,
        skipPrefsCheck: alert.severity === 'critical' && alert.status === 'firing',
      });
    } catch (err) {
      console.warn('[monitoring-alert] telegram notify failed:', err);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

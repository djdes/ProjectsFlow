import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import { resolvePref } from '../../domain/notifications/NotificationPrefs.js';
import { renderActivityEmail } from '../notifications/emails/activityEmail.js';
import type { MonitoringAlertNotifier } from './MonitoringAlertNotifier.js';
import type { ServerAlert } from '../../domain/monitoring/Alert.js';
import type { ProjectServer } from '../../domain/monitoring/ProjectServer.js';
import type { Project } from '../../domain/project/Project.js';

type Deps = {
  readonly notifications: NotificationRepository;
  readonly sendTelegram: SendAgentTelegramNotification;
  readonly members: ProjectMemberRepository;
  readonly email: EmailSender;
  readonly idGen: () => string;
  readonly appUrl: string;
};

// Доставляет алерты мониторинга ВСЕМ участникам проекта: in-app (SSE) + Telegram (всегда)
// + email (только firing, по per-member prefs 'server_alert'). Critical-firing в TG идёт
// минуя prefs. Всё best-effort по каждому каналу/получателю.
export class AlertNotificationDispatcher implements MonitoringAlertNotifier {
  constructor(private readonly deps: Deps) {}

  async notify(input: {
    readonly server: ProjectServer;
    readonly project: Project;
    readonly alert: ServerAlert;
  }): Promise<void> {
    const { server, project, alert } = input;
    const isFiring = alert.status === 'firing';
    const critical = alert.severity === 'critical' && isFiring;
    const monitoringUrl = `${this.deps.appUrl}/projects/${project.id}/monitoring`;

    const icon = alert.status === 'resolved' ? '✅' : alert.severity === 'critical' ? '🔴' : '🟠';
    const head = alert.status === 'resolved' ? 'Решено' : 'Алерт';
    const tgText =
      `${icon} <b>${head}</b> · ${escapeHtml(server.name)}\n` +
      `${escapeHtml(alert.message)}\n` +
      `<i>${escapeHtml(project.name)}</i>`;

    const inApp = async (userId: string): Promise<void> => {
      try {
        await this.deps.notifications.create({
          id: this.deps.idGen(),
          userId,
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
    };

    const tg = async (userId: string): Promise<void> => {
      try {
        await this.deps.sendTelegram.execute({
          userId,
          text: tgText,
          kind: 'server_alert',
          skipDedupCheck: true,
          skipPrefsCheck: critical,
        });
      } catch (err) {
        console.warn('[monitoring-alert] telegram notify failed:', err);
      }
    };

    const members = await this.deps.members.listByProject(project.id).catch(() => []);
    // Fallback: если участников почему-то нет — хотя бы владельцу (in-app + TG).
    if (members.length === 0) {
      await inApp(project.ownerId);
      await tg(project.ownerId);
      return;
    }

    for (const m of members) {
      await inApp(m.userId);
      await tg(m.userId);
      // Email: только на firing, по per-member pref (дефолт on для действий 'team').
      if (isFiring && m.user.email && resolvePref(m.notificationPrefs, 'server_alert', 'team')) {
        try {
          await this.deps.email.send(
            renderActivityEmail({
              to: m.user.email,
              type: 'server_alert',
              projectName: project.name,
              actorDisplayName: server.name,
              detail: alert.message,
              ctaUrl: monitoringUrl,
              ctaLabel: 'Открыть мониторинг',
            }),
          );
        } catch (err) {
          console.warn('[monitoring-alert] email notify failed:', err);
        }
      }
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

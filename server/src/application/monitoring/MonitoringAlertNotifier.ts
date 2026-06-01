import type { ServerAlert } from '../../domain/monitoring/Alert.js';
import type { ProjectServer } from '../../domain/monitoring/ProjectServer.js';
import type { Project } from '../../domain/project/Project.js';

// Доставка алерта получателям (in-app + Telegram). Реализация —
// AlertNotificationDispatcher. EvaluateAlerts зовёт это на firing/resolved.
export interface MonitoringAlertNotifier {
  notify(input: {
    readonly server: ProjectServer;
    readonly project: Project;
    readonly alert: ServerAlert;
  }): Promise<void>;
}

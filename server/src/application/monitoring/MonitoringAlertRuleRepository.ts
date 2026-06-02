import type { AlertKind, AlertSeverity } from '../../domain/monitoring/Alert.js';

export type AlertRuleRow = {
  readonly ruleKind: AlertKind;
  readonly enabled: boolean;
  readonly threshold: number | null;
  readonly severity: AlertSeverity;
};

// Per-project оверрайды правил алертов (таблица server_alert_rules). Дефолты — в коде
// (alertRules.ts); тут только строки-оверрайды, которые юзер задал в UI.
export interface MonitoringAlertRuleRepository {
  listByProject(projectId: string): Promise<AlertRuleRow[]>;
  upsert(projectId: string, rule: AlertRuleRow): Promise<void>;
}

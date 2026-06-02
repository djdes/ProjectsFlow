import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { serverAlertRules } from '../db/schema.js';
import type {
  AlertRuleRow,
  MonitoringAlertRuleRepository,
} from '../../application/monitoring/MonitoringAlertRuleRepository.js';
import type { AlertKind, AlertSeverity } from '../../domain/monitoring/Alert.js';

export class DrizzleMonitoringAlertRuleRepository implements MonitoringAlertRuleRepository {
  constructor(private readonly db: Database) {}

  async listByProject(projectId: string): Promise<AlertRuleRow[]> {
    const rows = await this.db
      .select()
      .from(serverAlertRules)
      .where(eq(serverAlertRules.projectId, projectId));
    return rows.map((r) => ({
      ruleKind: r.ruleKind as AlertKind,
      enabled: r.enabled,
      threshold: r.threshold ?? null,
      severity: r.severity as AlertSeverity,
    }));
  }

  async upsert(projectId: string, rule: AlertRuleRow): Promise<void> {
    await this.db
      .insert(serverAlertRules)
      .values({
        projectId,
        ruleKind: rule.ruleKind,
        enabled: rule.enabled,
        threshold: rule.threshold,
        severity: rule.severity,
      })
      .onDuplicateKeyUpdate({
        set: { enabled: rule.enabled, threshold: rule.threshold, severity: rule.severity },
      });
  }
}

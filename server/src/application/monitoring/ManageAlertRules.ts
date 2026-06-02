import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type {
  AlertRuleRow,
  MonitoringAlertRuleRepository,
} from './MonitoringAlertRuleRepository.js';
import type { AlertKind, AlertSeverity } from '../../domain/monitoring/Alert.js';
import { DEFAULT_RULE_CONFIG } from '../../domain/monitoring/alertRules.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly rules: MonitoringAlertRuleRepository;
};

const ALL_KINDS: AlertKind[] = [
  'process_down',
  'disk_usage',
  'restart_spike',
  'snapshot_stale',
  'http_down',
  'ssl_expiry',
];

function defaultSeverity(kind: AlertKind): AlertSeverity {
  return kind === 'process_down' || kind === 'http_down' ? 'critical' : 'warning';
}

// Чтение/запись per-project порогов алертов. get отдаёт смердженный набор (дефолты +
// оверрайды) для всех 4 правил — UI рисует форму. save апдейтит оверрайды (editor+).
export class ManageAlertRules {
  constructor(private readonly deps: Deps) {}

  async get(projectId: string, userId: string): Promise<AlertRuleRow[]> {
    await requireProjectAccess(this.deps, projectId, userId, 'view_monitoring');
    const overrides = await this.deps.rules.listByProject(projectId);
    const byKind = new Map(overrides.map((o) => [o.ruleKind, o]));
    return ALL_KINDS.map((kind) => {
      const ov = byKind.get(kind);
      return {
        ruleKind: kind,
        enabled: ov?.enabled ?? true,
        threshold: ov?.threshold ?? DEFAULT_RULE_CONFIG[kind].threshold,
        severity: ov?.severity ?? defaultSeverity(kind),
      };
    });
  }

  async save(projectId: string, userId: string, rules: AlertRuleRow[]): Promise<AlertRuleRow[]> {
    await requireProjectAccess(this.deps, projectId, userId, 'manage_monitoring');
    for (const r of rules) {
      if (!ALL_KINDS.includes(r.ruleKind)) continue;
      await this.deps.rules.upsert(projectId, r);
    }
    return this.get(projectId, userId);
  }
}

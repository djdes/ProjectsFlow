import { moscowDateOnly } from '../../domain/time/moscowDate.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import { renderLeadDigestEmail } from '../notifications/emails/leadDigestEmail.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import { buildLeadDigest, renderLeadDigestTelegram } from './buildLeadDigest.js';

type Deps = {
  readonly members: Pick<ProjectMemberRepository, 'listLeadUserIds'>;
  readonly projects: Pick<ProjectRepository, 'listByWorkspace'>;
  readonly tasks: Pick<TaskRepository, 'listByProjects'>;
  readonly users: Pick<UserRepository, 'getById'>;
  readonly workspaces: Pick<WorkspaceRepository, 'getById'>;
  readonly telegram: Pick<SendAgentTelegramNotification, 'execute'>;
  readonly email: EmailSender;
  readonly appUrl: string;
  readonly now?: () => Date;
};

export type LeadDigestSendResult = {
  readonly recipients: number;
  readonly activeCount: number;
  readonly overdueCount: number;
};

/**
 * Ежедневная сводка руководителям пространства: загрузка по людям + просрочки.
 *
 * Доставка адресная — личный чат каждого руководителя с ботом и его почта. Групповые
 * чаты не задействованы вообще: по требованию заказчика командная картина не должна
 * попадать в общие каналы (см. спеку §3).
 */
export class SendLeadDigest {
  constructor(private readonly deps: Deps) {}

  async execute(workspaceId: string): Promise<LeadDigestSendResult> {
    const leadIds = await this.deps.members.listLeadUserIds(workspaceId);
    if (leadIds.length === 0) return { recipients: 0, activeCount: 0, overdueCount: 0 };

    const workspace = await this.deps.workspaces.getById(workspaceId);
    const projects = await this.deps.projects.listByWorkspace(workspaceId);
    // listByProjects отдаёт только живые задачи (deleted_at IS NULL).
    const tasks =
      projects.length === 0
        ? []
        : await this.deps.tasks.listByProjects(projects.map((p) => p.id));

    const model = buildLeadDigest({
      workspaceName: workspace?.name ?? 'Пространство',
      dateMsk: moscowDateOnly((this.deps.now ?? (() => new Date()))()),
      tasks,
      projectNameById: new Map(projects.map((p) => [p.id, p.name])),
    });

    const text = renderLeadDigestTelegram(model);
    let recipients = 0;
    for (const leadId of leadIds) {
      const lead = await this.deps.users.getById(leadId);
      if (!lead) continue;
      recipients += 1;
      // Telegram и почта независимы: нет привязки к боту — остаётся письмо, и наоборот.
      const sent = await this.deps.telegram
        .execute({ userId: leadId, text, parseMode: 'HTML', kind: 'lead_digest' })
        .catch((error: unknown) => {
          console.warn('[lead-digest] telegram failed', leadId, error);
          return null;
        });
      if (sent === null) {
        // уже залогировано
      }
      await this.deps.email
        .send(renderLeadDigestEmail({ to: lead.email, model, appUrl: this.deps.appUrl }))
        .catch((error: unknown) => console.warn('[lead-digest] email failed', leadId, error));
    }

    return {
      recipients,
      activeCount: model.activeCount,
      overdueCount: model.overdue.length,
    };
  }
}

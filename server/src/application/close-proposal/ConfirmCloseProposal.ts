import type { CloseProposal } from '../../domain/close-proposal/CloseProposal.js';
import { CloseProposalNotFoundError } from '../../domain/close-proposal/errors.js';
import type { CloseProposalRepository } from './CloseProposalRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskApprovalService } from '../task/TaskApprovalService.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { LinkCommit } from '../task/LinkCommit.js';

export type ConfirmCloseProposalResult =
  | { readonly status: 'confirmed'; readonly proposal: CloseProposal; readonly taskId: string }
  // Уже разрешено (кем-то или ранее) — идемпотентный no-op.
  | { readonly status: 'already_resolved'; readonly proposal: CloseProposal }
  // Caller не участник проекта — 403.
  | { readonly status: 'not_member' };

type Deps = {
  readonly closeProposals: CloseProposalRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  // Проект нужен, чтобы решить про приёмку (флаг живёт у пространства проекта).
  readonly projects: ProjectRepository;
  readonly approval: TaskApprovalService;
  // Привязать коммит к задаче (видимая ссылка). Best-effort, сбой не валит подтверждение.
  readonly linkCommit?: LinkCommit;
};

// Подтверждение предложения закрыть задачу. Разрешено ЛЮБОМУ участнику проекта (viewer+) —
// осознанное послабление относительно move_task:'editor', повторяет существующий TG-путь
// (handleTaskDone проверяет только членство). Атомарно open→confirmed (идемпотентно), затем
// двигает задачу в done НАПРЯМУЮ (не через MoveTask — там гейт editor) + линкует коммит.
export class ConfirmCloseProposal {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    readonly proposalId: string;
    readonly userId: string;
  }): Promise<ConfirmCloseProposalResult> {
    const proposal = await this.deps.closeProposals.findById(input.proposalId);
    if (!proposal) throw new CloseProposalNotFoundError(input.proposalId);

    const membership = await this.deps.members.findForProject(proposal.projectId, input.userId);
    if (!membership) return { status: 'not_member' };

    const resolved = await this.deps.closeProposals.resolve({
      id: input.proposalId,
      status: 'confirmed',
      resolvedBy: input.userId,
    });
    // Кто-то уже разрешил (дубль кнопок личка/группа, повторный клик) — no-op.
    if (!resolved) return { status: 'already_resolved', proposal };

    const task = await this.deps.tasks.getById(proposal.taskId);
    if (task && task.status !== 'done') {
      // Приёмка (db/150): подтверждение close-proposal — такое же «выполнено», как кнопка
      // в интерфейсе. Раньше этот путь шёл мимо приёмки и закрывал задачу напрямую.
      const project = await this.deps.projects.getById(proposal.projectId);
      const target = project
        ? await this.deps.approval.resolveTargetStatus(project, input.userId, 'done')
        : 'done';
      const updated = await this.deps.tasks.update(
        task.id,
        { status: target, statusBeforeDone: task.status },
        input.userId,
      );
      if (project && updated && target === 'pending_approval') {
        void this.deps.approval
          .notifyApprovalRequested({ task: updated, project, actorUserId: input.userId })
          .catch((err: unknown) => console.error('[task:approval] notify failed:', err));
      }
    }

    try {
      await this.deps.linkCommit?.execute({
        projectId: proposal.projectId,
        ownerUserId: input.userId,
        taskId: proposal.taskId,
        sha: proposal.commitSha,
      });
    } catch {
      // Сбой привязки коммита не должен валить уже выполненное закрытие.
    }

    return { status: 'confirmed', proposal: resolved, taskId: proposal.taskId };
  }
}

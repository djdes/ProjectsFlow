import type { CloseProposal } from '../../domain/close-proposal/CloseProposal.js';
import { CloseProposalNotFoundError } from '../../domain/close-proposal/errors.js';
import type { CloseProposalRepository } from './CloseProposalRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';

export type DismissCloseProposalResult =
  | { readonly status: 'dismissed'; readonly proposal: CloseProposal }
  | { readonly status: 'already_resolved'; readonly proposal: CloseProposal }
  | { readonly status: 'not_member' };

type Deps = {
  readonly closeProposals: CloseProposalRepository;
  readonly members: ProjectMemberRepository;
};

// Отклонение предложения закрыть задачу («✕ Не она»). Любой участник (viewer+). Атомарно
// open→dismissed (идемпотентно). Задача остаётся как есть; повторного предложения по тому же
// коммиту не будет (UNIQUE task_id+commit_sha в create).
export class DismissCloseProposal {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    readonly proposalId: string;
    readonly userId: string;
  }): Promise<DismissCloseProposalResult> {
    const proposal = await this.deps.closeProposals.findById(input.proposalId);
    if (!proposal) throw new CloseProposalNotFoundError(input.proposalId);

    const membership = await this.deps.members.findForProject(proposal.projectId, input.userId);
    if (!membership) return { status: 'not_member' };

    const resolved = await this.deps.closeProposals.resolve({
      id: input.proposalId,
      status: 'dismissed',
      resolvedBy: input.userId,
    });
    if (!resolved) return { status: 'already_resolved', proposal };

    return { status: 'dismissed', proposal: resolved };
  }
}

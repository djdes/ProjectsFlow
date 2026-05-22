import { RequestTargetStaleError } from '../../domain/agent/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectJoinRequest } from '../../domain/project/ProjectJoinRequest.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectJoinRequestRepository } from '../project/ProjectJoinRequestRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import { renderJoinRequestEmail } from '../notifications/emails/joinRequestEmail.js';
import { normalizeGitUrl } from '../project/gitUrl.js';
import { verifyRequestTarget } from './repoAccessToken.js';

export type RepoAccessStatus = 'pending' | 'already_requested' | 'approved' | 'denied';

export type RepoAccessResult = {
  readonly status: RepoAccessStatus;
  readonly requestId: string | null;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly joinRequests: ProjectJoinRequestRepository;
  readonly users: UserRepository;
  readonly notifications: NotificationRepository;
  readonly email: EmailSender;
  readonly idGen: () => string;
  readonly appUrl: string;
  readonly tokenSecret: string;
};

type Outcome = 'created' | 'pending_existing' | 'approved' | 'declined';

export class RequestRepoAccess {
  constructor(private readonly deps: Deps) {}

  async execute(
    requesterUserId: string,
    gitRepoUrl: string,
    requestTarget: string,
  ): Promise<RepoAccessResult> {
    // 1) Верифицируем непрозрачный токен против URL (без секрета его не подделать).
    if (!verifyRequestTarget(requestTarget, gitRepoUrl, this.deps.tokenSecret)) {
      throw new RequestTargetStaleError();
    }

    // 2) Чужие проекты с этим репо (requester НЕ member), детерминированный порядок.
    const target = normalizeGitUrl(gitRepoUrl);
    const all = (await this.deps.projects.listWithGitRepo())
      .filter((p) => !p.isInbox && p.gitRepoUrl && normalizeGitUrl(p.gitRepoUrl) === target)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const matched: Project[] = [];
    for (const p of all) {
      const membership = await this.deps.members.findForProject(p.id, requesterUserId);
      if (!membership) matched.push(p);
    }
    if (matched.length === 0) return { status: 'denied', requestId: null };

    const requester = await this.deps.users.getById(requesterUserId);
    const requesterDisplayName = requester?.displayName ?? 'Пользователь';

    const outcomes: Outcome[] = [];
    let representativeId: string | null = null;

    for (const p of matched) {
      const existing = await this.deps.joinRequests.findByProjectAndRequester(p.id, requesterUserId);
      if (!existing) {
        const jr = await this.deps.joinRequests.create({
          id: this.deps.idGen(),
          projectId: p.id,
          requesterUserId,
          gitRepoUrl: p.gitRepoUrl ?? '',
        });
        await this.notifyOwners(p, jr, requesterDisplayName);
        outcomes.push('created');
        representativeId ??= jr.id;
      } else if (existing.status === 'pending') {
        outcomes.push('pending_existing');
        representativeId ??= existing.id;
      } else if (existing.status === 'accepted') {
        outcomes.push('approved');
        representativeId ??= existing.id;
      } else {
        outcomes.push('declined');
        representativeId ??= existing.id;
      }
    }

    return { status: aggregate(outcomes), requestId: representativeId };
  }

  private async notifyOwners(
    project: Project,
    joinRequest: ProjectJoinRequest,
    requesterDisplayName: string,
  ): Promise<void> {
    const projectUrl = `${this.deps.appUrl.replace(/\/$/, '')}/projects/${project.id}`;
    const owners = (await this.deps.members.listByProject(project.id)).filter(
      (m) => m.role === 'owner',
    );
    await Promise.all(
      owners.map(async (owner) => {
        try {
          await this.deps.notifications.create({
            id: this.deps.idGen(),
            userId: owner.userId,
            payload: {
              type: 'join_request',
              projectId: project.id,
              projectName: project.name,
              joinRequestId: joinRequest.id,
              requesterUserId: joinRequest.requesterUserId,
              requesterDisplayName,
              actorUserId: joinRequest.requesterUserId,
              actorDisplayName: requesterDisplayName,
            },
          });
          if (owner.user.email) {
            await this.deps.email.send(
              renderJoinRequestEmail({
                to: owner.user.email,
                projectName: project.name,
                requesterDisplayName,
                projectUrl,
              }),
            );
          }
        } catch (err) {
          console.error('[repo-access] notify owner failed:', err);
        }
      }),
    );
  }
}

function aggregate(outcomes: Outcome[]): RepoAccessStatus {
  if (outcomes.includes('approved')) return 'approved';
  if (outcomes.includes('created')) return 'pending';
  if (outcomes.includes('pending_existing')) return 'already_requested';
  return 'denied';
}

import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { ProjectJoinRequestRepository } from './ProjectJoinRequestRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import { renderJoinRequestEmail } from '../notifications/emails/joinRequestEmail.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly joinRequests: ProjectJoinRequestRepository;
  readonly users: UserRepository;
  readonly notifications: NotificationRepository;
  readonly email: EmailSender;
  readonly idGen: () => string;
  readonly appUrl: string;
};

// Заявитель просится в чужой проект (по совпадению git-репо). Создаёт join-request +
// уведомляет владельцев (in-app push через SSE + best-effort email).
// После перехода на единое пространство код не менялся: «уже участник» и владельцы
// (listByProject → role 'owner') читаются через workspace_members (Task 4).
export class RequestProjectJoin {
  constructor(private readonly deps: Deps) {}

  async execute(requesterUserId: string, projectId: string): Promise<{ ok: true }> {
    const project = await this.deps.projects.getById(projectId);
    if (!project || project.isInbox) throw new ProjectNotFoundError();

    // Уже участник — запрашивать нечего.
    const already = await this.deps.members.findForProject(projectId, requesterUserId);
    if (already) return { ok: true };

    const joinRequest = await this.deps.joinRequests.create({
      id: this.deps.idGen(),
      projectId,
      requesterUserId,
      gitRepoUrl: project.gitRepoUrl ?? '',
    });

    const requester = await this.deps.users.getById(requesterUserId);
    const requesterDisplayName = requester?.displayName ?? 'Пользователь';
    const projectUrl = `${this.deps.appUrl.replace(/\/$/, '')}/projects/${projectId}`;

    const owners = (await this.deps.members.listByProject(projectId)).filter(
      (m) => m.role === 'owner',
    );

    // Доставка владельцам — best-effort, не роняем заявку.
    await Promise.all(
      owners.map(async (owner) => {
        try {
          await this.deps.notifications.create({
            id: this.deps.idGen(),
            userId: owner.userId,
            payload: {
              type: 'join_request',
              projectId,
              projectName: project.name,
              joinRequestId: joinRequest.id,
              requesterUserId,
              requesterDisplayName,
              actorUserId: requesterUserId,
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
          console.error('[join-request] notify owner failed:', err);
        }
      }),
    );

    return { ok: true };
  }
}

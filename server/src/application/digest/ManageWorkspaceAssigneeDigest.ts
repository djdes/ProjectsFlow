import type { TelegramClient } from '../telegram/TelegramClient.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import { requireWorkspaceMember, requireWorkspaceOwner } from '../workspace/workspaceAccess.js';
import type { DigestGroupHistory } from './DigestSettingsRepository.js';
import type { SendWorkspaceAssigneeDigest } from './SendWorkspaceAssigneeDigest.js';
import type {
  SaveWorkspaceAssigneeDigestSettingsInput,
  WorkspaceAssigneeDigestRepository,
} from './WorkspaceAssigneeDigestRepository.js';
import type { WorkspaceAssigneeDigestSettings } from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';

type Deps = {
  readonly repo: WorkspaceAssigneeDigestRepository;
  readonly workspaces: WorkspaceRepository;
  readonly users: UserRepository;
  readonly telegram: TelegramClient;
  readonly send: SendWorkspaceAssigneeDigest;
};

export type WorkspaceAssigneeDigestMember = {
  readonly userId: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly telegramUsername: string | null;
  readonly hasTelegram: boolean;
};

export class ManageWorkspaceAssigneeDigest {
  constructor(private readonly deps: Deps) {}

  async get(
    workspaceId: string,
    actorUserId: string,
  ): Promise<{
    settings: WorkspaceAssigneeDigestSettings;
    members: WorkspaceAssigneeDigestMember[];
  }> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    const [settings, members] = await Promise.all([
      this.deps.repo.get(workspaceId),
      this.deps.workspaces.listMembers(workspaceId),
    ]);
    const linked = await Promise.all(
      members.map(async (member) => ({
        member,
        link: await this.deps.users.getTelegramLink(member.userId).catch(() => null),
      })),
    );
    return {
      settings,
      members: linked.map(({ member, link }) => ({
        userId: member.userId,
        displayName: member.displayName ?? null,
        email: member.email ?? null,
        avatarUrl: member.avatarUrl ?? null,
        telegramUsername: link?.telegramUsername ?? null,
        hasTelegram: link !== null,
      })),
    };
  }

  async save(
    workspaceId: string,
    actorUserId: string,
    input: SaveWorkspaceAssigneeDigestSettingsInput,
  ): Promise<WorkspaceAssigneeDigestSettings> {
    await requireWorkspaceOwner(this.deps.workspaces, workspaceId, actorUserId);
    const members = await this.deps.workspaces.listMembers(workspaceId);
    const memberIds = new Set(members.map((member) => member.userId));
    const recipientUserIds = [...new Set(input.recipientUserIds)].filter((id) =>
      memberIds.has(id),
    );
    return this.deps.repo.save(workspaceId, { ...input, recipientUserIds });
  }

  async sendNow(workspaceId: string, actorUserId: string) {
    await requireWorkspaceOwner(this.deps.workspaces, workspaceId, actorUserId);
    return this.deps.send.execute(workspaceId, { force: true });
  }

  async listGroups(
    workspaceId: string,
    actorUserId: string,
  ): Promise<DigestGroupHistory[]> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    return this.deps.repo.listGroups(workspaceId);
  }

  async resolveGroupTitle(
    workspaceId: string,
    actorUserId: string,
    chatId: number,
  ): Promise<{ title: string | null }> {
    await requireWorkspaceOwner(this.deps.workspaces, workspaceId, actorUserId);
    const chat = await this.deps.telegram.getChat?.(chatId).catch(() => null);
    return { title: chat?.title ?? null };
  }
}

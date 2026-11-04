import type { ProjectStatus } from '../../domain/project/Project.js';
import type { PlanId } from '../../domain/usage/Plan.js';
import type { UserDeletionPlan, UserDeletionSnapshot } from '../../domain/user/userDeletion.js';

// Read-model для admin-раздела. Проект — один раз (без дублей по members), с владельцем
// и счётчиками. Группировку по владельцу делает клиент (по ownerId).
export type AdminProjectView = {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly gitRepoUrl: string | null;
  readonly ownerId: string;
  readonly ownerDisplayName: string;
  readonly ownerEmail: string;
  readonly memberCount: number;
  readonly taskCount: number;
  readonly createdAt: Date;
};

export type AdminUserView = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly isAdmin: boolean;
  readonly projectCount: number;
  // Сколько проектов где этот юзер OWNER (подмножество projectCount).
  // Нужно для UI «Делегация X/Y» — знаменатель.
  readonly ownedProjectCount: number;
  // Сколько из owned-проектов имеют git_token_delegation.enabled=true.
  // Числитель для UI «Делегация X/Y». 0 если ни одного.
  readonly delegationEnabledCount: number;
  // Подключён ли GitHub. Если нет — делегацию включать нельзя в принципе;
  // UI рисует это как hint.
  readonly githubConnected: boolean;
  // Тариф юзера + дата окончания подписки (для бейджа/контрола в admin Users-tab).
  readonly plan: PlanId;
  readonly subscriptionExpiresAt: Date | null;
  // Telegram link for the edit dialog: linked flag and @username when known.
  readonly telegramLinked: boolean;
  readonly telegramUsername: string | null;
  // Workspaces the user is a member of.
  readonly workspaceCount: number;
  // Last password login (db/178; older logins are recovered from live sessions).
  readonly lastLoginAt: Date | null;
  // Last time the user was seen in the app: requests (throttled), project views, logins.
  readonly lastActivityAt: Date | null;
  readonly createdAt: Date;
  // Anonymized account (see DeleteUserAsAdmin); listed only under the «Удалённые» filter.
  readonly deletedAt: Date | null;
};

// Current profile values: «before» for the audit journal and the target's address for mail.
export type AdminUserProfile = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly isAdmin: boolean;
  readonly telegramLinked: boolean;
  readonly telegramUsername: string | null;
};

// The user panel: memberships, AI spend and activity counters from existing tables.
export type AdminUserOverviewData = {
  readonly workspaces: readonly {
    readonly id: string; readonly name: string; readonly kind: 'default' | 'team';
    readonly role: string; readonly isOwner: boolean; readonly memberCount: number;
  }[];
  readonly projects: readonly {
    readonly id: string; readonly name: string; readonly status: ProjectStatus;
    readonly role: string; readonly workspaceName: string | null; readonly taskCount: number;
  }[];
  readonly usage: { readonly costUsd30d: number; readonly costUsdTotal: number; readonly runs30d: number };
  readonly activity: {
    readonly tasksCreated30d: number;
    readonly comments30d: number;
    readonly activeSessions: number;
    readonly lastLoginAt: Date | null;
    readonly lastSeenAt: Date | null;
  };
};

export type AdminUpdateUserPatch = {
  readonly displayName?: string;
  readonly email?: string;
  readonly isAdmin?: boolean;
  readonly avatarUrl?: null;
  // null unlinks Telegram: the same fields the user's own «Отвязать» clears.
  readonly telegram?: null;
};

export interface AdminRepository {
  listAllProjects(): Promise<AdminProjectView[]>;
  // Every account, deleted ones included (they carry deletedAt).
  listAllUsers(): Promise<AdminUserView[]>;
  getUserProfile(id: string): Promise<AdminUserProfile | null>;
  loadUserOverview(id: string, since: Date): Promise<AdminUserOverviewData | null>;
  updateUser(id: string, patch: AdminUpdateUserPatch, actorId: string): Promise<void>;
  loadUserDeletionSnapshot(id: string): Promise<UserDeletionSnapshot | null>;
  // One transaction: locks the actor and the target, reloads the snapshot, asks `decide`
  // for the plan (decide throws to abort) and executes it. Returns attachment files of the
  // removed projects; the caller deletes them from storage after the commit.
  deleteUser(
    id: string,
    actorId: string,
    decide: (snapshot: UserDeletionSnapshot) => UserDeletionPlan,
  ): Promise<{ readonly plan: UserDeletionPlan; readonly storageKeys: readonly string[] }>;
}

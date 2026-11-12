import { aliasedTable, and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { users, workspaceInvites, workspaceMembers, workspaces } from '../db/schema.js';
import type {
  InviteCandidate,
  WorkspaceNeighborsRepository,
} from '../../application/workspace/WorkspaceNeighborsRepository.js';

export class DrizzleWorkspaceNeighborsRepository implements WorkspaceNeighborsRepository {
  constructor(private readonly db: Database) {}

  async listCandidates(actorUserId: string, workspaceId: string, now: Date): Promise<InviteCandidate[]> {
    // wm1 — членства приглашающего, wm2 — остальные участники тех же пространств.
    const wm1 = aliasedTable(workspaceMembers, 'wm1');
    const wm2 = aliasedTable(workspaceMembers, 'wm2');
    const [rows, targetMembers, pending] = await Promise.all([
      this.db
        .select({
          userId: users.id,
          displayName: users.displayName,
          email: users.email,
          avatarUrl: users.avatarUrl,
          telegramUserId: users.telegramUserId,
          workspaceId: workspaces.id,
          workspaceName: workspaces.name,
          workspaceIcon: workspaces.icon,
        })
        .from(wm1)
        .innerJoin(wm2, eq(wm2.workspaceId, wm1.workspaceId))
        .innerJoin(users, eq(users.id, wm2.userId))
        .innerJoin(workspaces, eq(workspaces.id, wm1.workspaceId))
        .where(
          and(
            eq(wm1.userId, actorUserId),
            ne(wm2.userId, actorUserId),
            ne(wm1.workspaceId, workspaceId),
            isNull(users.deletedAt),
          ),
        ),
      this.db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId)),
      this.db
        .select({ email: sql<string>`LOWER(TRIM(${workspaceInvites.email}))` })
        .from(workspaceInvites)
        .where(
          and(
            eq(workspaceInvites.workspaceId, workspaceId),
            isNull(workspaceInvites.acceptedAt),
            gt(workspaceInvites.expiresAt, now),
          ),
        ),
    ]);
    const members = new Set(targetMembers.map((m) => m.userId));
    const invited = new Set(pending.map((p) => p.email).filter((e): e is string => !!e));
    const byUser = new Map<string, InviteCandidate & { workspaces: InviteCandidate['workspaces'][number][] }>();
    for (const row of rows) {
      if (members.has(row.userId)) continue;
      let candidate = byUser.get(row.userId);
      if (!candidate) {
        candidate = {
          userId: row.userId,
          displayName: row.displayName ?? null,
          email: row.email,
          avatarUrl: row.avatarUrl ?? null,
          hasTelegram: row.telegramUserId !== null,
          workspaces: [],
          invited: invited.has(row.email.trim().toLowerCase()),
        };
        byUser.set(row.userId, candidate);
      }
      if (!candidate.workspaces.some((w) => w.id === row.workspaceId)) {
        candidate.workspaces.push({ id: row.workspaceId, name: row.workspaceName, icon: row.workspaceIcon ?? null });
      }
    }
    return [...byUser.values()]
      .map((c) => ({ ...c, workspaces: [...c.workspaces].sort((a, b) => a.name.localeCompare(b.name, 'ru')) }))
      .sort((a, b) => (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email, 'ru'));
  }
}

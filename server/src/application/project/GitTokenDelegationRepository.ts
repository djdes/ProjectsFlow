import type {
  GitTokenAccessOutcome,
  GitTokenDelegation,
} from '../../domain/project/GitTokenDelegation.js';

export type UpsertGitTokenDelegationInput = {
  readonly projectId: string;
  readonly granterUserId: string;
  readonly enabled: boolean;
};

export type LogGitTokenAccessInput = {
  readonly projectId: string;
  readonly accessedByUserId: string;
  readonly granterUserId: string | null;
  readonly outcome: GitTokenAccessOutcome;
};

export type GitTokenAccessLogEntry = {
  readonly accessedByUserId: string;
  readonly granterUserId: string | null;
  readonly accessedAt: Date;
  readonly outcome: GitTokenAccessOutcome;
};

export interface GitTokenDelegationRepository {
  // Делегация конкретного члена проекта (granter). Null если запись не создавалась.
  // v0.15: per-member opt-in — каждый член независимо включает СВОЮ делегацию.
  getForMember(projectId: string, granterUserId: string): Promise<GitTokenDelegation | null>;
  // Все active-делегации проекта (enabled=true). Используется в GetDelegatedGitToken
  // для выбора кандидата и в UI для рендера списка «кто разрешил».
  listEnabledForProject(projectId: string): Promise<GitTokenDelegation[]>;
  // Все делегации проекта (включая enabled=false) — для UI «полный список членов
  // с их статусом». Возвращает только существующие row'ы; члены без записи —
  // считаются «не делегирующими» (enabled=false).
  listAllForProject(projectId: string): Promise<GitTokenDelegation[]>;
  // Upsert ОДНОЙ записи (один granter). При enabled=true: granted_at = NOW() если
  // впервые, revoked_at = NULL. При enabled=false: revoked_at = NOW(), granted_at
  // оставляем (история).
  upsert(input: UpsertGitTokenDelegationInput): Promise<GitTokenDelegation>;
  // Лог-запись о попытке вызова /agent/.../git-token. Пишется для ВСЕХ outcome'ов
  // (ok и ошибочных) — нужно для разбора инцидентов и UI «лога обращений» owner'у.
  logAccess(input: LogGitTokenAccessInput): Promise<void>;
  // Последние N записей лога для UI. Сортировка — accessed_at desc.
  listAccessLog(projectId: string, limit: number): Promise<GitTokenAccessLogEntry[]>;
}

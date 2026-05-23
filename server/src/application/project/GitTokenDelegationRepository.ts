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
  // Текущая делегация проекта (или null если ещё ни разу не настраивали).
  get(projectId: string): Promise<GitTokenDelegation | null>;
  // Включить/выключить. При enabled=true: ставит granted_at = NOW(), revoked_at = NULL.
  // При enabled=false: ставит revoked_at = NOW() (granted_at сохраняем как историю).
  // Идемпотентно: если запись уже есть с тем же `enabled` — флаги не сбрасываются.
  upsert(input: UpsertGitTokenDelegationInput): Promise<GitTokenDelegation>;
  // Лог-запись о попытке вызова /agent/.../git-token. Пишется для ВСЕХ outcome'ов
  // (ok и ошибочных) — нужно для разбора инцидентов и UI «лога обращений» owner'у.
  logAccess(input: LogGitTokenAccessInput): Promise<void>;
  // Последние N записей лога для UI. Сортировка — accessed_at desc.
  listAccessLog(projectId: string, limit: number): Promise<GitTokenAccessLogEntry[]>;
}

// Append-only journal of what admins did to user accounts (db/178). Written by the admin
// use-cases after the change succeeded; read in the user panel («История действий»).

export const ADMIN_AUDIT_ACTIONS = [
  'profile_update', // name, email, avatar removal, Telegram unlink
  'role_change',
  'plan_change',
  'bulk_plan',
  'delete',
  'impersonate',
  'sign_out_all',
  'password_reset_sent',
] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export type AdminAuditDetail = Readonly<Record<string, unknown>>;

export type AdminAuditInput = {
  readonly actorUserId: string;
  readonly targetUserId: string | null;
  readonly action: AdminAuditAction;
  // Same id on every entry of one bulk operation.
  readonly batchId?: string | null;
  readonly before?: AdminAuditDetail | null;
  readonly after?: AdminAuditDetail | null;
};

export type AdminAuditEntry = {
  readonly id: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string | null;
  readonly targetUserId: string | null;
  readonly action: AdminAuditAction;
  readonly batchId: string | null;
  readonly before: AdminAuditDetail | null;
  readonly after: AdminAuditDetail | null;
  readonly createdAt: Date;
};

export interface AdminAuditLog {
  record(entries: readonly AdminAuditInput[]): Promise<void>;
  // Entries about the user, newest first.
  listForTarget(targetUserId: string, limit: number): Promise<AdminAuditEntry[]>;
}

/** Only the fields that changed, as before/after pairs for the journal. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  patch: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] === undefined || before[key] === patch[key]) continue;
    b[key] = before[key];
    a[key] = patch[key];
  }
  return Object.keys(a).length > 0 ? { before: b, after: a } : null;
}

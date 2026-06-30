// Порт append-only журнала расхода ИИ (USD). См. план gleaming-munching-locket (M1).
export type UsageSource = 'live' | 'ai_prompt' | 'monitoring' | 'commit_sync';

export type RecordUsageRow = {
  readonly id: string;
  readonly userId: string; // = dispatcher_user_id прогона (один профиль = один бюджет)
  readonly source: UsageSource;
  readonly refId: string;
  readonly projectId: string | null;
  readonly model: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly costUsd: number;
  readonly occurredAt?: Date;
};

export type UsageLedgerRepository = {
  // INSERT; глотает ER_DUP_ENTRY (UNIQUE(source, ref_id)) → false если уже записано (идемпотентно).
  append(row: RecordUsageRow): Promise<boolean>;
  // SUM(cost_usd) WHERE user_id=? AND occurred_at >= since. Возвращает Number (DECIMAL→Number).
  sumSince(userId: string, since: Date): Promise<number>;
  // Самая ранняя трата в окне (occurred_at >= since) — для расчёта resetsAt. null если трат нет.
  earliestSince(userId: string, since: Date): Promise<Date | null>;
};

import { estimateCostUsd } from '../../domain/usage/pricing.js';
import type { UsageLedgerRepository, UsageSource } from './UsageLedgerRepository.js';

export type RecordUsageInput = {
  readonly source: UsageSource;
  readonly refId: string;
  // Профиль, чей диспетчер выполнял работу — с его подписки списываем.
  readonly dispatcherUserId: string;
  readonly projectId: string | null;
  readonly model: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  // Авторитетная стоимость от раннера; если null — пробуем оценить по токенам/модели.
  readonly costUsd: number | null;
  readonly occurredAt?: Date;
};

type Deps = {
  readonly ledger: UsageLedgerRepository;
  readonly idGen: () => string;
};

// Единый хаб метеринга: зовётся из всех completion-путей ПОСЛЕ успешной записи результата.
// Идемпотентен (UNIQUE(source, ref_id) в ledger). Best-effort — вызывающий оборачивает в
// .catch(), чтобы сбой метеринга никогда не валил завершение джобы.
export class RecordUsage {
  constructor(private readonly deps: Deps) {}

  async execute(input: RecordUsageInput): Promise<void> {
    const cost = input.costUsd ?? estimateCostUsd(input.model, input.tokensIn, input.tokensOut) ?? 0;
    // Нечего метерить: ни стоимости, ни токенов.
    if (cost <= 0 && input.tokensIn == null && input.tokensOut == null) return;
    await this.deps.ledger.append({
      id: this.deps.idGen(),
      userId: input.dispatcherUserId,
      source: input.source,
      refId: input.refId,
      projectId: input.projectId,
      model: input.model,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costUsd: cost,
      occurredAt: input.occurredAt,
    });
  }
}

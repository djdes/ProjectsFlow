import type { ApprovalSummary } from '@/domain/approval/ApprovalSummary';
import type { ApprovalSummaryRepository } from './ApprovalSummaryRepository';

export type ApprovalSummaryKey = {
  readonly projectId: string;
  readonly taskId: string;
  // Версия задачи (например, время последнего изменения): изменилась — сводку перечитываем.
  readonly revision?: string | null;
};

// «Сводки нет» держим недолго: причиной могла быть временно недоступная подписка ИИ, и
// следующее открытие «Входящих» должно спросить снова. Готовую сводку держим всю сессию.
const EMPTY_TTL_MS = 2 * 60 * 1000;
const MAX_ENTRIES = 300;

type Entry = { readonly value: ApprovalSummary; readonly at: number };

// Общий кэш сводок полки «На утверждении» на всю вкладку (синглтон контейнера): карточка,
// её повторные рендеры и окно «Принять все» читают одну и ту же запись, а одновременные
// запросы одной задачи сливаются в один GET.
export class LoadApprovalSummary {
  private readonly cache = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<ApprovalSummary>>();

  constructor(
    private readonly repo: ApprovalSummaryRepository,
    private readonly now: () => number = Date.now,
  ) {}

  /** Уже известная сводка без запроса; undefined — ещё не загружали (или запись устарела). */
  peek(key: ApprovalSummaryKey): ApprovalSummary | undefined {
    const id = cacheKey(key);
    const entry = this.cache.get(id);
    if (!entry) return undefined;
    if (entry.value.summary === null && this.now() - entry.at > EMPTY_TTL_MS) {
      this.cache.delete(id);
      return undefined;
    }
    return entry.value;
  }

  execute(key: ApprovalSummaryKey): Promise<ApprovalSummary> {
    const known = this.peek(key);
    if (known) return Promise.resolve(known);
    const id = cacheKey(key);
    const running = this.inFlight.get(id);
    if (running) return running;
    // Ошибку сети не кэшируем: карточка просто останется без сводки, следующий показ повторит.
    const request = this.repo
      .get(key.projectId, key.taskId)
      .then((value) => {
        this.remember(id, value);
        return value;
      })
      .finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, request);
    return request;
  }

  private remember(id: string, value: ApprovalSummary): void {
    this.cache.delete(id);
    this.cache.set(id, { value, at: this.now() });
    while (this.cache.size > MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

function cacheKey(key: ApprovalSummaryKey): string {
  return `${key.projectId}/${key.taskId}@${key.revision ?? ''}`;
}

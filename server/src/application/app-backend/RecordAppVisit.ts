import type { AppTrafficRepository } from './AppTrafficRepository.js';
import { classifyUserAgent, normalizeVisitPath } from '../../domain/app-backend/AppTraffic.js';

// Минимальный контракт rate-limiter'а (см. InMemoryRateLimiter). true — пропустить.
export interface VisitRateLimiter {
  hit(key: string, limit: number, windowMs: number): boolean;
}

export type RecordAppVisitDeps = {
  readonly traffic: AppTrafficRepository;
  readonly rateLimiter: VisitRateLimiter;
  // Посол + вычисление session_hash. Инжектится, чтобы соль-секрет жил в composition root,
  // а use-case оставался чистым и тестируемым.
  readonly hashSession: (raw: string) => string;
  readonly now: () => Date;
  // Потолок записей в сутки на проект — иначе публичный эндпоинт раздувает квоту проекта.
  readonly dailyCap?: number;
  // Лимит приёма визитов в минуту на проект (анти-абьюз, не биллинг).
  readonly perMinuteLimit?: number;
};

export type RecordAppVisitInput = {
  readonly projectId: string;
  readonly path: unknown;
  readonly userAgent: string | null;
  // Транзитный идентификатор для подсчёта уникальных сессий (обычно ip+ua). НИКОГДА не хранится:
  // из него выводится только посоленный, ротируемый по дню session_hash.
  readonly sessionSeed: string;
};

export type RecordAppVisitResult = {
  readonly recorded: boolean;
  readonly reason?: 'rate_limited' | 'daily_cap';
};

const DEFAULT_DAILY_CAP = 50_000;
const DEFAULT_PER_MINUTE_LIMIT = 600;

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Приём одного визита с ПУБЛИЧНОГО опубликованного сайта. Эндпоинт неаутентифицирован, поэтому
// защита от абьюза (rate-limit по project_id + потолок записей в сутки) — обязательна, а не опция.
export class RecordAppVisit {
  private readonly dailyCap: number;
  private readonly perMinuteLimit: number;

  constructor(private readonly deps: RecordAppVisitDeps) {
    this.dailyCap = deps.dailyCap ?? DEFAULT_DAILY_CAP;
    this.perMinuteLimit = deps.perMinuteLimit ?? DEFAULT_PER_MINUTE_LIMIT;
  }

  async record(input: RecordAppVisitInput): Promise<RecordAppVisitResult> {
    const projectId = input.projectId;
    // 1) Rate-limit по проекту: окно 1 минута. Бесшумно отбрасываем сверх лимита (beacon не должен
    //    падать громко), но не пишем — так всплеск не превращается в раздувание квоты.
    if (!this.deps.rateLimiter.hit(`app-visit:${projectId}`, this.perMinuteLimit, 60_000)) {
      return { recorded: false, reason: 'rate_limited' };
    }
    const day = utcDay(this.deps.now());
    // 2) Потолок записей в сутки на проект — вторая граница ущерба поверх минутного лимита.
    if ((await this.deps.traffic.countForDay(projectId, day)) >= this.dailyCap) {
      return { recorded: false, reason: 'daily_cap' };
    }
    const sessionHash = this.deps.hashSession(`${projectId}:${day}:${input.sessionSeed}`);
    await this.deps.traffic.record({
      projectId,
      path: normalizeVisitPath(input.path),
      sessionHash,
      userAgentClass: classifyUserAgent(input.userAgent),
      visitDay: day,
      createdAt: this.deps.now().toISOString(),
    });
    return { recorded: true };
  }
}

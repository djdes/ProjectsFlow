import type { AppTrafficRepository } from './AppTrafficRepository.js';
import type { ProjectAccessDeps } from '../project/projectAccess.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import {
  DEFAULT_TRAFFIC_WINDOW_DAYS,
  MAX_TRAFFIC_WINDOW_DAYS,
  UA_CLASSES,
  type AppTraffic,
  type UaClass,
} from '../../domain/app-backend/AppTraffic.js';

type Deps = ProjectAccessDeps & { readonly traffic: AppTrafficRepository };

function clampDays(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_TRAFFIC_WINDOW_DAYS;
  return Math.max(1, Math.min(MAX_TRAFFIC_WINDOW_DAYS, Math.floor(raw)));
}

// Чтение агрегированного трафика опубликованного приложения для дашборда (cookie-auth, member).
// Отдаёт ТОЛЬКО временные ряды и грубые корзины клиента — никаких фасетов/«топ значений» по
// колонкам приложения (path не разбивается), session_hash наружу не уходит (раздел 4 плана).
export class GetAppTraffic {
  constructor(private readonly deps: Deps) {}

  async get(projectId: string, userId: string, days?: number): Promise<AppTraffic> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    const windowDays = clampDays(days);
    const sinceDay = new Date(Date.now() - (windowDays - 1) * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const agg = await this.deps.traffic.aggregate(projectId, sinceDay);
    const byClass: Record<UaClass, number> = { desktop: 0, mobile: 0, bot: 0, other: 0 };
    for (const cls of UA_CLASSES) byClass[cls] = agg.byClass[cls] ?? 0;
    return {
      windowDays,
      totalVisits: agg.totalVisits,
      totalSessions: agg.totalSessions,
      perDay: agg.perDay,
      byClass,
    };
  }
}

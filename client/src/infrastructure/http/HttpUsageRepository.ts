import type {
  PlanId,
  Subscription,
  UsageSummary,
  UsageWindow,
  WindowLabel,
} from '@/domain/usage/Usage';
import type { UsageRepository } from '@/application/usage/UsageRepository';
import { httpClient } from './httpClient';

type WindowDto = {
  label: WindowLabel;
  spentUsd: number;
  capUsd: number | null;
  remainingUsd: number | null;
  isOver: boolean;
  resetsAt: string | null;
};

type UsageDto = {
  plan: PlanId;
  subscription: { plan: PlanId; startedAt: string | null; expiresAt: string | null };
  windows: { fiveHour: WindowDto; sevenDay: WindowDto };
  isBlocked: boolean;
  blockedWindow: WindowLabel | null;
  rubPerUsd: number;
  primeTrialAvailable: boolean;
};

function windowFromDto(d: WindowDto): UsageWindow {
  return {
    label: d.label,
    // Деньги уже числа, но coerce на случай строкового DECIMAL с сервера.
    spentUsd: Number(d.spentUsd) || 0,
    capUsd: d.capUsd == null ? null : Number(d.capUsd),
    remainingUsd: d.remainingUsd == null ? null : Number(d.remainingUsd),
    isOver: Boolean(d.isOver),
    resetsAt: d.resetsAt ? new Date(d.resetsAt) : null,
  };
}

function subscriptionFromDto(d: UsageDto['subscription']): Subscription {
  return {
    plan: d.plan,
    startedAt: d.startedAt ? new Date(d.startedAt) : null,
    expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
  };
}

function fromDto(dto: UsageDto): UsageSummary {
  return {
    plan: dto.plan,
    subscription: subscriptionFromDto(dto.subscription),
    fiveHour: windowFromDto(dto.windows.fiveHour),
    sevenDay: windowFromDto(dto.windows.sevenDay),
    isBlocked: Boolean(dto.isBlocked),
    blockedWindow: dto.blockedWindow,
    rubPerUsd: Number(dto.rubPerUsd) || 0,
    primeTrialAvailable: Boolean(dto.primeTrialAvailable),
  };
}

export class HttpUsageRepository implements UsageRepository {
  async getUsage(): Promise<UsageSummary> {
    return fromDto(await httpClient.get<UsageDto>('/auth/me/usage'));
  }

  async changePlan(plan: PlanId): Promise<UsageSummary> {
    return fromDto(await httpClient.post<UsageDto>('/auth/me/plan', { plan }));
  }
}

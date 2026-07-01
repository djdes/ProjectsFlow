import type { WindowLabel } from './UsageWindow.js';

// Бросается гейтом enforcement, когда подписка исчерпала окно. Презентация мапит в HTTP 402.
export class UsageBlockedError extends Error {
  constructor(
    readonly window: WindowLabel,
    readonly resetsAt: Date | null,
  ) {
    super(`usage budget exceeded for window ${window}`);
    this.name = 'UsageBlockedError';
  }
}

// Инициатор работы на диспетчере — free-тариф (нет доступа к диспетчеру). Презентация
// мапит в HTTP 402 с error='plan_required' (нужен Prime/VIP). Отличается от UsageBlockedError
// тем, что это не «исчерпал окно», а «нет подходящего тарифа вовсе».
export class PlanRequiredError extends Error {
  constructor() {
    super('plan required to use dispatcher');
    this.name = 'PlanRequiredError';
  }
}

// Прайм-триал (1 час) уже использован — повторная self-serve активация запрещена (→ HTTP 409).
export class PrimeTrialUsedError extends Error {
  constructor() {
    super('prime trial already used');
    this.name = 'PrimeTrialUsedError';
  }
}

// ВИП нельзя подключить самому — только через админа (→ HTTP 403).
export class VipNotSelfServeError extends Error {
  constructor() {
    super('vip plan is not self-serve');
    this.name = 'VipNotSelfServeError';
  }
}

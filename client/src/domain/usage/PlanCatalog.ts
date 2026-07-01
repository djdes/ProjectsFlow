import type { PlanId } from './Usage';

// Витрина тарифов (RU-копирайт + ЦЕНА подписки). priceRub — цена подписки в ₽/мес
// (Прайм 1900 ₽, VIP 3900 ₽), НЕ путать с AI-бюджетом (лимитом): бюджет = $50/$100 в
// месяц (= 5000/10000 ₽), считается на сервере (PLAN_MONTHLY_USD) и виден в usage-окнах.
// Единственное место копирайта тарифов в приложении (лендинг — отдельно).
export type PlanMeta = {
  readonly id: PlanId;
  readonly nameRu: string;
  readonly priceRub: number | null;
  readonly tagline: string;
  readonly features: readonly string[];
};

export const PLAN_CATALOG: readonly PlanMeta[] = [
  {
    id: 'free',
    nameRu: 'Бесплатный',
    priceRub: null,
    tagline: 'Канбан и проекты — без AI-диспетчера',
    features: [
      'Канбан, проекты, делегирование',
      'Ручное ведение задач',
      'AI-диспетчер и авто-обработка — на Прайм/ВИП',
    ],
  },
  {
    id: 'prime',
    nameRu: 'Прайм',
    priceRub: 1900,
    tagline: 'Диспетчер + AI-бюджет платформы',
    features: [
      'AI-бюджет ≈ $50/мес (лимиты 5ч и 7д)',
      'Диспетчер, воркер, перефразировки, авто-обработка',
      'Расход считается по вашим задачам',
      'Приоритетная очередь задач',
    ],
  },
  {
    id: 'vip',
    nameRu: 'VIP',
    priceRub: 3900,
    tagline: 'Расширенный AI-бюджет для команд',
    features: [
      'AI-бюджет ≈ $100/мес (удвоенные окна)',
      'Всё из Прайма',
      'Максимальный приоритет',
    ],
  },
];

export function planMeta(plan: PlanId): PlanMeta {
  return PLAN_CATALOG.find((p) => p.id === plan) ?? PLAN_CATALOG[0];
}

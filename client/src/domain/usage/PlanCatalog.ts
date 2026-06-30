import type { PlanId } from './Usage';

// Витрина тарифов (RU-копирайт + цена). Цена — ₽/мес, она же бюджет AI-расхода
// (Прайм 5000 ₽, VIP 10000 ₽). null = бесплатно. Единственное место копирайта тарифов.
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
    tagline: 'Свой диспетчер — работает на вашей подписке Claude',
    features: [
      'Свой агент-раннер (BYO Claude)',
      'Канбан, проекты, делегирование',
      'Расход виден, без лимитов платформы',
    ],
  },
  {
    id: 'prime',
    nameRu: 'Прайм',
    priceRub: 5000,
    tagline: 'AI-бюджет платформы с лимитами как у Opus',
    features: [
      'AI-бюджет ≈ 5000 ₽/мес',
      'Лимиты: 5-часовое и недельное окно',
      'Диспетчер, перефразировки, авто-обработка',
      'Приоритетная очередь задач',
    ],
  },
  {
    id: 'vip',
    nameRu: 'VIP',
    priceRub: 10000,
    tagline: 'Расширенный AI-бюджет для команд',
    features: [
      'AI-бюджет ≈ 10000 ₽/мес',
      'Удвоенные окна 5ч / неделя',
      'Всё из Прайма',
      'Максимальный приоритет',
    ],
  },
];

export function planMeta(plan: PlanId): PlanMeta {
  return PLAN_CATALOG.find((p) => p.id === plan) ?? PLAN_CATALOG[0];
}

// Витрина тарифов ProjectsFlow (P1-лендинг). Это ТОЛЬКО витрина — без реальной логики
// подписки (она в backend, P2/P3). Если нужно поправить цены/формулировки — менять ТОЛЬКО здесь.
// Имена согласованы: Бесплатный / Прайм / ВИП (задачи 0c770033 + 903d484f).

export interface Plan {
  readonly id: 'free' | 'prime' | 'vip';
  /** Отображаемое имя тарифа (моно/циан в карточке). */
  readonly name: string;
  /** Цена в рублях. 0 — бесплатно. */
  readonly priceRub: number;
  /** Цена в долларах (опц., показываем рядом мелким). */
  readonly priceUsd?: number;
  /** Подпись под ценой: «навсегда» / «в месяц». */
  readonly priceNote: string;
  /** Короткий слоган тарифа под именем. */
  readonly tagline: string;
  /** Список возможностей. */
  readonly features: readonly string[];
  /** Текст CTA-кнопки. */
  readonly cta: string;
  /** Выделить карточку (рекомендуемый тариф). */
  readonly highlight: boolean;
  /** Бейдж над карточкой (напр. «POPULAR»). */
  readonly badge?: string;
  /** Доступен только по запросу — не самоподключение. */
  readonly requestOnly?: boolean;
  /** Доп-пометка под кнопкой (напр. «можно попробовать 1 час»). */
  readonly note?: string;
  /** href для CTA (относительный — лендинг и SPA на одном Express). */
  readonly href: string;
}

// Цены и состав соответствуют реальной витрине тарифов продукта
// (client/src/domain/usage/PlanCatalog.ts): Прайм 5000 ₽, ВИП 10000 ₽; цена = AI-бюджет.
export const PLANS: readonly Plan[] = [
  {
    id: 'free',
    name: 'Бесплатный',
    priceRub: 0,
    priceNote: 'навсегда',
    tagline: 'На твоей подписке Claude',
    features: [
      'подключаешь свою подписку Claude',
      'канбан, проекты, делегирование',
      'расходы видно, без лимитов платформы',
      'без карты на старте',
    ],
    cta: 'Начать бесплатно',
    highlight: false,
    href: '/register',
  },
  {
    id: 'prime',
    name: 'Прайм',
    priceRub: 5000,
    priceNote: 'в месяц',
    tagline: 'Claude онлайн от нас — ключи не нужны',
    features: [
      'встроенная онлайн-подписка Claude',
      'AI-бюджет ≈ 5000 ₽/мес',
      'проект на автопилоте, перефразировки',
      'приоритетная очередь задач',
    ],
    cta: 'Перейти на Прайм',
    highlight: true,
    badge: 'Популярный',
    href: '/register?plan=prime',
  },
  {
    id: 'vip',
    name: 'ВИП',
    priceRub: 10000,
    priceNote: 'в месяц',
    tagline: 'Расширенный бюджет — для команд',
    features: [
      'встроенная онлайн-подписка Claude',
      'AI-бюджет ≈ 10000 ₽/мес',
      'всё из Прайма, удвоенный лимит',
      'максимальный приоритет',
    ],
    cta: 'Перейти на ВИП',
    highlight: false,
    href: '/register?plan=vip',
  },
] as const;

/** Форматирование цены в рублях с тонкой шпацией между разрядами. */
export function formatRub(value: number): string {
  return value.toLocaleString('ru-RU').replace(/ /g, ' ');
}

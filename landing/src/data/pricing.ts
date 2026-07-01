// Витрина тарифов ProjectsFlow (P1-лендинг). Это ТОЛЬКО витрина — без реальной логики
// подписки (она в backend, P2/P3). Если нужно поправить цены/формулировки — менять ТОЛЬКО здесь.
// Имена согласованы: Бесплатный / Прайм / VIP (задачи 0c770033 + 903d484f).

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

// Витринные цены тарифов на лендинге: Прайм 1900 ₽, VIP 3900 ₽ (по запросу владельца).
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
    priceRub: 1900,
    priceNote: 'в месяц',
    tagline: 'Claude онлайн от нас — ключи не нужны',
    features: [
      'встроенная онлайн-подписка Claude',
      'щедрый AI-бюджет — без своих ключей',
      'проект на автопилоте, перефразировки',
      'приоритетная очередь задач',
    ],
    cta: 'Перейти на Прайм',
    highlight: true,
    badge: 'Популярный',
    note: '🎁 Первый час — бесплатно, без карты',
    href: '/register?plan=prime',
  },
  {
    id: 'vip',
    name: 'VIP',
    priceRub: 3900,
    priceNote: 'в месяц',
    tagline: 'Расширенный бюджет — для команд',
    features: [
      'встроенная онлайн-подписка Claude',
      'увеличенный AI-бюджет',
      'всё из Прайма, удвоенный лимит',
      'максимальный приоритет',
    ],
    cta: 'По запросу',
    highlight: false,
    requestOnly: true,
    href: '/register?plan=vip',
  },
] as const;

/** Форматирование цены в рублях с тонкой шпацией между разрядами. */
export function formatRub(value: number): string {
  return value.toLocaleString('ru-RU').replace(/ /g, ' ');
}

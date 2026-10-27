export type PillarCode = 'AI' | 'CL' | 'FN' | 'DP';
export type ExtendedPillarCode = PillarCode | 'LV' | 'TM';

export interface TariffOption {
  readonly id: 'free' | 'prime' | 'vip';
  readonly label: string;
  readonly shortLabel: string;
  readonly priceRub: number;
  readonly priceNote: string;
  readonly badge: string;
  readonly href: string;
  readonly ctaLabel: string;
  readonly popular?: boolean;
}

export interface PillarConfig {
  readonly code: PillarCode;
  readonly nameRu: string;
  readonly iconEmoji: string;
  readonly giantWord: string;
  readonly splitLeft: string;
  readonly splitRight: string;
  readonly splitSubword: string;
  readonly tagline: string;
  readonly mindlyTitle: string;
  readonly mindlyDesc: string;
  readonly story: string;
  // Цвета сцены и 3D-материалов (в стиле Planet BOLD / Mindly / GrowTree)
  readonly stageBgGradient: string;
  readonly orbGradient: string;
  readonly cardColorPrimary: string;
  readonly cardColorSecondary: string;
  readonly cardAccentHex: string;
  readonly auroraColors: [string, string, string];
  readonly satellite1: { readonly title: string; readonly sub: string };
  readonly satellite2: { readonly title: string; readonly sub: string };
  readonly metrics: [
    { readonly label: string; readonly value: string },
    { readonly label: string; readonly value: string },
    { readonly label: string; readonly value: string }
  ];
  readonly cardTelemetry: {
    readonly topChip: string;
    readonly centerHeadline: string;
    readonly centerSub: string;
    readonly footerCode: string;
  };
}

export const TARIFF_OPTIONS: readonly TariffOption[] = [
  {
    id: 'free',
    label: 'Бесплатный · 0 ₽',
    shortLabel: '0 ₽ · Старт',
    priceRub: 0,
    priceNote: 'навсегда · на своей подписке Claude',
    badge: 'БЕЗ КАРТЫ НА СТАРТЕ',
    href: '/register',
    ctaLabel: 'Начать бесплатно за 0 ₽',
  },
  {
    id: 'prime',
    label: 'Прайм · 1 900 ₽',
    shortLabel: '1 900 ₽ · Прайм',
    priceRub: 1900,
    priceNote: 'в месяц · 1 час тест-драйва бесплатно',
    badge: 'CLAUDE ОНЛАЙН ОТ НАС · ХИТ',
    href: '/register?plan=prime',
    ctaLabel: 'Попробовать Прайм (1 час бесплатно)',
    popular: true,
  },
  {
    id: 'vip',
    label: 'VIP · 3 900 ₽',
    shortLabel: '3 900 ₽ · VIP',
    priceRub: 3900,
    priceNote: 'в месяц · расширенный бюджет для команд',
    badge: 'УДВОЕННЫЙ AI-БЮДЖЕТ · VIP',
    href: '/register?plan=vip',
    ctaLabel: 'Подключить VIP (3 900 ₽/мес)',
  },
] as const;

export const PILLARS_DATA: Record<PillarCode, PillarConfig> = {
  AI: {
    code: 'AI',
    nameRu: 'Автопилот',
    iconEmoji: '⚡',
    giantWord: 'AUTOPILOT',
    splitLeft: 'АВТО',
    splitRight: 'ПИЛОТ',
    splitSubword: 'IDEA TO PRODUCT · 24/7',
    tagline: 'Вайб-кодинг без рутины · Бросаешь задачу — делается сама',
    mindlyTitle: 'Автопилот задач AI · Хит',
    mindlyDesc:
      'Опиши словами, что нужно сделать. Платформа сама разбивает цель на шаги и присылает готовое на утверждение.',
    story:
      'Включаешь автопилот — и ProjectsFlow сам придумывает и выполняет шаги к твоей цели, пока ты занят продуктом или отдыхаешь. Возвращаешься в доску «Входящие» — а задачи уже ждут в колонке «На утверждении».',
    stageBgGradient:
      'radial-gradient(circle at 52% 32%, #f43b68 0%, #b8144d 45%, #160613 92%)',
    orbGradient: 'linear-gradient(135deg, #ff2e63 0%, #ff9966 100%)',
    cardColorPrimary: '#ff2e63',
    cardColorSecondary: '#6d0e3c',
    cardAccentHex: '#ffe66d',
    auroraColors: ['#ff4d79', '#ff9a5a', '#ffe66d'],
    satellite1: { title: 'Живой ход (LIVE)', sub: '84% готово · 3,20 ₽ за задачу' },
    satellite2: { title: 'На утверждении', sub: 'Принимай результат в 1 клик' },
    metrics: [
      { label: 'Старт работы AI', value: 'За 3 секунды' },
      { label: 'Тест-драйв Прайма', value: '1 час бесплатно' },
      { label: 'Владение кодом', value: '100% у тебя' },
    ],
    cardTelemetry: {
      topChip: 'PROJECTSFLOW · AUTOPILOT',
      centerHeadline: 'AI ДЕЛАЕТ',
      centerSub: 'ОТ ИДЕИ ДО ГОТОВОГО ПРОДУКТА САМ',
      footerCode: 'LIVE: 4/4 CHECKS · 84%',
    },
  },
  CL: {
    code: 'CL',
    nameRu: 'Claude Онлайн',
    iconEmoji: '🧠',
    giantWord: 'CLAUDE AI',
    splitLeft: 'КЛОД',
    splitRight: 'ОНЛАЙН',
    splitSubword: 'ZERO API KEYS · NO VPN',
    tagline: 'Подписка на Claude уже внутри · Без VPN и своих API-ключей',
    mindlyTitle: 'Claude онлайн от нас',
    mindlyDesc:
      'На Прайме и VIP ведущие модели работают прямо из коробки — без зарубежных карт, прокси и ручной настройки.',
    story:
      'Забудь про покупку зарубежных карт, блокировки аккаунтов и сложные API-ключи. На тарифах Прайм и VIP онлайн-подписка уже встроена в платформу, а на Бесплатном тарифе можно в два клика подключить собственную подписку.',
    stageBgGradient:
      'radial-gradient(circle at 52% 32%, #198765 0%, #0b4f3f 46%, #061713 92%)',
    orbGradient: 'linear-gradient(135deg, #1db954 0%, #9ef01a 100%)',
    cardColorPrimary: '#1db954',
    cardColorSecondary: '#083d2c',
    cardAccentHex: '#9ef01a',
    auroraColors: ['#1db954', '#70e000', '#a3f73b'],
    satellite1: { title: 'Без VPN и ключей', sub: 'Встроенная онлайн-подписка' },
    satellite2: { title: 'Свой или наш Claude', sub: 'Гибкое переключение в 1 клик' },
    metrics: [
      { label: 'Настройка ключей', value: '0 минут (внутри)' },
      { label: 'Тариф Бесплатный', value: '0 ₽ навсегда' },
      { label: 'Тариф Прайм', value: '1 900 ₽/мес' },
    ],
    cardTelemetry: {
      topChip: 'CLAUDE ONLINE · BUILT-IN',
      centerHeadline: 'CLAUDE PRO',
      centerSub: 'РАБОТАЕТ ОНЛАЙН БЕЗ VPN И КЛЮЧЕЙ',
      footerCode: 'MODEL: READY · 0 KEYS',
    },
  },
  FN: {
    code: 'FN',
    nameRu: 'Финансы в ₽',
    iconEmoji: '💎',
    giantWord: 'FINANCE',
    splitLeft: 'ДЕНЬГИ',
    splitRight: 'ПРОЕКТА',
    splitSubword: 'TRANSPARENT RUB MARGINS',
    tagline: 'Прибыль, доходы и AI-расходы по проекту — на виду в рублях',
    mindlyTitle: 'Деньги с одного взгляда',
    mindlyDesc:
      'Видно, сколько каждый проект заработал и сколько потратил на AI, домен и хостинг — без таблиц и сюрпризов.',
    story:
      'Каждый шаг AI и каждая операция проекта учитываются в рублях. Ты всегда видишь реальную экономику: доход от клиентов, себестоимость AI-задач, расходы на инфраструктуру и чистую маржу по месяцам.',
    stageBgGradient:
      'radial-gradient(circle at 52% 32%, #1d84b5 0%, #0e4d8a 46%, #061322 92%)',
    orbGradient: 'linear-gradient(135deg, #00b4d8 0%, #ffd166 100%)',
    cardColorPrimary: '#00b4d8',
    cardColorSecondary: '#023e8a',
    cardAccentHex: '#ffd166',
    auroraColors: ['#00b4d8', '#48cae4', '#ffd166'],
    satellite1: { title: 'Прибыль +128 400 ₽', sub: 'Маржинальность проекта 60%' },
    satellite2: { title: 'Точный учёт AI', sub: 'От 3,20 ₽ за готовую фичу' },
    metrics: [
      { label: 'Доход проекта', value: '214 000 ₽' },
      { label: 'Расходы и AI', value: '85 600 ₽' },
      { label: 'Чистая прибыль', value: '128 400 ₽ (60%)' },
    ],
    cardTelemetry: {
      topChip: 'UNIT ECONOMICS · RUB',
      centerHeadline: '+128 400 ₽',
      centerSub: 'ПРОЗРАЧНАЯ ПРИБЫЛЬ И МАРЖА 60%',
      footerCode: 'MARGIN: 60% · RUB LIVE',
    },
  },
  DP: {
    code: 'DP',
    nameRu: 'Проверки и Релиз',
    iconEmoji: '🛡️',
    giantWord: 'SHIPPING',
    splitLeft: 'ЧИСТЫЙ',
    splitRight: 'РЕЛИЗ',
    splitSubword: '4/4 CHECKS · ZERO LOCK-IN',
    tagline: 'Автопроверки перед выкаткой · Никакого лок-ина, код 100% твой',
    mindlyTitle: '4 из 4 проверок перед релизом',
    mindlyDesc:
      'Сборка, линтер, отсутствие секретов в коде и адаптив на телефоне проверяются автоматически перед деплоем.',
    story:
      'Платформа не просто пишет код — она проверяет сборку, типы, безопасность секретов и мобильную вёрстку до того, как изменения попадут в прод. А весь созданный продукт целиком принадлежит тебе.',
    stageBgGradient:
      'radial-gradient(circle at 52% 32%, #6831b8 0%, #3a1078 46%, #0c0721 92%)',
    orbGradient: 'linear-gradient(135deg, #7b2cbf 0%, #00d2ff 100%)',
    cardColorPrimary: '#7b2cbf',
    cardColorSecondary: '#1e0b42',
    cardAccentHex: '#72efdd',
    auroraColors: ['#9d4edd', '#00d2ff', '#72efdd'],
    satellite1: { title: 'Автопроверки 4/4', sub: 'Сборка · Типы · Секреты · Мобила' },
    satellite2: { title: 'Гарантия возврата', sub: 'Не зашло — вернём деньги' },
    metrics: [
      { label: 'Контроль качества', value: '4 из 4 автопроверок' },
      { label: 'Лок-ин платформы', value: '0% (всё твоё)' },
      { label: 'Гарантия Прайм/VIP', value: '100% возврат денег' },
    ],
    cardTelemetry: {
      topChip: 'QUALITY GATE · DEPLOY',
      centerHeadline: '4 / 4 PASS',
      centerSub: 'СБОРКА И БЕЗОПАСНОСТЬ ПРОВЕРЕНЫ',
      footerCode: 'DEPLOY: GREEN · 0 LOCK-IN',
    },
  },
};

export const EXTRA_SPLIT_PILLARS: Record<
  'LV' | 'TM',
  {
    readonly code: 'LV' | 'TM';
    readonly nameRu: string;
    readonly iconEmoji: string;
    readonly splitLeft: string;
    readonly splitRight: string;
    readonly splitSubword: string;
    readonly story: string;
    readonly metrics: [
      { readonly label: string; readonly value: string },
      { readonly label: string; readonly value: string },
      { readonly label: string; readonly value: string }
    ];
  }
> = {
  LV: {
    code: 'LV',
    nameRu: 'Живой стрим LIVE',
    iconEmoji: '🔴',
    splitLeft: 'ЖИВОЙ',
    splitRight: 'ПРОГРЕСС',
    splitSubword: 'REALTIME AI STREAM · SSE',
    story:
      'Вкладка LIVE показывает в реальном времени каждую мысль и действие AI-воркера: какие файлы он читает, какие страницы верстает и сколько копеек стоил текущий запуск. Полная прозрачность без «чёрного ящика».',
    metrics: [
      { label: 'Стрим действий', value: 'В реальном времени' },
      { label: 'История запусков', value: 'Единая лента чата' },
      { label: 'Стоимость шага', value: 'Видна до копейки' },
    ],
  },
  TM: {
    code: 'TM',
    nameRu: 'Команда и Telegram',
    iconEmoji: '✈️',
    splitLeft: 'КОМАНДА',
    splitRight: 'И ТЕЛЕГРАМ',
    splitSubword: 'ROLES · ALERTS · MONITORING',
    story:
      'Приглашай партнёров и разработчиков в проект, раздавай роли, храни заметки и доступы в едином хабе. А сводки, упоминания и алерты мониторинга серверов мгновенно прилетают прямо в Telegram.',
    metrics: [
      { label: 'Уведомления', value: 'Прямо в Telegram' },
      { label: 'Мониторинг серверов', value: '24/7 авто-проверка' },
      { label: 'Доступы и база знаний', value: 'В одном месте' },
    ],
  },
};

export const WALKTHROUGH_STEPS = [
  {
    step: '01',
    title: 'Опиши идею словами — доска «Входящие»',
    desc: 'Бросаешь задачу простым языком без сложных ТЗ. Нажми на карточку — её заберёт AI, или перетащи в колонку «Сейчас», если хочешь сделать шаг сам.',
    caption: 'Экран 1 · Живая доска «Входящие» и очередь AI',
    badge: 'Черновик → В очереди',
    screenType: 'board' as const,
    shotUrl: '/shots/app-board.png',
    demoPrompt: 'Собери современный лендинг кофейни с меню из 12 позиций и формой брони в Telegram',
  },
  {
    step: '02',
    title: 'Живой ход работы (LIVE) и автопроверки',
    desc: 'Смотри в реальном времени, как AI читает структуру проекта, собирает компоненты, сжимает графику и прогоняет 4 из 4 предрелизных проверок.',
    caption: 'Экран 2 · LIVE-стрим выполнения (84% · 3,20 ₽) и 4/4 проверок',
    badge: 'AI делает → 4/4 проверок',
    screenType: 'live' as const,
    shotUrl: '/shots/app-board.png',
    demoPrompt: 'Добавь тёмную тему по системной настройке и проверь мобильную вёрстку на iPhone',
  },
  {
    step: '03',
    title: 'Деньги, расходы и чистая прибыль в рублях',
    desc: 'Вся экономика проекта как на ладони: оплаты от клиентов (+214 000 ₽), расходы на AI и хостинг (−85 600 ₽) и чистая прибыль (+128 400 ₽, маржа 60%).',
    caption: 'Экран 3 · Финансы проекта, операции и график прибыли',
    badge: 'Маржа 60% · +128 400 ₽',
    screenType: 'finance' as const,
    shotUrl: '/shots/app-finance.png',
    demoPrompt: 'Подключи оплату через СБП с предоплатой 30% и выведи аналитику выручки по месяцам',
  },
] as const;

export const USE_CASE_CATALOG = [
  {
    name: 'Собрать лендинг или сайт для запуска',
    category: 'Веб и маркетинг',
    priceHint: 'Готово за 15–30 мин · от 15 ₽ AI-бюджета',
    tags: ['AI', 'CL', 'DP'],
  },
  {
    name: 'Подключить Telegram-бота и уведомления',
    category: 'Боты и автоматизация',
    priceHint: 'Заявки, алерты и запись клиентов в TG',
    tags: ['AI', 'TM'],
  },
  {
    name: 'Добавить экран оплаты и приём платежей',
    category: 'Финтех и e-commerce',
    priceHint: 'Тарифы, корзина, СБП и вебхуки',
    tags: ['AI', 'FN', 'DP'],
  },
  {
    name: 'Включить автопилот развития продукта',
    category: 'Автопилот 24/7',
    priceHint: 'Сам предлагает и делает улучшения',
    tags: ['AI', 'CL', 'LV'],
  },
  {
    name: 'Сделать тёмную тему и адаптив под iPhone',
    category: 'UX/UI и дизайн-система',
    priceHint: 'С автопроверкой вёрстки без съезжаний',
    tags: ['AI', 'DP'],
  },
  {
    name: 'Вести доходы, расходы и маржу проекта в ₽',
    category: 'Финансы и аналитика',
    priceHint: 'Видно каждую трату на AI, домен и сервер',
    tags: ['FN', 'TM'],
  },
  {
    name: 'Мониторинг серверов и защита секретов',
    category: 'Инфраструктура и DevOps',
    priceHint: '4/4 проверок до выкатки + алерты 24/7',
    tags: ['DP', 'TM'],
  },
  {
    name: 'Работать на встроенном Claude без VPN',
    category: 'Онлайн-подписка LLM',
    priceHint: 'Прайм 1 900 ₽/мес · 1 час тест-драйва 0 ₽',
    tags: ['CL', 'AI'],
  },
] as const;

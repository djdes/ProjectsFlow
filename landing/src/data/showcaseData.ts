export type StackLayerId = 'layer-autopilot' | 'layer-claude' | 'layer-finance' | 'layer-deploy';
export type ChassisMode = 'exploded' | 'compact' | 'gyro';

export interface StackLayerSpec {
  id: StackLayerId;
  index: number; // 0 (bottom) to 3 (top)
  code: string;
  shortName: string;
  layerTag: string;
  giantWord: string;
  headline: string;
  accentHeadline: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  glowRgb: [number, number, number];
  stageGradient: string;
  leftBracketTitle: string;
  leftBracketSub: string;
  rightBracketTitle: string;
  rightBracketSub: string;
  SlabSpec: {
    topLabel: string;
    centerMetric: string;
    subMetric: string;
    statusCode: string;
    circuitPattern: 'neural' | 'kanban' | 'finance' | 'deploy';
  };
  metrics: {
    label: string;
    value: string;
    delta: string;
  }[];
  bullets: string[];
}

export interface TariffOption {
  id: 'free' | 'prime' | 'vip';
  name: string;
  badge: string;
  priceRub: number;
  priceFormatted: string;
  period: string;
  claudeQuota: string;
  autopilotMode: string;
  summary: string;
  highlight?: boolean;
  ctaText: string;
  features: string[];
}

export interface PromptPreset {
  id: string;
  title: string;
  shortTab: string;
  category: string;
  promptText: string;
  layerFocus: StackLayerId;
  estimatedTime: string;
  estimatedSavedRub: string;
  heroMetricValue: string;
  heroMetricLabel: string;
  generatedTasks: {
    code: string;
    title: string;
    role: string;
    status: 'done' | 'running' | 'queued';
    duration: string;
  }[];
  checks: {
    name: string;
    status: string;
  }[];
  pnlPreview: {
    expectedRevenue: string;
    infraCost: string;
    netMargin: string;
  };
}

export interface DesktopScreenStep {
  id: string;
  stepNum: string;
  title: string;
  subtitle: string;
  description: string;
  layerId: StackLayerId;
  accentColor: string;
  terminalCommand: string;
  windowTitle: string;
  windowUrl: string;
  kpis: { label: string; value: string; tone: string }[];
  uiBlocks: {
    title: string;
    badge: string;
    lines: string[];
  }[];
}

export const STACK_LAYERS: StackLayerSpec[] = [
  {
    id: 'layer-autopilot',
    index: 3,
    code: '01 · АВТОПИЛОТ',
    shortName: 'Автопилот задач',
    layerTag: 'АВТОПИЛОТ PROJECTSFLOW · 1 ЧАС БЕСПЛАТНО',
    giantWord: 'AUTOPILOT',
    headline: 'ОПИШИ ИДЕЮ —',
    accentHeadline: 'ДОСКА ДВИЖЕТСЯ САМА',
    description:
      'Пишете цель своими словами — платформа сама разбивает её на задачи, пишет код и доводит до готового результата.',
    primaryColor: '#ff2e63',
    secondaryColor: '#b8144d',
    accentColor: '#ffe66d',
    glowRgb: [255, 46, 99],
    stageGradient:
      'radial-gradient(circle at 60% 28%, #c9184a 0%, #590d22 46%, #13040c 92%)',
    leftBracketTitle: 'От текста до плана',
    leftBracketSub: 'За 3 секунды без ТЗ',
    rightBracketTitle: '2 режима работы',
    rightBracketSub: 'Автопилот или шаг за шагом',
    SlabSpec: {
      topLabel: 'LAYER 01 // AUTOPILOT ENGINE',
      centerMetric: '10.6× ТЕМП',
      subMetric: 'ИДЕЯ -> КОД -> ГОТОВЫЙ ПРОДУКТ',
      statusCode: 'MODE: AUTOPILOT · 1 ЧАС БЕСПЛАТНО',
      circuitPattern: 'kanban',
    },
    metrics: [
      { label: 'Старт проекта', value: '3 сек', delta: 'Из 1 фразы' },
      { label: 'Ускорение релиза', value: '10.6×', delta: 'Без рутины' },
      { label: 'Тест Прайма', value: '1 час', delta: 'Бесплатно' },
    ],
    bullets: [
      'Два режима: полный «Автопилот» или «Шаг за шагом»',
      'Наглядная канбан-доска без сложных настроек',
    ],
  },
  {
    id: 'layer-claude',
    index: 2,
    code: '02 · CLAUDE AI',
    shortName: 'Claude уже внутри',
    layerTag: 'CLAUDE ОНЛАЙН · БЕЗ VPN И КЛЮЧЕЙ',
    giantWord: 'CLAUDE AI',
    headline: 'ПОДПИСКА CLAUDE',
    accentHeadline: 'УЖЕ ВСТРОЕНА ВНУТРИ',
    description:
      'На тарифах «Прайм» и «VIP» передовой Claude работает сразу из коробки — без VPN, зарубежных карт и покупки API-ключей.',
    primaryColor: '#9d4edd',
    secondaryColor: '#5a189a',
    accentColor: '#ff9e00',
    glowRgb: [157, 78, 221],
    stageGradient:
      'radial-gradient(circle at 60% 28%, #6831b8 0%, #31105e 46%, #0c061a 92%)',
    leftBracketTitle: 'Без VPN и ключей',
    leftBracketSub: 'Встроенная подписка от нас',
    rightBracketTitle: 'Гибкий выбор',
    rightBracketSub: 'Наш Claude или свой аккаунт',
    SlabSpec: {
      topLabel: 'LAYER 02 // BUILT-IN CLAUDE CORE',
      centerMetric: '0 КЛЮЧЕЙ',
      subMetric: 'CLAUDE ОНЛАЙН ОТ НАС · БЕЗ VPN',
      statusCode: 'CLAUDE: READY · QUOTA: INCLUDED',
      circuitPattern: 'neural',
    },
    metrics: [
      { label: 'Настройка VPN', value: '0 мин', delta: 'Работает сразу' },
      { label: 'Свой Claude', value: '0 ₽', delta: 'На бесплатном' },
      { label: 'Прайм с Claude', value: '1 900 ₽', delta: 'Всё включено' },
    ],
    bullets: [
      'Встроенный Claude от нас на Прайме и VIP',
      'Возможность подключить свой Claude бесплатно',
    ],
  },
  {
    id: 'layer-finance',
    index: 1,
    code: '03 · ФИНАНСЫ ₽',
    shortName: 'Деньги и P&L в ₽',
    layerTag: 'ЮНИТ-ЭКОНОМИКА · ВСЁ В РУБЛЯХ',
    giantWord: 'FINANCE ₽',
    headline: 'ПРИБЫЛЬ И РАСХОДЫ',
    accentHeadline: 'ПРОЗРАЧНО В РУБЛЯХ',
    description:
      'Доходы, себестоимость генерации и чистая маржа по каждому проекту считаются автоматически в рублях на одном экране.',
    primaryColor: '#00b4d8',
    secondaryColor: '#0077b6',
    accentColor: '#ffd166',
    glowRgb: [0, 180, 216],
    stageGradient:
      'radial-gradient(circle at 60% 28%, #1d84b5 0%, #0b3b66 46%, #05101f 92%)',
    leftBracketTitle: 'P&L дашборд в ₽',
    leftBracketSub: 'Доходы, расходы и маржа',
    rightBracketTitle: 'Оплата в рублях',
    rightBracketSub: 'Никаких конвертаций в $',
    SlabSpec: {
      topLabel: 'LAYER 03 // RUB UNIT ECONOMICS',
      centerMetric: '+214 000 ₽',
      subMetric: 'ЧИСТАЯ ПРИБЫЛЬ · МАРЖА 71%',
      statusCode: 'P&L: REALTIME · CURRENCY: RUB',
      circuitPattern: 'finance',
    },
    metrics: [
      { label: 'Чистая прибыль', value: '+214 000 ₽', delta: 'Маржа 71%' },
      { label: 'Валюта учёта', value: '100% ₽', delta: 'Без курсов $' },
      { label: 'Сводка P&L', value: 'За 1 сек', delta: 'Без таблиц' },
    ],
    bullets: [
      'Автоматический расчёт окупаемости каждого проекта',
      'Понятная картина расходов на команду и ИИ в рублях',
    ],
  },
  {
    id: 'layer-deploy',
    index: 0,
    code: '04 · РЕЛИЗ CI',
    shortName: 'Проверки и Релиз',
    layerTag: '4 АВТОПРОВЕРКИ · ЖИВОЕ ПРЕВЬЮ',
    giantWord: 'DEPLOY CI',
    headline: 'ЧЕТЫРЕ ЩИТА ПРОВЕРКИ',
    accentHeadline: 'И ЖИВОЙ СТЕНД',
    description:
      'Каждая задача проходит 4 автопроверки перед релизом, а готовый результат сразу открывается по живой ссылке.',
    primaryColor: '#f97316',
    secondaryColor: '#9a3412',
    accentColor: '#fde047',
    glowRgb: [249, 115, 22],
    stageGradient:
      'radial-gradient(circle at 60% 28%, #b45309 0%, #451a03 46%, #140803 92%)',
    leftBracketTitle: 'Живой просмотр',
    leftBracketSub: 'Готовый сайт по ссылке',
    rightBracketTitle: '4 щита качества',
    rightBracketSub: 'Сборка · Типы · Тесты · Git',
    SlabSpec: {
      topLabel: 'LAYER 04 // 4-GATE QA & LIVE DEPLOY',
      centerMetric: '4 / 4 PASS',
      subMetric: 'ЖИВОЙ СТЕНД · 100% ВАШ GIT',
      statusCode: 'SSL: ACTIVE · CODE: 100% YOURS',
      circuitPattern: 'deploy',
    },
    metrics: [
      { label: 'Автопроверки', value: '4 из 4', delta: 'До выкладки' },
      { label: 'Живой стенд', value: '< 15 сек', delta: 'По ссылке' },
      { label: 'Права на код', value: '100%', delta: 'Ваш Git' },
    ],
    bullets: [
      'Автоматический контроль качества перед каждым релизом',
      '100% исходного кода и Git остаются в вашей собственности',
    ],
  },
];

export const TARIFF_OPTIONS: TariffOption[] = [
  {
    id: 'free',
    name: 'Бесплатный',
    badge: 'СТАРТ · СВОЙ CLAUDE',
    priceRub: 0,
    priceFormatted: '0 ₽',
    period: 'навсегда',
    claudeQuota: 'Свой подключённый Claude',
    autopilotMode: 'Доска + Шаг за шагом',
    summary: 'Канбан-доска, учёт финансов в ₽ и работа со своим аккаунтом Claude.',
    ctaText: 'Начать бесплатно',
    features: [
      'Канбан-доска и декомпозиция задач',
      'Подключение своего аккаунта Claude (0 ₽)',
      'Базовый учёт доходов и расходов в рублях',
      '100% прав на исходный код и Git',
    ],
  },
  {
    id: 'prime',
    name: 'Прайм',
    badge: 'ХИТ · 1 ЧАС БЕСПЛАТНО',
    priceRub: 1900,
    priceFormatted: '1 900 ₽',
    period: 'в месяц',
    claudeQuota: 'Встроенный Claude от нас',
    autopilotMode: 'Полный Автопилот + Шаг за шагом',
    summary: 'Подписка на Claude уже внутри (без VPN и ключей), полный Автопилот и P&L в рублях.',
    highlight: true,
    ctaText: 'Попробовать Прайм (1 час бесплатно)',
    features: [
      'Встроенный Claude от нас (без VPN и API-ключей)',
      '1 час тест-драйва бесплатно на вашем проекте',
      'Режимы «Автопилот» и «Шаг за шагом»',
      'Все 4 этапа автопроверок и живой стенд',
      'Полный финансовый дашборд P&L в ₽',
    ],
  },
  {
    id: 'vip',
    name: 'VIP',
    badge: 'МАКСИМУМ · X3 МОЩНОСТЬ',
    priceRub: 3900,
    priceFormatted: '3 900 ₽',
    period: 'в месяц',
    claudeQuota: 'Максимальный резерв Claude X3',
    autopilotMode: 'Мульти-проектный Автопилот',
    summary: 'Утроенный резерв Claude, приоритетная очередь сборок и портфельная аналитика для команд.',
    ctaText: 'Включить VIP-режим',
    features: [
      'Все возможности «Прайм» + X3 лимит Claude',
      'Приоритетные слоты для параллельных проектов',
      'Командные роли и совместный доступ',
      'Сводный P&L по всем проектам бизнеса',
    ],
  },
];

export const PROMPT_PRESETS: PromptPreset[] = [
  {
    id: 'preset-tg-shop',
    shortTab: '🛍 Telegram-магазин',
    title: 'Магазин в Telegram с оплатой по СБП',
    category: 'E-Commerce',
    promptText:
      'Витрина товаров в Telegram WebApp: каталог, корзина, оплата по СБП в рублях и расчёт чистой маржи с заказа.',
    layerFocus: 'layer-autopilot',
    estimatedTime: '22 минуты',
    estimatedSavedRub: '65 000 ₽ экономии',
    heroMetricValue: '+294 000 ₽',
    heroMetricLabel: 'Прогноз чистой прибыли / мес',
    generatedTasks: [
      { code: '01', title: 'Каталог, корзина и база заказов', role: 'Архитектор AI', status: 'done', duration: '40 сек' },
      { code: '02', title: 'Витрина Telegram WebApp и СБП в ₽', role: 'Fullstack AI', status: 'done', duration: '6 мин' },
      { code: '03', title: '4 автопроверки и живой стенд', role: 'QA Shield', status: 'running', duration: '2 мин' },
    ],
    checks: [
      { name: 'Сборка и типы', status: 'PASS' },
      { name: 'Защита оплаты', status: 'PASS' },
      { name: 'Мобильный вид', status: 'PASS' },
      { name: 'Живой стенд', status: 'ONLINE' },
    ],
    pnlPreview: {
      expectedRevenue: '380 000 ₽ / мес',
      infraCost: '1 900 ₽ (Прайм)',
      netMargin: '+294 000 ₽',
    },
  },
  {
    id: 'preset-saas-crm',
    shortTab: '📊 CRM для селлеров',
    title: 'Кабинет аналитики и заявок для селлеров',
    category: 'B2B SaaS',
    promptText:
      'Личный кабинет селлера: остатки по складам, юнит-экономика по артикулам в рублях и канбан закупок.',
    layerFocus: 'layer-finance',
    estimatedTime: '28 минут',
    estimatedSavedRub: '90 000 ₽ экономии',
    heroMetricValue: '+445 000 ₽',
    heroMetricLabel: 'Прогноз чистой прибыли / мес',
    generatedTasks: [
      { code: '01', title: 'Схема артикулов, партий и ролей', role: 'Архитектор AI', status: 'done', duration: '55 сек' },
      { code: '02', title: 'Дашборд P&L по каждому SKU в ₽', role: 'Finance AI', status: 'done', duration: '5 мин' },
      { code: '03', title: 'Тесты прав доступа и публикация', role: 'QA Shield', status: 'running', duration: '3 мин' },
    ],
    checks: [
      { name: 'Роли доступа', status: 'PASS' },
      { name: 'Сверка маржи ₽', status: 'PASS' },
      { name: 'Сборка проекта', status: 'PASS' },
      { name: 'Живой стенд', status: 'ONLINE' },
    ],
    pnlPreview: {
      expectedRevenue: '520 000 ₽ / мес',
      infraCost: '3 900 ₽ (VIP)',
      netMargin: '+445 000 ₽',
    },
  },
  {
    id: 'preset-ai-support',
    shortTab: '🤖 ИИ-портал команды',
    title: 'Внутренний AI-портал базы знаний и заявок',
    category: 'AI Workspace',
    promptText:
      'Портал поддержки: ответы по регламентам через встроенный Claude, карточки тикетов и отчёт по скорости.',
    layerFocus: 'layer-claude',
    estimatedTime: '19 минут',
    estimatedSavedRub: '55 000 ₽ экономии',
    heroMetricValue: '+138 000 ₽',
    heroMetricLabel: 'Экономия ФОТ каждый месяц',
    generatedTasks: [
      { code: '01', title: 'Подключение регламентов к Claude Онлайн', role: 'Claude Core', status: 'done', duration: '45 сек' },
      { code: '02', title: 'Окно оператора с подсказками ИИ', role: 'Frontend AI', status: 'done', duration: '4 мин' },
      { code: '03', title: 'Проверка безопасности и релиз', role: 'QA Shield', status: 'running', duration: '2 мин' },
    ],
    checks: [
      { name: 'Claude без VPN', status: 'PASS' },
      { name: 'Защита данных', status: 'PASS' },
      { name: 'Скорость < 50мс', status: 'PASS' },
      { name: 'Живой стенд', status: 'ONLINE' },
    ],
    pnlPreview: {
      expectedRevenue: '140 000 ₽ выгоды',
      infraCost: '1 900 ₽ (Прайм)',
      netMargin: '+138 100 ₽',
    },
  },
];

export const DESKTOP_WORKFLOW_STEPS: DesktopScreenStep[] = [
  {
    id: 'step-01',
    stepNum: '01',
    title: 'Опишите идею своими словами',
    subtitle: 'Встроенный Claude без VPN',
    description:
      'Никаких сложных ТЗ: напишите, какой продукт нужен, и встроенный Claude за 3 секунды соберёт план задач на доске.',
    layerId: 'layer-claude',
    accentColor: '#c084fc',
    terminalCommand: 'projectsflow init --mode=autopilot --claude=builtin-prime',
    windowTitle: 'Шаг 01 — Создание проекта с Claude Онлайн',
    windowUrl: 'projectsflow.ru/new',
    kpis: [
      { label: 'Подписка Claude', value: 'Встроена', tone: '#c084fc' },
      { label: 'План на доске', value: 'За 3 сек', tone: '#ff2e63' },
      { label: 'Настройка VPN', value: '0 минут', tone: '#38bdf8' },
    ],
    uiBlocks: [
      {
        title: 'Ваш запрос на русском языке',
        badge: 'ИДЕЯ',
        lines: [
          '«Сервис онлайн-записи с предоплатой в рублях и уведомлениями в Telegram»',
        ],
      },
      {
        title: 'Готовый план на Канбан-доске',
        badge: 'АВТО-БЭКЛОГ',
        lines: [
          '✓ Создано 12 карточек: База данных, Календарь слотов, Оплата в ₽, Живой стенд',
        ],
      },
    ],
  },
  {
    id: 'step-02',
    stepNum: '02',
    title: 'Запустите Автопилот или Шаг за шагом',
    subtitle: 'Живое движение по доске',
    description:
      'На «Автопилоте» задачи выполняются сами до превью. В режиме «Шаг за шагом» вы одобряете каждый ключевой этап.',
    layerId: 'layer-autopilot',
    accentColor: '#ff2e63',
    terminalCommand: 'projectsflow autopilot run --verify-all',
    windowTitle: 'Шаг 02 — Канбан-доска Автопилота',
    windowUrl: 'projectsflow.ru/board',
    kpis: [
      { label: 'Режим работы', value: 'Автопилот', tone: '#ff2e63' },
      { label: 'Автопроверки', value: '4 из 4 PASS', tone: '#fde047' },
      { label: 'Скорость', value: '10.6× быстрее', tone: '#38bdf8' },
    ],
    uiBlocks: [
      {
        title: 'Исполнение задач в реальном времени',
        badge: 'В РАБОТЕ',
        lines: [
          '⚡ ИИ-агент пишет код интерфейса и серверных маршрутов, прогоняя 4 проверки качества',
        ],
      },
      {
        title: 'Мгновенный живой просмотр',
        badge: 'ПРЕВЬЮ ГОТОВО',
        lines: [
          '✓ Стенд открывается прямо в браузере по ссылке — можно сразу тестировать',
        ],
      },
    ],
  },
  {
    id: 'step-03',
    stepNum: '03',
    title: 'Контролируйте прибыль в ₽ и релиз',
    subtitle: 'P&L дашборд + 100% ваш код',
    description:
      'Все доходы, расходы и чистая маржа проекта видны в рублях, а готовый код синхронизируется с вашим Git.',
    layerId: 'layer-finance',
    accentColor: '#38bdf8',
    terminalCommand: 'projectsflow release --pnl=rub --git=sync',
    windowTitle: 'Шаг 03 — Финансы в ₽ и Релиз',
    windowUrl: 'projectsflow.ru/finance',
    kpis: [
      { label: 'Чистая прибыль', value: '+214 000 ₽', tone: '#38bdf8' },
      { label: 'Маржинальность', value: '71.4%', tone: '#fde047' },
      { label: 'Права на код', value: '100% ваши', tone: '#ff2e63' },
    ],
    uiBlocks: [
      {
        title: 'Юнит-экономика проекта в рублях',
        badge: 'P&L В РУБЛЯХ',
        lines: [
          'Выручка: +299 600 ₽ · Расходы на ИИ: −1 900 ₽ · Чистая прибыль: +214 000 ₽',
        ],
      },
      {
        title: 'Релиз в 1 клик без привязки к платформе',
        badge: 'GIT SYNC',
        lines: [
          '✓ Сайт опубликован по HTTPS, весь исходный код в вашем репозитории',
        ],
      },
    ],
  },
];

export const FAQ_ITEMS = [
  {
    q: 'Нужен ли мне VPN или зарубежная карта, чтобы пользоваться Claude внутри ProjectsFlow?',
    a: 'Нет. На тарифах «Прайм» (1 900 ₽/мес) и «VIP» (3 900 ₽/мес) онлайн-подписка на Claude уже встроена от нас. Вы оплачиваете тариф в рублях и сразу работаете из браузера без VPN и покупки внешних API-ключей.',
  },
  {
    q: 'Как работает бесплатный пробный час на тарифе «Прайм»?',
    a: 'После регистрации вы можете активировать 1 час работы на «Прайме» бесплатно. Этого достаточно, чтобы описать идею своего проекта, увидеть автоматическую декомпозицию на доске и получить первое живое превью.',
  },
  {
    q: 'Чем отличается режим «Автопилот» от режима «Шаг за шагом»?',
    a: 'На «Автопилоте» платформа самостоятельно проводит задачи по всей доске — от архитектуры и кода до 4 проверок и живого стенда. В режиме «Шаг за шагом» ИИ ждёт вашего одобрения на каждом ключевом переходе.',
  },
  {
    q: 'Могу ли я подключить свой собственный аккаунт Claude на бесплатном тарифе?',
    a: 'Да! Тариф «Бесплатный» (0 ₽) позволяет подключить ваш собственный аккаунт Claude и пользоваться канбан-доской, декомпозицией и базовым финансовым учётом без абонентской платы.',
  },
  {
    q: 'Кому принадлежит код проекта и можно ли забрать его к себе?',
    a: 'Весь созданный код, миграции базы данных и конфигурация на 100% принадлежат вам. Вы в любой момент можете синхронизировать проект со своим GitHub/GitLab или развернуть его на собственном сервере.',
  },
];

export type StackLayerId = 'layer-claude' | 'layer-autopilot' | 'layer-finance' | 'layer-deploy';
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
  category: string;
  promptText: string;
  layerFocus: StackLayerId;
  estimatedTime: string;
  estimatedSavedRub: string;
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
    id: 'layer-deploy',
    index: 3,
    code: 'L4 · RELEASE',
    shortName: 'Релиз и Живой Превью',
    layerTag: 'СЛОЙ 04 · ЧТО ВИДЯТ ПОЛЬЗОВАТЕЛИ',
    giantWord: 'ДЕПЛОЙ CI',
    headline: 'ЧЕТЫРЕ ЩИТА ПРОВЕРКИ',
    accentHeadline: 'И РЕЛИЗ В 1 КЛИК',
    description:
      'Верхний уровень стека ProjectsFlow: каждая задача проходит 4 автоматических контура проверки (сборка, типы, безопасность, живой стенд) прежде чем попасть к клиентам.',
    primaryColor: '#38bdf8',
    secondaryColor: '#0284c7',
    accentColor: '#a3e635',
    glowRgb: [56, 189, 248],
    stageGradient:
      'radial-gradient(circle at 64% 26%, #0c2d48 0%, #071629 45%, #050811 90%)',
    leftBracketTitle: 'Живой стенд и UI',
    leftBracketSub: 'Мгновенное превью каждой ветки в браузере',
    rightBracketTitle: '4 контура защиты',
    rightBracketSub: 'Typecheck · Lint · Тесты · Секреты',
    SlabSpec: {
      topLabel: 'LAYER 04 // LIVE PRODUCTION & QA GATE',
      centerMetric: '4 / 4 PASS',
      subMetric: 'ZERO DOWNTIME · AUTO PREVIEW URL',
      statusCode: 'SSL: ACTIVE · GIT: 100% YOURS',
      circuitPattern: 'deploy',
    },
    metrics: [
      { label: 'Автопроверки до релиза', value: '4 из 4', delta: 'Без сломанных сборок' },
      { label: 'Живой стенд по ссылке', value: '< 15 сек', delta: 'Готов для показа клиенту' },
      { label: 'Права на Git и код', value: '100%', delta: 'Никакого vendor-lock' },
    ],
    bullets: [
      'Автоматический прогон сборки, тестов и проверки безопасности перед выкладкой',
      'Готовая ссылка на живой просмотр результата прямо из карточки задачи',
      'Полная синхронизация с вашим Git-репозиторием и моментальный откат в 1 клик',
    ],
  },
  {
    id: 'layer-finance',
    index: 2,
    code: 'L3 · FINANCE ₽',
    shortName: 'Юнит-экономика в ₽',
    layerTag: 'СЛОЙ 03 · ДЕНЬГИ И ОКУПАЕМОСТЬ',
    giantWord: 'ФИНАНСЫ ₽',
    headline: 'ПРИБЫЛЬ И РАСХОДЫ',
    accentHeadline: 'ПРОЗРАЧНО В РУБЛЯХ',
    description:
      'Финансовый слой прямо внутри рабочего пространства: доходы, себестоимость генерации, подписки, ФОТ и чистая маржа по каждому проекту считаются автоматически в рублях.',
    primaryColor: '#10b981',
    secondaryColor: '#047857',
    accentColor: '#fde047',
    glowRgb: [16, 185, 129],
    stageGradient:
      'radial-gradient(circle at 64% 26%, #093529 0%, #061c17 45%, #050811 90%)',
    leftBracketTitle: 'P&L дашборд проекта',
    leftBracketSub: 'Доходы, расходы и чистая прибыль в ₽',
    rightBracketTitle: 'Контроль юнит-маржи',
    rightBracketSub: 'Себестоимость ИИ и часов команды',
    SlabSpec: {
      topLabel: 'LAYER 03 // RUB UNIT ECONOMICS & P&L',
      centerMetric: '+214 000 ₽',
      subMetric: 'ЧИСТАЯ ПРИБЫЛЬ · МАРЖА 71.4%',
      statusCode: 'P&L: REALTIME · CURRENCY: RUB',
      circuitPattern: 'finance',
    },
    metrics: [
      { label: 'Чистая прибыль проекта', value: '+214 000 ₽', delta: '+34% к прошлому месяцу' },
      { label: 'Учёт расходов на ИИ', value: 'До 1 ₽', delta: 'Без скрытых списаний в $' },
      { label: 'Сводка для руководителя', value: 'За 1 сек', delta: 'Без таблиц Excel' },
    ],
    bullets: [
      'Наглядный баланс доходов, выплат и затрат по каждому проекту в рублях',
      'Понимание окупаемости каждой фичи ещё до того, как она уйдёт в разработку',
      'Все расчёты и тарифы в ₽ — никаких двойных конвертаций и зарубежных карт',
    ],
  },
  {
    id: 'layer-autopilot',
    index: 1,
    code: 'L2 · AUTOPILOT',
    shortName: 'Автопилот и Канбан',
    layerTag: 'СЛОЙ 02 · ОРКЕСТРАЦИЯ ЗАДАЧ',
    giantWord: 'АВТОПИЛОТ',
    headline: 'ОПИШИ ИДЕЮ — ДОСКА',
    accentHeadline: 'ДВИЖЕТСЯ САМА',
    description:
      'Слой автономного исполнения: вы пишете цель своими словами, а ProjectsFlow сам декомпозирует её в карточки Канбана, пишет код, проверяет результат и двигает задачи до «Готово».',
    primaryColor: '#a3e635',
    secondaryColor: '#4d7c0f',
    accentColor: '#38bdf8',
    glowRgb: [163, 230, 53],
    stageGradient:
      'radial-gradient(circle at 64% 26%, #1f3312 0%, #0e1a0b 45%, #050811 90%)',
    leftBracketTitle: 'Умная декомпозиция',
    leftBracketSub: 'Из 1 абзаца текста в готовый план работ',
    rightBracketTitle: '2 режима скорости',
    rightBracketSub: 'Полный автопилот или шаг за шагом',
    SlabSpec: {
      topLabel: 'LAYER 02 // AUTONOMOUS KANBAN ENGINE',
      centerMetric: '10.6× ТЕМП',
      subMetric: 'IDEA -> PLAN -> CODE -> REVIEW',
      statusCode: 'MODE: AUTOPILOT + STEP-BY-STEP',
      circuitPattern: 'kanban',
    },
    metrics: [
      { label: 'Старт по 1 описанию', value: '3 сек', delta: 'Готовый бэклог и архитектура' },
      { label: 'Скорость до релиза', value: '10.6×', delta: 'Быстрее ручной рутины' },
      { label: 'Режим контроля', value: 'Гибкий', delta: 'Автопилот / Шаг за шагом' },
    ],
    bullets: [
      'Два режима на выбор: полный «Автопилот» от идеи до превью или вдумчивый «Шаг за шагом»',
      'Понятная визуальная доска: всегда видно, какая задача пишется, а какая проходит ревью',
      'Командная работа: владельцы бизнеса, разработчики и ИИ-агенты работают в одном окне',
    ],
  },
  {
    id: 'layer-claude',
    index: 0,
    code: 'L1 · CLAUDE CORE',
    shortName: 'Ядро Claude Онлайн',
    layerTag: 'СЛОЙ 01 · ФУНДАМЕНТ ИИ БЕЗ VPN',
    giantWord: 'CLAUDE AI',
    headline: 'ПОДПИСКА CLAUDE',
    accentHeadline: 'УЖЕ ВСТРОЕНА ВНУТРИ',
    description:
      'Фундаментальный слой платформы: на тарифах «Прайм» и «VIP» передовые модели Claude уже включены. Не нужно искать зарубежные карты, настраивать VPN или покупать отдельные API-ключи.',
    primaryColor: '#c084fc',
    secondaryColor: '#6d28d9',
    accentColor: '#38bdf8',
    glowRgb: [192, 132, 252],
    stageGradient:
      'radial-gradient(circle at 64% 26%, #2b164d 0%, #120b29 45%, #050811 90%)',
    leftBracketTitle: 'Claude без VPN и ключей',
    leftBracketSub: 'Работает сразу после входа в аккаунт',
    rightBracketTitle: 'Гибкое подключение',
    rightBracketSub: 'Встроенный Claude или свой аккаунт',
    SlabSpec: {
      topLabel: 'LAYER 01 // BUILT-IN CLAUDE NEURAL CORE',
      centerMetric: '0 КЛЮЧЕЙ',
      subMetric: 'CLAUDE ОНЛАЙН ОТ НАС · БЕЗ VPN',
      statusCode: 'LATENCY: LOW · QUOTA: INCLUDED',
      circuitPattern: 'neural',
    },
    metrics: [
      { label: 'Настройка ключей и VPN', value: '0 мин', delta: 'Включено в Прайм и VIP' },
      { label: 'Тест-драйв Прайма', value: '1 час', delta: 'Бесплатно при старте' },
      { label: 'Свой Claude при желании', value: 'В 1 клик', delta: 'Полная свобода выбора' },
    ],
    bullets: [
      'Онлайн-подписка на Claude уже встроена в «Прайм» и «VIP» — открываете браузер и работаете',
      'Первый час на тарифе «Прайм» доступен бесплатно, чтобы проверить скорость на реальной задаче',
      'Если у вас уже есть собственный Claude — подключите его на бесплатном тарифе без ограничений',
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
    summary: 'Идеально для старта: канбан-доска, учёт финансов в ₽ и работа со своим подключённым аккаунтом Claude.',
    ctaText: 'Начать бесплатно',
    features: [
      'Канбан-доска проектов и декомпозиция задач',
      'Подключение своего аккаунта Claude без наценок',
      'Базовый учёт доходов и расходов проекта в рублях',
      '100% прав на исходный код и Git-репозиторий',
    ],
  },
  {
    id: 'prime',
    name: 'Прайм',
    badge: 'ХИТ · 1 ЧАС БЕСПЛАТНО',
    priceRub: 1900,
    priceFormatted: '1 900 ₽',
    period: 'в месяц',
    claudeQuota: 'Встроенный Claude Онлайн от нас',
    autopilotMode: 'Полный Автопилот + Шаг за шагом',
    summary: 'Встроенная подписка на Claude без VPN и ключей, полный Автопилот, 4 контура проверки и P&L-аналитика.',
    highlight: true,
    ctaText: 'Попробовать Прайм (1 час бесплатно)',
    features: [
      'Встроенная онлайн-подписка на Claude от нас (без VPN и ключей)',
      '1 час тест-драйва бесплатно прямо на вашем проекте',
      'Режимы «Автопилот» и «Шаг за шагом» без ограничений',
      'Все 4 этапа автопроверок и живой просмотр стенда',
      'Полный финансовый дашборд P&L и маржинальности в ₽',
    ],
  },
  {
    id: 'vip',
    name: 'VIP',
    badge: 'МАКСИМУМ · КОМАНДЫ И СТУДИИ',
    priceRub: 3900,
    priceFormatted: '3 900 ₽',
    period: 'в месяц',
    claudeQuota: 'Максимальный приоритет Claude X3',
    autopilotMode: 'Мульти-проектный Автопилот + Команда',
    summary: 'Увеличенный резерв генераций Claude, приоритетная очередь сборок, командные роли и сводный P&L по портфелю.',
    ctaText: 'Включить VIP-режим',
    features: [
      'Все возможности «Прайм» + утроенный лимит встроенного Claude',
      'Приоритетные вычислительные слоты для параллельных проектов',
      'Командный доступ, роли участников и аудит действий',
      'Портфельная P&L-сводка по всем проектам студии или бизнеса',
    ],
  },
];

export const PROMPT_PRESETS: PromptPreset[] = [
  {
    id: 'preset-tg-shop',
    title: 'Telegram WebApp магазин с оплатой в ₽',
    category: 'E-Commerce / Bot',
    promptText:
      'Собери витрину букетов и подарков в Telegram WebApp: каталог с фильтрами, корзина, оплата по СБП в рублях, уведомления курьеру и панель учёта маржи с каждого заказа.',
    layerFocus: 'layer-autopilot',
    estimatedTime: '22 мин на Автопилоте',
    estimatedSavedRub: 'Экономия ~65 000 ₽ на старте',
    generatedTasks: [
      { code: 'PF-101', title: 'Схема каталога, корзины и статусов заказа', role: 'Архитектор AI', status: 'done', duration: '40 сек' },
      { code: 'PF-102', title: 'Интерфейс Telegram WebApp + витрина и фильтры', role: 'Frontend AI', status: 'done', duration: '4 мин' },
      { code: 'PF-103', title: 'Шлюз СБП в ₽ и вебхуки подтверждения оплаты', role: 'Backend AI', status: 'running', duration: '6 мин' },
      { code: 'PF-104', title: 'Автопроверка безопасности и деплой превью-стенда', role: 'QA Shield', status: 'queued', duration: '2 мин' },
    ],
    checks: [
      { name: 'Типизация TypeScript', status: 'PASS · 0 ошибок' },
      { name: 'Защита вебхуков оплаты', status: 'PASS · HMAC проверен' },
      { name: 'Мобильный экран 390px', status: 'PASS · 0px overflow' },
      { name: 'Живой стенд предпросмотра', status: 'ONLINE · Готов' },
    ],
    pnlPreview: {
      expectedRevenue: '380 000 ₽ / мес',
      infraCost: '1 900 ₽ (тариф Прайм)',
      netMargin: '+294 000 ₽ чистыми',
    },
  },
  {
    id: 'preset-saas-crm',
    title: 'SaaS-кабинет аналитики и заявок для селлеров',
    category: 'B2B SaaS / CRM',
    promptText:
      'Нужен личный кабинет для селлеров: импорт остатков, расчёт юнит-экономики по артикулам в рублях, канбан заявок на закупку и роли для менеджеров.',
    layerFocus: 'layer-finance',
    estimatedTime: '28 мин на Автопилоте',
    estimatedSavedRub: 'Экономия ~90 000 ₽ на разработке',
    generatedTasks: [
      { code: 'PF-201', title: 'Модель данных артикулов, партий и ролей доступа', role: 'Архитектор AI', status: 'done', duration: '55 сек' },
      { code: 'PF-202', title: 'Дашборд P&L по каждому SKU в рублях', role: 'Finance AI', status: 'done', duration: '5 мин' },
      { code: 'PF-203', title: 'Канбан закупок и уведомления о низком остатке', role: 'Fullstack AI', status: 'running', duration: '7 мин' },
      { code: 'PF-204', title: 'API-тесты прав доступа и публикация стенда', role: 'QA Shield', status: 'queued', duration: '3 мин' },
    ],
    checks: [
      { name: 'Изоляция ролей (RBAC)', status: 'PASS · 14 тестов' },
      { name: 'Точность расчёта маржи ₽', status: 'PASS · Сверка 100%' },
      { name: 'Сборка клиента и сервера', status: 'PASS · Чисто' },
      { name: 'Стенд для демонстрации', status: 'ONLINE · Готов' },
    ],
    pnlPreview: {
      expectedRevenue: '520 000 ₽ / мес',
      infraCost: '3 900 ₽ (тариф VIP)',
      netMargin: '+445 000 ₽ чистыми',
    },
  },
  {
    id: 'preset-ai-support',
    title: 'Внутренний AI-портал базы знаний и тикетов',
    category: 'AI Workspace',
    promptText:
      'Создай портал для команды поддержки: поиск ответов по регламентам через встроенный Claude, карточка обращения клиента, подсказки оператору и отчёт по скорости ответа.',
    layerFocus: 'layer-claude',
    estimatedTime: '19 мин на Автопилоте',
    estimatedSavedRub: 'Экономия ~55 000 ₽ + 0 ₽ за VPN',
    generatedTasks: [
      { code: 'PF-301', title: 'Индексация регламентов и контур встроенного Claude', role: 'Claude Core', status: 'done', duration: '45 сек' },
      { code: 'PF-302', title: 'Рабочее место оператора с быстрыми ответами ИИ', role: 'Frontend AI', status: 'done', duration: '4 мин' },
      { code: 'PF-303', title: 'Метрики SLA и стоимости обработки тикета в ₽', role: 'Analytics AI', status: 'running', duration: '4 мин' },
      { code: 'PF-304', title: 'Проверка отсутствия утечек данных и релиз', role: 'QA Shield', status: 'queued', duration: '2 мин' },
    ],
    checks: [
      { name: 'Канал Claude Онлайн', status: 'PASS · Без VPN' },
      { name: 'Фильтрация приватных данных', status: 'PASS · Защищено' },
      { name: 'Отклик интерфейса', status: 'PASS · < 50 мс' },
      { name: 'Живой стенд команды', status: 'ONLINE · Готов' },
    ],
    pnlPreview: {
      expectedRevenue: 'Экономия 140 000 ₽ ФОТ',
      infraCost: '1 900 ₽ (тариф Прайм)',
      netMargin: '+138 100 ₽ выгоды',
    },
  },
];

export const DESKTOP_WORKFLOW_STEPS: DesktopScreenStep[] = [
  {
    id: 'step-01',
    stepNum: '01',
    title: 'Формулировка идеи и декомпозиция',
    subtitle: 'Слой 01–02 · Встроенный Claude + Канбан',
    description:
      'Вы описываете продукт обычным русским языком. Встроенный Claude мгновенно разбивает цель на понятные этапы, создаёт структуру БД, API и задачи на доске.',
    layerId: 'layer-claude',
    accentColor: '#c084fc',
    terminalCommand: 'projectsflow init --mode=autopilot --claude=builtin-prime',
    windowTitle: 'ProjectsFlow Studio — Декомпозиция идеи с Claude Онлайн',
    windowUrl: 'https://projectsflow.ru/workspace/new-project',
    kpis: [
      { label: 'Статус Claude', value: 'Онлайн · Встроен', tone: '#c084fc' },
      { label: 'Задач создано', value: '12 карточек', tone: '#a3e635' },
      { label: 'Время старта', value: '2.8 сек', tone: '#38bdf8' },
    ],
    uiBlocks: [
      {
        title: 'Входящий запрос владельца продукта',
        badge: 'PROMPT -> SPEC',
        lines: [
          '«Сделать сервис бронирования студий с предоплатой в рублях, календарём слотов и Telegram-уведомлениями»',
          '✓ Сформирована архитектура: 4 таблицы, 6 REST-маршрутов, 5 экранов клиента',
        ],
      },
      {
        title: 'Автоматический бэклог Канбана',
        badge: 'READY TO RUN',
        lines: [
          '[PF-01] Схема слотов и броней в БД — Готово к запуску',
          '[PF-02] Календарь выбора времени и оплата в ₽ — В очереди Автопилота',
        ],
      },
    ],
  },
  {
    id: 'step-02',
    stepNum: '02',
    title: 'Автопилот или Шаг за шагом',
    subtitle: 'Слой 02 · Живое исполнение на доске',
    description:
      'Выберите темп: на «Автопилоте» платформа сама берёт карточки в работу и пишет код. В режиме «Шаг за шагом» вы подтверждаете каждое архитектурное решение.',
    layerId: 'layer-autopilot',
    accentColor: '#a3e635',
    terminalCommand: 'projectsflow autopilot run --parallel=3 --verify-each',
    windowTitle: 'ProjectsFlow Studio — Живая Канбан-доска Автопилота',
    windowUrl: 'https://projectsflow.ru/workspace/board',
    kpis: [
      { label: 'Режим доски', value: 'Автопилот ON', tone: '#a3e635' },
      { label: 'В работе сейчас', value: '3 агента', tone: '#38bdf8' },
      { label: 'Готовность спринта', value: '84%', tone: '#10b981' },
    ],
    uiBlocks: [
      {
        title: 'Колонка «В работе» (ИИ-исполнение)',
        badge: 'LIVE CODING',
        lines: [
          '⚡ Генерация компонента расписания и валидации пересечений слотов...',
          '⚡ Подключение серверных проверок прав доступа и API-тестов...',
        ],
      },
      {
        title: 'Колонка «Проверка качества»',
        badge: 'QA GATE 4/4',
        lines: [
          '✓ Сборка клиента и сервера без ошибок (0 warnings)',
          '✓ Стендовое окружение обновлено: preview-booking.projectsflow.ru',
        ],
      },
    ],
  },
  {
    id: 'step-03',
    stepNum: '03',
    title: 'Юнит-экономика в ₽ и релиз в продакшен',
    subtitle: 'Слой 03–04 · Финансы P&L + Живой продукт',
    description:
      'Прежде чем выкатить релиз в 1 клик, вы видите полную финансовую картину проекта в рублях: сколько стоила разработка, какая маржа и как выглядит живой сайт.',
    layerId: 'layer-finance',
    accentColor: '#10b981',
    terminalCommand: 'projectsflow release --target=production --pnl-report=rub',
    windowTitle: 'ProjectsFlow Studio — P&L Финансы в ₽ и Релиз',
    windowUrl: 'https://projectsflow.ru/workspace/finance-and-release',
    kpis: [
      { label: 'Чистая прибыль', value: '+214 000 ₽', tone: '#10b981' },
      { label: 'Рентабельность', value: '71.4% маржа', tone: '#fde047' },
      { label: 'Статус релиза', value: 'LIVE · HTTPS', tone: '#38bdf8' },
    ],
    uiBlocks: [
      {
        title: 'Финансовая сводка проекта (в рублях)',
        badge: 'P&L REALTIME',
        lines: [
          'Выручка по оплаченным заказам: +299 600 ₽ | Затраты на инфраструктуру и ИИ: −1 900 ₽',
          'Чистый финансовый результат: +214 000 ₽ (окупаемость тарифа Прайм — с первого дня)',
        ],
      },
      {
        title: 'Готовый релиз и передача прав',
        badge: '100% YOUR CODE',
        lines: [
          '✓ Продакшен-сборка опубликована, SSL-сертификат активен',
          '✓ Весь исходный код синхронизирован с вашим Git-репозиторием',
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

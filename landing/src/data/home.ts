// Тексты главной (landing/src/pages/index.astro). Из этих же данных собираются /index.md и
// /llms-full.txt, поэтому правка здесь меняет и страницу, и описание для ИИ.
// Тарифы — pricing.ts, вопросы — faq.ts. `id` связывает пункт с его картинкой в компоненте.

export interface TitledText {
  readonly title: string;
  readonly text: string;
}

export interface Fact {
  readonly value: string;
  readonly text: string;
}

export const HERO = {
  badgeStrong: 'Claude уже внутри',
  badgeRest: 'без ключей и VPN',
  titleA: 'Опиши идею.',
  titleB: 'Получи готовый продукт.',
  lead: 'Платформа для тех, кто строит с AI. Описываешь задачу словами, воркеры делают её в твоём проекте, а ты смотришь вживую и принимаешь результат.',
  note: 'Бесплатный тариф навсегда. Карта не нужна.',
  noteMore: 'Работает в браузере, на iPhone и в Telegram.',
  noteMoreLink: 'Где ещё',
} as const;

/** Главная фраза: на странице слова загораются по одному. */
export const STATEMENT =
  'Трекеры хранят задачи. ProjectsFlow их делает: AI-воркеры берут карточки с доски, пишут код, проверяют его и приносят тебе готовый результат на утверждение.';

export const FACTS: readonly Fact[] = [
  { value: '0 ₽', text: 'чтобы начать: бесплатный тариф навсегда' },
  { value: '1 час', text: 'Прайма бесплатно и без карты' },
  { value: 'в рублях', text: 'расход каждого проекта на виду' },
  { value: 'всё твоё', text: 'код и результат: уходишь и забираешь' },
];

export const BIG_FEATURES: readonly (TitledText & { readonly id: 'live' | 'autopilot' })[] = [
  {
    id: 'live',
    title: 'LIVE-лента: видно каждое действие',
    text: 'Что AI читает, что правит и какие проверки запускает, видно прямо сейчас. Твои комментарии и действия воркера идут одной лентой, история остаётся в задаче.',
  },
  {
    id: 'autopilot',
    title: 'Автопилот: проект движется сам',
    text: 'Включаешь, и платформа сама придумывает следующие шаги к цели и делает их, пока ты занят другим. Возвращаешься, а прогресс уже есть.',
  },
];

export const STEPS: readonly (TitledText & { readonly id: 'idea' | 'workers' | 'checks' | 'accept' })[] = [
  { id: 'idea', title: 'Опиши идею', text: 'Словами, как другу. Платформа разложит её на задачи и выложит на доску.' },
  {
    id: 'workers',
    title: 'AI берёт задачи',
    text: 'Воркеры работают прямо в репозитории проекта. Каждое их действие видно в LIVE-ленте задачи.',
  },
  {
    id: 'checks',
    title: 'Проверки до показа',
    text: 'Прежде чем показать результат, воркер прогоняет сборку и тесты и поднимает живой стенд.',
  },
  {
    id: 'accept',
    title: 'Ты принимаешь',
    text: 'Смотришь стенд и принимаешь работу. Не то? Пишешь, что поправить, и отправляешь на доработку.',
  },
];

export type DetailId = 'team' | 'telegram' | 'commits' | 'finance' | 'monitoring' | 'together' | 'public' | 'search';

export const DETAILS: readonly (TitledText & { readonly id: DetailId })[] = [
  { id: 'team', title: 'Командная работа', text: 'Приглашай людей, раздавай роли и ведите проект вместе.' },
  { id: 'telegram', title: 'Уведомления в Telegram', text: 'Сводки, упоминания и итоги задач приходят прямо в Telegram.' },
  { id: 'commits', title: 'Коммиты у задач', text: 'Каждый коммит привязан к своей задаче: видно, что и когда поменялось.' },
  { id: 'finance', title: 'Финансы проекта', text: 'Доходы, расходы и прибыль по проекту на виду, в рублях.' },
  { id: 'monitoring', title: 'Мониторинг серверов', text: 'Следим за здоровьем серверов и заранее предупреждаем о проблемах.' },
  { id: 'together', title: 'Всё в одном месте', text: 'Заметки, доступы и история рядом, а не по чатам.' },
  { id: 'public', title: 'Публичная доска', text: 'Покажи прогресс клиенту или команде по одной ссылке.' },
  { id: 'search', title: 'Поиск за секунду', text: 'Нажми ⌘K, и любая задача или проект перед тобой.' },
];

export type PlatformId = 'browser' | 'iphone' | 'telegram' | 'mcp' | 'github';

/** `name` — полное название (для /index.md), `title` и `note` — карточка веера «Где работает». */
export const PLATFORMS: readonly { readonly id: PlatformId; readonly name: string; readonly title: string; readonly note: string }[] = [
  { id: 'browser', name: 'Браузер', title: 'Браузер', note: 'любой компьютер' },
  { id: 'iphone', name: 'iPhone как приложение', title: 'iPhone', note: 'как приложение' },
  { id: 'telegram', name: 'Telegram', title: 'Telegram', note: 'сводки и ответы' },
  { id: 'mcp', name: 'Claude Code через MCP', title: 'Claude Code', note: 'через MCP' },
  { id: 'github', name: 'GitHub', title: 'GitHub', note: 'коммиты у задач' },
];

export const GUARANTEES: readonly (TitledText & { readonly id: 'trial' | 'refund' | 'help' | 'nolockin' })[] = [
  { id: 'trial', title: 'Первый час бесплатно', text: 'Прайм можно попробовать час без карты.' },
  { id: 'refund', title: 'Вернём деньги', text: 'Платный тариф не подошёл, оформим возврат без допросов.' },
  { id: 'help', title: 'Поможем, если застрял', text: 'Что-то не вышло, разберёмся вместе и бесплатно.' },
  { id: 'nolockin', title: 'Никакого лок-ина', text: 'Всё, что создаёшь, твоё. Уходишь и забираешь с собой.' },
];

export const FINAL = {
  titleA: 'Опиши первую задачу сегодня.',
  titleB: 'Первый результат увидишь уже в первый час.',
} as const;

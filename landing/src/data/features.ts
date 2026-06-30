// Ключевые ценности для секции Features (P1). Соответствуют контент-контракту плана §4.
// icon — ключ, маппится на inline-SVG path в Features.astro (line-иконки, циан-плитка).

export interface Feature {
  readonly icon: 'board' | 'automation' | 'finance' | 'subscription' | 'github';
  readonly title: string;
  readonly body: string;
  /** Моно-метка-акцент (как код-мотив в dev-cool). */
  readonly tag?: string;
}

export const FEATURES: readonly Feature[] = [
  {
    icon: 'board',
    title: 'Доска + колонка Worker',
    body:
      'Канбан для твоих проектов с колонкой воркера. Бросаешь задачу — AI пишет код, коммитит и деплоит. Каждый коммит привязан к задаче.',
    tag: '--col worker',
  },
  {
    icon: 'automation',
    title: 'Автоматизация',
    body:
      'Диспетчер сам генерит задачи по твоим критериям и выполняет их в тихом режиме, пока не достигнут лимит. Меньше рутины — больше готового кода.',
    tag: 'auto-dispatch',
  },
  {
    icon: 'finance',
    title: 'Финучёт по проекту',
    body:
      'Видишь расход на AI и API по каждому проекту — прозрачно, в рублях, без сюрпризов в конце месяца. Каждый рубль на виду.',
    tag: '₽ / project',
  },
  {
    icon: 'subscription',
    title: 'Встроенная AI-подписка',
    body:
      'Не подключаешь свои ключи и не упираешься в чужие лимиты. Работаешь по нашей подписке — один тариф на все проекты.',
    tag: 'no keys',
  },
] as const;

// Доп. возможности (GitHub-привязка, KB, секреты) — короткой строкой-полосой под карточками.
export const EXTRA_FEATURES: readonly string[] = [
  'GitHub-привязка',
  'Коммиты ↔ задачи',
  'База знаний (KB)',
  'Хранилище секретов',
];

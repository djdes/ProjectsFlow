// Навигационные ссылки лендинга (P1). Якоря на секции одной страницы.

export interface NavLink {
  readonly href: string;
  readonly label: string;
}

// Ссылки root-относительные (/#...), чтобы работать и со страниц блога, а не только с главной.
export const NAV_LINKS: readonly NavLink[] = [
  { href: '/#features', label: 'Возможности' },
  { href: '/#how', label: 'Как это работает' },
  { href: '/#pricing', label: 'Тарифы' },
  { href: '/blog', label: 'Блог' },
  { href: '/#faq', label: 'Вопросы' },
] as const;

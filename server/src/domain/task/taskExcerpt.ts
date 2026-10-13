// Превью описания задачи для событий ленты и уведомлений.
//
// Картинки и HTML редактора (figure-блок `<figure data-figure-image><img …></figure>`, `<img>`,
// цвет и подчёркивание `<span …>`) не тратят лимит символов и не попадают в текст. Иначе у
// задачи, которая начинается со скриншота, превью в 120 символов почти целиком уходило на тег:
// в ленте было «<figure data-…» или обрезанный заголовок («Исправит»). Переводы строк
// сохраняются — клиент берёт заголовок по первой строке. Описание из одних картинок —
// «Скриншот», как называет такую задачу клиент.
export function taskExcerpt(description: string | null | undefined, limit = 120): string {
  const source = description ?? '';
  const text = source
    .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length === 0) return source.trim().length > 0 ? 'Скриншот' : '';
  return text.slice(0, limit);
}

// Заголовок задачи (первая строка текста) — для событий, где нужен только он.
export function taskTitleExcerpt(description: string | null | undefined, limit = 80): string {
  return (taskExcerpt(description, 2000).split('\n')[0] ?? '').trim().slice(0, limit);
}

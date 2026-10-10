// Утилиты блога: время чтения из сырого markdown + тон метки по теме статьи.
// Русский темп чтения ~180 слов/мин.

const WPM = 180;

/** Оценка времени чтения (мин) по сырому markdown-телу статьи. */
export function readingMinutes(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ') // блоки кода не считаем
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // ссылки/картинки → их текст
    .replace(/[#>*_~|>-]/g, ' ');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WPM));
}

/** Тема → тон метки (пастельные теги Notion, как метки проектов в приложении). */
export const TOPIC_TONE: Record<string, string> = {
  Практика: 'pf-tone-orange',
  Продукт: 'pf-tone-blue',
  Деньги: 'pf-tone-green',
  Автоматизация: 'pf-tone-pink',
};

export function topicTone(topic: string): string {
  return TOPIC_TONE[topic] ?? 'pf-tone-gray';
}

/** Формат даты «1 июля 2026». */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

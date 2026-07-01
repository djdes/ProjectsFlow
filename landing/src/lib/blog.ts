// Утилиты блога: время чтения из сырого markdown + палитра обложек по теме.
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

/** Тема → мягкий градиент обложки (на токенах-совместимых цветах). */
export interface TopicStyle {
  readonly gradient: string;
  readonly ink: string;
}

export const TOPIC_STYLE: Record<string, TopicStyle> = {
  Практика: { gradient: 'linear-gradient(135deg, #e6f7fc, #cfeaf3)', ink: '#066f94' },
  Продукт: { gradient: 'linear-gradient(135deg, #eef1f6, #dfe6f0)', ink: '#3a4b66' },
  Деньги: { gradient: 'linear-gradient(135deg, #fdf0d9, #f7e2bd)', ink: '#7a5410' },
  Автоматизация: { gradient: 'linear-gradient(135deg, #e6f7ef, #d2efe0)', ink: '#0b6244' },
};

export function topicStyle(topic: string): TopicStyle {
  return TOPIC_STYLE[topic] ?? { gradient: 'linear-gradient(135deg, #eef1f6, #e2e8f0)', ink: '#3a4b66' };
}

/** Формат даты «1 июля 2026». */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

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

/** Тема → мягкий градиент обложки + иконка-мотив (svg-path) + цвет. */
export interface TopicStyle {
  readonly gradient: string;
  readonly ink: string;
  /** SVG-path d для иконки-мотива обложки (24×24, stroke=currentColor). */
  readonly icon: string;
}

export const TOPIC_STYLE: Record<string, TopicStyle> = {
  Практика: {
    gradient: 'linear-gradient(135deg, #eafaff 0%, #cfeaf3 100%)',
    ink: '#066f94',
    icon: 'M13 3 4 14h7l-1 7 9-11h-7l1-7Z', // молния — быстрый запуск
  },
  Продукт: {
    gradient: 'linear-gradient(135deg, #f2f5fb 0%, #dfe6f0 100%)',
    ink: '#3a4b66',
    icon: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8', // коробка/продукт
  },
  Деньги: {
    gradient: 'linear-gradient(135deg, #fff5e2 0%, #f7e2bd 100%)',
    ink: '#8a5d10',
    icon: 'M4 19V9m5 10V5m5 14v-6m5 6V8', // столбики — прибыль/траты
  },
  Автоматизация: {
    gradient: 'linear-gradient(135deg, #e9faf1 0%, #d2efe0 100%)',
    ink: '#0b6244',
    icon: 'M9 3h6M12 6V3M5 8h14a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1V9a1 1 0 011-1zM9 13h.01M15 13h.01', // робот-воркер
  },
};

export function topicStyle(topic: string): TopicStyle {
  return (
    TOPIC_STYLE[topic] ?? {
      gradient: 'linear-gradient(135deg, #f2f5fb, #e2e8f0)',
      ink: '#3a4b66',
      icon: 'M4 19V9m5 10V5m5 14v-6m5 6V8',
    }
  );
}

/** Формат даты «1 июля 2026». */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
